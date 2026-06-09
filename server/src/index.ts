// ★ 반드시 다른 import 보다 먼저 — Express 4 는 async 라우트 핸들러가 reject 하면 에러
//   미들웨어로 흘려보내지 못해(동기 throw·next(err)만 처리) 응답이 안 가고 요청이 행(hang)한다.
//   이 패키지가 Router 를 패치해 async 핸들러의 reject 를 자동으로 next(err) 로 전달 → 아래
//   글로벌 에러 미들웨어가 500 JSON 을 응답하게 한다. (DB 순단·예외 시 30초 타임아웃 대신 즉시 에러)
import "express-async-errors";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { requireAuth, NATIVE_ORIGINS } from "./lib/auth.js";
import { initSsePubsub } from "./lib/ssePubsub.js";
import { deliverLocal } from "./lib/sse.js";
import authRouter from "./routes/auth.js";
import adminRouter from "./routes/admin.js";
import usersRouter from "./routes/users.js";
import scheduleRouter from "./routes/schedule.js";
import widgetRouter from "./routes/widget.js";
import attendanceRouter from "./routes/attendance.js";
import journalRouter from "./routes/journal.js";
import noticeRouter from "./routes/notice.js";
import chatRouter from "./routes/chat.js";
import expenseRouter from "./routes/expense.js";
import uploadRouter, { UPLOAD_DIR } from "./routes/upload.js";
import { isStorageEnabled, downloadFile, getSignedDownloadUrl } from "./lib/storage.js";
import fs from "node:fs";
import notificationRouter from "./routes/notification.js";
import pushRouter from "./routes/push.js";
import updatesRouter from "./routes/updates.js";
import attendanceIpRestrictRouter from "./routes/attendanceIpRestrict.js";
import searchRouter from "./routes/search.js";
import documentRouter from "./routes/document.js";
import approvalRouter from "./routes/approval.js";
import approvalExtrasRouter from "./routes/approvalExtras.js";
import passkeyRouter from "./routes/passkey.js";
import profileRouter from "./routes/profile.js";
import versionRouter from "./routes/version.js";
import meRouter from "./routes/me.js";
import featureFlagsRouter from "./routes/featureFlags.js";
import navRouter from "./routes/nav.js";
import projectRouter from "./routes/project.js";
import webhookRouter from "./routes/webhook.js";
import meetingRouter from "./routes/meeting.js";
import pinRouter from "./routes/pin.js";
import unfurlRouter from "./routes/unfurl.js";
import snippetRouter from "./routes/snippet.js";
import { shareLinkAuthedRouter, shareLinkPublicRouter } from "./routes/shareLink.js";
import { folderShareLinkAuthedRouter } from "./routes/folderShareLink.js";
import serviceAccountRouter from "./routes/serviceAccount.js";
import payslipRouter from "./routes/payslip.js";
import desktopDownloadRouter from "./routes/desktopDownload.js";
import platformRouter from "./routes/platform.js";
import path from "node:path";
import mime from "mime-types";
import { installConsoleHook, pushHttpLog, pushErrorEvent } from "./lib/logBuffer.js";

// 콘솔 로그를 인메모리 버퍼에도 적재 — 총관리자 \"서버 로그\" 탭에서 조회.
// 반드시 다른 import 가 끝난 뒤(이 시점), 첫 console.log 이전에 호출.
installConsoleHook();

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const IS_PROD = process.env.NODE_ENV === "production";
const ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:1000";

// ALB + Vercel rewrite 두 hop 뒤에 있다(웹 + 네이티브 모두 nest.hi-vits.com → Vercel rewrite
// → api.nest.hi-vits.com(ALB) → ECS). trust proxy=1 만 두면 마지막 Vercel hop 만 떼어내
// req.ip 가 Vercel 인스턴스 IP(13.125.x.x / 43.203.x.x 같은 AWS Lambda IP) 로 잡힌다 →
// 출근 IP 화이트리스트가 의도와 다르게 동작.
// trust proxy=2 로 두 hop(ALB + Vercel) 신뢰 → X-Forwarded-For 의 가장 왼쪽 = 사용자 IP.
// "true" 는 모든 프록시 신뢰라 스푸핑 위험 → 정확한 hop 수 명시.
if (IS_PROD) {
  app.set("trust proxy", 2);
}

