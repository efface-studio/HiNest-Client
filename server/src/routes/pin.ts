import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();
router.use(requireAuth);

/**
 * 폴리모픽 즐겨찾기(핀) — targetType/targetId 조합으로 여러 리소스(DOCUMENT, MEETING, CHAT_ROOM,
 * PROJECT, NOTICE 등)를 한 테이블로 저장. 사이드바/홈 대시보드에서 한 번에 불러 쓴다.
 *
 * 라벨(label) 은 사용자가 직접 붙일 수 있는 별칭. 비우면 원 리소스 이름을 조회해 표시.
 */

const TARGET_TYPES = ["DOCUMENT", "MEETING", "CHAT_ROOM", "PROJECT", "NOTICE"] as const;
type TargetType = (typeof TARGET_TYPES)[number];

const createSchema = z.object({
  targetType: z.enum(TARGET_TYPES),
  targetId: z.string().min(1).max(50),
  label: z.string().max(80).optional(),
});

/**
 * 핀에 붙은 리소스의 최신 표시 정보를 한 번에 가져온다 — 리소스 삭제 후 핀만 남을 수 있어서
 * null 인 항목은 클라가 "[삭제된 항목]" 으로 표시 or 자동 제거 가능.
 */
async function hydratePins(
  pins: { id: string; targetType: string; targetId: string; label: string | null; sortOrder: number; createdAt: Date }[],
  u: { id: string; role: string; team: string | null },
) {
  const groups: Record<TargetType, string[]> = {
    DOCUMENT: [], MEETING: [], CHAT_ROOM: [], PROJECT: [], NOTICE: [],
  };
  for (const p of pins) {
    if ((TARGET_TYPES as readonly string[]).includes(p.targetType)) {
      groups[p.targetType as TargetType].push(p.targetId);
    }
  }
  const isAdmin = u.role === "ADMIN";
  // 접근통제(BAC): 핀은 임의 targetId 를 저장할 수 있으므로, 하이드레이션 단계에서 '현재 사용자가
  // 실제로 볼 수 있는 것'만 이름을 조회한다. 접근 불가 항목은 nameBy 에 안 들어가 missing=true 로
  // 떨어져 기존 '[삭제된 항목]' UX 로 흡수 → 비공개 리소스의 제목/이름이 새지 않음.
  const docAcl = isAdmin
    ? {}
    : { OR: [
        { scope: "ALL" },
        { authorId: u.id },
        ...(u.team ? [{ scope: "TEAM", scopeTeam: u.team }] : []),
        { scope: "CUSTOM", scopeUserIds: { contains: u.id } },
      ] };
  const meetingAcl = isAdmin
    ? {}
    : { OR: [
        { visibility: "ALL" },
        { authorId: u.id },
        { viewers: { some: { userId: u.id } } },
        { visibility: "PROJECT", project: { members: { some: { userId: u.id } } } },
      ] };
  const projectAcl = isAdmin ? {} : { members: { some: { userId: u.id } } };

  const [docs, meetings, rooms, projects, notices] = await Promise.all([
    groups.DOCUMENT.length
      ? prisma.document.findMany({ where: { id: { in: groups.DOCUMENT }, deletedAt: null, ...docAcl }, select: { id: true, title: true } })
      : Promise.resolve([]),
    groups.MEETING.length
      ? prisma.meeting.findMany({ where: { id: { in: groups.MEETING }, deletedAt: null, ...meetingAcl }, select: { id: true, title: true } })
      : Promise.resolve([]),
    groups.CHAT_ROOM.length
      ? prisma.chatRoom.findMany({ where: { id: { in: groups.CHAT_ROOM }, members: { some: { userId: u.id } } }, select: { id: true, name: true, type: true } })
      : Promise.resolve([]),
    groups.PROJECT.length
      ? prisma.project.findMany({ where: { id: { in: groups.PROJECT }, ...projectAcl }, select: { id: true, name: true, color: true } })
      : Promise.resolve([]),
    // 공지는 회사 전체 공개 — companyId 자동 스코프로 충분(추가 ACL 불필요).
    groups.NOTICE.length
      ? prisma.notice.findMany({ where: { id: { in: groups.NOTICE }, deletedAt: null }, select: { id: true, title: true } })
      : Promise.resolve([]),
  ]);
  const nameBy = new Map<string, { name: string; meta?: any }>();
  docs.forEach((d) => nameBy.set(`DOCUMENT:${d.id}`, { name: d.title }));
  meetings.forEach((m) => nameBy.set(`MEETING:${m.id}`, { name: m.title }));
  rooms.forEach((r) => nameBy.set(`CHAT_ROOM:${r.id}`, { name: r.name ?? "대화방", meta: { type: r.type } }));
  projects.forEach((p) => nameBy.set(`PROJECT:${p.id}`, { name: p.name, meta: { color: p.color } }));
  notices.forEach((n) => nameBy.set(`NOTICE:${n.id}`, { name: n.title }));

  return pins.map((p) => {
    const info = nameBy.get(`${p.targetType}:${p.targetId}`);
    return {
      id: p.id,
      targetType: p.targetType,
      targetId: p.targetId,
      label: p.label,
      sortOrder: p.sortOrder,
      createdAt: p.createdAt,
      name: info?.name ?? null,
      meta: info?.meta ?? null,
      missing: !info,
    };
  });
}

