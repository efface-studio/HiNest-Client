import crypto from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { notifyAllUsers } from "../lib/notify.js";
import { sendEmail } from "../lib/email.js";
import {
  signToken,
  setAuthCookie,
  clearAuthCookie,
  writeLog,
  requireAuth,
  signSuper,
  setSuperCookie,
  clearSuperCookie,
  clearImpCookie,
  verifySuperToken,
  SUPER_TTL_SEC,
  requireSuperAdminStepUp,
  createSession,
  evictSessionCache,
  isNativeOrigin,
} from "../lib/auth.js";

const router = Router();

// 타이밍 공격 방어용 더미 해시 — 가입되지 않은 이메일로도 동일하게 bcrypt.compare 가
// 호출되도록 만들어, \"존재하는 이메일\" 과 \"없는 이메일\" 의 응답 시간 차이로 가입 여부를
// 추측하지 못하게 한다. 모듈 로드 시 한 번만 생성 (rounds 12 — 실제 사용자와 동일 비용).
// 임의 32바이트 토큰을 해시해 절대 일치하지 않는 정상 포맷의 해시를 만든다.
const TIMING_DUMMY_HASH = bcrypt.hashSync(
  Math.random().toString(36) + Date.now().toString(36),
  12,
);

const loginSchema = z.object({
  // 이메일 전용. 과거에는 사내 ID 도 허용했지만 정책 단순화로 이메일로만 로그인.
  email: z.string().email().max(200).transform((s) => s.trim().toLowerCase()),
  // bcrypt 는 72바이트 초과를 조용히 자르지만, 과도한 페이로드로 CPU 낭비 시키는
  // 슬로우 해시 DoS 를 막기 위해 128자 상한.
  password: z.string().min(1).max(128),
});

/**
 * 유니크한 사번(employeeNo)을 자동 생성.
 * 포맷: HB + 6자리 숫자 (예: HB123456)
 * 충돌 시 최대 50회 재시도 후 타임스탬프 기반 fallback.
 */
export async function generateUniqueEmployeeNo(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const n = Math.floor(100000 + Math.random() * 900000);
    const candidate = `HB${n}`;
    const dup = await prisma.user.findFirst({
      where: { employeeNo: candidate },
      select: { id: true },
    });
    if (!dup) return candidate;
  }
  return `HB${Date.now().toString().slice(-8)}`;
}

