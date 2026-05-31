import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth, writeLog } from "../lib/auth.js";
import { notify, notifyMany } from "../lib/notify.js";

const router = Router();
router.use(requireAuth);

const approvalSchema = z.object({
  type: z.enum(["TRIP", "EXPENSE", "PURCHASE", "GENERAL", "OFFSITE", "OTHER"]),
  title: z.string().min(1).max(200),
  content: z.string().max(5000).optional(),
  data: z.any().optional(),
  // Invalid Date 가 Prisma 쓰기까지 흘러가 500 이 나지 않도록 파싱 가능한 문자열만 허용.
  startDate: z.string().max(40).refine(
    (s) => !s || !Number.isNaN(new Date(s).getTime()),
    { message: "시작일 형식이 올바르지 않습니다" },
  ).optional(),
  endDate: z.string().max(40).refine(
    (s) => !s || !Number.isNaN(new Date(s).getTime()),
    { message: "종료일 형식이 올바르지 않습니다" },
  ).optional(),
  amount: z.number().int().nonnegative().max(1_000_000_000).optional(),
  reviewerIds: z.array(z.string().max(50)).min(1).max(10),
});

/** 사이드바·탭 배지용 — 결재 대기/내 신청 개수만 가볍게.
 *
 * pending 의미: "지금 당장 내가 처리해야 할 결재 수"
 *   = 결재 자체가 PENDING + 내가 그 결재의 PENDING 스텝 중 첫 번째(=현재 차례) 리뷰어
 *
 * 단순히 `steps.some(reviewerId=me, status=PENDING)` 만 보면 다단계 결재에서
 * 나보다 앞 순번 리뷰어가 아직 결재 안 한 결재까지 카운트돼 빨간 배지가 부풀어 보임.
 * 화면(스코프=pending) 은 currentReviewerId===me 만 "내 차례" 로 표시하므로 사용자는
 * "결재 대기 0인데 왜 빨간 N?" 으로 체감. 카운트 의미를 화면과 맞추는 것이 핵심.
 */
router.get("/counts", async (req, res) => {
  const u = (req as any).user;

  // 일단 후보(내가 어딘가 PENDING 리뷰어인 PENDING 결재) 만 좁혀서 가져온다 — 보통 사내 결재
  // 동시 진행량은 매우 적으므로 count() 한 방을 못 쓰는 비용보다 정확성이 중요.
  // steps 는 PENDING 만, order 오름차순으로 1개만 — 첫 PENDING 스텝이 곧 "현재 차례".
  const candidates = await prisma.approval.findMany({
    where: {
      status: "PENDING",
      steps: { some: { reviewerId: u.id, status: "PENDING" } },
    },
    select: {
      id: true,
      steps: {
        where: { status: "PENDING" },
        orderBy: { order: "asc" },
        take: 1,
        select: { reviewerId: true },
      },
    },
  });
  const pending = candidates.filter((a) => a.steps[0]?.reviewerId === u.id).length;

  const mine = await prisma.approval.count({
    where: { requesterId: u.id, status: "PENDING" },
  });

  res.setHeader("Cache-Control", "private, max-age=30");
  res.json({ pending, mine });
});

router.get("/", async (req, res) => {
  const u = (req as any).user;
  const scope = String(req.query.scope ?? "mine"); // mine | pending | all(admin only)
  const where: any = {};

  if (scope === "all") {
    // 전체 목록은 ADMIN 전용. 일반 사용자가 ?scope=all 로 요청 시 강제 403.
    if (u.role !== "ADMIN") return res.status(403).json({ error: "forbidden" });
    // where = {} — 전체 조회 (ADMIN 의도된 동작)
  } else if (scope === "pending") {
    // 내가 리뷰어이고, 아직 대기중이며 내 순번이 돌아온 것
    where.steps = { some: { reviewerId: u.id, status: "PENDING" } };
    where.status = "PENDING";
  } else {
    // "mine" 또는 미지원 scope → 안전하게 본인 것만 반환
    where.requesterId = u.id;
  }
  const list = await prisma.approval.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      requester: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true, position: true, team: true } },
      steps: {
        orderBy: { order: "asc" },
        include: { reviewer: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } } },
      },
    },
  });

  // 현재 차례(pending 중 첫 번째) 계산
  const decorated = list.map((a) => {
    const cur = a.steps.find((s) => s.status === "PENDING");
    return { ...a, currentStepOrder: cur?.order ?? null, currentReviewerId: cur?.reviewerId ?? null };
  });
  res.json({ approvals: decorated });
});

