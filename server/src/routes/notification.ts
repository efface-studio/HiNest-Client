import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth, queryTokenAuth, signSseTicket } from "../lib/auth.js";
import { addClient, removeClient } from "../lib/sse.js";

const router = Router();

/* ===== Server-Sent Events 스트림 =====
 * 웹/데스크톱: httpOnly 쿠키로 인증. 네이티브 앱: EventSource 가 헤더를 못 싣고 쿠키는
 * cross-site ITP 로 막히므로 ?token=<jwt> 쿼리로 인증(queryTokenAuth 가 Bearer 로 승격). */
router.get("/stream", queryTokenAuth, requireAuth, async (req, res) => {
  const u = (req as any).user;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  (res as any).flushHeaders?.();

  res.write(`event: ready\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`);

  const client = addClient(u.id, res);

  // 15초마다 keepalive 주석 라인 (프록시·브라우저 idle 타임아웃 방지)
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {}
  }, 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeClient(client);
  });
});

router.use(requireAuth);

// 웹 전용: Vercel 이 SSE 를 버퍼/끊으므로, 짧은 수명 티켓을 받아 백엔드(api.*)로 직결한다.
// 쿠키 인증(위 requireAuth) 통과한 요청만 발급 — sid 포함이라 세션 무효화도 그대로 적용.
router.get("/sse-ticket", (req, res) => {
  const sid = (req as any).sessionId as string | null;
  if (!sid) return res.status(401).json({ error: "unauthorized" });
  res.json({ ticket: signSseTicket((req as any).user, sid) });
});

router.get("/", async (req, res) => {
  const u = (req as any).user;
  const scope = String(req.query.scope ?? "all"); // all | unread
  const where: any = { userId: u.id };
  if (scope === "unread") where.readAt = null;
  // count() 는 클라이언트가 items 에서 계산하므로 DB 왕복 1회 절약.
  // (100개 범위 내에서는 items.filter(!readAt).length 로 충분히 정확함)
  const items = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const unread = items.filter((n) => !n.readAt).length;
  res.json({ notifications: items, unread });
});

const readSchema = z.object({
  // 한 번에 500 건까지만 읽음 처리 — IN() 폭주 방지.
  ids: z.array(z.string().max(64)).max(500).optional(),
  all: z.boolean().optional(),
});

router.post("/read", async (req, res) => {
  const u = (req as any).user;
  const parsed = readSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const { ids, all } = parsed.data;
  if (all) {
    await prisma.notification.updateMany({
      where: { userId: u.id, readAt: null },
      data: { readAt: new Date() },
    });
  } else if (ids && ids.length) {
    await prisma.notification.updateMany({
      where: { userId: u.id, id: { in: ids }, readAt: null },
      data: { readAt: new Date() },
    });
  }
  // unread 재집계 생략 — 클라이언트가 낙관적 업데이트로 이미 반영함. DB 왕복 1회 절약.
  res.json({ ok: true });
});

/**
 * 알림 환경설정 — 유저별 타입별 on/off + 방해금지 시간대(DND) + 이메일 중계.
 * prefs JSONB 는 { [NotifyType]: boolean } 형태. 누락된 타입은 기본 true.
 */
router.get("/prefs", async (req, res) => {
  const u = (req as any).user;
  const row = await prisma.notificationPref.findUnique({ where: { userId: u.id } });
  res.json({
    prefs: row?.prefs ?? {},
    dndStart: row?.dndStart ?? null,
    dndEnd: row?.dndEnd ?? null,
    emailOn: row?.emailOn ?? false,
  });
});

const prefsSchema = z.object({
  prefs: z.record(z.string(), z.boolean()).optional(),
  // "HH:MM" 문자열. 빈 문자열/null 이면 DND 비활성.
  dndStart: z.string().max(5).nullable().optional(),
  dndEnd: z.string().max(5).nullable().optional(),
  emailOn: z.boolean().optional(),
});

router.put("/prefs", async (req, res) => {
  const u = (req as any).user;
  const parsed = prefsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const d = parsed.data;
  const row = await prisma.notificationPref.upsert({
    where: { userId: u.id },
    create: {
      userId: u.id,
      prefs: d.prefs ?? {},
      dndStart: d.dndStart ?? null,
      dndEnd: d.dndEnd ?? null,
      emailOn: d.emailOn ?? false,
    },
    update: {
      ...(d.prefs !== undefined ? { prefs: d.prefs } : {}),
      ...(d.dndStart !== undefined ? { dndStart: d.dndStart } : {}),
      ...(d.dndEnd !== undefined ? { dndEnd: d.dndEnd } : {}),
      ...(d.emailOn !== undefined ? { emailOn: d.emailOn } : {}),
    },
  });
  res.json({
    prefs: row.prefs,
    dndStart: row.dndStart,
    dndEnd: row.dndEnd,
    emailOn: row.emailOn,
  });
});

router.delete("/:id", async (req, res) => {
  const u = (req as any).user;
  await prisma.notification.deleteMany({
    where: { id: req.params.id, userId: u.id },
  });
  res.json({ ok: true });
});

export default router;
