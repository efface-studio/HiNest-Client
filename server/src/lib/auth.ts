import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "./db.js";
import { runWithTenant } from "./tenant.js";

// JWT_SECRET 은 언제나 필수. NODE_ENV 누락/오탈자로 프로덕션에서 하드코딩 fallback 이 쓰이는
// 사고를 막기 위해, 개발 모드에서도 명시적으로 .env 에 지정하도록 강제한다.
// 다만 개발 편의를 위해 ALLOW_DEV_JWT_SECRET=1 이면 임의 개발 시크릿을 허용.
const IS_PROD = process.env.NODE_ENV === "production";
const RAW_SECRET = process.env.JWT_SECRET;
const ALLOW_DEV_FALLBACK = !IS_PROD && process.env.ALLOW_DEV_JWT_SECRET === "1";
if (!RAW_SECRET || RAW_SECRET.length < 16) {
  if (!ALLOW_DEV_FALLBACK) {
    throw new Error(
      "JWT_SECRET 환경변수가 없거나 너무 짧습니다. 16자 이상의 강한 시크릿을 .env 에 지정하세요. " +
      "(개발 편의상 임시로 허용하려면 ALLOW_DEV_JWT_SECRET=1)"
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    "[auth] WARNING: JWT_SECRET 이 없어 개발용 임시 시크릿을 사용합니다. 프로덕션 기동 전에 반드시 .env 에 JWT_SECRET 을 설정하세요."
  );
}
const SECRET = RAW_SECRET ?? "hinest-dev-secret-change-me";
/**
 * requireAuth 가 매 요청마다 DB 에 날리는 user.findUnique 를 30초간 캐시.
 * - Fargate 태스크마다 독립 캐시 (Redis 불필요 — 30초 스탈 허용 범위 내).
 * - 유저 비활성화·권한 변경은 최대 30초 지연 반영 (기존 JWT 7일 만료보다 훨씬 짧음).
 * - 캐시는 최대 5000엔트리 → 5000 * ~500B ≈ 2.5MB 상한. 1만 명 이상 회사라면 LRU 도입.
 */
const _userCache = new Map<string, { user: any; exp: number }>();
const USER_CACHE_TTL = 30_000;
const USER_CACHE_MAX = 5_000;

async function getCachedUser(id: string): Promise<any | null> {
  const hit = _userCache.get(id);
  if (hit && hit.exp > Date.now()) return hit.user;
  const user = await prisma.user.findUnique({ where: { id } });
  if (user) {
    if (_userCache.size >= USER_CACHE_MAX) {
      // 가장 오래된 키 하나 제거 (Map 삽입 순 보장).
      _userCache.delete(_userCache.keys().next().value!);
    }
    _userCache.set(id, { user, exp: Date.now() + USER_CACHE_TTL });
  }
  return user;
}

/** 유저 정보가 변경됐을 때 캐시에서 즉시 제거 (관리자 편집, 비활성화 등). */
export function evictUserCache(id: string) {
  _userCache.delete(id);
}

/** 세션 유효성 캐시 — revoke 이후 최대 30초 지연 반영. 강제 로그아웃에 충분히 빠른 반응성. */
const _sessionCache = new Map<string, { revoked: boolean; exp: number }>();
const SESSION_CACHE_TTL = 30_000;

async function isSessionRevoked(sid: string): Promise<boolean> {
  const hit = _sessionCache.get(sid);
  if (hit && hit.exp > Date.now()) return hit.revoked;
  const row = await prisma.session.findUnique({
    where: { id: sid },
    select: { revokedAt: true },
  });
  // row 없는 케이스 = 레거시 클라이언트가 보낸 가짜 sid 거나, DB 정리됨. 안전하게 revoked 처리.
  const revoked = !row || row.revokedAt !== null;
  _sessionCache.set(sid, { revoked, exp: Date.now() + SESSION_CACHE_TTL });
  return revoked;
}

export function evictSessionCache(sid: string) {
  _sessionCache.delete(sid);
}

const COOKIE = "hinest_token";
const SUPER_COOKIE = "hinest_super";
const IMP_COOKIE = "hinest_imp";
const SUPER_TTL_SEC = 15 * 60; // 15분
const IMP_TTL_SEC = 60 * 60; // 1시간 — 디버깅 세션은 길게 가지 않도록
const COOKIE_BASE = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: IS_PROD,
  path: "/",
};