router.get("/:id", async (req, res) => {
  const u = (req as any).user;
  const a = await prisma.approval.findUnique({
    where: { id: req.params.id },
    include: {
      requester: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true, position: true, team: true, email: true } },
      steps: {
        orderBy: { order: "asc" },
        include: { reviewer: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true, position: true } } },
      },
      // 반려 → 재상신 체인을 양방향으로 포함. 원본을 타고 올라가고 개정본을 타고 내려감.
      revisedFrom: { select: { id: true, title: true, status: true, createdAt: true } },
      revisions: { select: { id: true, title: true, status: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      comments: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } } },
      },
    },
  });
  if (!a) return res.status(404).json({ error: "not found" });
  const canSee = a.requesterId === u.id || a.steps.some((s) => s.reviewerId === u.id) || u.role === "ADMIN";
  if (!canSee) return res.status(403).json({ error: "forbidden" });
  res.json({ approval: a });
});

/**
 * 결재 댓글 스레드 — 반려 사유에 대한 후속 논의, 재상신 전 맥락 정리용.
 * 기안자/결재자/ADMIN 만 보이고 쓸 수 있음.
 */
router.post("/:id/comments", async (req, res) => {
  const u = (req as any).user;
  const content = typeof req.body?.content === "string" ? req.body.content.trim().slice(0, 2000) : "";
  if (!content) return res.status(400).json({ error: "내용을 입력해주세요" });
  const a = await prisma.approval.findUnique({
    where: { id: req.params.id },
    include: { steps: { select: { reviewerId: true } } },
  });
  if (!a) return res.status(404).json({ error: "not found" });
  const canPost = a.requesterId === u.id || a.steps.some((s) => s.reviewerId === u.id) || u.role === "ADMIN";
  if (!canPost) return res.status(403).json({ error: "forbidden" });
  const c = await prisma.approvalComment.create({
    data: { approvalId: a.id, authorId: u.id, content },
    include: { author: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } } },
  });
  // 관련 당사자에게 멘션 알림 — 본인 제외. 순차 notify() → 병렬 notifyMany() 로 교체.
  const targets = new Set<string>([a.requesterId, ...a.steps.map((s) => s.reviewerId)]);
  targets.delete(u.id);
  if (targets.size > 0) {
    await notifyMany(Array.from(targets).map((userId) => ({
      userId,
      type: "MENTION" as const,
      title: "결재에 새 댓글",
      body: `${u.name}: ${content.slice(0, 120)}`,
      linkUrl: `/approvals?id=${a.id}`,
      actorName: u.name,
    })));
  }
  res.json({ comment: c });
});

/**
 * 반려된 결재를 기반으로 수정 재상신. 원본은 그대로 보존하고 revisedFromId 로 이어 붙여
 * 스레드 형태로 볼 수 있게 한다. 기안자 본인만 가능.
 */