// === User enumeration 방어 ===
// 로그인 응답 본문은 4가지 분기(존재X / 비활성 / 잠금 / 비번오답) 모두 같은 모양이어야 한다.
// 이전엔 "남은 시도: N회" 접미사 / ACCOUNT_LOCKED 코드 / 잠금 안내 메시지가 분기마다 달라서
// 공격자가 응답만 보고 "이 이메일이 가입돼 있나?" 를 100% 판정할 수 있었다.
// 잠겨있던 본인은 메일로 받은 재설정 링크로 해제할 수 있으니 안내가 없어도 막히지 않는다.
const GENERIC_LOGIN_ERROR = "잘못된 이메일 또는 비밀번호";

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });

  // === 타이밍 공격 방어 ===
  // 이메일이 없어도 / 비활성이어도 / 잠겨있어도, 일단 bcrypt.compare 는 항상 한 번 수행.
  // 그래야 "가입된 이메일" 과 "없는 이메일" 의 응답 시간 차이가 사라져 이메일 enumeration 불가.
  // 분기 결과(로그/응답)는 그 후 균일하게 처리.
  const hashToCompare = user?.passwordHash ?? TIMING_DUMMY_HASH;
  const compareOk = await bcrypt.compare(password, hashToCompare);

  // 사용자 부재 / 비활성 — 응답은 다른 분기와 같은 모양.
  if (!user || !user.active) {
    return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
  }
  // 잠금 — 감사 로그는 남기되, 응답 본문은 일반 실패와 동일하게 (enumeration 방어).
  if (user.lockedAt) {
    await writeLog(user.id, "LOGIN_BLOCKED", user.email, "account locked", req.ip);
    return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
  }

  const ok = compareOk;
  if (!ok) {
    // 실패 카운터 증가. 5 회 누적 시 잠금.
    const nextCount = (user.failedLoginCount ?? 0) + 1;
    const shouldLock = nextCount >= 5;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: nextCount, ...(shouldLock ? { lockedAt: new Date() } : {}) },
    });
    if (shouldLock) {
      await writeLog(user.id, "LOGIN_LOCKED", user.email, `fails=${nextCount}`, req.ip);
    } else {
      await writeLog(user.id, "LOGIN_FAIL", user.email, `fails=${nextCount}/5`, req.ip);
    }
    // 응답은 일관 — "남은 시도", "잠겼습니다" 등 enumeration 단서가 되는 정보 제거.
    return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
  }

  // 성공 시 카운터 리셋.
  if ((user.failedLoginCount ?? 0) > 0) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0 },
    });
  }

  // ── 회사(테넌트) 상태 게이트 ──
  // 가입 승인된(ACTIVE) 회사의 사용자만 로그인 허용. 플랫폼 운영자는 회사 소속이 없으므로 통과.
  // 비밀번호가 이미 맞은 뒤이므로 enumeration 누수 없음 (자격증명을 아는 사람에게만 노출).
  if (!user.platformAdmin) {
    const company = user.companyId
      ? await prisma.company.findUnique({ where: { id: user.companyId }, select: { status: true } })
      : null;
    const status = company?.status ?? null;
    if (status !== "ACTIVE") {
      await writeLog(user.id, "LOGIN_BLOCKED_COMPANY", user.email, `company=${user.companyId ?? "none"} status=${status ?? "none"}`, req.ip);
      const code =
        status === "PENDING" ? "COMPANY_PENDING"
        : status === "SUSPENDED" ? "COMPANY_SUSPENDED"
        : status === "REJECTED" ? "COMPANY_REJECTED"
        : "COMPANY_INACTIVE";
      const error =
        status === "PENDING" ? "가입 승인 대기 중입니다. 승인 후 로그인할 수 있어요."
        : status === "SUSPENDED" ? "일시 정지된 회사 계정입니다. 운영자에게 문의해 주세요."
        : status === "REJECTED" ? "가입이 반려된 회사입니다. 운영자에게 문의해 주세요."
        : "사용할 수 없는 회사 계정입니다.";
      return res.status(403).json({ error, code });
    }
  }

  const sid = await createSession(user.id, req);
  const token = signToken({ id: user.id, role: user.role, name: user.name, email: user.email, companyId: user.companyId }, sid);
  setAuthCookie(res, token, req);
  await writeLog(user.id, "LOGIN", user.email, `sid=${sid}`, req.ip);

  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      team: user.team,
      position: user.position,
      avatarColor: user.avatarColor,
      avatarUrl: user.avatarUrl,
      superAdmin: user.superAdmin,
    },
    // 네이티브 앱(Capacitor)은 cross-site 쿠키가 ITP 에 막혀 새로고침 시 세션이 끊긴다.
    // 네이티브 origin 일 때만 세션 JWT 를 본문으로 함께 내려, 클라가 저장해 Authorization
    // 헤더로 보낸다. 웹/데스크톱은 토큰을 본문에 노출하지 않음(httpOnly 쿠키만 사용).
    ...(isNativeOrigin(req) ? { token } : {}),
  });
});

const signupSchema = z.object({
  inviteKey: z.string().min(4).max(100),
  email: z.string().email().max(200).transform((s) => s.trim().toLowerCase()),
  name: z.string().min(1).max(200),
  // 8자 이상 — 6자는 현대 기준으로 너무 약함. 기존 계정은 그대로 사용 가능하고 다음 변경 시 8자 요구.
  // bcrypt 72바이트 한계 가이드 + 슬로우 해시 DoS 방지로 128자 상한.
  password: z.string().min(8).max(128),
});

