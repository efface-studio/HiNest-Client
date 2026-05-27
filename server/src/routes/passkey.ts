import { Router } from "express";
import { prisma } from "../lib/db.js";
import {
  requireAuth,
  requireSuperAdminStepUp,
  signSuper,
  setSuperCookie,
  writeLog,
  SUPER_TTL_SEC,
} from "../lib/auth.js";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from "@simplewebauthn/server";

const router = Router();

/**
 * WebAuthn RP ID / origin — 명시 환경변수가 없으면 CLIENT_ORIGIN 에서 파생.
 * Vercel 배포면 CLIENT_ORIGIN=https://team-hivits.vercel.app 하나만 있어도
 * RP_ID=team-hivits.vercel.app, ORIGINS=[https://team-hivits.vercel.app] 로 자동 설정.
 * dev 환경 (CLIENT_ORIGIN 미설정) 에선 localhost 기본값.
 */
function deriveRpConfig(): { rpId: string; origins: string[] } {
  const explicitRp = process.env.WEBAUTHN_RP_ID;
  const explicitOrigins = process.env.WEBAUTHN_ORIGINS;
  const clientOrigin = process.env.CLIENT_ORIGIN;
  if (explicitRp && explicitOrigins) {
    return { rpId: explicitRp, origins: explicitOrigins.split(",").map((s) => s.trim()).filter(Boolean) };
  }
  if (clientOrigin) {
    try {
      const u = new URL(clientOrigin);
      return {
        rpId: explicitRp ?? u.hostname,
        origins: explicitOrigins
          ? explicitOrigins.split(",").map((s) => s.trim()).filter(Boolean)
          : [u.origin],
      };
    } catch {
      /* fallthrough to dev default */
    }
  }
  return {
    rpId: explicitRp ?? "localhost",
    origins: (explicitOrigins ?? "http://localhost:1000,http://127.0.0.1:1000")
      .split(",").map((s) => s.trim()).filter(Boolean),
  };
}
const { rpId: RP_ID, origins: ORIGINS } = deriveRpConfig();
const RP_NAME = "HiNest";

// 챌린지 임시 저장 (5분 TTL)
type Challenge = { value: string; expiresAt: number; purpose: "register" | "auth" };
const challenges = new Map<string, Challenge>();
function setChallenge(userId: string, value: string, purpose: "register" | "auth") {
  challenges.set(userId, { value, expiresAt: Date.now() + 5 * 60 * 1000, purpose });
}
function takeChallenge(userId: string, purpose: "register" | "auth") {
  const c = challenges.get(userId);
  if (!c) return null;
  if (c.expiresAt < Date.now() || c.purpose !== purpose) {
    challenges.delete(userId);
    return null;
  }
  challenges.delete(userId);
  return c.value;
}

function toB64Url(buf: Buffer | Uint8Array) {
  return Buffer.from(buf).toString("base64url");
}
function fromB64Url(s: string) {
  return Buffer.from(s, "base64url");
}

/* ================ 등록(registration) ================
 * 정책 (보안 우선):
 *   - 패스키 = step-up 인증 자격증 자체이므로, 새 패스키를 추가하려면 반드시 step-up 완료 상태여야 한다.
 *   - 세션 쿠키만 탈취된 공격자가 자기 기기 패스키를 등록 → 영구 super 접근을 얻는 시나리오 차단.
 *   - 현재 UI 도 SuperStepUpGate 안에서만 등록을 트리거하므로 UX 영향 없음.
 */
router.post("/register/options", requireAuth, requireSuperAdminStepUp, async (req, res) => {
  const u = (req as any).user;
  const user = await prisma.user.findUnique({ where: { id: u.id } });
  if (!user) return res.status(404).json({ error: "not found" });

  const existing = await prisma.passkey.findMany({ where: { userId: u.id } });
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: "none",
    authenticatorSelection: {
      authenticatorAttachment: "platform", // Touch ID / Face ID 우선
      residentKey: "preferred",
      userVerification: "required",
    },
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: c.transports?.split(",") as any[] | undefined,
    })),
    timeout: 60_000,
  });

  setChallenge(u.id, options.challenge, "register");
  res.json(options);
});