// 기본 보안 헤더 — CSP 는 프런트 개발 편의상 기본만.
// 프로덕션에선 HSTS 2년 + preload 활성화 — HTTPS→HTTP 다운그레이드 공격 차단.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // /uploads 타 origin 로드 허용
    contentSecurityPolicy: false, // API 서버라 HTML 안 서빙. 필요 시 활성화.
    hsts: IS_PROD
      ? { maxAge: 63072000, includeSubDomains: true, preload: true }
      : false,
  })
);

// gzip/brotli 압축 — JSON 응답 평균 70% 축소. 1KB 미만은 오버헤드라 threshold.
// SSE 같은 스트림은 compression 이 자동으로 건너뜀 (Content-Type text/event-stream).
app.use(
  compression({
    threshold: 1024,
    // 이미 압축된 바이너리(이미지·영상)는 건너뜀 — /uploads 스트림 이중 압축 방지.
    filter: (req, res) => {
      const ct = String(res.getHeader("Content-Type") || "");
      if (ct.startsWith("image/") || ct.startsWith("video/") || ct.startsWith("audio/")) return false;
      return compression.filter(req, res);
    },
  })
);

// CORS — 프로덕션은 CLIENT_ORIGIN 만 허용. 개발에선 로컬호스트 편의 허용.
// Capacitor 네이티브 앱 WebView origin(capacitor://localhost, https://localhost)은 prod/dev 모두 허용 —
// 네이티브는 어느 환경에서든 배포된 API 서버로 붙는다. 이 목록은 아래 CSRF Origin 체크에도 그대로 쓰인다.
const CORS_ORIGINS = (IS_PROD
  ? [ORIGIN]
  : [ORIGIN, "http://localhost:1000", "http://127.0.0.1:1000"]
).concat(NATIVE_ORIGINS);
app.use(
  cors({
    origin: CORS_ORIGINS,
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

// === Request ID 미들웨어 ===
// 각 요청에 고유 ID 를 붙여 access log / error log / superadmin 로그 뷰에서
// "이 5xx 가 그 요청이었음" 을 상호참조할 수 있게 한다. 응답 헤더 X-Request-ID 로
// 클라에도 노출 — 사용자 버그 리포트 시 그 ID 만 받으면 서버 로그 즉시 검색 가능.
//
// 형식: <epoch36>-<rand36>  (예: l4hk2x-a3f9)
import crypto from "node:crypto";
app.use((req, res, next) => {
  const rid = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  (req as any).requestId = rid;
  res.setHeader("X-Request-ID", rid);
  next();
});

// HTTP 액세스 라인을 인메모리 버퍼에 적재 — \"GET /api/x 200 12ms\" 형식.
// query string 안의 token/password/secret/key 같은 값은 마스킹해 개발자 콘솔의 \"서버 로그\" 탭에서
// 우연히 노출되지 않도록 차단.
const SENSITIVE_QS_KEYS = /^(token|password|pw|secret|key|auth|code|otp|signature)$/i;
function scrubUrl(raw: string): string {
  const qIdx = raw.indexOf("?");
  if (qIdx < 0) return raw;
  const path = raw.slice(0, qIdx);
  const params = new URLSearchParams(raw.slice(qIdx + 1));
  let dirty = false;
  for (const [k, v] of params) {
    if (SENSITIVE_QS_KEYS.test(k) && v) {
      params.set(k, "***");
      dirty = true;
    }
  }
  if (!dirty) return raw;
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
// HTTP access log — 매 요청마다 in-memory 링버퍼에 적재.
// 비용 절감:
//   - ALB/Fargate healthcheck 가 GET /api/health 를 매 30초씩 두드리는데, 200 OK 만
//     남기는 라인은 정보가 없고 CloudWatch ingestion(=USD/GB) 만 가산된다.
//   - GET /api/notification/stream 도 SSE long-poll 시작 핸드셰이크가 끊임없이 찍힘.
//   - 위 두 경로는 정상 200/204 일 때만 스킵. 비정상 응답(5xx, 4xx)은 그대로 기록해야
//     장애 진단이 가능.
// 정상(2xx/3xx) 응답만 스킵 — 비정상은 로그에 남겨 진단 가능. 추가 후보는 호출 빈도가 높은
// 폴링·heartbeat 류로, 정상 응답 시 콘텐츠가 없거나 동일해 진단 가치가 낮은 것들.
//   /api/health                  : ALB healthcheck (~30초 주기)
//   /api/notification/stream     : SSE long-poll 핸드셰이크
//   /api/updates/check           : Capgo Live Updates 폴링 (셸이 시작 시·간헐 호출)
//   /api/version                 : 데스크탑/웹 버전 폴링 (UpdateBanner)
const ACCESS_LOG_SKIP_PATHS = new Set([
  "/api/health",
  "/api/notification/stream",
  "/api/updates/check",
  "/api/version",
]);
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    if (ACCESS_LOG_SKIP_PATHS.has(req.path) && res.statusCode < 400) return;
    const dur = Date.now() - start;
    const url = req.originalUrl || req.url;
    const rid = (req as any).requestId;
    pushHttpLog(`${rid} ${req.method} ${scrubUrl(url)} ${res.statusCode} ${dur}ms`);
  });
  next();
});

