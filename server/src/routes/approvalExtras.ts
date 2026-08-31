import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";

/**
 * 결재 템플릿 + 결재라인 즐겨찾기 — 기존 approval 라우터와 경로가 /:id 와 충돌해서
 * 별도 파일/마운트 포인트로 분리. 템플릿은 전사 공유(ALL) / 팀(TEAM) / 개인(ME) 3단.
 * 결재라인은 개인 단위만.
 */
const router = Router();
router.use(requireAuth);

const templateBody = z.object({
  title: z.string().max(200).optional(),
  content: z.string().max(5000).optional(),
  fields: z.any().optional(),
  defaultLine: z.array(z.string().max(50)).max(10).optional(),
});

const templateSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["TRIP", "EXPENSE", "PURCHASE", "GENERAL", "OFFSITE", "OTHER"]),
  scope: z.enum(["ALL", "TEAM", "ME"]).default("ALL"),
  scopeTeam: z.string().max(100).nullable().optional(),
  body: templateBody,
});

router.get("/templates", async (req, res) => {
  const u = (req as any).user;
  // JWT 에 team 이 없으므로 DB 조회. 캐시 없이 템플릿 목록당 1쿼리 — 호출 빈도가 낮아 OK.
  const me = await prisma.user.findUnique({ where: { id: u.id }, select: { team: true } });
  const team = me?.team ?? null;
  const list = await prisma.approvalTemplate.findMany({
    where: {
      OR: [
        { scope: "ALL" },
        ...(team ? [{ scope: "TEAM", scopeTeam: team }] : []),
        { scope: "ME", createdById: u.id },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  res.json({ templates: list });
});

router.post("/templates", async (req, res) => {
  const u = (req as any).user;
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const d = parsed.data;
  const created = await prisma.approvalTemplate.create({
    data: {
      name: d.name,
      type: d.type,
      scope: d.scope,
      scopeTeam: d.scope === "TEAM"
        ? (d.scopeTeam ?? (await prisma.user.findUnique({ where: { id: u.id }, select: { team: true } }))?.team ?? null)
        : null,
      body: d.body as any,
      createdById: u.id,
    },
  });
  res.json({ template: created });
});

router.delete("/templates/:id", async (req, res) => {
  const u = (req as any).user;
  const t = await prisma.approvalTemplate.findUnique({ where: { id: req.params.id } });
  if (!t) return res.status(404).json({ error: "not found" });
  if (t.createdById !== u.id && u.role !== "ADMIN")
    return res.status(403).json({ error: "forbidden" });
  await prisma.approvalTemplate.delete({ where: { id: t.id } });
  res.json({ ok: true });
});

const lineSchema = z.object({
  name: z.string().min(1).max(100),
  reviewerIds: z.array(z.string().max(50)).min(1).max(10),
});

router.get("/lines", async (req, res) => {
  const u = (req as any).user;
  const rows = await prisma.approvalLineFavorite.findMany({
    where: { userId: u.id },
    orderBy: { createdAt: "desc" },
  });
  // reviewerIds 는 콤마로 직렬화되어 있음 — 클라에 배열로 넘김.
  res.json({
    lines: rows.map((r) => ({
      id: r.id,
      name: r.name,
      reviewerIds: r.reviewerIds.split(",").filter(Boolean),
      createdAt: r.createdAt,
    })),
  });
});

router.post("/lines", async (req, res) => {
  const u = (req as any).user;
  const parsed = lineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const d = parsed.data;
  const created = await prisma.approvalLineFavorite.create({
    data: {
      userId: u.id,
      name: d.name,
      reviewerIds: Array.from(new Set(d.reviewerIds)).join(","),
    },
  });
  res.json({
    line: { id: created.id, name: created.name, reviewerIds: created.reviewerIds.split(",").filter(Boolean), createdAt: created.createdAt },
  });
});

router.delete("/lines/:id", async (req, res) => {
  const u = (req as any).user;
  const row = await prisma.approvalLineFavorite.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: "not found" });
  if (row.userId !== u.id) return res.status(403).json({ error: "forbidden" });
  await prisma.approvalLineFavorite.delete({ where: { id: row.id } });
  res.json({ ok: true });
});

export default router;