router.post("/register/verify", requireAuth, requireSuperAdminStepUp, async (req, res) => {
  const u = (req as any).user;
  const expected = takeChallenge(u.id, "register");
  if (!expected) return res.status(400).json({ error: "챌린지가 만료되었어요. 다시 시도해주세요." });

  let verification: VerifiedRegistrationResponse;
  try {
    verification = await verifyRegistrationResponse({
      response: req.body?.response,
      expectedChallenge: expected,
      expectedOrigin: ORIGINS,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "등록 실패" });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return res.status(400).json({ error: "등록을 검증하지 못했어요" });
  }

  const info = verification.registrationInfo;
  const credential = info.credential;
  const credentialId = credential.id;
  const publicKey = Buffer.from(credential.publicKey);
  const counter = credential.counter ?? 0;
  // transports 는 "usb,nfc,ble,internal" 같은 문자열 — 전체 다 합쳐도 100자 미만.
  // 악성 클라이언트가 수KB 배열을 보내 DB 컬럼을 부풀리지 못하게 캡.
  const rawTransports = (credential.transports ?? req.body?.response?.response?.transports)?.join(",");
  const transports = rawTransports && rawTransports.length > 120 ? rawTransports.slice(0, 120) : rawTransports;

  // deviceName 은 사용자 표시용 문자열. UI 상 60자 이상 의미없고, DB 비대화 방어 위해 80자 하드 캡.
  const rawDeviceName = String(req.body?.deviceName ?? inferDeviceName(req.get("user-agent") ?? ""));
  const deviceName = rawDeviceName.length > 80 ? rawDeviceName.slice(0, 80) : rawDeviceName;

  await prisma.passkey.create({
    data: {
      userId: u.id,
      credentialId,
      publicKey,
      counter,
      transports,
      deviceName,
    },
  });
  await writeLog(u.id, "PASSKEY_REGISTER", credentialId.slice(0, 16), deviceName, req.ip);
  res.json({ ok: true });
});

/* ================ 인증(authentication) ================ */
router.post("/auth/options", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const list = await prisma.passkey.findMany({ where: { userId: u.id } });
  if (list.length === 0) return res.status(400).json({ error: "등록된 패스키가 없어요", code: "NO_PASSKEY" });

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: list.map((c) => ({
      id: c.credentialId,
      transports: c.transports?.split(",") as any[] | undefined,
    })),
    userVerification: "required",
    timeout: 60_000,
  });
  setChallenge(u.id, options.challenge, "auth");
  res.json(options);
});

router.post("/auth/verify", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const expected = takeChallenge(u.id, "auth");
  if (!expected) return res.status(400).json({ error: "챌린지가 만료되었어요. 다시 시도해주세요." });

  const responseData = req.body?.response;
  const credentialId = responseData?.id;
  if (!credentialId) return res.status(400).json({ error: "invalid response" });

  const stored = await prisma.passkey.findUnique({ where: { credentialId } });
  if (!stored || stored.userId !== u.id) {
    return res.status(400).json({ error: "알 수 없는 패스키" });
  }

  let verification: VerifiedAuthenticationResponse;
  try {
    verification = await verifyAuthenticationResponse({
      response: responseData,
      expectedChallenge: expected,
      expectedOrigin: ORIGINS,
      expectedRPID: RP_ID,
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(stored.publicKey),
        counter: stored.counter,
        transports: stored.transports?.split(",") as any[] | undefined,
      },
      requireUserVerification: true,
    });
  } catch (e: any) {
    await writeLog(u.id, "PASSKEY_AUTH_FAIL", credentialId.slice(0, 16), e?.message, req.ip);
    return res.status(400).json({ error: e?.message ?? "인증 실패" });
  }

  if (!verification.verified) {
    await writeLog(u.id, "PASSKEY_AUTH_FAIL", credentialId.slice(0, 16), "verified=false", req.ip);
    return res.status(400).json({ error: "인증 실패" });
  }

  await prisma.passkey.update({
    where: { id: stored.id },
    data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
  });

  // 총관리자면 super 쿠키 발급
  const fresh = await prisma.user.findUnique({ where: { id: u.id } });
  if (fresh?.superAdmin) {
    const token = signSuper(fresh.id);
    setSuperCookie(res, token);
    await writeLog(fresh.id, "SUPER_STEPUP_OK_PASSKEY", undefined, stored.deviceName ?? undefined, req.ip);
    return res.json({ ok: true, super: true, expiresAt: Date.now() + SUPER_TTL_SEC * 1000 });
  }
  await writeLog(u.id, "PASSKEY_AUTH_OK", stored.id, stored.deviceName ?? undefined, req.ip);
  res.json({ ok: true });
});

/* ================ 기기 관리 ================ */
router.get("/", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const list = await prisma.passkey.findMany({
    where: { userId: u.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, deviceName: true, createdAt: true, lastUsedAt: true, transports: true },
  });
  res.json({ passkeys: list });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const pk = await prisma.passkey.findUnique({ where: { id: req.params.id } });
  if (!pk || pk.userId !== u.id) return res.status(404).json({ error: "not found" });
  await prisma.passkey.delete({ where: { id: pk.id } });
  await writeLog(u.id, "PASSKEY_DELETE", pk.id, pk.deviceName ?? undefined, req.ip);
  res.json({ ok: true });
});

function inferDeviceName(ua: string) {
  const u = ua.toLowerCase();
  if (u.includes("iphone")) return "iPhone";
  if (u.includes("ipad")) return "iPad";
  if (u.includes("macintosh") || u.includes("mac os")) return "Mac";
  if (u.includes("android")) return "Android";
  if (u.includes("windows")) return "Windows";
  return "기기";
}

// 미사용 경고 방지
void requireSuperAdminStepUp;
void toB64Url; void fromB64Url;

export default router;