// CSRF 방어 — 쿠키 인증 + SameSite=lax 만으론 크로스 오리진 상태변경 요청에 완전히 안전하지 않음.
// Origin / Referer 헤더를 허용 오리진 목록과 대조해 안 맞으면 403.
// GET/HEAD/OPTIONS 는 상태변경이 아니므로 통과. 웹훅(/api/webhook/*)은 자체 토큰 검증이라 예외.
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
app.use((req, res, next) => {
  if (!STATE_CHANGING.has(req.method)) return next();
  if (req.path.startsWith("/api/webhook/")) return next();
  if (req.path === "/api/health") return next();
  const origin = String(req.headers.origin || "");
  const referer = String(req.headers.referer || "");
  // Origin 이 있으면 그걸로 검증. 없으면 Referer 의 origin 을 뽑아 검증.
  let sender = origin;
  if (!sender && referer) {
    try { sender = new URL(referer).origin; } catch { sender = ""; }
  }
  if (sender) {
    if (CORS_ORIGINS.includes(sender)) return next();
    return res.status(403).json({ error: "origin not allowed" });
  }
  // Origin / Referer 둘 다 없는 경우 — CSRF 핵심 위협은 "브라우저가 자동으로 cookie 를
  // 실어 보내는" 시나리오라, cookie 가 함께 오는 경우만 차단한다.
  //   - 정상 브라우저 (web/Electron): 항상 Origin 송신
  //   - 네이티브 앱 / curl / 웹훅: Authorization 또는 토큰 헤더로 인증, cookie 안 씀
  // 이 정책으로 위 cookie + no Origin 조합(= CSRF 시도)이 차단되고, 정상 비-브라우저는
  // 영향 없음. 이전엔 무조건 통과해 SameSite 우회 공격에 노출됐었다.
  const hasCookieAuth =
    !!req.cookies?.["hinest_token"] ||
    !!req.cookies?.["hinest_super"] ||
    !!req.cookies?.["hinest_imp"];
  if (hasCookieAuth) {
    return res.status(403).json({ error: "origin required for cookie-authenticated requests" });
  }
  return next();
});

// 레이트 리밋 — 브루트포스/DoS 방어.
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10분
  limit: 30,                // 동일 IP 당 30회
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
});
// 업로드 리밋 — 30/분은 대량 업로드 시나리오(폴더 통째, 문서 수백 개) 를 못 버리므로
// 초당 ~10 건 상당인 600/분 으로 상향. 사용자가 진짜로 폴더 하나 드롭해도 분당 수백 개 업로드가 정상 동작.
// IP 기반이라 NAT 뒤 여러 직원이 동시에 올려도 공유되는 버킷이므로 여유있게 잡음.
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "업로드 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
});
// 사내 인트라넷 기준 600 req/min(10 req/sec)으로 하향.
// 업로드 워크플로 최악 케이스: 파일 업로드(/api/upload) + 문서 생성(/api/document) = 2 req.
// 폴더 1개 50파일 드래그 드롭 = 100 req → 분당 600 안에 여유 있게 들어옴.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