// Capacitor 네이티브 앱 WebView 의 origin — iOS: capacitor://localhost, Android: https://localhost.
// 이 origin 들은 API 서버(예: nest.hi-vits.com)와 cross-site 라서 SameSite=Lax 쿠키가 전송되지 않는다.
// 따라서 네이티브에서 들어온 요청에만 SameSite=None;Secure 로 발급해 cross-site 전송을 허용한다.
// 웹/데스크톱은 기존 Lax 를 유지(추가 방어선) — 어차피 Origin 체크 CSRF 미들웨어가 양쪽 다 보호한다.
export const NATIVE_ORIGINS = (process.env.CAPACITOR_ORIGINS ?? "capacitor://localhost,https://localhost")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function isNativeOrigin(req?: Request): boolean {
  const o = req?.headers?.origin;
  return !!o && NATIVE_ORIGINS.includes(o);
}

/**
 * Authorization: Bearer <jwt> 헤더에서 세션 토큰 추출.
 *
 * 네이티브 앱(Capacitor WebView)은 origin 이 https://localhost 라, 다른 도메인인 API 서버가
 * 발급한 세션 쿠키가 cross-site(third-party)로 취급돼 iOS WKWebView 의 추적 방지(ITP)에
 * 막힌다 — 로그인 직후엔 메모리로 동작하지만 새로고침하면 쿠키 없이 /api/me 가 호출돼 401 →
 * 로그아웃. 그래서 네이티브는 쿠키 대신 Bearer 헤더로 같은 JWT 를 보낸다. 웹/데스크톱은
 * 헤더가 없으므로 기존 httpOnly 쿠키 경로를 그대로 탄다(동작 변화 없음).
 */
function bearerToken(req: Request): string | undefined {
  const h = req.headers?.authorization;
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : undefined;
}

// 네이티브 origin 이면 cross-site 쿠키(None;Secure), 아니면 기존 Lax 베이스.
// set/clear 가 같은 base 를 써야 브라우저가 쿠키를 실제로 지운다 — 호출부에서 req 를 함께 넘길 것.
function cookieBase(req?: Request) {
  if (isNativeOrigin(req)) {
    return { httpOnly: true, sameSite: "none" as const, secure: true, path: "/" };
  }
  return COOKIE_BASE;
}

export interface AuthUser {
  id: string;
  role: string;
  name: string;
  email: string;
  superAdmin: boolean;
  // 소속 회사(테넌트) id. 플랫폼 운영자는 null.
  companyId: string | null;
  // 플랫폼 운영자 — 테넌트를 가로지르는 최상위 권한 (회사 가입 승인 등).
  platformAdmin: boolean;
}

export function signToken(
  user: { id: string; role: string; name: string; email: string; companyId?: string | null },
  sessionId?: string,
) {
  return jwt.sign({ ...user, sid: sessionId }, SECRET, { expiresIn: "7d" });
}

/** 로그인 성공 시 호출 — 새 Session row 생성 후 sessionId 반환. JWT 에 박아두면
 *  서버에서 revokedAt 로 즉시 무효화 가능. */
export async function createSession(userId: string, req: Request): Promise<string> {
  const ua = (req.headers["user-agent"] || "").slice(0, 200) || null;
  const ip = req.ip ?? null;
  const s = await prisma.session.create({
    data: { userId, ua, ip },
    select: { id: true },
  });
  return s.id;
}

export function setAuthCookie(res: Response, token: string, req?: Request) {
  res.cookie(COOKIE, token, {
    ...cookieBase(req),
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });
}

export function clearAuthCookie(res: Response, req?: Request) {
  res.clearCookie(COOKIE, cookieBase(req));
}