router.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "입력값을 확인해주세요 (비밀번호는 8자 이상)" });
  const { inviteKey, email, name, password } = parsed.data;

  // 사전 검증 — 트랜잭션 밖에서 빠르게 거를 수 있는 케이스만.
  // 진짜 race-safe 한 \"사용 가능 여부\" 판단은 트랜잭션 안의 atomic updateMany 가 결정.
  const key = await prisma.inviteKey.findUnique({ where: { key: inviteKey } });
  if (!key) return res.status(400).json({ error: "유효하지 않은 초대키" });
  if (key.expiresAt && key.expiresAt < new Date()) return res.status(400).json({ error: "만료된 초대키" });
  if (key.email && key.email.toLowerCase() !== email.toLowerCase())
    return res.status(400).json({ error: "초대키에 등록된 이메일과 일치하지 않습니다" });

  // 2026 기준 bcrypt rounds 12 — 로그인/가입 지연은 체감 없고 GPU 공격 비용은 4x 증가.
  const passwordHash = await bcrypt.hash(password, 12);
  const employeeNo = await generateUniqueEmployeeNo();

  // 초대키 발급자의 회사를 신규 유저에게 승계 (멀티테넌시).
  // 발급자/회사를 못 찾으면 기본 회사로 폴백 — 단일 회사 단계의 레거시 키 호환.
  let targetCompanyId = "company_default";
  if (key.createdById) {
    const inviter = await prisma.user.findUnique({
      where: { id: key.createdById },
      select: { companyId: true },
    });
    if (inviter?.companyId) targetCompanyId = inviter.companyId;
  }

  // ===== Atomic claim + create =====
  // 이전엔 (1) findUnique 로 used=false 확인 → (2) user.create → (3) inviteKey.update used=true 였는데
  // (1) 과 (3) 사이에 같은 초대키로 동시 요청이 들어오면 둘 다 used=false 를 보고 통과 → 키 1개로 N명 가입.
  // updateMany({ where:{id, used:false}, data:{used:true} }) 는 \"하나만 통과\" 를 DB 가 보장하므로
  // 트랜잭션 안에서 이 결과 count 를 보고 분기하면 어떤 동시성 시나리오에서도 단 한 명만 가입한다.
  let user: { id: string; email: string; name: string; role: string; team: string | null; position: string | null; avatarColor: string; avatarUrl: string | null; superAdmin: boolean; companyId: string | null };
  try {
    user = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const claim = await tx.inviteKey.updateMany({
        where: {
          id: key.id,
          used: false,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        data: { used: true, usedAt: now },
      });
      if (claim.count === 0) {
        throw Object.assign(new Error("이미 사용된 초대키"), { _http: 400 });
      }
      const created = await tx.user.create({
        data: {
          email,
          name,
          passwordHash,
          role: key.role,
          team: key.team,
          position: key.position,
          employeeNo,
          companyId: targetCompanyId,
        },
      });
      // usedById 는 user.id 가 있어야 채울 수 있어 같은 트랜잭션 안에서 추가 update.
      await tx.inviteKey.update({
        where: { id: key.id },
        data: { usedById: created.id },
      });
      return {
        id: created.id, email: created.email, name: created.name, role: created.role,
        team: created.team, position: created.position,
        avatarColor: created.avatarColor, avatarUrl: created.avatarUrl, superAdmin: created.superAdmin,
        companyId: created.companyId,
      };
    }, {
      isolationLevel: "Serializable",
      // 명시적 timeout — 기본 5초는 bcrypt 비번 해싱이 끝나기 전 lock 잡을 수 있음을
      // 고려하면 짧다. 트랜잭션은 짧고 (updateMany + create + update), Serializable
      // retry 까지 고려해 10초.
      timeout: 10_000,
    });
  } catch (e: any) {
    // 동시성 충돌 또는 race 결과. 메시지는 통일.
    if (e?._http === 400) return res.status(400).json({ error: e.message });
    // Prisma unique violation (이메일 중복 등) — 일반 메시지로.
    if (e?.code === "P2002") return res.status(400).json({ error: "이미 가입된 이메일이거나 충돌이 발생했습니다" });
    throw e;
  }

  const sid = await createSession(user.id, req);
  const token = signToken({ id: user.id, role: user.role, name: user.name, email: user.email, companyId: user.companyId }, sid);
  setAuthCookie(res, token, req);
  await writeLog(user.id, "SIGNUP", user.email, `invite:${inviteKey} sid=${sid}`, req.ip);

  // 신규 가입 안내 — 본인 제외 모든 활성 사용자에게 종 + SSE 알림.
  // notifyAllUsers 가 사용자 NotificationPref(NOTICE 타입) 도 함께 확인하므로 옵트아웃한 사람은 자동 스킵.
  // 가입 응답을 막지 않도록 fire-and-forget.
  notifyAllUsers({
    type: "NOTICE",
    title: `🎉 ${user.name} 님이 합류했어요`,
    body: [user.team, user.position].filter(Boolean).join(" · ") || "환영해 주세요!",
    linkUrl: `/users/${user.id}`,
    actorName: user.name,
    actorColor: user.avatarColor,
  }, user.id, user.companyId).catch((e) => console.error("[signup] notifyAllUsers failed", e));

  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      team: user.team,
      position: user.position,
      avatarColor: user.avatarColor,
      avatarUrl: user.avatarUrl,
      superAdmin: user.superAdmin,
    },
    // 로그인과 동일 — 네이티브 origin 에만 세션 토큰을 본문으로 함께 내린다.
    ...(isNativeOrigin(req) ? { token } : {}),
  });
});