// 요청 로거 — 403/401 디버깅용
app.use((req, res, next) => {
  const started = Date.now();
  const originalUrl = req.originalUrl;
  res.on("finish", () => {
    if (res.statusCode >= 400 || originalUrl.startsWith("/api/auth/")) {
      const u = (req as any).user;
      const who = u ? `user=${u.email}(super=${u.superAdmin})` : "user=-";
      // scrubUrl — ?token=/?password= 등 민감 쿼리값을 ●●● 로 마스킹(이 로그는 stdout→CloudWatch 로
      // 흘러가므로 위 access 로거와 동일하게 스크럽해 토큰 평문 노출을 막는다).
      console.log(`[${new Date().toISOString().slice(11, 19)}] ${req.method} ${scrubUrl(originalUrl)} → ${res.statusCode} ${who} (${Date.now() - started}ms)`);
    }
  });
  next();
});

// 내부 인프라 정보(스토리지 백엔드/버킷명)는 외부에 노출하지 않음
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// IP 차단 / 동적 rate-limit 룰 — 정적 limiter 보다 먼저 적용. (DB 룰 60s 캐시)
import { ipBlockMiddleware, rateLimitMiddleware } from "./lib/securityRules.js";
app.use("/api", ipBlockMiddleware);
app.use("/api", rateLimitMiddleware);

// 전역 API 레이트 리밋 — 라우트별 특수 limiter 는 그 뒤에 추가로 씌운다.
// (login/upload 는 더 엄격한 limiter 가 먼저 적용됨)
app.use("/api", apiLimiter);

// 비밀번호 재설정 요청은 1회당 메일 1건 발송이라 enumeration 방어가 있어도
// IP 당 분당 100건씩 던지면 메일 폭격이 된다. IP 당 시간당 10건으로 묶어둔다.
// 정상 사용자라면 시간당 10건은 절대 도달 불가능 (1번 받고 받았는지 확인 + 재요청 1~2회면 충분).
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1시간
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
});
app.use("/api/auth/password-reset/request", passwordResetLimiter);

// 데스크톱 앱 다운로드 — 인증 불필요, GitHub Releases 스트리밍 프록시.
// 자체 도메인으로 일관된 URL 을 제공해 브라우저 Safe Browsing 평판을 쌓는다.
app.use("/api/download", desktopDownloadRouter);

app.use("/api/auth", loginLimiter, authRouter);
app.use("/api/me", meRouter);
app.use("/api/feature-flags", featureFlagsRouter);
// ⚠️ specific 한 sub-router 를 prefix-router 보다 먼저 마운트 — 안 그러면
//    Express 가 /api/admin/attendance-ip 를 adminRouter 안에서 처리하려다 404 가 됨.
// 회사 출근 IP 화이트리스트 — 회사 관리자(ADMIN) 전용. CRUD.
app.use("/api/admin/attendance-ip", attendanceIpRestrictRouter);
app.use("/api/admin", adminRouter);
app.use("/api/platform", platformRouter);
app.use("/api/users", usersRouter);
app.use("/api/schedule", scheduleRouter);
// iOS/iPadOS/macOS WidgetKit 전용 — 위젯 페이로드 한계(~16KB) 고려한 가벼운 응답.
app.use("/api/widget", widgetRouter);
app.use("/api/attendance", attendanceRouter);
app.use("/api/journal", journalRouter);
app.use("/api/notice", noticeRouter);
app.use("/api/chat", chatRouter);
app.use("/api/expense", expenseRouter);
app.use("/api/upload", uploadLimiter, uploadRouter);
app.use("/api/notification", notificationRouter);
app.use("/api/push", pushRouter);
// Capacitor Live Updates (Capgo self-hosted) — 네이티브 셸이 OTA 새 번들 여부 확인.
// Phase 1: 항상 'no_new_version_available' 응답(placeholder). Phase 2 에서 진짜 OTA 활성화.
app.use("/api/updates", updatesRouter);
app.use("/api/search", searchRouter);
app.use("/api/document", documentRouter);
// extras(templates/lines) 를 approval 보다 먼저 마운트 — approval 의 /:id 와 경로가 겹치는
// 걸 피하려고 별도 prefix 로 분리. 클라는 /api/approval-extras/templates 로 접근.
app.use("/api/approval-extras", approvalExtrasRouter);
app.use("/api/approval", approvalRouter);
app.use("/api/passkey", passkeyRouter);
app.use("/api/profile", profileRouter);
app.use("/api/version", versionRouter);
app.use("/api/nav", navRouter);
app.use("/api/project", projectRouter);
app.use("/api/meeting", meetingRouter);
app.use("/api/pins", pinRouter);
app.use("/api/unfurl", unfurlRouter);
app.use("/api/snippet", snippetRouter);
app.use("/api/service-accounts", serviceAccountRouter);
app.use("/api/payslip", payslipRouter);
// 공유 링크 — 생성/관리는 인증 필요, 실제 외부 다운로드는 인증 없이.
app.use("/api/share-links", shareLinkAuthedRouter);
app.use("/api/folder-share-links", folderShareLinkAuthedRouter);
app.use("/api/public-share", shareLinkPublicRouter);
// 웹훅 수신은 인증 없음 — 라우터 내부에서 token 검증.
app.use("/api/webhook", webhookRouter);

