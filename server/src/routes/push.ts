import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { apnsDiag } from "../lib/apns.js";

/**
 * 원격 푸시(APNs/FCM) 기기 토큰 등록·해제.
 *
 * 흐름:
 *  - 로그인 후 클라이언트(@capacitor/push-notifications)가 OS 에서 디바이스 토큰을 발급받아
 *    POST /api/push/register 로 보낸다.
 *  - 로그아웃 시 POST /api/push/unregister 로 해당 기기 토큰을 지워 더 이상 푸시가 가지 않게 한다.
 *
 * token 은 schema 상 unique 다. 같은 기기를 다른 계정으로 재로그인하면 token 의 userId 를
 * 새 유저로 갱신(upsert)해 이전 유저에게 푸시가 가지 않게 한다.
 */

const router = Router();
router.use(requireAuth);

const registerSchema = z.object({
  token: z.string().min(8).max(512),
  platform: z.enum(["ios", "android"]).default("ios"),
  deviceId: z.string().max(256).optional(),
});

router.post("/register", async (req, res) => {
  const u = (req as any).user;
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const { token, platform, deviceId } = parsed.data;

  await prisma.pushToken.upsert({
    where: { token },
    create: { userId: u.id, token, platform, deviceId: deviceId ?? null, lastUsedAt: new Date() },
    update: { userId: u.id, platform, deviceId: deviceId ?? null, lastUsedAt: new Date() },
  });

  res.json({ ok: true });
});

const unregisterSchema = z.object({
  token: z.string().min(8).max(512),
});

router.post("/unregister", async (req, res) => {
  const u = (req as any).user;
  const parsed = unregisterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });

  // 본인 소유 토큰만 삭제 — 남의 토큰을 임의로 지우지 못하게 userId 로 스코프.
  await prisma.pushToken.deleteMany({ where: { token: parsed.data.token, userId: u.id } });

  res.json({ ok: true });
});

/**
 * 진단 — 본인 iOS 토큰으로 테스트 푸시를 실제 발송하고 APNs 응답을 그대로 돌려준다.
 * 브라우저에서 로그인된 채로 /api/push/diag 를 열면 결과 JSON 을 볼 수 있고,
 * 정상이면 등록된 기기에 "테스트 알림" 푸시가 도착한다. 본인 토큰만 대상이라 안전.
 */
router.get("/diag", async (req, res) => {
  const u = (req as any).user;
  res.json(await apnsDiag(u.id));
});

export default router;