/* ===== 회사 가입 신청 (멀티테넌시) =====
 * 누구나 회사를 신청할 수 있다. 신청 시 Company(status=PENDING) + 첫 ADMIN User 를 생성.
 * 플랫폼 운영자가 승인(ACTIVE)하기 전까지는 로그인이 차단되므로 세션/쿠키를 발급하지 않는다.
 */
const companySignupSchema = z.object({
  companyName: z.string().min(1).max(200),
  contactName: z.string().min(1).max(100),
  email: z.string().email().max(200).transform((s) => s.trim().toLowerCase()),
  password: z.string().min(8).max(128),
  contactPhone: z.string().max(40).optional(),
  bizRegNo: z.string().max(40).optional(),
});

router.post("/company-signup", async (req, res) => {
  const parsed = companySignupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "입력값을 확인해주세요 (비밀번호는 8자 이상)" });
  const { companyName, contactName, email, password, contactPhone, bizRegNo } = parsed.data;

  // 이메일은 글로벌 유니크 — 트랜잭션 안 unique 위반으로도 막히지만 빠른 분기용 사전 체크.
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return res.status(400).json({ error: "이미 가입된 이메일입니다" });

  const passwordHash = await bcrypt.hash(password, 12);
  const employeeNo = await generateUniqueEmployeeNo();

  let companyId: string;
  try {
    companyId = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: companyName,
          status: "PENDING",
          contactName,
          contactEmail: email,
          contactPhone: contactPhone ?? null,
          bizRegNo: bizRegNo ?? null,
        },
      });
      await tx.user.create({
        data: {
          email,
          name: contactName,
          passwordHash,
          role: "ADMIN", // 회사의 첫 관리자
          employeeNo,
          companyId: company.id,
        },
      });
      return company.id;
    });
  } catch (e: any) {
    if (e?.code === "P2002") return res.status(400).json({ error: "이미 가입된 이메일이거나 충돌이 발생했습니다" });
    throw e;
  }

  await writeLog(null, "COMPANY_SIGNUP", companyId, `${companyName} / ${email}`, req.ip);
  // 승인 전까지 로그인 불가 — 세션/쿠키 발급하지 않는다.
  res.json({ ok: true, status: "PENDING" });
});

router.post("/logout", requireAuth, async (req, res) => {
  // 현재 세션 row 도 revoke — 다른 디바이스 세션은 유지.
  const sid = (req as any).sessionId as string | null;
  if (sid) {
    try {
      await prisma.session.update({
        where: { id: sid },
        data: { revokedAt: new Date(), revokedById: (req as any).user?.id },
      });
      evictSessionCache(sid);
    } catch { /* ignore */ }
  }
  clearAuthCookie(res, req);
  clearSuperCookie(res, req);
  // 임퍼소네이트 쿠키도 함께 클리어 — 같은 브라우저로 다시 로그인했을 때 이전 impersonation
  // 컨텍스트가 의도치 않게 되살아나는 걸 막는다. 이전엔 clearImpCookie 호출이 빠져서
  // 1시간 동안 잔류하다 같은 super-admin 로그인 시 자동 재활성화됐었다.
  clearImpCookie(res, req);
  res.json({ ok: true });
});

/* ===== 총관리자 step-up (비밀번호 재확인) ===== */
router.post("/step-up", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const user = await prisma.user.findUnique({ where: { id: u.id } });
  if (!user || !user.superAdmin) return res.status(403).json({ error: "forbidden" });
  // 로그인/가입 schema 와 동일한 128자 상한. 제한 없이 bcrypt.compare 에
  // 넘기면 슬로우 해시 DoS 벡터.
  const rawPw = String(req.body?.password ?? "");
  const password = rawPw.length > 128 ? rawPw.slice(0, 128) : rawPw;
  if (!password) return res.status(400).json({ error: "비밀번호를 입력해주세요" });

  // 총관리자는 반드시 별도의 super 비밀번호가 설정되어 있어야 함 — 일반 비밀번호 fallback 금지.
  // 처음 super 권한을 받은 직후엔 superPasswordHash 가 null 이라 클라가 \"setup\" 화면으로 분기할 수 있도록
  // 별도 코드 반환.
  if (!user.superPasswordHash) {
    await writeLog(user.id, "SUPER_STEPUP_FAIL", undefined, "no_super_password_set", req.ip);
    return res.status(403).json({
      error: "총관리자 전용 비밀번호가 아직 설정되지 않았어요. 처음 설정해 주세요.",
      code: "SUPER_PW_NOT_SET",
    });
  }
  const ok = await bcrypt.compare(password, user.superPasswordHash);
  if (!ok) {
    await writeLog(user.id, "SUPER_STEPUP_FAIL", undefined, undefined, req.ip);
    return res.status(401).json({ error: "비밀번호가 일치하지 않습니다" });
  }

  const token = signSuper(user.id);
  setSuperCookie(res, token, req);
  await writeLog(user.id, "SUPER_STEPUP_OK", undefined, `ttl=${SUPER_TTL_SEC}s`, req.ip);
  res.json({ ok: true, expiresAt: Date.now() + SUPER_TTL_SEC * 1000 });
});