// /uploads — 인증된 유저만 접근, 비이미지/비영상은 강제 다운로드로 내려서 브라우저 인라인 실행 차단.
// 추가로 nosniff 로 MIME 변조 차단, 파일명 traversal 방지.
// Supabase Storage 활성화 시: 서버가 버킷에서 스트림으로 받아 그대로 중계 (프록시).
// 비활성화 시: 기존 디스크 정적 서빙 (로컬 dev 용).
const INLINE_MIME_PREFIXES = ["image/", "video/", "audio/"];
function applyUploadSecurityHeaders(
  res: express.Response,
  name: string,
  contentType: string,
  forceDownload: boolean,
  downloadName?: string,
) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  // defense-in-depth — /uploads 에서 내려가는 HTML 이 실수로라도 실행되지 않도록 tight CSP
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox; frame-ancestors 'none'");
  const inline = INLINE_MIME_PREFIXES.some((p) => contentType.startsWith(p));
  if (forceDownload || !inline) {
    // ?download=1 이 오거나 비-인라인 타입이면 강제 첨부. 원본 파일명이 있으면 그걸 사용.
    const fn = downloadName || name;
    // RFC 5987 로 UTF-8 파일명 인코딩 — 한글/공백 파일명도 깨지지 않게.
    const encoded = encodeURIComponent(fn).replace(/['()]/g, escape).replace(/\*/g, "%2A");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fn.replace(/"/g, "")}"; filename*=UTF-8''${encoded}`,
    );
  }
}

/**
 * 업로드 키의 회사 바인딩을 검사한다(테넌트 격리, 심층 방어).
 * 신규 키는 `cmp_<companyId>__<...>` 형태로 업로더 회사를 박아 발급된다(upload.ts).
 *  - 접두어가 없으면(legacy 키, 항상 숫자로 시작): 과거처럼 인증만으로 허용 — 하위호환.
 *  - 접두어가 있으면: 인증 유저의 companyId 와 일치해야 통과. 슈퍼/플랫폼 관리자는 우회.
 *  - 접두어는 있는데 파싱이 안 되면(우리가 만든 적 없는 형태) 거부(fail-closed).
 */
function canAccessUploadKey(
  key: string,
  user: { companyId?: string | null; superAdmin?: boolean; platformAdmin?: boolean } | undefined,
): boolean {
  if (!key.startsWith("cmp_")) return true; // legacy — 인증만으로 허용
  if (user?.superAdmin || user?.platformAdmin) return true; // 크로스 테넌트 허용
  const rest = key.slice(4);
  const sep = rest.indexOf("__");
  if (sep <= 0) return false; // cmp_ 접두어인데 companyId 파싱 불가 → 거부
  const keyCompanyId = rest.slice(0, sep);
  return !!user?.companyId && user.companyId === keyCompanyId;
}