router.get("/", async (req, res) => {
  const u = (req as any).user;
  const pins = await prisma.pin.findMany({
    where: { userId: u.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: 100,
  });
  const items = await hydratePins(pins, { id: u.id, role: u.role, team: u.team ?? null });
  res.json({ pins: items });
});

router.post("/", async (req, res) => {
  const u = (req as any).user;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const d = parsed.data;
  // 같은 (user, type, id) 조합은 @@unique — upsert 로 멱등.
  const pin = await prisma.pin.upsert({
    where: { userId_targetType_targetId: { userId: u.id, targetType: d.targetType, targetId: d.targetId } },
    create: { userId: u.id, targetType: d.targetType, targetId: d.targetId, label: d.label ?? null },
    update: { label: d.label ?? null },
  });
  res.json({ pin });
});

/** 리소스 기반 삭제 — 프런트에서 "핀 토글" 하기 쉽게 id 말고 (type, id) 로도 받는다. */
router.delete("/:id", async (req, res) => {
  const u = (req as any).user;
  await prisma.pin.deleteMany({ where: { id: req.params.id, userId: u.id } });
  res.json({ ok: true });
});

router.delete("/by-target/:type/:targetId", async (req, res) => {
  const u = (req as any).user;
  const type = req.params.type;
  if (!(TARGET_TYPES as readonly string[]).includes(type)) {
    return res.status(400).json({ error: "invalid type" });
  }
  await prisma.pin.deleteMany({ where: { userId: u.id, targetType: type, targetId: req.params.targetId } });
  res.json({ ok: true });
});

/** 드래그로 순서 재정렬. */
const reorderSchema = z.object({ ids: z.array(z.string()).max(100) });
router.post("/reorder", async (req, res) => {
  const u = (req as any).user;
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const ids = parsed.data.ids;
  // 내 것만 검증.
  const mine = await prisma.pin.findMany({ where: { userId: u.id, id: { in: ids } }, select: { id: true } });
  if (mine.length !== ids.length) return res.status(400).json({ error: "invalid ids" });
  // 배열 형태 → callback 형태로 변경. 배열 형태는 timeout 옵션을 받지 않으므로
  // 100개 짜리 정렬에서 default 5초 timeout 에 걸릴 위험을 명시적으로 막는다.
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.pin.update({ where: { id: ids[i] }, data: { sortOrder: i } });
    }
  }, { timeout: 8_000 });
  res.json({ ok: true });
});

export default router;