/* ===== 총관리자 step-up 비밀번호 최초 설정 / 변경 =====
 * 보안 정책:
 *   - 최초 설정: 본인의 "일반 로그인 비밀번호" 를 다시 입력해야 함 — 세션 쿠키만 탈취된
 *     공격자가 step-up 비번을 마음대로 처음 설정하고 그 비번으로 step-up 하는 우회를 차단.
 *   - 변경: 기존 super 비번 검증.
 *   - 8~128자, 본인의 일반 로그인 비밀번호와 다르게 (재사용 방지).
 */
router.post("/super-password", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const user = await prisma.user.findUnique({ where: { id: u.id } });
  if (!user || !user.superAdmin) return res.status(403).json({ error: "forbidden" });

  const rawNew = String(req.body?.next ?? "");
  const next = rawNew.length > 128 ? rawNew.slice(0, 128) : rawNew;
  if (!next || next.length < 8) return res.status(400).json({ error: "8자 이상 입력해 주세요" });

  const sameAsLogin = await bcrypt.compare(next, user.passwordHash).catch(() => false);
  if (sameAsLogin) {
    return res.status(400).json({ error: "일반 로그인 비밀번호와 달라야 해요" });
  }

  if (user.superPasswordHash) {
    // 변경 모드 — 기존 super 비번으로 본인 확인.
    const rawCur = String(req.body?.current ?? "");
    const current = rawCur.length > 128 ? rawCur.slice(0, 128) : rawCur;
    if (!current) return res.status(400).json({ error: "현재 총관리자 비밀번호가 필요해요" });
    const ok = await bcrypt.compare(current, user.superPasswordHash);
    if (!ok) {
      await writeLog(user.id, "SUPER_PW_CHANGE_FAIL", undefined, undefined, req.ip);
      return res.status(401).json({ error: "현재 총관리자 비밀번호가 일치하지 않아요" });
    }
  } else {
    // 최초 설정 모드 — 세션 쿠키 단독으로 super 비번을 새로 만드는 우회를 막기 위해
    // "일반 로그인 비밀번호" 를 다시 입력받아 검증한다. (cookie != "본인 확인")
    const rawLogin = String(req.body?.loginPassword ?? "");
    const loginPw = rawLogin.length > 128 ? rawLogin.slice(0, 128) : rawLogin;
    if (!loginPw) return res.status(400).json({ error: "로그인 비밀번호로 본인 확인이 필요해요" });
    const ok = await bcrypt.compare(loginPw, user.passwordHash);
    if (!ok) {
      await writeLog(user.id, "SUPER_PW_SET_FAIL", undefined, "login-pw mismatch", req.ip);
      return res.status(401).json({ error: "로그인 비밀번호가 일치하지 않아요" });
    }
  }

  const hash = await bcrypt.hash(next, 12);
  await prisma.user.update({ where: { id: user.id }, data: { superPasswordHash: hash } });
  await writeLog(user.id, user.superPasswordHash ? "SUPER_PW_CHANGE" : "SUPER_PW_SET", undefined, undefined, req.ip);
  res.json({ ok: true, firstTime: !user.superPasswordHash });
});