// <img> 태그는 Authorization 헤더를 못 싣고, 네이티브 앱(Capacitor)은 쿠키도 cross-site ITP 에
// 막혀 /uploads 이미지를 인증할 방법이 없다. 그래서 ?token=<jwt> 쿼리로 세션 토큰을 받아(헤더/쿠키가
// 없을 때만 보강) requireAuth 가 인식하게 한다. 접근 로그는 token 쿼리값을 마스킹한다(SENSITIVE_QS_KEYS).
function uploadsQueryToken(req: express.Request, _res: express.Response, next: express.NextFunction) {
  if (!req.headers.authorization && typeof req.query.token === "string" && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
}

app.use("/uploads", uploadsQueryToken, requireAuth, async (req, res) => {
  const name = req.path.replace(/^\/+/, "");
  // 경로 탈출 / 상대경로 차단
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    return res.status(400).json({ error: "invalid filename" });
  }
  // 신규 키(cmp_<companyId>__...)는 다른 회사 유저의 접근을 차단. 존재 자체를 숨기려 404 로 응답
  // (legacy 키·관리자는 통과). 스토리지 조회 전에 막아 불필요한 fetch·타이밍 노출도 차단.
  if (!canAccessUploadKey(name, (req as any).user)) {
    return res.status(404).json({ error: "not found" });
  }
  const forceDownload = req.query.download === "1" || req.query.download === "true";
  // ?name=<원본파일명> — 다운로드 대화상자에 표시할 이름. 서버 키는 해시라 보기 좋지 않음.
  const rawName = typeof req.query.name === "string" ? req.query.name : undefined;
  const downloadName = rawName ? sanitizeDownloadName(rawName) : undefined;

  // 1) 스토리지(S3/Supabase).
  if (isStorageEnabled()) {
    const mt = String(mime.lookup(name) || "application/octet-stream");
    const inline = INLINE_MIME_PREFIXES.some((p) => mt.startsWith(p));
    const wantAttachment = forceDownload || !inline;

    // 다운로드(첨부)는 presigned URL 로 302 리다이렉트 — 클라이언트가 스토리지(S3 CDN)에서 직접 받는다.
    // ECS 가 전체 파일을 메모리로 버퍼링해 되넘기던 4-hop 경로 제거 → 속도 대폭 향상 + 504 타임아웃 해소 +
    // ResponseContentDisposition 으로 원본 파일명 보장. (인라인 이미지/영상은 아래 버퍼+캐시 경로 유지 —
    // 아바타 재요청 시 max-age 캐시 활용, 매 로드마다 리다이렉트 hop 이 생기지 않게.)
    if (wantAttachment) {
      const signed = await getSignedDownloadUrl(name, {
        downloadName: downloadName || name,
        contentType: mt,
      });
      if (signed) {
        res.setHeader("Cache-Control", "no-store"); // 서명이 매번 달라 캐시 의미 없음
        return res.redirect(302, signed);
      }
    }

    // 인라인 이미지/영상, 또는 presigned 실패 → 기존 버퍼 스트림(+캐시).
    const file = await downloadFile(name);
    if (file) {
      const fmt = file.contentType || mt;
      applyUploadSecurityHeaders(res, name, String(fmt), forceDownload, downloadName);
      res.setHeader("Content-Type", String(fmt));
      res.setHeader("Content-Length", String(file.size));
      res.setHeader("Cache-Control", "private, max-age=86400");
      return res.end(file.buffer);
    }
    // 버킷에 없으면 legacy 디스크 fallback 시도 (마이그레이션 이전 파일)
  }

  // 2) 디스크 fallback — dev 모드 / legacy 파일
  const diskPath = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(diskPath)) {
    return res.status(404).json({ error: "not found" });
  }
  const mt = mime.lookup(name) || "application/octet-stream";
  applyUploadSecurityHeaders(res, name, String(mt), forceDownload, downloadName);
  res.setHeader("Content-Type", String(mt));
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.sendFile(diskPath);
});