router.post("/:id/revise", async (req, res) => {
  const u = (req as any).user;
  const parsed = approvalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const d = parsed.data;
  const orig = await prisma.approval.findUnique({ where: { id: req.params.id } });
  if (!orig) return res.status(404).json({ error: "not found" });
  if (orig.requesterId !== u.id) return res.status(403).json({ error: "본인 기안만 재상신할 수 있어요" });
  if (orig.status !== "REJECTED") return res.status(400).json({ error: "반려된 결재만 재상신할 수 있어요" });

  const reviewers = Array.from(new Set(d.reviewerIds.filter((id) => id !== u.id)));
  if (!reviewers.length) return res.status(400).json({ error: "결재자를 1명 이상 선택해주세요" });
  let dataJson: string | null = null;
  if (d.data !== undefined && d.data !== null) {
    const serialized = JSON.stringify(d.data);
    dataJson = serialized.length > 16_000 ? serialized.slice(0, 16_000) : serialized;
  }
  const approval = await prisma.approval.create({
    data: {
      type: d.type,
      title: d.title,
      content: d.content,
      data: dataJson,
      startDate: d.startDate ? new Date(d.startDate) : null,
      endDate: d.endDate ? new Date(d.endDate) : null,
      amount: d.amount,
      requesterId: u.id,
      revisedFromId: orig.id,
      steps: {
        create: reviewers.map((rid, idx) => ({ companyId: u.companyId, reviewerId: rid, order: idx + 1 })),
      },
    },
    include: { steps: true },
  });
  await writeLog(u.id, "APPROVAL_REVISE", approval.id, `${orig.id}→${approval.id}`);
  const first = approval.steps.find((s) => s.order === 1);
  if (first) {
    await notify({
      userId: first.reviewerId,
      type: "APPROVAL_REQUEST",
      title: `재상신 결재 요청 · ${labelForType(d.type)}`,
      body: d.title,
      linkUrl: `/approvals?id=${approval.id}`,
      actorName: u.name,
    });
  }
  res.json({ approval });
});

router.post("/", async (req, res) => {
  const parsed = approvalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const u = (req as any).user;
  const d = parsed.data;

  const reviewers = Array.from(new Set(d.reviewerIds.filter((id) => id !== u.id)));
  if (!reviewers.length) return res.status(400).json({ error: "결재자를 1명 이상 선택해주세요" });

  // d.data 는 z.any() 라 서버에서 다시 한 번 크기 제한. 결재 양식별 폼 JSON
  // (출장 지역/경비 등) 이 들어가는 자리라 수 KB 면 충분. 전역 json limit(2mb)
  // 안이라도 DB 단에서 수 MB 레코드는 쓰기/조회 비용을 부풀리므로 16KB 로 컷.
  let dataJson: string | null = null;
  if (d.data !== undefined && d.data !== null) {
    const serialized = JSON.stringify(d.data);
    dataJson = serialized.length > 16_000 ? serialized.slice(0, 16_000) : serialized;
  }

  const approval = await prisma.approval.create({
    data: {
      type: d.type,
      title: d.title,
      content: d.content,
      data: dataJson,
      startDate: d.startDate ? new Date(d.startDate) : null,
      endDate: d.endDate ? new Date(d.endDate) : null,
      amount: d.amount,
      requesterId: u.id,
      steps: {
        create: reviewers.map((rid, idx) => ({ companyId: u.companyId, reviewerId: rid, order: idx + 1 })),
      },
    },
    include: { steps: true },
  });
  await writeLog(u.id, "APPROVAL_CREATE", approval.id, `${d.type}:${d.title}`);

  const first = approval.steps.find((s) => s.order === 1);
  if (first) {
    await notify({
      userId: first.reviewerId,
      type: "APPROVAL_REQUEST",
      title: `결재 요청 · ${labelForType(d.type)}`,
      body: d.title,
      linkUrl: `/approvals?id=${approval.id}`,
      actorName: u.name,
    });
  }

  res.json({ approval });
});