/**
 * ===== 데스크톱 앱 전용 생체 인증 =====
 * Electron Chromium 이 macOS Touch ID 를 WebAuthn 플랫폼 인증기로 노출하지 못해서,
 * main 프로세스가 직접 systemPreferences.promptTouchID 로 OS 프롬프트를 띄우는 별도 경로.
 *
 * 등록 플로우:
 *   1. 총관리자가 비번으로 1차 step-up (기존 /auth/step-up)
 *   2. step-up 상태에서 /auth/desktop-biometric/enroll 로 현재 기기의 deviceId 등록
 * 잠금 해제:
 *   3. 다음부터는 OS Touch ID 통과 + (userId, deviceId) 가 등록되어 있으면 super cookie 발급
 *
 * deviceId 는 Electron userData 폴더에 저장된 랜덤 UUID (main 프로세스가 생성).
 * 사용자가 직접 수정할 수 없고 앱 재설치 시 재생성됨.
 */
router.get("/desktop-biometric", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const list = await prisma.desktopBiometric.findMany({
    where: { userId: u.id },
    orderBy: { createdAt: "desc" },
    // deviceId 는 반환하지 않음 — Electron 앱은 로컬 userData 에서 직접 읽으며
    // 서버 응답을 통해 노출하면 세션 탈취 시 super step-up 우회에 악용될 수 있음.
    select: { id: true, deviceName: true, createdAt: true, lastUsedAt: true },
  });
  res.json({ devices: list });
});

router.post("/desktop-biometric/enroll", requireAuth, requireSuperAdminStepUp, async (req, res) => {
  const u = (req as any).user;
  const isDesktop = req.get("x-hinest-desktop") === "1";
  if (!isDesktop) return res.status(400).json({ error: "데스크톱 앱에서만 등록할 수 있어요" });

  // deviceId 는 Electron 에서 생성한 UUID (32~36자) — 128자면 여유 있음. 상한 없이 둘 경우
  // DB 유니크 인덱스에 수 MB 값이 들어가 저장/조회 비용이 튀고, passkey.ts 와도 format
  // 의도 일치.
  const rawDevId = String(req.body?.deviceId ?? "").trim();
  const deviceId = rawDevId.length > 128 ? rawDevId.slice(0, 128) : rawDevId;
  const rawDevName = String(req.body?.deviceName ?? "").trim();
  const deviceName = rawDevName ? (rawDevName.length > 80 ? rawDevName.slice(0, 80) : rawDevName) : null;
  if (!deviceId || deviceId.length < 8) return res.status(400).json({ error: "invalid deviceId" });

  const row = await prisma.desktopBiometric.upsert({
    where: { userId_deviceId: { userId: u.id, deviceId } },
    create: { userId: u.id, deviceId, deviceName },
    update: { deviceName: deviceName ?? undefined },
  });
  await writeLog(u.id, "DESKTOP_BIO_ENROLL", row.id.slice(0, 8), deviceName ?? undefined, req.ip);
  res.json({ ok: true, id: row.id });
});

router.delete("/desktop-biometric/:id", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const row = await prisma.desktopBiometric.findUnique({ where: { id: req.params.id } });
  if (!row || row.userId !== u.id) return res.status(404).json({ error: "not found" });
  await prisma.desktopBiometric.delete({ where: { id: row.id } });
  await writeLog(u.id, "DESKTOP_BIO_REMOVE", row.id.slice(0, 8), row.deviceName ?? undefined, req.ip);
  res.json({ ok: true });
});

router.post("/desktop-biometric/stepup", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const isDesktop = req.get("x-hinest-desktop") === "1";
  if (!isDesktop) return res.status(400).json({ error: "데스크톱 앱에서만 사용할 수 있어요" });

  const user = await prisma.user.findUnique({ where: { id: u.id } });
  if (!user || !user.superAdmin) return res.status(403).json({ error: "forbidden" });

  const rawDevId = String(req.body?.deviceId ?? "").trim();
  const deviceId = rawDevId.length > 128 ? rawDevId.slice(0, 128) : rawDevId;
  if (!deviceId) return res.status(400).json({ error: "invalid deviceId" });

  const row = await prisma.desktopBiometric.findUnique({
    where: { userId_deviceId: { userId: u.id, deviceId } },
  });
  if (!row) {
    await writeLog(user.id, "SUPER_STEPUP_FAIL_DESKTOP_BIO", deviceId.slice(0, 8), "not_enrolled", req.ip);
    return res.status(403).json({ error: "이 기기는 Touch ID 등록이 되어있지 않아요", code: "NOT_ENROLLED" });
  }

  await prisma.desktopBiometric.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  const token = signSuper(user.id);
  setSuperCookie(res, token, req);
  await writeLog(user.id, "SUPER_STEPUP_OK_DESKTOP_BIO", row.id.slice(0, 8), row.deviceName ?? undefined, req.ip);
  res.json({ ok: true, expiresAt: Date.now() + SUPER_TTL_SEC * 1000 });
});

