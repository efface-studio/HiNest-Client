import { Router } from "express";
import { USER_AVATAR_SELECT } from "../lib/userSelect.js";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";

/**
 * 스니펫 라이브러리 CRUD.
 *
 * scope 모델:
 *  - PRIVATE: 본인만 조회/수정
 *  - ALL    : 전사 조회 가능, 수정/삭제는 본인만
 */

const router = Router();
router.use(requireAuth);

const upsertSchema = z.object({
  trigger: z.string().min(1).max(40).regex(/^[\w\-가-힣]+$/, "영문/숫자/하이픈/한글만"),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
  lang: z.string().max(40).optional().default(""),
  scope: z.enum(["PRIVATE", "ALL"]).optional().default("PRIVATE"),
});

/** 본인 + 전사 공개 모두 — 검색·정렬 옵션. */
router.get("/", async (req, res) => {
  const u = (req as any).user;
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const where: any = {
    OR: [{ ownerId: u.id }, { scope: "ALL" }],
  };
  if (q) {
    where.AND = [
      {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { trigger: { contains: q, mode: "insensitive" } },
          { body: { contains: q, mode: "insensitive" } },
        ],
      },
    ];
  }
  const snippets = await prisma.snippet.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: 200,
    include: { owner: { select: USER_AVATAR_SELECT } },
  });
  res.json({ snippets });
});

/** 슬래시 자동완성용 — 매우 가벼운 응답. trigger prefix 우선 매치, 그 다음 title. */
router.get("/search", async (req, res) => {
  const u = (req as any).user;
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const limit = Math.min(20, Math.max(1, parseInt(String(req.query.limit ?? 10), 10) || 10));
  if (!q) {
    // 빈 쿼리면 가장 최근/사용 빈도 순.
    const items = await prisma.snippet.findMany({
      where: { OR: [{ ownerId: u.id }, { scope: "ALL" }] },
      orderBy: [{ uses: "desc" }, { updatedAt: "desc" }],
      take: limit,
      select: { id: true, trigger: true, title: true, body: true, lang: true, scope: true, uses: true },
    });
    return res.json({ items });
  }
  const items = await prisma.snippet.findMany({
    where: {
      AND: [
        { OR: [{ ownerId: u.id }, { scope: "ALL" }] },
        {
          OR: [
            { trigger: { contains: q, mode: "insensitive" } },
            { title: { contains: q, mode: "insensitive" } },
          ],
        },
      ],
    },
    orderBy: [{ uses: "desc" }, { updatedAt: "desc" }],
    take: limit,
    select: { id: true, trigger: true, title: true, body: true, lang: true, scope: true, uses: true },
  });
  res.json({ items });
});

router.post("/", async (req, res) => {
  const u = (req as any).user;
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const snippet = await prisma.snippet.create({
    data: { ...parsed.data, ownerId: u.id },
  });
  res.json({ snippet });
});

router.patch("/:id", async (req, res) => {
  const u = (req as any).user;
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const exist = await prisma.snippet.findUnique({ where: { id: req.params.id } });
  if (!exist) return res.status(404).json({ error: "not found" });
  if (exist.ownerId !== u.id) return res.status(403).json({ error: "forbidden" });
  const snippet = await prisma.snippet.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  res.json({ snippet });
});

router.delete("/:id", async (req, res) => {
  const u = (req as any).user;
  const exist = await prisma.snippet.findUnique({ where: { id: req.params.id } });
  if (!exist) return res.status(404).json({ error: "not found" });
  if (exist.ownerId !== u.id) return res.status(403).json({ error: "forbidden" });
  await prisma.snippet.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

/** 사용 횟수 + 1 — 자동완성에서 삽입할 때 호출. 인기 정렬 가중치. */
router.post("/:id/use", async (req, res) => {
  const u = (req as any).user;
  const exist = await prisma.snippet.findUnique({ where: { id: req.params.id } });
  if (!exist) return res.status(404).json({ error: "not found" });
  if (exist.ownerId !== u.id && exist.scope !== "ALL") {
    return res.status(403).json({ error: "forbidden" });
  }
  await prisma.snippet.update({
    where: { id: req.params.id },
    data: { uses: { increment: 1 } },
  });
  res.json({ ok: true });
});

export default router;