/**
 * ?token= 쿼리를 Authorization: Bearer 로 승격(헤더·쿠키가 없을 때만).
 * <img>·EventSource 처럼 커스텀 헤더를 못 싣는 클라이언트가 인증하도록 — 네이티브 SSE 스트림용.
 * (EventSource 는 헤더를 못 싣고 네이티브 쿠키는 cross-site ITP 로 막히므로 쿼리 토큰이 유일한 경로.)
 * requireAuth 앞에 두고, GET 스트림처럼 안전한 라우트에만 적용한다. (/api/notification/stream 은
 * 접근 로그에서도 제외되어 토큰 노출 없음.)
 */
export function queryTokenAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.headers.authorization && typeof req.query.token === "string" && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  // 네이티브 앱은 Bearer 헤더, 웹/데스크톱은 httpOnly 쿠키. 헤더 우선, 없으면 쿠키 폴백.
  const token = bearerToken(req) ?? req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: "unauthorized" });
  try {
    const payload = jwt.verify(token, SECRET) as any;
    // sid 없는 레거시 토큰은 서버측 세션 무효화(revokedAt) 를 적용할 수 없으므로 거부.
    // 강제 로그아웃·계정 비활성화 즉시 차단이 보장되어야 하기 때문.
    if (!payload.sid) {
      return res.status(401).json({ error: "session expired", code: "LEGACY_TOKEN" });
    }
    if (await isSessionRevoked(payload.sid)) {
      return res.status(401).json({ error: "session revoked", code: "SESSION_REVOKED" });
    }
    const realUser = await getCachedUser(payload.id);
    if (!realUser || !realUser.active) return res.status(401).json({ error: "unauthorized" });

    // 임퍼소네이션 — 총관리자가 다른 유저로 보기.
    // 원본 인증은 그대로 두고, req.user 만 타깃 유저로 바꾼다. 모든 audit 액션은 진짜 사용자(=원본)
    // 와 함께 기록되도록 req.impersonator 에 보관.
    let activeUser = realUser;
    let impersonatedById: string | null = null;
    const impTok = req.cookies?.[IMP_COOKIE];
    if (impTok && realUser.superAdmin) {
      try {
        const ip = jwt.verify(impTok, SECRET) as any;
        if (ip.kind === "imp" && ip.actor === realUser.id && typeof ip.sub === "string") {
          const target = await getCachedUser(ip.sub);
          if (target && target.active) {
            activeUser = target;
            impersonatedById = realUser.id;
          }
        }
      } catch {
        // 만료/위변조 — 무시하고 일반 인증으로 진행
      }
    }

    (req as any).user = {
      id: activeUser.id,
      role: activeUser.role,
      name: activeUser.name,
      email: activeUser.email,
      superAdmin: activeUser.superAdmin,
      companyId: activeUser.companyId ?? null,
      platformAdmin: activeUser.platformAdmin,
    } as AuthUser;
    // 핸들러에서 user row 가 또 필요하면 재조회하지 말고 이거 쓰기 — /api/me 처럼
    // 인증만 거치고 바로 user 필드를 되돌려주는 엔드포인트에서 DB 왕복 1번 절약.
    (req as any).userRecord = activeUser;
    (req as any).realUser = realUser;
    (req as any).impersonatedById = impersonatedById;
    (req as any).sessionId = payload.sid ?? null;
    // 이후 모든 핸들러를 테넌트 컨텍스트 안에서 실행 → Prisma 쿼리가 자동으로 companyId 로 스코프된다.
    // 플랫폼 운영자(platformAdmin)는 테넌트를 가로지르므로 bypass=true 로 스코프를 해제한다.
    runWithTenant(
      { companyId: activeUser.companyId ?? null, bypass: !!activeUser.platformAdmin },
      () => next(),
    );
  } catch {
    return res.status(401).json({ error: "unauthorized" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const u = (req as any).user as AuthUser | undefined;
  if (!u || u.role !== "ADMIN") return res.status(403).json({ error: "forbidden" });
  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const u = (req as any).user as AuthUser | undefined;
  if (!u || !u.superAdmin) return res.status(403).json({ error: "forbidden" });
  next();
}

/**
 * 플랫폼 운영(회사 가입 승인 등 테넌트를 가로지르는 최상위 작업) 접근 가드.
 * 플랫폼 운영자(platformAdmin)뿐 아니라 개발자(superAdmin)도 허용한다 — 개발자는
 * 최상위 권한이므로 회사 관리 콘솔을 항상 볼 수 있어야 한다. (스코프 우회는 라우터에서
 * runUnscoped 로 명시 처리 — superAdmin 세션은 평소 자기 회사로 스코프되기 때문.)
 */
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  const u = (req as any).user as AuthUser | undefined;
  if (!u || (!u.platformAdmin && !u.superAdmin)) return res.status(403).json({ error: "forbidden" });
  next();
}

/* ---- Super admin step-up (비밀번호 재인증) ---- */
export function signSuper(userId: string) {
  return jwt.sign({ sub: userId, kind: "super" }, SECRET, {
    expiresIn: `${SUPER_TTL_SEC}s`,
  });
}

export function setSuperCookie(res: Response, token: string, req?: Request) {
  res.cookie(SUPER_COOKIE, token, {
    ...cookieBase(req),
    maxAge: SUPER_TTL_SEC * 1000,
  });
}

export function clearSuperCookie(res: Response, req?: Request) {
  res.clearCookie(SUPER_COOKIE, cookieBase(req));
}

export function verifySuperToken(req: Request, userId: string): { exp: number } | null {
  const tok = (req as any).cookies?.[SUPER_COOKIE];
  if (!tok) return null;
  try {
    const p = jwt.verify(tok, SECRET) as any;
    if (p.sub !== userId || p.kind !== "super") return null;
    return { exp: p.exp * 1000 };
  } catch {
    return null;
  }
}

/** 총관리자 민감 액션용: JWT 본인 + 초최근 비밀번호 재인증 필요 */
export function requireSuperAdminStepUp(req: Request, res: Response, next: NextFunction) {
  const u = (req as any).user as AuthUser | undefined;
  if (!u || !u.superAdmin) return res.status(403).json({ error: "forbidden" });
  const v = verifySuperToken(req, u.id);
  if (!v) {
    return res.status(401).json({
      error: "비밀번호 재확인이 필요합니다",
      code: "SUPER_STEPUP_REQUIRED",
    });
  }
  (req as any).superExpiresAt = v.exp;
  next();
}

export { SUPER_TTL_SEC, IMP_TTL_SEC };

/* ---- Impersonation (사용자 대신 보기) ---- */
export function signImpersonate(actorId: string, targetId: string) {
  return jwt.sign({ actor: actorId, sub: targetId, kind: "imp" }, SECRET, {
    expiresIn: `${IMP_TTL_SEC}s`,
  });
}

export function setImpCookie(res: Response, token: string, req?: Request) {
  res.cookie(IMP_COOKIE, token, {
    ...cookieBase(req),
    maxAge: IMP_TTL_SEC * 1000,
  });
}

export function clearImpCookie(res: Response, req?: Request) {
  res.clearCookie(IMP_COOKIE, cookieBase(req));
}

/** 진짜 super-admin 권한 체크 — 임퍼소네이션 중에도 원본 사용자가 super 면 통과시키는 변종.
 *  imp 시작/종료 자체엔 쓰지 말 것 (이미 stepup 으로 보호됨). */
export function isRealSuperAdmin(req: Request): boolean {
  const real = (req as any).realUser;
  return !!real?.superAdmin;
}

export async function writeLog(userId: string | null, action: string, target?: string, detail?: string, ip?: string) {
  try {
    await prisma.auditLog.create({
      data: { userId: userId ?? undefined, action, target, detail, ip },
    });
  } catch (e) {
    console.error("audit log failed", e);
  }
}