router.post("/step-down", requireAuth, async (req, res) => {
  const u = (req as any).user;
  clearSuperCookie(res, req);
  await writeLog(u.id, "SUPER_STEPDOWN", undefined, undefined, req.ip);
  res.json({ ok: true });
});

router.get("/super-session", requireAuth, async (req, res) => {
  const u = (req as any).user;
  if (!u.superAdmin) return res.json({ active: false });
  const v = verifySuperToken(req, u.id);
  if (!v) return res.json({ active: false });
  res.json({ active: true, expiresAt: v.exp });
});

/* ======================== 비밀번호 재설정 (잠긴 계정 자가 복구) ========================
 *
 * 흐름:
 *   1) POST /password-reset/request  { email }
 *      - 응답은 항상 200 (이메일 enumeration 차단 — 가입 여부 노출 X)
 *      - 유효한 활성 유저면 32바이트 토큰 생성 → SHA-256 해시만 DB 저장 → 메일 발송
 *      - 토큰 자체는 응답에 포함되지 않음. 오직 메일로만 전달.
 *      - 30분 1회용. 같은 유저의 이전 미사용 토큰은 재요청 시점에 만료 처리.
 *
 *   2) POST /password-reset/confirm  { token, newPassword }
 *      - tokenHash 매칭 + 만료/사용 검증 → 비밀번호 교체 → lockedAt/failedLoginCount 리셋
 *      - 같은 유저의 모든 세션 강제 로그아웃 (Session.revokedAt 채움)
 *      - 토큰 사용 처리 + 같은 유저의 다른 미사용 토큰도 같이 무효화
 */

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30분

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * 비밀번호 재설정 메일에 들어가는 base URL.
 *
 * 보안:
 *   프로덕션에서는 반드시 환경변수 PUBLIC_APP_URL 을 사용한다. 요청 Host 헤더 fallback 을
 *   허용하면 공격자가 password-reset/request 호출 시 Host: attacker.example 로 위장해
 *   피해자에게 자기 도메인이 박힌 리셋 링크를 메일로 보내게 만들 수 있다 (Host header injection).
 *
 *   - NODE_ENV === "production" 이고 PUBLIC_APP_URL 이 없으면 안전하게 default 운영 도메인 사용.
 *   - 개발 환경에서만 Host 헤더 fallback 허용.
 */
const PROD_DEFAULT_APP_URL = "https://nest.hi-vits.com";
function appBaseUrl(req: { headers: { host?: string }; protocol?: string }) {
  const fromEnv = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") return PROD_DEFAULT_APP_URL;
  const host = req.headers?.host ?? "localhost:5173";
  const proto = host.startsWith("localhost") ? "http" : "https";
  return `${proto}://${host}`;
}