router.post("/:id/act", async (req, res) => {
  const u = (req as any).user;
  const action = String(req.body?.action ?? ""); // approve | reject
  // 반려 사유는 zod 가 아니라 raw body 에서 꺼내는데, 길이 제한이 없으면
  // 메가바이트 페이로드로 DB write 가 부풀 수 있음. 500 자로 컷.
  const rawComment = req.body?.comment ? String(req.body.comment) : undefined;
  const comment = rawComment && rawComment.length > 500 ? rawComment.slice(0, 500) : rawComment;
  if (!["approve", "reject"].includes(action))
    return res.status(400).json({ error: "invalid action" });

  const a = await prisma.approval.findUnique({
    where: { id: req.params.id },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  if (!a) return res.status(404).json({ error: "not found" });
  if (a.status !== "PENDING") return res.status(400).json({ error: "이미 종결된 결재입니다" });

  const currentStep = a.steps.find((s) => s.status === "PENDING");
  if (!currentStep) return res.status(400).json({ error: "처리할 단계가 없습니다" });
  if (currentStep.reviewerId !== u.id)
    return res.status(403).json({ error: "본인 차례가 아닙니다" });

  const newStatus = action === "approve" ? "APPROVED" : "REJECTED";
  await prisma.approvalStep.update({
    where: { id: currentStep.id },
    data: { status: newStatus, comment, actedAt: new Date() },
  });

  if (action === "reject") {
    await prisma.approval.update({ where: { id: a.id }, data: { status: "REJECTED" } });
    await notify({
      userId: a.requesterId,
      type: "APPROVAL_REVIEW",
      title: `결재 반려 · ${labelForType(a.type)}`,
      body: `${a.title}\n${comment ?? ""}`.trim(),
      linkUrl: `/approvals?id=${a.id}`,
      actorName: u.name,
    });
  } else {
    // approve → 다음 단계 알림 혹은 최종 승인
    const next = a.steps.find((s) => s.order > currentStep.order && s.status === "PENDING");
    if (next) {
      await notify({
        userId: next.reviewerId,
        type: "APPROVAL_REQUEST",
        title: `결재 요청 · ${labelForType(a.type)}`,
        body: a.title,
        linkUrl: `/approvals?id=${a.id}`,
        actorName: u.name,
      });
    } else {
      await prisma.approval.update({ where: { id: a.id }, data: { status: "APPROVED" } });
      await notify({
        userId: a.requesterId,
        type: "APPROVAL_REVIEW",
        title: `결재 승인 · ${labelForType(a.type)}`,
        body: a.title,
        linkUrl: `/approvals?id=${a.id}`,
        actorName: u.name,
      });
    }
  }

  await writeLog(u.id, `APPROVAL_${action.toUpperCase()}`, a.id, a.title);

  const refreshed = await prisma.approval.findUnique({
    where: { id: a.id },
    include: {
      requester: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true, position: true, team: true } },
      steps: {
        orderBy: { order: "asc" },
        include: { reviewer: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } } },
      },
    },
  });
  // 목록 응답과 같은 shape — currentReviewerId / currentStepOrder 포함해야 클라가 즉시 selected 갱신 가능.
  const cur = refreshed?.steps.find((s) => s.status === "PENDING");
  res.json({
    approval: refreshed
      ? { ...refreshed, currentStepOrder: cur?.order ?? null, currentReviewerId: cur?.reviewerId ?? null }
      : null,
  });
});

router.post("/:id/cancel", async (req, res) => {
  const u = (req as any).user;
  const a = await prisma.approval.findUnique({ where: { id: req.params.id } });
  if (!a) return res.status(404).json({ error: "not found" });
  if (a.requesterId !== u.id) return res.status(403).json({ error: "forbidden" });
  if (a.status !== "PENDING") return res.status(400).json({ error: "이미 종결되었습니다" });
  await prisma.approval.update({ where: { id: a.id }, data: { status: "CANCELED" } });
  await writeLog(u.id, "APPROVAL_CANCEL", a.id);
  res.json({ ok: true });
});

function labelForType(t: string) {
  return {
    TRIP: "출장 신청",
    OFFSITE: "외근 신청",
    EXPENSE: "지출결의",
    PURCHASE: "구매요청",
    GENERAL: "일반 품의",
    OTHER: "기타",
  }[t] ?? t;
}

export default router;
