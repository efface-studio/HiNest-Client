import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth, writeLog } from "../lib/auth.js";

const router = Router();
router.use(requireAuth);

const schema = z.object({
  // YYYY-MM-DD 강제 — 느슨하면 풀 ISO 가 저장돼 클라가 원시 타임스탬프를 노출한다(#1099 계열).
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(20_000),
});

// partial 이지만 빈 문자열 overwrite 는 막아야 함 — .partial() 만 쓰면 ""로 title 덮기 가능.
const patchSchema = z.object({
  date: z.string().max(40).optional(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(20_000).optional(),
});

router.get("/", async (req, res) => {
  const u = (req as any).user;
  const userId = req.query.userId ? String(req.query.userId) : u.id;
  // 권한 정책 (permissions catalog 기준):
  //   - 본인 일지: 누구나 (자기 자신)
  //   - 타인 일지: MEMBER 불가, MANAGER 는 같은 팀까지만, ADMIN 만 전사 열람
  // 이전엔 MANAGER 가 모든 부서 일지를 볼 수 있어 개인정보 노출 우려 컸음.
  if (userId !== u.id) {
    if (u.role === "MEMBER") return res.status(403).json({ error: "forbidden" });
    if (u.role === "MANAGER") {
      // 내 팀은 requireAuth 캐시 유저행에서 — 대상(다른 유저) 팀만 조회.
      const me = (req as any).userRecord as { team?: string | null } | undefined;
      const target = await prisma.user.findUnique({ where: { id: userId }, select: { team: true } });
      // 팀 미지정이거나 다른 팀이면 거부 — null/undefined 동일 취급 안 함(둘 다 null 이면 거부).
      if (!me?.team || !target?.team || me.team !== target.team) {
        return res.status(403).json({ error: "forbidden" });
      }
    }
    // ADMIN 은 통과.
  }
  const list = await prisma.journal.findMany({
    where: { userId, deletedAt: null },
    orderBy: { date: "desc" },
    take: 500,
    include: { user: { select: { name: true } } },
  });
  res.json({ journals: list });
});

router.post("/", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const u = (req as any).user;
  const d = parsed.data;
  const j = await prisma.journal.create({
    data: { userId: u.id, date: d.date, title: d.title, content: d.content },
  });
  await writeLog(u.id, "JOURNAL_CREATE", j.id, d.date);
  res.json({ journal: j });
});

router.patch("/:id", async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const u = (req as any).user;
  const j = await prisma.journal.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!j) return res.status(404).json({ error: "not found" });
  if (j.userId !== u.id) return res.status(403).json({ error: "forbidden" });
  const updated = await prisma.journal.update({
    where: { id: j.id },
    data: parsed.data,
  });
  await writeLog(u.id, "JOURNAL_UPDATE", j.id);
  res.json({ journal: updated });
});

router.delete("/:id", async (req, res) => {
  const u = (req as any).user;
  const j = await prisma.journal.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!j) return res.status(404).json({ error: "not found" });
  if (j.userId !== u.id && u.role !== "ADMIN")
    return res.status(403).json({ error: "forbidden" });
  await prisma.journal.update({ where: { id: j.id }, data: { deletedAt: new Date(), deletedById: (req as any).user?.id } });
  await writeLog(u.id, "JOURNAL_DELETE", j.id);
  res.json({ ok: true });
});

export default router;