/** CR/LF 나 쌍따옴표 같은 헤더 인젝션 위험 문자 제거. */
function sanitizeDownloadName(s: string): string {
  return s.replace(/[\r\n"]/g, "").slice(0, 255);
}

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const rid = (req as any).requestId;
  // request id 를 stack 앞에 박아 access log 와 error log 를 한 줄로 검색 가능.
  console.error(`[err:${rid}]`, err);
  const status = typeof err.status === "number" ? err.status : 500;
  // 500 계열 예상치 못한 에러는 내부 메시지 유출 방지 — DB/Prisma 오류가 그대로 나가지 않도록.
  // 4xx 는 우리가 직접 throw 한 의도된 에러라 message 노출 허용.
  const msg = status < 500 ? (err.message ?? "bad request") : "서버 오류가 발생했습니다";
  // 에러 대시보드용 이벤트 적재 — 5xx 만. 4xx 는 사용자 입력 오류라 분리.
  if (status >= 500) {
    try {
      pushErrorEvent({
        ts: Date.now(),
        status,
        method: req.method,
        path: req.path,
        message: `[${rid}] ${String(err?.message ?? err ?? "Unknown")}`,
        stack: String(err?.stack ?? ""),
        userId: (req as any).user?.id ?? null,
        ua: (req.headers["user-agent"] || "").slice(0, 200) || null,
        ip: req.ip ?? null,
      });
    } catch { /* 로깅 실패가 응답을 막지 않게 */ }
  }
  // 응답에도 request id 박아서 (이미 미들웨어가 헤더로 보냄) 클라가 알 수 있게 body 에도 포함.
  // 사용자 버그 리포트 → 우리가 이 ID 만 있으면 서버 로그 한 번에 검색.
  res.status(status).json({ error: msg, requestId: rid });
});

// 방어: Prisma 등 async 에러로 프로세스가 죽지 않도록
process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

// 기존 공지 알림 백필 — linkUrl 이 "/notice" 로만 저장돼있던 예전 알림을 "/notice?id=..." 로 보정.
// 알림 title 에서 📌 접두어를 제거하고 notice.title 과 매칭.
import { prisma } from "./lib/db.js";
import { generateUniqueEmployeeNo } from "./routes/auth.js";

/**
 * 기존 유저 마이그레이션 백필:
 *  1) email 에 "@" 가 없거나 기타 식별자(사번/사내ID)로 저장된 경우 → @hinest.local 을 붙여 유효한 이메일 형식으로 정리
 *  2) employeeNo 가 비어있는 기존 유저에게 자동 생성된 사번 부여
 *
 * 정책 변경("이메일 전용 로그인 + 사번 자동 부여")에 맞춰 기존 데이터를 한 번 보정.
 * 이미 보정된 행은 건너뛰므로 재시작에도 안전.
 */
async function backfillUserIdentity() {
  try {
    // 1) 이메일 형식 보정
    const bad = await prisma.user.findMany({
      where: { NOT: { email: { contains: "@" } } },
      select: { id: true, email: true },
    });
    let emailFixed = 0;
    for (const u of bad) {
      const base = (u.email || u.id).replace(/[^A-Za-z0-9._-]/g, "").toLowerCase() || u.id.slice(0, 8);
      let candidate = `${base}@hinest.local`;
      let i = 1;
      while (await prisma.user.findUnique({ where: { email: candidate }, select: { id: true } })) {
        candidate = `${base}.${i}@hinest.local`;
        i++;
      }
      await prisma.user.update({ where: { id: u.id }, data: { email: candidate } });
      emailFixed++;
    }
    if (emailFixed) console.log(`[backfill] 이메일 형식 보정: ${emailFixed}건`);

    // 2) 사번 자동 부여 (null / 빈 문자열 / 구 HN 접두어)
    // 정책 변경: HN → HB 로 프리픽스 변경. HN 접두어 유저는 새 HB 사번으로 재부여.
    const noEmp = await prisma.user.findMany({
      where: {
        OR: [
          { employeeNo: null },
          { employeeNo: "" },
          { employeeNo: { startsWith: "HN" } },
        ],
      },
      select: { id: true, employeeNo: true },
    });
    let empFixed = 0;
    for (const u of noEmp) {
      const no = await generateUniqueEmployeeNo();
      await prisma.user.update({ where: { id: u.id }, data: { employeeNo: no } });
      empFixed++;
    }
    if (empFixed) console.log(`[backfill] 사번 자동 생성/갱신: ${empFixed}건`);
  } catch (e) {
    console.error("[backfill] user identity backfill 실패:", e);
  }
}
async function backfillNoticeLinks() {
  try {
    const stale = await prisma.notification.findMany({
      where: { type: "NOTICE", linkUrl: "/notice" },
      select: { id: true, title: true, createdAt: true },
    });
    if (stale.length === 0) return;
    const notices = await prisma.notice.findMany({ select: { id: true, title: true, createdAt: true } });
    let fixed = 0;
    for (const n of stale) {
      const plain = n.title.replace(/^📌\s*/, "").trim();
      // 동일 title 중 생성 시각이 알림에 가장 가까운 공지를 선택
      const candidates = notices.filter((x) => x.title === plain);
      if (candidates.length === 0) continue;
      const best = candidates.reduce((a, b) =>
        Math.abs(+new Date(a.createdAt) - +new Date(n.createdAt)) <
        Math.abs(+new Date(b.createdAt) - +new Date(n.createdAt)) ? a : b
      );
      await prisma.notification.update({
        where: { id: n.id },
        data: { linkUrl: `/notice?id=${best.id}` },
      });
      fixed++;
    }
    if (fixed) console.log(`[backfill] notice notifications linkUrl 보정: ${fixed}건`);
  } catch (e) {
    console.error("[backfill] notice link backfill 실패:", e);
  }
}