router.post("/password-reset/request", async (req, res) => {
  const parsed = z.object({ email: z.string().email().max(200) }).safeParse(req.body);
  // 형식 오류라도 동일한 응답 — 폼 validation 은 클라가 책임. 서버는 enumeration 방어 우선.
  if (!parsed.success) return res.json({ ok: true });

  const email = parsed.data.email.toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, active: true, resignedAt: true },
  });

  // 유효한 계정이 아니면 발송 없이 200. 응답 차이로 enumeration 불가.
  if (!user || !user.active || user.resignedAt) {
    await writeLog(null, "PWD_RESET_REQUEST_MISS", undefined, email, req.ip);
    return res.json({ ok: true });
  }

  // 같은 유저의 기존 미사용 토큰 즉시 무효화 — 옛 메일 살아있어도 못 쓰게.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { expiresAt: new Date() },
  });

  // 32바이트 랜덤 → base64url. DB 엔 SHA-256 해시만 저장.
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt, ipRequested: req.ip ?? null },
  });

  const link = `${appBaseUrl(req)}/reset-password?token=${encodeURIComponent(token)}`;
  const subject = "[HiNest] 비밀번호 재설정 안내";
  const text = [
    `${user.name}님,`,
    "",
    "HiNest 비밀번호 재설정을 요청하셨습니다. 아래 링크로 30분 안에 새 비밀번호를 설정해 주세요.",
    "",
    link,
    "",
    "본인이 요청하지 않으셨다면 이 메일을 무시하셔도 됩니다 — 비밀번호는 그대로 유지됩니다.",
    "이 링크는 한 번만 사용할 수 있어요.",
    "",
    "— HiNest 팀",
  ].join("\n");
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px;color:#1F2937">
      <h1 style="font-size:20px;font-weight:800;margin:0 0 16px">비밀번호 재설정 안내</h1>
      <p style="font-size:14px;line-height:1.6;margin:0 0 18px;color:#374151">
        <strong>${escapeHtml(user.name)}</strong>님, HiNest 비밀번호 재설정을 요청하셨습니다.<br/>
        아래 버튼을 눌러 <strong>30분 안에</strong> 새 비밀번호를 설정해 주세요.
      </p>
      <p style="margin:24px 0">
        <a href="${escapeAttr(link)}"
           style="display:inline-block;background:#3B5CF0;color:#fff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 22px;border-radius:10px">
          비밀번호 재설정하기
        </a>
      </p>
      <p style="font-size:12px;color:#6B7280;line-height:1.6;margin:18px 0 0">
        버튼이 동작하지 않으면 아래 URL 을 브라우저에 직접 붙여넣어 주세요:<br/>
        <span style="word-break:break-all;color:#3B5CF0">${escapeHtml(link)}</span>
      </p>
      <hr style="border:0;border-top:1px solid #E5E7EB;margin:28px 0"/>
      <p style="font-size:12px;color:#9CA3AF;line-height:1.6;margin:0">
        본인이 요청하지 않으셨다면 이 메일을 무시하시면 됩니다 — 비밀번호는 그대로 유지됩니다.<br/>
        링크는 한 번만 사용할 수 있어요.
      </p>
    </div>
  `;

  await sendEmail({ to: user.email, subject, text, html });
  await writeLog(user.id, "PWD_RESET_REQUEST", user.email, undefined, req.ip);
  res.json({ ok: true });
});

router.post("/password-reset/confirm", async (req, res) => {
  const parsed = z
    .object({
      token: z.string().min(20).max(200),
      newPassword: z.string().min(8).max(128),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "비밀번호는 8자 이상이어야 해요." });

  const { token, newPassword } = parsed.data;
  const tokenHash = hashToken(token);

  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true, name: true, active: true, resignedAt: true } } },
  });
  if (!row || !row.user) return res.status(400).json({ error: "유효하지 않은 링크입니다.", code: "INVALID_TOKEN" });
  if (row.usedAt) return res.status(400).json({ error: "이미 사용된 링크입니다.", code: "USED_TOKEN" });
  if (row.expiresAt.getTime() < Date.now())
    return res.status(400).json({ error: "만료된 링크입니다. 다시 요청해 주세요.", code: "EXPIRED_TOKEN" });
  if (!row.user.active || row.user.resignedAt)
    return res.status(400).json({ error: "사용할 수 없는 계정입니다." });

  const passwordHash = await bcrypt.hash(newPassword, 12);

  // 트랜잭션: 비밀번호 교체 + 잠금 해제 + 모든 세션 revoke + 토큰 사용 처리 + 같은 유저 다른 미사용 토큰 무효화.
  // revoke 대상 세션 id 를 미리 수집해서 트랜잭션 후에 캐시 evict 까지 묶는다.
  const sessionsToEvict = await prisma.session.findMany({
    where: { userId: row.userId, revokedAt: null },
    select: { id: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash, failedLoginCount: 0, lockedAt: null },
    });
    await tx.session.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: row.userId },
    });
    await tx.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });
    await tx.passwordResetToken.updateMany({
      where: { userId: row.userId, id: { not: row.id }, usedAt: null, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    });
  }, {
    // 4 step 트랜잭션 — 사용자 update + session revoke + 토큰 사용 처리 + 다른 토큰 무효화.
    // 명시적 8초 timeout — 기본 5초보다 여유. 그래도 응답 30초 안엔 끝나도록.
    timeout: 8_000,
  });

  // 캐시 evict — _sessionCache 30초 TTL 동안 공격자 세션이 통과하던 잔류 윈도우 제거.
  // 사용자가 비번 재설정으로 공격자를 끊어내려는 시나리오에선 이 30초가 치명적이라 즉시 무효화.
  for (const s of sessionsToEvict) evictSessionCache(s.id);

  await writeLog(row.userId, "PWD_RESET_CONFIRM", row.user.email, undefined, req.ip);

  res.json({ ok: true });
});

// 작은 HTML 이스케이프 — 메일 본문에 사용자 이름 등 변수 박을 때 XSS/주입 방지.
function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(s: string) {
  return escapeHtml(s);
}


export default router;
