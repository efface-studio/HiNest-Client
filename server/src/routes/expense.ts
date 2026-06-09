import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth, writeLog } from "../lib/auth.js";
import { notify } from "../lib/notify.js";

const router = Router();
router.use(requireAuth);

// receiptUrl 은 클라에서 base64 data URL 또는 /uploads/ 경로로 들어옴.
// 전역 body limit (2MB, index.ts) 에 걸리면 413 이 나버리고 zod 에 도달조차 못하므로
// 클라에서 이미지 사이즈를 맞춰 보내야 함 (현재 ≈1.3MB 바이너리 상한).
// data URL 이외 외부 URL 을 저장하면 리뷰어가 클릭했을 때 피싱/CSRF 위험 → 엄격 매칭.
const RECEIPT_MAX_LEN = 1_900_000; // 2MB - JSON 오버헤드 buffer
const receiptUrlSchema = z
  .string()
  .max(RECEIPT_MAX_LEN, "영수증 이미지가 너무 큽니다")
  .regex(/^(data:image\/[a-zA-Z+.-]+;base64,|\/uploads\/[A-Za-z0-9._-]+$)/, "허용되지 않는 영수증 경로")
  .optional();

const schema = z.object({
  // ISO 8601 확장 포맷도 40자면 충분. 길게 들어오는 걸 막아 Date 파싱 비용 방어.
  // 추가로 실제 파싱 가능한 날짜인지 refine — Invalid Date 가 Prisma 까지 흘러가 500 이 나던 경로 차단.
  usedAt: z.string().min(1).max(40).refine(
    (s) => !Number.isNaN(new Date(s).getTime()),
    { message: "날짜 형식이 올바르지 않습니다" },
  ),
  merchant: z.string().min(1).max(200),
  category: z.string().min(1).max(40),
  amount: z.number().int().nonnegative().max(100_000_000),
  memo: z.string().max(2000).optional(),
  receiptUrl: receiptUrlSchema,
});

// 목록
router.get("/", async (req, res) => {
  const u = (req as any).user;
  const all = req.query.all === "1" && (u.role === "ADMIN" || u.role === "MANAGER");
  const month = req.query.month ? String(req.query.month) : undefined;

  const where: any = all ? {} : { userId: u.id };
  // MANAGER 는 자기 팀 지출만 볼 수 있어야 함 — 다른 팀 예산 노출 방지.
  if (all && u.role === "MANAGER") {
    const me = await prisma.user.findUnique({ where: { id: u.id }, select: { team: true } });
    where.user = me?.team ? { team: me.team } : { id: "__none__" };
  }
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    where.usedAt = {
      gte: new Date(y, m - 1, 1),
      lt: new Date(y, m, 1),
    };
  }
  const list = await prisma.cardExpense.findMany({
    where,
    orderBy: { usedAt: "desc" },
    // 한 달 경비는 팀당 수백 건 정도 — 그래도 무한 스캔 차단을 위해 상한을 건다.
    take: 1000,
    include: { user: { select: { name: true, team: true } } },
  });
  const totalAmount = list.reduce((s, x) => s + x.amount, 0);
  res.json({ expenses: list, totalAmount });
});

router.post("/", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const u = (req as any).user;
  const d = parsed.data;
  const e = await prisma.cardExpense.create({
    data: {
      userId: u.id,
      usedAt: new Date(d.usedAt),
      merchant: d.merchant,
      category: d.category,
      amount: d.amount,
      memo: d.memo,
      receiptUrl: d.receiptUrl,
    },
  });
  await writeLog(u.id, "EXPENSE_CREATE", e.id, `${d.merchant} ${d.amount}원`);
  res.json({ expense: e });
});

router.patch("/:id", async (req, res) => {
  const u = (req as any).user;
  const exist = await prisma.cardExpense.findUnique({ where: { id: req.params.id } });
  if (!exist) return res.status(404).json({ error: "not found" });

  const body = req.body ?? {};

  if (body.status && (u.role === "ADMIN" || u.role === "MANAGER")) {
    if (!["PENDING", "APPROVED", "REJECTED"].includes(body.status))
      return res.status(400).json({ error: "invalid status" });
    // 본인 지출 자기 심사 방지 — 역할에 관계없이 본인 경비는 심사 불가
    if (exist.userId === u.id)
      return res.status(403).json({ error: "본인 지출은 심사할 수 없어요" });
    // MANAGER 는 같은 팀 지출만 심사 가능.
    if (u.role === "MANAGER") {
      const [me, owner] = await Promise.all([
        prisma.user.findUnique({ where: { id: u.id }, select: { team: true } }),
        prisma.user.findUnique({ where: { id: exist.userId }, select: { team: true } }),
      ]);
      if (!me?.team || owner?.team !== me.team) {
        return res.status(403).json({ error: "다른 팀의 경비를 심사할 수 없어요" });
      }
    }
    const updated = await prisma.cardExpense.update({
      where: { id: exist.id },
      data: { status: body.status, reviewer: u.id },
    });
    await writeLog(u.id, "EXPENSE_REVIEW", exist.id, body.status);
    // 경비 소유자에게 심사 결과 알림 — 승인/반려일 때만, 본인 심사 자기알림 방지(가드 중복이나 안전).
    if ((body.status === "APPROVED" || body.status === "REJECTED") && exist.userId !== u.id) {
      await notify({
        userId: exist.userId,
        type: "APPROVAL_REVIEW",
        title: body.status === "APPROVED" ? "법인카드 사용내역이 승인됐어요" : "법인카드 사용내역이 반려됐어요",
        body: `${exist.merchant} ${exist.amount.toLocaleString("ko-KR")}원`,
        linkUrl: "/expense",
        actorName: u.name,
      });
    }
    return res.json({ expense: updated });
  }

  if (exist.userId !== u.id) return res.status(403).json({ error: "forbidden" });
  // 승인·반려가 끝난 경비는 작성자라도 내용 수정 불가 — 승인 이력과 실제 값이 어긋나는
  // 워크플로 무결성 훼손을 막는다(금액·상호·날짜 등을 사후 변경하는 행위 차단).
  // 수정이 필요하면 관리자가 PENDING 으로 되돌린 뒤(위 status 분기) 다시 편집.
  if (exist.status !== "PENDING") {
    return res.status(409).json({ error: "이미 처리된 경비는 수정할 수 없어요. 관리자에게 상태 변경을 요청하세요." });
  }
  const parsed = schema.partial().safeParse(body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const d = parsed.data;
  const updated = await prisma.cardExpense.update({
    where: { id: exist.id },
    data: {
      ...(d.usedAt && { usedAt: new Date(d.usedAt) }),
      ...(d.merchant && { merchant: d.merchant }),
      ...(d.category && { category: d.category }),
      ...(d.amount !== undefined && { amount: d.amount }),
      ...(d.memo !== undefined && { memo: d.memo }),
      ...(d.receiptUrl !== undefined && { receiptUrl: d.receiptUrl }),
    },
  });
  await writeLog(u.id, "EXPENSE_UPDATE", exist.id);
  res.json({ expense: updated });
});

router.delete("/:id", async (req, res) => {
  const u = (req as any).user;
  const exist = await prisma.cardExpense.findUnique({ where: { id: req.params.id } });
  if (!exist) return res.status(404).json({ error: "not found" });
  if (exist.userId !== u.id && u.role !== "ADMIN")
    return res.status(403).json({ error: "forbidden" });
  await prisma.cardExpense.delete({ where: { id: exist.id } });
  await writeLog(u.id, "EXPENSE_DELETE", exist.id);
  res.json({ ok: true });
});

export default router;