const server = app.listen(PORT, () => {
  console.log(`[HiNest API] http://localhost:${PORT}`);
  // 멀티 인스턴스 SSE 팬아웃(Postgres LISTEN/NOTIFY) 시작 — 태스크 간 알림 실시간 전달.
  initSsePubsub(deliverLocal);
  backfillNoticeLinks();
  backfillUserIdentity();
  // 자동 퇴근 스케줄러 — 매 분 tick, 설정된 시각의 사용자를 자동 퇴근 처리.
  import("./jobs/autoClockOut.js").then((m) => m.startAutoClockOut()).catch((e) => {
    console.error("[autoClockOut] 스케줄러 로드 실패:", e);
  });
  // DB 유지보수 잡 — 매일 KST 03:00, 만료된 세션/토큰/접근 로그 정리.
  import("./jobs/dbMaintenance.js").then((m) => m.startDbMaintenance()).catch((e) => {
    console.error("[dbMaintenance] 스케줄러 로드 실패:", e);
  });
  // 예약 채팅 메시지 디스패처 — 매 분 tick, 도래한 예약 메시지를 실제 발송(SSE+알림).
  import("./jobs/dispatchScheduled.js").then((m) => m.startScheduledDispatch()).catch((e) => {
    console.error("[dispatchScheduled] 스케줄러 로드 실패:", e);
  });
});

// === Graceful shutdown ===
// ECS Fargate 가 배포 중 task 교체할 때 SIGTERM 을 30초 grace 안에 보낸다.
// 그 30초 동안 진행 중인 요청을 정상 처리하고, 새 요청은 받지 않으며, DB 연결을
// 닫아야 한다. 그래야 사용자가 "갑자기 끊겼다" / 502 를 안 보고, prisma 연결도
// pgBouncer/RDS 풀에 dangling 으로 남지 않는다.
//
// 흐름:
//   1) SIGTERM 수신 → server.close() (새 연결 거부, 기존 요청 finish 대기)
//   2) prisma.$disconnect() (커넥션 풀 cleanup)
//   3) 25초 안에 안 끝나면 process.exit(1) — Fargate 가 SIGKILL 보내기 직전 자체 종료.
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received — draining connections`);
  const forceTimer = setTimeout(() => {
    console.error("[shutdown] 25s timeout — forcing exit");
    process.exit(1);
  }, 25_000);
  server.close(async (err) => {
    if (err) console.error("[shutdown] server.close error:", err);
    try {
      const { prisma } = await import("./lib/db.js");
      await prisma.$disconnect();
      console.log("[shutdown] prisma disconnected");
    } catch (e) {
      console.error("[shutdown] prisma disconnect failed:", e);
    }
    clearTimeout(forceTimer);
    console.log("[shutdown] clean exit");
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// uncaughtException / unhandledRejection — 로깅만 하고 프로세스는 유지.
// (exit 시키면 ECS 가 재시작하지만 그 사이 사용자는 끊김 — 일시적 에러는 흘려보내는 게 운영상 안전)
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
