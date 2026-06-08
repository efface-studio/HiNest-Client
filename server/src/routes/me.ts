import { Router } from "express";
import { z } from "zod";
import { requireAuth, clearImpCookie, writeLog } from "../lib/auth.js";
import { prisma } from "../lib/db.js";
import { isConsoleOnlyUser } from "../lib/consoleOnly.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  // requireAuth 가 이미 user row 전체를 가져왔으므로 재조회하지 말고 그걸 재사용.
  // 매 화면 로드마다 호출되는 엔드포인트라 DB 왕복 1번 절약이 체감된다.
  const user = (req as any).userRecord;
  if (!user) return res.status(404).json({ error: "not found" });
  // 임퍼소네이션 중이면 진짜 사용자 정보도 같이 — 클라이언트가 빨간 배너를 띄움.
  const real = (req as any).realUser;
  const impedById: string | null = (req as any).impersonatedById ?? null;
  const impersonator = impedById && real
    ? { id: real.id, name: real.name }
    : null;
  res.json({
    impersonator,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      team: user.team,
      position: user.position,
      avatarColor: user.avatarColor,
      avatarUrl: user.avatarUrl,
      superAdmin: user.superAdmin,
      platformAdmin: user.platformAdmin,
      // 개발자 콘솔 전용 계정이면 회사 앱(일반 페이지) 접근을 막고 /super-admin 으로 보낸다.
      consoleOnly: isConsoleOnlyUser(user),
      companyId: user.companyId ?? null,
      isDeveloper: user.isDeveloper,
      employeeNo: user.employeeNo,
      presenceStatus: user.presenceStatus,
      presenceMessage: user.presenceMessage,
      presenceUpdatedAt: user.presenceUpdatedAt,
      workStartTime: user.workStartTime,
      workEndTime: user.workEndTime,
    },
  });
});

// 업무 상태 변경 — null 로 보내면 "자동 판정 (attendance 기준)"
// 수동 설정 가능 상태 — 근무중/오프라인은 자동 판정이라 수동 값에서 제외.
const PRESENCE_VALUES = ["MEETING", "MEAL", "OUT", "AWAY"] as const;
const presenceSchema = z.object({
  status: z.enum(PRESENCE_VALUES).nullable(),
  message: z.string().max(60).nullable().optional(),
});

router.patch("/presence", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const parsed = presenceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const { status, message } = parsed.data;
  const updated = await prisma.user.update({
    where: { id: u.id },
    data: {
      presenceStatus: status,
      presenceMessage: message ?? null,
      presenceUpdatedAt: status ? new Date() : null,
    },
    select: { presenceStatus: true, presenceMessage: true, presenceUpdatedAt: true },
  });
  res.json(updated);
});

/** 임퍼소네이션 종료 — 모든 인증 사용자에게 열어둠.
 *  (관리자 권한 체크가 있으면 임퍼소네이션 중인 일반 유저가 빠져나올 수 없음.) */
router.delete("/impersonate", requireAuth, async (req, res) => {
  const real = (req as any).realUser;
  const impedId = (req as any).impersonatedById;
  clearImpCookie(res, req);
  if (impedId && real?.id) {
    await writeLog(real.id, "IMPERSONATE_END", (req as any).user?.id, undefined, req.ip);
  }
  res.json({ ok: true });
});

export default router;
