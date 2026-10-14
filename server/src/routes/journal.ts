import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth, writeLog } from "../lib/auth.js";
import { hasPermission } from "../lib/permissions.js";
import { getHiddenPositions, excludeHidden } from "../lib/hiddenPositions.js";

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

// 타인 일지 열람 범위 — permissions 카탈로그(journal.view.all / journal.view.team) 기준.
// 관리자가 역할별 권한을 토글하면 그대로 반영된다. 팀 미지정이면 팀 범위 열람 불가.
async function journalViewScope(u: { role: string; team?: string | null }): Promise<"all" | "team" | null> {
  if (await hasPermission(u.role, "journal.view.all")) return "all";
  if (u.team && (await hasPermission(u.role, "journal.view.team"))) return "team";
  return null;
}

// 내가 일지를 열람할 수 있는 사용자 목록(본인 제외) — 클라이언트 열람 대상 선택용.
router.get("/viewable-users", async (req, res) => {
  const u = (req as any).user;
  const scope = await journalViewScope(u);
  if (!scope) return res.json({ users: [] });
  const hidden = await getHiddenPositions(u.companyId);
  const users = await prisma.user.findMany({
    where: {
      active: true,
      id: { not: u.id },
      ...(scope === "team" ? { team: u.team } : {}),
      ...excludeHidden(hidden),
    },
    orderBy: { name: "asc" },
    take: 5000,
    select: { id: true, name: true, team: true, position: true },
  });
  res.json({ users });
});

router.get("/", async (req, res) => {
  const u = (req as any).user;
  const userId = req.query.userId ? String(req.query.userId) : u.id;
  if (userId !== u.id) {
    const scope = await journalViewScope(u);
    if (!scope) return res.status(403).json({ error: "forbidden" });
    if (scope === "team") {
      // 팀 미지정 대상은 거부 — 둘 다 null 이어도 같은 팀으로 보지 않는다.
      const target = await prisma.user.findUnique({ where: { id: userId }, select: { team: true } });
      if (!target?.team || target.team !== u.team) return res.status(403).json({ error: "forbidden" });
    }
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
