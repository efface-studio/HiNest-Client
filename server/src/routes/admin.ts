import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db.js";
import { runUnscoped } from "../lib/tenant.js";
import {
  requireAdmin, requireAuth, requireSuperAdminStepUp, verifySuperToken,
  signSuper, setSuperCookie, SUPER_TTL_SEC,
  writeLog, evictUserCache, evictSessionCache,
  signImpersonate, setImpCookie, clearImpCookie,
} from "../lib/auth.js";
import { todayStr } from "../lib/dates.js";
import { getLogs, type LogLevel, getErrorGroups, getErrorGroup, clearErrorGroups } from "../lib/logBuffer.js";
import { evictNavVisibilityCache } from "./nav.js";

const router = Router();
router.use(requireAuth, requireAdmin);

/**
 * 개발자(superAdmin) 운영 콘솔 전용 서브라우터.
 *
 * 회사 단위 admin 엔드포인트(위 `router` 에 직접 등록)는 평소대로 자기 회사로 스코프되지만,
 * 운영 콘솔은 전 회사를 가로지르는 god-view 여야 한다(로그·감사·세션·휴지통·시스템 통계 등).
 * 따라서 이 그룹의 핸들러만 runUnscoped 로 테넌트 스코프를 국소 해제한다.
 *
 * 보안: superAdmin 세션에 전역 bypass 를 주지 않는다. 전역으로 풀면 일반 서비스 화면
 * (채팅·근태·문서 등)에서도 타 회사 데이터가 섞여 노출되기 때문. 해제는 오직 이 콘솔
 * 라우트 구간에서만 일어난다. (PR #194 가 /api/platform 에 적용한 패턴과 동일.)
 *
 * 마운트는 파일 끝에서 router.use(ops). 회사 라우트가 먼저 매칭되므로 스코프 해제가
 * 그쪽으로 새지 않는다(회사 admin 요청은 ops 에 들어오지 않는다).
 */
const ops = Router();
ops.use((_req: Request, _res: Response, next: NextFunction) => runUnscoped(() => next()));

/* ===== 초대키 ===== */
router.get("/invites", async (_req, res) => {
  const keys = await prisma.inviteKey.findMany({
    orderBy: { createdAt: "desc" },
    include: { usedBy: { select: { name: true, email: true } } },
  });
  res.json({ keys });
});

const createKeySchema = z.object({
  email: z.string().email().max(200).optional().or(z.literal("")),
  name: z.string().max(200).optional(),
  role: z.enum(["ADMIN", "MANAGER", "MEMBER"]).default("MEMBER"),
  team: z.string().max(80).optional(),
  position: z.string().max(80).optional(),
  expiresInDays: z.number().int().positive().max(365).optional(),
});

router.post("/invites", async (req, res) => {
  const parsed = createKeySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const d = parsed.data;
  const u = (req as any).user;

  const key = `HN-${crypto.randomBytes(4).toString("hex").toUpperCase()}-${crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;

  const created = await prisma.inviteKey.create({
    data: {
      key,
      email: d.email || null,
      name: d.name || null,
      role: d.role,
      team: d.team || null,
      position: d.position || null,
      expiresAt: d.expiresInDays ? new Date(Date.now() + d.expiresInDays * 86400000) : null,
      createdById: u.id,
    },
  });
  await writeLog(u.id, "INVITE_CREATE", key, JSON.stringify(d));
  res.json({ key: created });
});

router.delete("/invites/:id", async (req, res) => {
  const u = (req as any).user;
  await prisma.inviteKey.delete({ where: { id: req.params.id } });
  await writeLog(u.id, "INVITE_DELETE", req.params.id);
  res.json({ ok: true });
});

/* ===== 유저 ===== */
// HR 상세까지 포함해 전 필드 반환. 엑셀 업/다운로드 기반.
const HR_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  team: true,
  position: true,
  active: true,
  resignedAt: true,
  avatarColor: true,

  isDeveloper: true,
  avatarUrl: true,
  createdAt: true,
  hrCode: true,
  affiliation: true,
  employeeNo: true,
  workplace: true,
  department: true,
  jobDuty: true,
  employmentType: true,
  employmentCategory: true,
  contractType: true,
  birthDate: true,
  gender: true,
  disabilityType: true,
  disabilityLevel: true,
  hireDate: true,
  phone: true,
  note: true,
  autoClockOutTime: true,
  workStartTime: true,
  workEndTime: true,
  failedLoginCount: true,
  lockedAt: true,
} as const;

router.get("/users", async (req, res) => {
  const u = (req as any).user;
  // 상한 5000 — 엑셀 업로드 상한과 맞춤. 조직이 더 커지면 cursor pagination 으로 전환.
  const users = await prisma.user.findMany({
    where: u.superAdmin ? {} : { superAdmin: false }, // 일반 관리자에겐 총관리자 계정 은닉
    orderBy: { createdAt: "desc" },
    select: HR_SELECT,
    take: 5000,
  });
  res.json({ users });
});

// HR 필드 전반은 짧은 ID/코드/라벨 성격이므로 500자면 충분.
// note 만 자유 메모라 5000자까지 허용. 둘 다 DoS 방지 + DB 컬럼 오남용 차단용 상한.
const nullableStr = z.string().max(500).optional().nullable();
const noteStr = z.string().max(5_000).optional().nullable();
const updateUserSchema = z.object({
  role: z.enum(["ADMIN", "MANAGER", "MEMBER"]).optional(),
  team: nullableStr,
  position: nullableStr,
  active: z.boolean().optional(),
  name: z.string().max(200).optional(),
  hrCode: nullableStr,
  affiliation: nullableStr,
  employeeNo: nullableStr,
  workplace: nullableStr,
  department: nullableStr,
  jobDuty: nullableStr,
  employmentType: nullableStr,
  employmentCategory: nullableStr,
  contractType: nullableStr,
  birthDate: nullableStr,
  gender: nullableStr,
  disabilityType: nullableStr,
  disabilityLevel: nullableStr,
  hireDate: nullableStr,
  phone: nullableStr,
  note: noteStr,
  // 자동 퇴근 시간 — "HH:mm" 형식. 빈 문자열이면 null 로 저장해 자동 퇴근 해제.
  autoClockOutTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm 형식").optional().nullable()
    .or(z.literal("")),
  // 기준 근무 시각 — "HH:mm" 형식. 빈 문자열 → null (기본 09:00 / 18:00 로 fallback).
  workStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm 형식").optional().nullable()
    .or(z.literal("")),
  workEndTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm 형식").optional().nullable()
    .or(z.literal("")),
});

router.patch("/users/:id", async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const u = (req as any).user;

  // 총관리자는 일반 관리자가 변경할 수 없음 — 404 처럼 위장해 존재를 노출하지 않음
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: "not found" });
  if (target.superAdmin && !u.superAdmin) return res.status(404).json({ error: "not found" });

  const data = parsed.data;

  // 빈 문자열 "" 는 null 로 정규화 — DB 에 저장되면 "자동 퇴근 미설정" 으로 해석됨.
  if (data.autoClockOutTime === "") (data as any).autoClockOutTime = null;
  if (data.workStartTime === "") (data as any).workStartTime = null;
  if (data.workEndTime === "") (data as any).workEndTime = null;

  // 역할 변경은 민감한 권한 에스컬레이션 경로. superAdmin + step-up 쿠키가 있어야 허용.
  // ADMIN 이 자신 또는 동료의 role 을 임의로 바꿀 수 없게 함.
  const isRoleChange = data.role !== undefined && data.role !== target.role;
  if (isRoleChange) {
    if (!u.superAdmin) {
      return res.status(403).json({ error: "역할 변경 권한이 없습니다 (총관리자 전용)" });
    }
    const v = verifySuperToken(req, u.id);
    if (!v) {
      return res.status(401).json({
        error: "역할 변경 전에 비밀번호 재확인이 필요합니다",
        code: "SUPER_STEPUP_REQUIRED",
      });
    }
    // 본인 역할 강등은 사고 방지용 차단 — 필요하면 다른 총관리자가 처리.
    if (target.id === u.id) {
      return res.status(400).json({ error: "본인 역할은 변경할 수 없습니다" });
    }
  }

  // 본인 계정 비활성화 차단 — 자기 자신 락아웃 사고 방지.
  // (resign 엔드포인트도 별도로 가드 — 아래 참조)
  if (data.active === false && target.id === u.id) {
    return res.status(400).json({ error: "본인 계정은 비활성화할 수 없습니다" });
  }

  const updated = await prisma.user.update({
    where: { id: req.params.id },
    data,
    select: HR_SELECT,
  });
  // 권한/활성 상태 변경 시 캐시된 세션 정보를 즉시 무효화해야 함 (30s TTL 대기 없이 즉시 반영)
  evictUserCache(req.params.id);
  await writeLog(
    u.id,
    isRoleChange ? "USER_ROLE_CHANGE" : "USER_UPDATE",
    req.params.id,
    JSON.stringify(data)
  );
  res.json({ user: updated });
});

/* ===== 엑셀 일괄 업로드 — HR 필드 업서트 =====
 * 클라이언트에서 xlsx 파일 파싱 후 행 배열 전달.
 * 식별자: email(우선) 또는 employeeNo 또는 hrCode 중 먼저 매치되는 기존 유저를 업데이트.
 * 매치 안 되면 무시 (잘못된 비밀번호로 신규 유저 만들지 않음).
 */
// 업데이트 스키마와 동일한 상한 적용 — 한 행이 거대한 페이로드를 숨기지 못하도록.
const importShortStr = z.string().max(500).optional();
const importNoteStr = z.string().max(5_000).optional();
const importRowSchema = z.object({
  email: z.string().max(200).optional(),
  hrCode: importShortStr,
  employeeNo: importShortStr,
  name: z.string().max(200).optional(),
  affiliation: importShortStr,
  workplace: importShortStr,
  department: importShortStr,
  jobDuty: importShortStr,
  position: importShortStr,
  employmentType: importShortStr,
  employmentCategory: importShortStr,
  contractType: importShortStr,
  birthDate: importShortStr,
  gender: importShortStr,
  disabilityType: importShortStr,
  disabilityLevel: importShortStr,
  hireDate: importShortStr,
  phone: importShortStr,
  note: importNoteStr,
  team: importShortStr,
});
/** 1회 import 최대 행 수 — DoS 방지용 상한. 실무상 넉넉한 5000. */
const IMPORT_MAX_ROWS = 5000;

router.post("/users/import", async (req, res) => {
  const u = (req as any).user;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows) return res.status(400).json({ error: "rows 배열이 필요합니다." });
  if (rows.length > IMPORT_MAX_ROWS) {
    return res.status(413).json({
      error: `한 번에 업로드 가능한 최대 행 수(${IMPORT_MAX_ROWS})를 초과했습니다. 나눠서 업로드해 주세요.`,
    });
  }

  // 성능 개선 (N+1 → 상수 쿼리):
  // 기존엔 5000 rows × up to 3 (email/employeeNo/hrCode) lookup = 최대 15,000 개의 DB 왕복.
  // 이제는 가능한 모든 식별자를 한 번에 모아 3회의 findMany 로 해결.
  // update 는 여전히 row 당 1회 유지 (데이터 일관성 · 오류 추적 목적).
  const emailsSet = new Set<string>();
  const empNosSet = new Set<string>();
  const hrCodesSet = new Set<string>();
  for (const raw of rows) {
    if (raw?.email) emailsSet.add(String(raw.email));
    if (raw?.employeeNo) empNosSet.add(String(raw.employeeNo));
    if (raw?.hrCode) hrCodesSet.add(String(raw.hrCode));
  }

  const [byEmail, byEmpNo, byHrCode] = await Promise.all([
    emailsSet.size
      ? prisma.user.findMany({
          where: { email: { in: [...emailsSet] } },
          select: { id: true, email: true, superAdmin: true },
        })
      : Promise.resolve([] as { id: string; email: string; superAdmin: boolean }[]),
    empNosSet.size
      ? prisma.user.findMany({
          where: { employeeNo: { in: [...empNosSet] } },
          select: { id: true, employeeNo: true, superAdmin: true },
        })
      : Promise.resolve([] as { id: string; employeeNo: string | null; superAdmin: boolean }[]),
    hrCodesSet.size
      ? prisma.user.findMany({
          where: { hrCode: { in: [...hrCodesSet] } },
          select: { id: true, hrCode: true, superAdmin: true },
        })
      : Promise.resolve([] as { id: string; hrCode: string | null; superAdmin: boolean }[]),
  ]);
  const emailMap = new Map(byEmail.map((x) => [x.email, { id: x.id, superAdmin: x.superAdmin }]));
  const empNoMap = new Map(
    byEmpNo.filter((x) => x.employeeNo).map((x) => [x.employeeNo as string, { id: x.id, superAdmin: x.superAdmin }])
  );
  const hrCodeMap = new Map(
    byHrCode.filter((x) => x.hrCode).map((x) => [x.hrCode as string, { id: x.id, superAdmin: x.superAdmin }])
  );

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const [i, raw] of rows.entries()) {
    const parsed = importRowSchema.safeParse(raw);
    if (!parsed.success) {
      skipped++;
      errors.push(`행 ${i + 2}: 형식 오류`);
      continue;
    }
    const d = parsed.data;
    // 식별자 순서: email → employeeNo → hrCode
    let target: { id: string; superAdmin: boolean } | undefined;
    if (d.email) target = emailMap.get(d.email);
    if (!target && d.employeeNo) target = empNoMap.get(d.employeeNo);
    if (!target && d.hrCode) target = hrCodeMap.get(d.hrCode);
    if (!target) {
      skipped++;
      errors.push(`행 ${i + 2}: 일치하는 유저 없음 (email/사번/HR번호 중 하나 필요)`);
      continue;
    }
    if (target.superAdmin && !u.superAdmin) {
      skipped++;
      continue;
    }
    // undefined 값은 무시되도록 필터링
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d)) {
      if (k === "email") continue; // 식별자로만 쓰고 변경은 안 함
      if (v !== undefined && v !== "") data[k] = v;
    }
    await prisma.user.update({ where: { id: target.id }, data });
    updated++;
  }
  await writeLog(u.id, "USER_IMPORT", "", JSON.stringify({ updated, skipped }));
  res.json({ updated, skipped, errors: errors.slice(0, 20) });
});

router.delete("/users/:id", async (req, res) => {
  const u = (req as any).user;
  if (req.params.id === u.id) return res.status(400).json({ error: "본인은 삭제할 수 없습니다" });

  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: "not found" });
  if (target.superAdmin && !u.superAdmin) return res.status(404).json({ error: "not found" });

  await prisma.user.delete({ where: { id: req.params.id } });
  await writeLog(u.id, "USER_DELETE", req.params.id);
  res.json({ ok: true });
});

/* ===== 퇴사 처리 =====
 * 구성원을 퇴사로 표시하고 로그인을 즉시 차단한다.
 *
 * 보안 정책:
 *  - 관리자가 자기 자신의 비밀번호를 한 번 더 입력해야 처리 가능 (계정 탈취·실수 방지 step-up).
 *  - 총관리자 계정은 일반 관리자가 건드릴 수 없음 (기존 PATCH 와 동일 정책).
 *  - 본인 퇴사는 불가 — 관리자 본인이 사고로 자기 로그인을 막는 상황을 차단.
 *
 * 동작:
 *  - resignedAt 에 퇴사일(관리자가 캘린더에서 고른 YYYY-MM-DD) 저장.
 *  - active=false 로 설정 → 로그인 로직(auth.ts) 이 user.active 로 가드하므로 바로 차단됨.
 */
const resignSchema = z.object({
  // 관리자의 현재 계정 비밀번호 (step-up 재확인)
  password: z.string().min(1).max(128),
  // 퇴사일 — "YYYY-MM-DD" 문자열. 빈 값이면 오늘 날짜로.
  resignedAt: z.string().max(40).optional(),
});

router.post("/users/:id/resign", async (req, res) => {
  const u = (req as any).user;
  const parsed = resignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });

  if (req.params.id === u.id) {
    return res.status(400).json({ error: "본인 계정은 퇴사 처리할 수 없습니다" });
  }

  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: "not found" });
  if (target.superAdmin && !u.superAdmin) return res.status(404).json({ error: "not found" });

  // 관리자 본인 비밀번호 재확인 — 잘못된 재확인을 attacker 가 폭주시키지 못하게 bcrypt.compare 자체가 slow.
  const me = await prisma.user.findUnique({ where: { id: u.id }, select: { passwordHash: true } });
  if (!me) return res.status(401).json({ error: "세션이 유효하지 않습니다" });
  const ok = await bcrypt.compare(parsed.data.password, me.passwordHash);
  if (!ok) {
    await writeLog(u.id, "USER_RESIGN_FAIL", req.params.id, "bad_password");
    return res.status(401).json({ error: "비밀번호가 올바르지 않습니다", code: "BAD_PASSWORD" });
  }

  // 날짜 파싱 — 빈 값이면 지금 시각. YYYY-MM-DD 는 자정(로컬) 기준으로 해석.
  let when: Date;
  if (parsed.data.resignedAt) {
    const s = parsed.data.resignedAt;
    // ISO 혹은 YYYY-MM-DD 둘 다 허용
    when = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
    if (Number.isNaN(when.getTime())) {
      return res.status(400).json({ error: "퇴사일 형식이 올바르지 않습니다" });
    }
  } else {
    when = new Date();
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { resignedAt: when, active: false },
    select: HR_SELECT,
  });
  evictUserCache(target.id);
  await writeLog(u.id, "USER_RESIGN", target.id, `at=${when.toISOString()}`);
  res.json({ user: updated });
});

/**
 * 퇴사 취소(복직) — 실수로 퇴사 처리한 경우를 되돌리기 위함.
 * 동일하게 관리자 비밀번호 재확인 필요.
 */
/** 잠긴 계정 해제 — failedLoginCount 0, lockedAt null. ADMIN 권한 필요. */
router.post("/users/:id/unlock", async (req, res) => {
  const u = (req as any).user;
  const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, email: true, lockedAt: true, superAdmin: true } });
  if (!target) return res.status(404).json({ error: "not found" });
  if (target.superAdmin && !u.superAdmin) return res.status(404).json({ error: "not found" });
  await prisma.user.update({
    where: { id: target.id },
    data: { failedLoginCount: 0, lockedAt: null },
  });
  await evictUserCache(target.id);
  await writeLog(u.id, "USER_UNLOCK", target.id, target.email, req.ip);
  res.json({ ok: true });
});

/**
 * 잠긴 계정 일괄 해제 — 한 번에 모든 잠긴(혹은 실패 카운트 보유) 계정의 잠금을 푼다.
 * SuperAdmin 이 아닌 경우, 다른 SuperAdmin 의 잠금은 해제하지 않는다.
 */
router.post("/users/unlock-all", async (req, res) => {
  const u = (req as any).user;
  // 대상 계정 미리 조회 — 감사 로그에 누구를 풀었는지 남기기 위함.
  const targets = await prisma.user.findMany({
    where: {
      OR: [{ lockedAt: { not: null } }, { failedLoginCount: { gt: 0 } }],
      ...(u.superAdmin ? {} : { superAdmin: false }),
    },
    select: { id: true, email: true },
  });
  if (targets.length === 0) {
    return res.json({ ok: true, count: 0, users: [] });
  }
  const ids = targets.map((t) => t.id);
  await prisma.user.updateMany({
    where: { id: { in: ids } },
    data: { failedLoginCount: 0, lockedAt: null },
  });
  // 각 사용자 캐시 무효화 + 감사 로그
  await Promise.all(targets.map((t) => evictUserCache(t.id)));
  await writeLog(u.id, "USER_UNLOCK_BULK", undefined, `count=${targets.length} ids=${ids.join(",")}`, req.ip);
  res.json({ ok: true, count: targets.length, users: targets });
});

/** 관리자가 유저 비밀번호를 직접 설정. 기존 console 명령은 임시 비번 생성이고, 이건 명시 비번 입력. */
router.post("/users/:id/reset-password", async (req, res) => {
  const u = (req as any).user;
  const parsed = z.object({ newPassword: z.string().min(8).max(128) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "비밀번호는 8자 이상이어야 합니다" });
  const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, email: true, superAdmin: true } });
  if (!target) return res.status(404).json({ error: "not found" });
  // super-admin 의 비밀번호는 super-admin 끼리만 리셋 가능 — 404 로 위장(존재 노출 X).
  if (target.superAdmin && !u.superAdmin) return res.status(404).json({ error: "not found" });
  // super-admin 끼리의 비번 리셋(자기 자신 포함)은 step-up 필요. (쿠키 단독 탈취 시
  // super 비밀번호까지 덮어쓰는 우회 차단.)
  if (target.superAdmin) {
    const v = verifySuperToken(req, u.id);
    if (!v) return res.status(401).json({ error: "step-up 필요", code: "SUPER_STEPUP_REQUIRED" });
  }
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  // 새 비번 발효 + 잠김 해제 + 대상의 모든 활성 세션 revoke (다른 기기 자동 로그아웃).
  // 이전엔 세션 그대로라 공격자가 ADMIN 의 잔존 세션으로 계속 활동 가능했다.
  const sessionsToEvict = await prisma.session.findMany({
    where: { userId: target.id, revokedAt: null },
    select: { id: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: { passwordHash, failedLoginCount: 0, lockedAt: null },
    });
    await tx.session.updateMany({
      where: { userId: target.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: u.id },
    });
  });
  for (const s of sessionsToEvict) evictSessionCache(s.id);
  await evictUserCache(target.id);
  await writeLog(u.id, "USER_PW_RESET", target.id, target.email, req.ip);
  res.json({ ok: true });
});

router.post("/users/:id/unresign", async (req, res) => {
  const u = (req as any).user;
  const parsed = z.object({ password: z.string().min(1).max(128) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });

  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: "not found" });
  if (target.superAdmin && !u.superAdmin) return res.status(404).json({ error: "not found" });

  const me = await prisma.user.findUnique({ where: { id: u.id }, select: { passwordHash: true } });
  if (!me) return res.status(401).json({ error: "세션이 유효하지 않습니다" });
  const ok = await bcrypt.compare(parsed.data.password, me.passwordHash);
  if (!ok) {
    await writeLog(u.id, "USER_UNRESIGN_FAIL", req.params.id, "bad_password");
    return res.status(401).json({ error: "비밀번호가 올바르지 않습니다", code: "BAD_PASSWORD" });
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { resignedAt: null, active: true },
    select: HR_SELECT,
  });
  evictUserCache(target.id);
  await writeLog(u.id, "USER_UNRESIGN", target.id);
  res.json({ user: updated });
});

/* ===== 팀 ===== */
router.get("/teams", async (_req, res) => {
  const teams = await prisma.team.findMany({ orderBy: { createdAt: "asc" }, take: 500 });
  res.json({ teams });
});

// 팀/직급 이름은 UI 상 80자면 넉넉. zod schema (user.team/position) 와 동일한 상한으로 맞춤.
// 상한 없이는 수 MB name 으로 DB 를 부풀리거나 user.team 전수 업데이트가 극단적으로 느려질 수 있음.
function capName(raw: unknown, limit = 80): string {
  const s = String(raw ?? "").trim();
  return s.length > limit ? s.slice(0, limit) : s;
}

router.post("/teams", async (req, res) => {
  const name = capName(req.body?.name);
  if (!name) return res.status(400).json({ error: "이름을 입력해주세요" });
  const u = (req as any).user;
  try {
    const team = await prisma.team.create({ data: { name } });
    await writeLog(u.id, "TEAM_CREATE", team.id, name);
    res.json({ team });
  } catch (e: any) {
    if (e?.code === "P2002") return res.status(400).json({ error: "이미 존재하는 팀" });
    throw e;
  }
});

router.patch("/teams/:id", async (req, res) => {
  const name = capName(req.body?.name);
  if (!name) return res.status(400).json({ error: "이름을 입력해주세요" });
  const u = (req as any).user;
  const prev = await prisma.team.findUnique({ where: { id: req.params.id } });
  if (!prev) return res.status(404).json({ error: "not found" });
  const team = await prisma.team.update({ where: { id: prev.id }, data: { name } });
  // 사용자 team 문자열도 동기화
  if (prev.name !== name) {
    // `team` 변수는 Team 객체라 문자열 필드에 바로 못 넣음. 새 이름 `name` 을 넣어야
    // 사용자의 team 문자열이 올바르게 동기화됨.
    await prisma.user.updateMany({ where: { team: prev.name }, data: { team: name } });
  }
  await writeLog(u.id, "TEAM_UPDATE", team.id, `${prev.name} -> ${name}`);
  res.json({ team });
});

router.delete("/teams/:id", async (req, res) => {
  const u = (req as any).user;
  const team = await prisma.team.findUnique({ where: { id: req.params.id } });
  if (!team) return res.status(404).json({ error: "not found" });
  await prisma.team.delete({ where: { id: team.id } });
  await writeLog(u.id, "TEAM_DELETE", team.id, team.name);
  res.json({ ok: true });
});

/* ===== 직급 ===== */
router.get("/positions", async (_req, res) => {
  const positions = await prisma.position.findMany({
    orderBy: [{ rank: "asc" }, { createdAt: "asc" }],
    take: 500,
  });
  res.json({ positions });
});

router.post("/positions", async (req, res) => {
  const name = capName(req.body?.name);
  if (!name) return res.status(400).json({ error: "이름을 입력해주세요" });
  const u = (req as any).user;
  // rank 는 더이상 수동 입력받지 않음 — 드래그 정렬 UI 로 바뀌면서
  // 새 항목은 항상 맨 아래로 붙인다 (기존 max rank + 1).
  const last = await prisma.position.findFirst({ orderBy: { rank: "desc" }, select: { rank: true } });
  const rank = (last?.rank ?? -1) + 1;
  try {
    const position = await prisma.position.create({ data: { name, rank } });
    await writeLog(u.id, "POSITION_CREATE", position.id, name);
    res.json({ position });
  } catch (e: any) {
    if (e?.code === "P2002") return res.status(400).json({ error: "이미 존재하는 직급" });
    throw e;
  }
});

/**
 * 직급 순서 일괄 재정렬 — 드래그로 옮긴 후 클라가 전체 id 순서를 보낸다.
 * 누락된 id 가 있으면 400 (race 상태에서 레코드가 조용히 밀려나는 걸 방지).
 */
router.post("/positions/reorder", async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: any) => typeof x === "string") : [];
  if (!ids.length) return res.status(400).json({ error: "ids required" });
  const u = (req as any).user;

  const all = await prisma.position.findMany({ select: { id: true } });
  const existing = new Set(all.map((p) => p.id));
  if (ids.length !== existing.size || ids.some((id: string) => !existing.has(id))) {
    return res.status(400).json({ error: "ids 가 현재 직급 목록과 일치하지 않습니다" });
  }

  // 배열 형태는 timeout 미지원이라 callback 형태로 변경 — 직급 수십 개 reorder 안전.
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.position.update({ where: { id: ids[i] }, data: { rank: i } });
    }
  }, { timeout: 8_000 });
  await writeLog(u.id, "POSITION_REORDER", undefined, `${ids.length}건`);
  res.json({ ok: true });
});

router.patch("/positions/:id", async (req, res) => {
  const name = req.body?.name !== undefined ? capName(req.body.name) : undefined;
  const rank = req.body?.rank !== undefined ? Number(req.body.rank) : undefined;
  const u = (req as any).user;
  const prev = await prisma.position.findUnique({ where: { id: req.params.id } });
  if (!prev) return res.status(404).json({ error: "not found" });
  const position = await prisma.position.update({
    where: { id: prev.id },
    data: { ...(name !== undefined && { name }), ...(rank !== undefined && { rank }) },
  });
  if (name && prev.name !== name) {
    await prisma.user.updateMany({ where: { position: prev.name }, data: { position: name } });
  }
  await writeLog(u.id, "POSITION_UPDATE", position.id, `${prev.name} -> ${name ?? prev.name}`);
  res.json({ position });
});

router.delete("/positions/:id", async (req, res) => {
  const u = (req as any).user;
  const position = await prisma.position.findUnique({ where: { id: req.params.id } });
  if (!position) return res.status(404).json({ error: "not found" });
  await prisma.position.delete({ where: { id: position.id } });
  await writeLog(u.id, "POSITION_DELETE", position.id, position.name);
  res.json({ ok: true });
});

/* ===== 로그 (총관리자 전용 · step-up 필요) ===== */
/* ===== API 명세 (총관리자) =====
 * Express 라우터 트리를 깊이우선으로 훑어 등록된 모든 (METHOD, PATH) + 사용된 미들웨어 이름을 수집.
 * - 인증/권한 미들웨어 이름이 검출되면 auth: \"PUBLIC\" | \"AUTH\" | \"ADMIN\" | \"SUPER\" 로 라벨링.
 * - 정렬: 첫 path segment 별 그룹 + 그 안에서 path 알파벳 순.
 */
ops.get("/api-spec", requireSuperAdminStepUp, async (req, res) => {
  type SpecRoute = {
    method: string;
    path: string;
    auth: "PUBLIC" | "AUTH" | "ADMIN" | "SUPER";
    middlewares: string[];
    pathParams: string[];
    /** 메소드별 표준 헤더 — Content-Type / 인증 쿠키. */
    headers: { name: string; value: string; required: boolean }[];
    /** body 가 있는 메소드 여부. 실제 스키마는 라우트마다 다르므로 \"있음/없음\" 만 명시. */
    hasBody: boolean;
  };

  const AUTH_NAMES = new Set(["requireAuth"]);
  const ADMIN_NAMES = new Set(["requireAdmin"]);
  const SUPER_NAMES = new Set(["requireSuperAdmin", "requireSuperAdminStepUp"]);

  function authOf(names: string[]): SpecRoute["auth"] {
    if (names.some((n) => SUPER_NAMES.has(n))) return "SUPER";
    if (names.some((n) => ADMIN_NAMES.has(n))) return "ADMIN";
    if (names.some((n) => AUTH_NAMES.has(n))) return "AUTH";
    return "PUBLIC";
  }

  /** Layer.regexp 에서 prefix path 복원. fast_slash 인 경우 빈 prefix.
   *  복잡한 정규식 라우트(파라미터 포함)는 layer.regexp.fast_slash 가 false 일 때 정규식 toString
   *  자체에서 \"^\\/api\\/x\\/?\" 패턴을 추출 시도 — 못 찾으면 빈 문자열로 두고 자식 path 만 사용. */
  function prefixOfRouter(layer: any): string {
    if (layer.regexp?.fast_slash) return "";
    const src = layer.regexp?.toString?.() ?? "";
    // /^\/api\/snippet\/?(?=\/|$)/i  → /api/snippet
    const m = /^\/\^\\?(\/[^\\\/?]+(?:\\\/[^\\\/?]+)*)\\?\\?\(\?=\\?\/\|\$\)/i.exec(src);
    if (!m) return "";
    return m[1].replace(/\\\//g, "/");
  }

  const routes: SpecRoute[] = [];

  function walk(stack: any[], parentPath: string, parentMw: string[]) {
    for (const layer of stack) {
      // 라우터 자체에 박힌 미들웨어 (router.use(requireAuth) 형태)는 layer.handle 에 stack 이 있는 router.
      // 단순 미들웨어 layer 는 method 가 없고 route 도 없음 → 다음 형제 layer 들에 적용되는 게이트.
      if (layer.route) {
        const subPath = layer.route.path;
        const fullPath = (parentPath + subPath).replace(/\/+/g, "/");
        // 한 path 에 여러 method 가 등록될 수 있음 (route.methods 객체).
        const methods = Object.keys(layer.route.methods ?? {}).filter((m) => layer.route.methods[m]);
        // route 자체에 deps 로 박힌 미들웨어들 (e.g. router.get(path, requireSuperAdminStepUp, handler))
        const routeMw: string[] = (layer.route.stack ?? [])
          .map((s: any) => s.name || s.handle?.name || "")
          .filter(Boolean);
        const allMw = [...parentMw, ...routeMw];
        const auth = authOf(allMw);
        for (const m of methods) {
          if (m === "_all") continue;
          const method = m.toUpperCase();
          const pathParams = (fullPath.match(/:[A-Za-z_][A-Za-z0-9_]*/g) ?? []).map((s) => s.slice(1));
          const hasBody = ["POST", "PUT", "PATCH"].includes(method);
          const headers: SpecRoute["headers"] = [];
          if (hasBody) {
            headers.push({ name: "Content-Type", value: "application/json", required: true });
          }
          if (auth !== "PUBLIC") {
            headers.push({ name: "Cookie", value: "hinest_auth=<JWT>", required: true });
          }
          if (auth === "SUPER") {
            headers.push({ name: "Cookie", value: "hinest_super=<JWT>", required: true });
          }
          routes.push({
            method,
            path: fullPath,
            auth,
            middlewares: allMw.filter((n) => n !== "<anonymous>"),
            pathParams,
            headers,
            hasBody,
          });
        }
      } else if (layer.name === "router" && layer.handle?.stack) {
        const prefix = prefixOfRouter(layer);
        walk(layer.handle.stack, parentPath + prefix, parentMw);
      } else if (layer.handle?.name && !layer.route) {
        // 라우터에 직접 박힌 미들웨어(use) — 이름이 있으면 게이트로 누적.
        // 단, app.use 의 글로벌 미들웨어는 어떤 라우터든 자식이라 부모 컨텍스트로 들어가야 하지만,
        // 단순화를 위해 이름만 누적. 부모 router.use(requireAuth) 도 여기 걸림.
        if (!["query", "expressInit", "<anonymous>", "bound dispatch"].includes(layer.handle.name)) {
          parentMw.push(layer.handle.name);
        }
      }
    }
  }

  const app = req.app as any;
  const root = app._router?.stack ?? app.router?.stack ?? [];
  walk(root, "", []);

  // 중복 제거(같은 path/method 가 여러 layer 매칭될 수 있음) + 정렬.
  const dedup = new Map<string, SpecRoute>();
  for (const r of routes) {
    const k = `${r.method} ${r.path}`;
    if (!dedup.has(k)) dedup.set(k, r);
  }
  const sorted = [...dedup.values()].sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
  );
  // 클라이언트가 컬한테 \"이 서버 어디서 응답하는지\" 보여주기 위해 동적으로 base URL 계산.
  // origin/x-forwarded-host 가 있으면 그것을 우선(프록시 뒤에서도 정확).
  const xfHost = (req.headers["x-forwarded-host"] || "").toString();
  const xfProto = (req.headers["x-forwarded-proto"] || "").toString();
  const host = xfHost || req.get("host") || "";
  const proto = xfProto || (req.secure ? "https" : "http");
  const baseUrl = host ? `${proto}://${host}` : "";
  res.json({ baseUrl, routes: sorted, total: sorted.length });
});

/* ===== 총관리자 콘솔 — 명령어 기반 빠른 제어 (UI 안 만들고도 즉시 가능한 액션) =====
 * 단일 엔드포인트에서 명령어 문자열을 토큰화 → 화이트리스트 dispatch.
 * 모든 명령은 AuditLog 에 기록(action: \"SUPER_CONSOLE\", detail: 명령어 + 인자).
 *
 * 보안:
 *  - requireSuperAdminStepUp 게이트(이 endpoint 만으로 권한 상승 가능하므로 step-up 필수)
 *  - body.cmd 200자 상한
 *  - dispatch 화이트리스트만 실행, prisma 직접 노출 없음
 */
const consoleSchema = z.object({ cmd: z.string().min(1).max(200) });

/** 콘솔 입력창의 @ 자동완성용 — ctx 에 따라 유저/팀/직급 후보 반환. */
ops.get("/console/complete", requireSuperAdminStepUp, async (req, res) => {
  const ctx = String(req.query.ctx ?? "user").toLowerCase();
  const q = String(req.query.q ?? "").trim();
  const limit = Math.min(20, Math.max(1, parseInt(String(req.query.limit ?? 10), 10) || 10));

  if (ctx === "user") {
    // 빈 q 면 최근 가입 순. 검색은 이름/이메일/사번/HR코드 부분 매치.
    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
            { employeeNo: { contains: q, mode: "insensitive" as const } },
            { hrCode: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {};
    const users = await prisma.user.findMany({
      where,
      take: limit,
      orderBy: q ? { name: "asc" } : { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        employeeNo: true,
        team: true,
        position: true,
        role: true,
        active: true,
      },
    });
    return res.json({ items: users });
  }

  if (ctx === "team" || ctx === "position") {
    // distinct — 유저 테이블에 들어있는 고유 팀/직급 값 모음.
    const rows = await prisma.user.findMany({
      where: ctx === "team" ? { team: { not: null } } : { position: { not: null } },
      select: ctx === "team" ? { team: true } : { position: true },
      distinct: ctx === "team" ? ["team"] : ["position"],
      take: 200,
    });
    let values = rows
      .map((r: any) => (ctx === "team" ? r.team : r.position))
      .filter((v: any): v is string => !!v && typeof v === "string");
    if (q) {
      const k = q.toLowerCase();
      values = values.filter((v) => v.toLowerCase().includes(k));
    }
    values.sort((a, b) => a.localeCompare(b, "ko"));
    return res.json({ items: values.slice(0, limit).map((v) => ({ value: v })) });
  }

  return res.status(400).json({ error: "unknown ctx" });
});

ops.post("/console", requireSuperAdminStepUp, async (req, res) => {
  const u = (req as any).user;
  const parsed = consoleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const raw = parsed.data.cmd.trim();
  // 토크나이저 — \"공백 포함 값\" / '공백 포함 값' 지원. 그 외엔 공백 분리.
  const tokens: string[] = [];
  {
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
    }
  }
  const head = (tokens[0] || "").toLowerCase();
  const sub = (tokens[1] || "").toLowerCase();
  const arg1 = tokens[2] || "";
  const arg2 = tokens[3] || "";

  function out(lines: string[] | string): { ok: true; output: string } {
    return { ok: true, output: Array.isArray(lines) ? lines.join("\n") : lines };
  }
  function err(msg: string) {
    return { ok: false as const, output: msg };
  }
  // 사용자 식별자 — id(cuid) / email / employeeNo 자동 매치.
  async function findUser(key: string) {
    if (!key) return null;
    if (/@/.test(key)) return prisma.user.findUnique({ where: { email: key } });
    const byId = await prisma.user.findUnique({ where: { id: key } }).catch(() => null);
    if (byId) return byId;
    return prisma.user.findFirst({ where: { OR: [{ employeeNo: key }, { hrCode: key }] } });
  }

  let result: { ok: boolean; output: string };

  try {
    if (head === "help" || head === "?") {
      result = out([
        "사용 가능한 명령:",
        "",
        "  [세션]",
        "  help / ?                            이 목록",
        "  whoami                              현재 세션 정보",
        "  clear / cls                          (클라 측) 콘솔 비우기",
        "",
        "  [유저 조회]",
        "  users list [limit]                  최근 가입 N명 (기본 20, 최대 200)",
        "  users find <query>                  이름/이메일/사번 부분 매치",
        "  users devs                           개발자 권한 보유자 전체",
        "  user info <id|email|사번>            유저 상세",
        "",
        "  [유저 권한·계정]",
        "  user role <id> <MEMBER|MANAGER|ADMIN>   role 직접 지정",
        "  user grant admin|super|dev <id>      ADMIN / superAdmin / HiNest 개발자 부여",
        "  user revoke admin|super|dev <id>     ADMIN→MEMBER / superAdmin false / 개발자 해제",
        "  user lock <id>                       active=false (로그인 차단)",
        "  user unlock <id>                     active=true",
        "  user resign <id> [YYYY-MM-DD]        퇴사 처리 (resignedAt + active=false)",
        "  user reset-pw <id>                    임시 비밀번호 생성·반환",
        "  user team <id> <team>                팀 변경 ('-' 입력 시 비움)",
        "  user position <id> <position>         직급 변경 ('-' 입력 시 비움)",
        "",
        "  [방·메시지]",
        "  rooms list [limit]                  최근 방 N개",
        "  room info <roomId>                  방 상세 + 멤버",
        "",
        "  [회사·멀티테넌트]",
        "  companies [limit]                   전 회사 목록 + 인원수",
        "  company <id|name|slug>              회사별 상세 + 카운트(유저·방·문서·회의·공지)",
        "",
        "  [세션]",
        "  sessions <id|email>                 해당 유저 활성 세션 목록",
        "  session revoke <sessionId>          세션 강제 무효화(로그아웃)",
        "",
        "  [공지·시스템]",
        "  notice broadcast <text>             고정 공지 즉시 발행",
        "  system stats                        전체 카운트 한눈에",
        "  audit recent [limit]                감사 로그 최근 N건 (기본 20)",
        "  cache evict user <id>               유저 메모리 캐시 무효화",
      ]);
    } else if (head === "whoami") {
      result = out([
        `id        : ${u.id}`,
        `name      : ${u.name}`,
        `email     : ${u.email}`,
        `role      : ${u.role}`,
        `superAdmin: ${u.superAdmin ? "true" : "false"}`,
      ]);
    } else if (head === "users" && sub === "list") {
      const limit = Math.min(200, Math.max(1, parseInt(arg1 || "20", 10) || 20));
      const list = await prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        select: { id: true, name: true, email: true, role: true, superAdmin: true, isDeveloper: true, active: true, createdAt: true },
      });
      const rows = list.map(
        (x) =>
          `${x.id}  ${x.role.padEnd(7)} ${x.superAdmin ? "S" : " "}${x.isDeveloper ? "D" : " "} ${x.active ? "A" : "X"}  ${x.email.padEnd(28)} ${x.name}`,
      );
      result = out([`최근 ${list.length}명 (역할 / S=super / D=developer / A=active):`, ...rows]);
    } else if (head === "users" && sub === "find") {
      const q = arg1;
      if (!q) { result = err("쿼리가 비었어요. 예: users find 김"); }
      else {
        const list = await prisma.user.findMany({
          where: {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { employeeNo: { contains: q, mode: "insensitive" } },
              { hrCode: { contains: q, mode: "insensitive" } },
            ],
          },
          take: 50,
          select: { id: true, name: true, email: true, role: true, superAdmin: true, isDeveloper: true, active: true, employeeNo: true },
        });
        if (list.length === 0) { result = out("매치 0건"); }
        else {
          const rows = list.map(
            (x) =>
              `${x.id}  ${x.role.padEnd(7)} ${x.superAdmin ? "S" : " "}${x.isDeveloper ? "D" : " "} ${x.active ? "A" : "X"}  ${(x.employeeNo ?? "-").padEnd(12)} ${x.email.padEnd(28)} ${x.name}`,
          );
          result = out([`매치 ${list.length}건 (S=super / D=developer / A=active):`, ...rows]);
        }
      }
    } else if (head === "users" && sub === "devs") {
      const list = await prisma.user.findMany({
        where: { isDeveloper: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, email: true, role: true, active: true },
      });
      if (list.length === 0) { result = out("개발자 권한을 가진 사용자가 없어요."); }
      else {
        const rows = list.map(
          (x) =>
            `${x.id}  ${x.role.padEnd(7)} ${x.active ? "A" : "X"}  ${x.email.padEnd(28)} ${x.name}`,
        );
        result = out([`개발자 ${list.length}명:`, ...rows]);
      }
    } else if (head === "user" && sub === "info") {
      const target = await findUser(arg1);
      if (!target) { result = err(`유저를 찾을 수 없음: ${arg1}`); }
      else {
        result = out([
          `id         : ${target.id}`,
          `name       : ${target.name}`,
          `email      : ${target.email}`,
          `employeeNo : ${target.employeeNo ?? "-"}`,
          `role       : ${target.role}`,
          `superAdmin : ${target.superAdmin ? "true" : "false"}`,
          `isDeveloper: ${(target as any).isDeveloper ? "true" : "false"}`,
          `active     : ${target.active ? "true" : "false"}`,
          `team       : ${target.team ?? "-"}`,
          `position   : ${target.position ?? "-"}`,
          `createdAt  : ${target.createdAt.toISOString()}`,
        ]);
      }
    } else if (head === "user" && (sub === "grant" || sub === "revoke")) {
      const what = arg1.toLowerCase();
      const target = await findUser(arg2);
      if (!target) { result = err(`유저를 찾을 수 없음: ${arg2}`); }
      else if (target.id === u.id && (what === "super" || what === "admin")) {
        // 자기 자신의 권한을 콘솔로 토글하는 사고 방지.
        result = err("본인의 권한은 콘솔에서 변경할 수 없어요.");
      } else if (what === "admin") {
        const nextRole = sub === "grant" ? "ADMIN" : "MEMBER";
        await prisma.user.update({ where: { id: target.id }, data: { role: nextRole } });
        await evictUserCache(target.id);
        result = out(`OK · ${target.email} role: ${target.role} → ${nextRole}`);
      } else if (what === "super") {
        const next = sub === "grant";
        await prisma.user.update({ where: { id: target.id }, data: { superAdmin: next } });
        await evictUserCache(target.id);
        result = out(`OK · ${target.email} superAdmin: ${target.superAdmin} → ${next}`);
      } else if (what === "dev" || what === "developer") {
        const next = sub === "grant";
        await prisma.user.update({ where: { id: target.id }, data: { isDeveloper: next } });
        await evictUserCache(target.id);
        result = out(`OK · ${target.email} isDeveloper: ${(target as any).isDeveloper ?? false} → ${next}`);
      } else {
        result = err(`알 수 없는 권한: ${arg1}. admin / super / dev 만 지원.`);
      }
    } else if (head === "user" && (sub === "lock" || sub === "unlock")) {
      const target = await findUser(arg1);
      if (!target) { result = err(`유저를 찾을 수 없음: ${arg1}`); }
      else if (target.id === u.id) {
        result = err("본인 계정은 콘솔에서 잠글 수 없어요.");
      } else {
        const nextActive = sub === "unlock";
        await prisma.user.update({
          where: { id: target.id },
          data: { active: nextActive, ...(nextActive ? {} : { resignedAt: target.resignedAt ?? new Date() }) },
        });
        await evictUserCache(target.id);
        result = out(`OK · ${target.email} active: ${target.active} → ${nextActive}`);
      }
    } else if (head === "user" && sub === "role") {
      const target = await findUser(arg1);
      if (!target) { result = err(`유저를 찾을 수 없음: ${arg1}`); }
      else if (target.id === u.id) {
        result = err("본인 role 은 콘솔에서 변경할 수 없어요.");
      } else {
        const next = arg2.toUpperCase();
        if (!["MEMBER", "MANAGER", "ADMIN"].includes(next)) {
          result = err(`role 은 MEMBER / MANAGER / ADMIN 중 하나. 받은 값: ${arg2}`);
        } else {
          await prisma.user.update({ where: { id: target.id }, data: { role: next } });
          await evictUserCache(target.id);
          result = out(`OK · ${target.email} role: ${target.role} → ${next}`);
        }
      }
    } else if (head === "user" && sub === "resign") {
      const target = await findUser(arg1);
      if (!target) { result = err(`유저를 찾을 수 없음: ${arg1}`); }
      else if (target.id === u.id) {
        result = err("본인 계정은 콘솔에서 퇴사 처리할 수 없어요.");
      } else {
        const dateStr = arg2 || "";
        const resignedAt = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? new Date(dateStr) : new Date();
        await prisma.user.update({
          where: { id: target.id },
          data: { resignedAt, active: false },
        });
        await evictUserCache(target.id);
        result = out(`OK · ${target.email} resigned at ${resignedAt.toISOString().slice(0, 10)} (active=false)`);
      }
    } else if (head === "user" && sub === "reset-pw") {
      const target = await findUser(arg1);
      if (!target) { result = err(`유저를 찾을 수 없음: ${arg1}`); }
      else {
        const tmp = crypto.randomBytes(8).toString("base64url"); // ~11자, 영숫자+- _
        const hash = await bcrypt.hash(tmp, 12);
        await prisma.user.update({ where: { id: target.id }, data: { passwordHash: hash } });
        await evictUserCache(target.id);
        result = out([
          `OK · ${target.email} 임시 비밀번호 발급:`,
          `  ${tmp}`,
          "사용자에게 안전한 채널로 전달하고, 첫 로그인 후 즉시 변경하도록 안내해 주세요.",
        ]);
      }
    } else if (head === "user" && (sub === "team" || sub === "position")) {
      const target = await findUser(arg1);
      if (!target) { result = err(`유저를 찾을 수 없음: ${arg1}`); }
      else {
        // 토크나이저가 quoted 처리하므로 arg2 가 그대로 \"디자인팀\" 같은 값 한 덩어리로 들어옴.
        // 빈값(\"-\") → null. 추가 토큰이 더 있으면 공백 결합(quote 없이 입력한 케이스 대비).
        const tail = tokens.slice(3).join(" ").trim();
        const combined = tail ? `${arg2} ${tail}` : arg2;
        const value = combined === "-" || !combined ? null : combined;
        await prisma.user.update({
          where: { id: target.id },
          data: sub === "team" ? { team: value } : { position: value },
        });
        await evictUserCache(target.id);
        result = out(`OK · ${target.email} ${sub} → ${value ?? "(빈 값)"}`);
      }
    } else if ((head === "user" && sub === "impersonate") || head === "imp") {
      // imp <user> 또는 user impersonate <user>
      const userArg = head === "imp" ? sub : arg1;
      const target = await findUser(userArg);
      if (!target) { result = err(`유저를 찾을 수 없음: ${userArg}`); }
      else if (target.id === u.id) { result = err("본인은 임퍼소네이션할 수 없습니다"); }
      else if (target.superAdmin) { result = err("다른 개발자 계정으로는 볼 수 없습니다"); }
      else {
        const tok = signImpersonate(u.id, target.id);
        setImpCookie(res, tok, req);
        await writeLog(u.id, "IMPERSONATE_START", target.id, target.name, req.ip);
        result = out([
          `OK · 이제 ${target.name} (${target.email}) 으로 로그인됩니다`,
          `유효 시간: 1시간 · 종료: 화면 상단 빨간 배너의 "종료" 버튼 또는 \`unimp\``,
          `페이지를 새로고침해야 적용됩니다.`,
        ]);
      }
    } else if (head === "unimp") {
      const real = (req as any).realUser;
      const impedId = (req as any).impersonatedById;
      clearImpCookie(res, req);
      if (impedId && real?.id) {
        await writeLog(real.id, "IMPERSONATE_END", (req as any).user?.id, undefined, req.ip);
      }
      result = out("임퍼소네이션 종료. 페이지를 새로고침하세요.");
    } else if (head === "rooms" && sub === "list") {
      const limit = Math.min(200, Math.max(1, parseInt(arg1 || "20", 10) || 20));
      const list = await prisma.chatRoom.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        select: { id: true, name: true, type: true, createdAt: true, _count: { select: { members: true, messages: true } } },
      });
      const rows = list.map(
        (r) =>
          `${r.id}  ${r.type.padEnd(7)} m=${String(r._count.members).padStart(3)} msg=${String(r._count.messages).padStart(5)}  ${r.createdAt.toISOString().slice(0, 10)}  ${r.name ?? "(이름없음)"}`,
      );
      result = out([`최근 ${list.length}개 방:`, ...rows]);
    } else if (head === "room" && sub === "info") {
      const room = await prisma.chatRoom.findUnique({
        where: { id: arg1 },
        include: {
          members: { include: { user: { select: { id: true, name: true, email: true } } } },
          _count: { select: { messages: true } },
        },
      });
      if (!room) { result = err(`방을 찾을 수 없음: ${arg1}`); }
      else {
        result = out([
          `id        : ${room.id}`,
          `name      : ${room.name ?? "(이름없음)"}`,
          `type      : ${room.type}`,
          `createdAt : ${room.createdAt.toISOString()}`,
          `messages  : ${room._count.messages}`,
          `members   : ${room.members.length}`,
          ...room.members.map((m) => `  · ${m.user.email.padEnd(28)} ${m.user.name}`),
        ]);
      }
    } else if (head === "notice" && sub === "broadcast") {
      // 따옴표로 감싸 보내거나 그냥 공백 단어들로 보내거나 둘 다 허용.
      const body = tokens.slice(2).join(" ").trim();
      if (!body) { result = err("본문이 비었어요. 예: notice broadcast 내일 점검 있어요"); }
      else {
        const notice = await prisma.notice.create({
          data: { title: "[총관리자]", content: body, pinned: true, authorId: u.id },
        });
        result = out(`OK · 공지 발행 (id=${notice.id}, pinned=true)`);
      }
    } else if (head === "system" && sub === "stats") {
      const [users, activeUsers, rooms, messages, notices, projects, documents] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { active: true } }),
        prisma.chatRoom.count(),
        prisma.chatMessage.count(),
        prisma.notice.count(),
        prisma.project.count(),
        prisma.document.count(),
      ]);
      result = out([
        "시스템 카운트:",
        `  users      : ${users} (active ${activeUsers})`,
        `  rooms      : ${rooms}`,
        `  messages   : ${messages}`,
        `  notices    : ${notices}`,
        `  projects   : ${projects}`,
        `  documents  : ${documents}`,
      ]);
    } else if (head === "audit" && sub === "recent") {
      const limit = Math.min(100, Math.max(1, parseInt(arg1 || "20", 10) || 20));
      const logs = await prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        include: { user: { select: { name: true, email: true } } },
      });
      const rows = logs.map(
        (l) =>
          `${l.createdAt.toISOString()}  ${l.action.padEnd(22)} ${(l.user?.email ?? "(system)").padEnd(28)} ${l.detail ?? ""}`,
      );
      result = out([`최근 ${logs.length}건:`, ...rows]);
    } else if (head === "cache" && sub === "evict" && arg1 === "user") {
      const target = await findUser(arg2);
      if (!target) { result = err(`유저를 찾을 수 없음: ${arg2}`); }
      else {
        await evictUserCache(target.id);
        result = out(`OK · cache evicted: ${target.email}`);
      }
    } else if (head === "companies") {
      // 전 회사 목록 + 인원수. (멀티테넌트 전체 조망)
      const limit = Math.min(500, Math.max(1, parseInt(tokens[1] || "100", 10) || 100));
      const list = await prisma.company.findMany({
        orderBy: { createdAt: "desc" }, take: limit,
        select: { id: true, name: true, slug: true, status: true },
      });
      const counts = await prisma.user.groupBy({ by: ["companyId"], _count: { _all: true } });
      const cmap = new Map<string | null, number>(counts.map((c) => [c.companyId, c._count._all]));
      const rows = list.map(
        (c) => `${c.id}  ${c.status.padEnd(9)} ${String(cmap.get(c.id) ?? 0).padStart(4)}명  ${c.slug ? "@" + c.slug + " " : ""}${c.name}`,
      );
      result = out([`회사 ${list.length}개 (status / 인원):`, ...rows]);
    } else if (head === "company") {
      // company <id|name|slug> — 회사별 상세 + 카운트(유저·방·문서·회의·공지).
      const key = tokens[1] || "";
      if (!key) { result = err("회사 키가 필요해요. 예: company <id|name|slug>"); }
      else {
        const co = await prisma.company.findFirst({
          where: { OR: [{ id: key }, { slug: key }, { name: { contains: key, mode: "insensitive" } }] },
        });
        if (!co) { result = err(`회사를 찾을 수 없음: ${key}`); }
        else {
          const [users, activeUsers, rooms, docs, meetings, notices] = await Promise.all([
            prisma.user.count({ where: { companyId: co.id } }),
            prisma.user.count({ where: { companyId: co.id, active: true } }),
            prisma.chatRoom.count({ where: { companyId: co.id } }),
            prisma.document.count({ where: { companyId: co.id } }),
            prisma.meeting.count({ where: { companyId: co.id } }),
            prisma.notice.count({ where: { companyId: co.id } }),
          ]);
          result = out([
            `id      : ${co.id}`,
            `name    : ${co.name}`,
            `slug    : ${co.slug ?? "-"}`,
            `status  : ${co.status}`,
            `users   : ${users} (active ${activeUsers})`,
            `rooms   : ${rooms}`,
            `docs    : ${docs}`,
            `meetings: ${meetings}`,
            `notices : ${notices}`,
          ]);
        }
      }
    } else if (head === "sessions") {
      // sessions <user> — 해당 유저의 활성 세션 목록.
      const target = await findUser(tokens[1] || "");
      if (!target) { result = err(`유저를 찾을 수 없음: ${tokens[1] || "(없음)"}`); }
      else {
        const list = await prisma.session.findMany({
          where: { userId: target.id, revokedAt: null },
          orderBy: { createdAt: "desc" }, take: 50,
          select: { id: true, createdAt: true },
        });
        if (list.length === 0) { result = out(`활성 세션 없음 — ${target.email}`); }
        else {
          const rows = list.map((s) => `${s.id}  ${s.createdAt.toISOString()}`);
          result = out([`활성 세션 ${list.length}개 — ${target.email}:`, ...rows]);
        }
      }
    } else if (head === "session" && sub === "revoke") {
      // session revoke <sessionId> — 강제 로그아웃(세션 무효화).
      const sid = arg1;
      if (!sid) { result = err("세션 id 가 필요해요. 예: session revoke <sessionId>"); }
      else {
        const r = await prisma.session.updateMany({
          where: { id: sid, revokedAt: null },
          data: { revokedAt: new Date(), revokedById: u.id },
        });
        result = r.count > 0 ? out(`OK · 세션 무효화: ${sid}`) : err(`활성 세션을 찾을 수 없음: ${sid}`);
      }
    } else {
      result = err(`알 수 없는 명령: "${raw}". help 로 사용법 확인.`);
    }
  } catch (e: any) {
    result = err(`실행 오류: ${e?.message ?? "unknown"}`);
  }

  // 모든 명령(성공/실패 무관) 감사 로그.
  await writeLog(u.id, "SUPER_CONSOLE", undefined, raw, req.ip).catch(() => {});
  res.json(result);
});

/** 채팅 감사 잠금 해제 — 클라에 비번 박지 않도록 서버에서 비교 후 OK 만 반환.
 *  비번은 환경변수 CHAT_AUDIT_PW (없으면 비활성). super-stepup 게이트로 1차 보호 + 비번 2차 보호.
 *  일치 시 클라가 sessionStorage 에 만료시각 박는 정도 — 진짜 권한 가드는 ChatAudit API 자체의 super-stepup. */
ops.post("/chat-audit/unlock", requireSuperAdminStepUp, async (req, res) => {
  const u = (req as any).user;
  const expected = process.env.CHAT_AUDIT_PW || "";
  const got = String(req.body?.password ?? "");
  if (!expected) {
    return res.status(503).json({ error: "CHAT_AUDIT_PW 환경변수가 설정되지 않았어요." });
  }
  // 길이가 다르면 즉시 false — timingSafeEqual 은 같은 길이만 받음.
  if (got.length !== expected.length) {
    await writeLog(u.id, "CHAT_AUDIT_UNLOCK_FAIL", undefined, undefined, req.ip).catch(() => {});
    // 403 — 인증은 됐지만(슈퍼관리자 세션) 이 step-up 암호가 틀림. 401 로 주면 클라 api() 가
    // '세션 만료' 로 오인해 전역 로그아웃시킨다(버그). 암호 오류는 forbidden 으로 분리.
    return res.status(403).json({ code: "BAD_STEPUP_PW", error: "암호 불일치" });
  }
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  const ok = crypto.timingSafeEqual(a, b);
  if (!ok) {
    await writeLog(u.id, "CHAT_AUDIT_UNLOCK_FAIL", undefined, undefined, req.ip).catch(() => {});
    // 403 — 인증은 됐지만(슈퍼관리자 세션) 이 step-up 암호가 틀림. 401 로 주면 클라 api() 가
    // '세션 만료' 로 오인해 전역 로그아웃시킨다(버그). 암호 오류는 forbidden 으로 분리.
    return res.status(403).json({ code: "BAD_STEPUP_PW", error: "암호 불일치" });
  }
  await writeLog(u.id, "CHAT_AUDIT_UNLOCK_OK", undefined, undefined, req.ip).catch(() => {});
  // 채팅 감사 API(/api/chat/rooms?scope=audit, .../messages)는 super step-up 쿠키(hinest_super)를
  // verifySuperToken 으로 요구한다. CHAT_AUDIT_PW 가 맞았으니 여기서 그 쿠키를 함께 발급해야
  // 패널 진입 시 401 이 나지 않는다. (예전엔 쿠키를 안 줘서 패널이 401 → api() 가 세션 만료로
  // 오인하고 전역 로그아웃시키는 버그가 있었음.)
  setSuperCookie(res, signSuper(u.id), req);
  res.json({ ok: true, ttlMs: SUPER_TTL_SEC * 1000 });
});

/** 사이드바 메뉴 가시성 관리 (총관리자 전용).
 *  GET  /api/admin/nav-visibility           전체 NavConfig 행 (disabled 만 의미 있음)
 *  POST /api/admin/nav-visibility           { path, enabled } upsert.
 */
ops.get("/nav-visibility", requireSuperAdminStepUp, async (_req, res) => {
  const rows = await prisma.navConfig.findMany({ orderBy: { path: "asc" } });
  res.json({ items: rows });
});

ops.post("/nav-visibility", requireSuperAdminStepUp, async (req, res) => {
  const u = (req as any).user;
  const schema = z.object({
    path: z.string().min(1).max(120),
    enabled: z.boolean().optional(),
    inDev: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const { path: p, enabled, inDev } = parsed.data;
  if (enabled === undefined && inDev === undefined) {
    return res.status(400).json({ error: "enabled 또는 inDev 중 하나는 필요해요" });
  }
  // partial update — 클라가 한 필드만 보내도 다른 필드는 유지.
  const existing = await prisma.navConfig.findUnique({ where: { path: p } });
  const nextEnabled = enabled ?? existing?.enabled ?? true;
  const nextInDev = inDev ?? existing?.inDev ?? false;
  await prisma.navConfig.upsert({
    where: { path: p },
    create: { path: p, enabled: nextEnabled, inDev: nextInDev, updatedBy: u.id },
    update: { enabled: nextEnabled, inDev: nextInDev, updatedBy: u.id },
  });
  // NavConfig 변경 즉시 인메모리 캐시 무효화 — 다음 요청에서 최신값 로드.
  evictNavVisibilityCache();
  await writeLog(u.id, "NAV_TOGGLE", p, JSON.stringify({ enabled: nextEnabled, inDev: nextInDev }), req.ip).catch(() => {});
  res.json({ ok: true });
});

/** 서버 인메모리 로그 — 콘솔 출력 + HTTP 액세스 라인. 프로세스 재기동 시 초기화. */
ops.get("/server-logs", requireSuperAdminStepUp, async (req, res) => {
  const since = req.query.since ? Number(req.query.since) : undefined;
  const levelRaw = String(req.query.level ?? "");
  const level = (["info", "warn", "error", "http"] as const).includes(levelRaw as any)
    ? (levelRaw as LogLevel)
    : undefined;
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const limit = req.query.limit ? Math.min(9999, Math.max(1, Number(req.query.limit))) : 500;
  const logs = getLogs({ since, level, q, limit });
  res.json({ logs, now: Date.now() });
});

ops.get("/logs", requireSuperAdminStepUp, async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 200), 500);
  // companyId 가 주어지면 해당 회사 활동만 — 개발자 콘솔의 회사 선택 드롭다운용.
  const companyId = typeof req.query.companyId === "string" && req.query.companyId ? req.query.companyId : undefined;
  const logs = await prisma.auditLog.findMany({
    where: companyId ? { companyId } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { user: { select: { name: true, email: true } } },
  });
  res.json({ logs });
});

/** 회사 목록 — 개발자 콘솔의 회사 선택 드롭다운 채우기용(경량). */
ops.get("/companies", requireSuperAdminStepUp, async (_req, res) => {
  const companies = await prisma.company.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, slug: true, status: true },
  });
  res.json({ companies });
});

/* ===== 출근 기록 조회 — 특정 유저의 특정 날짜 ===== */
router.get("/users/:id/attendance", async (req, res) => {
  const u = (req as any).user;
  const { id } = req.params;
  // super-admin 의 출근 기록은 super-admin 끼리만 열람 가능 — 다른 관리자에게는
  // 존재 자체를 숨겨 출근 패턴/근무 시간 노출 차단.
  const target = await prisma.user.findUnique({ where: { id }, select: { superAdmin: true } });
  if (target?.superAdmin && !u.superAdmin) return res.status(404).json({ error: "not found" });
  const defaultDate = todayStr();
  const qdate = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : defaultDate;
  const rec = await prisma.attendance.findUnique({
    where: { userId_date: { userId: id, date: qdate } },
  });
  res.json({ attendance: rec });
});

/* ===== 출근 기록 관리 — 특정 유저의 특정 날짜 출퇴근 시각 수정 ===== */
// body: { date?: "YYYY-MM-DD" 생략시 오늘, checkIn?: ISO|null, checkOut?: ISO|null }
// 문자열 생략 → 미변경, null 명시 → 해당 필드 지움.
router.patch("/users/:id/attendance", async (req, res) => {
  const u = (req as any).user;
  const { id } = req.params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: "not found" });
  // super-admin 의 출퇴근을 일반 관리자가 조작 못 하도록 차단 — 존재 노출 X.
  if (user.superAdmin && !u.superAdmin) return res.status(404).json({ error: "not found" });
  const body = req.body ?? {};
  const defaultDate = todayStr();
  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : defaultDate;
  const parseTime = (v: unknown): Date | null | undefined => {
    if (v === null) return null;
    if (typeof v !== "string" || !v) return undefined;
    const dt = new Date(v);
    return isNaN(dt.getTime()) ? undefined : dt;
  };
  const checkIn = parseTime(body.checkIn);
  const checkOut = parseTime(body.checkOut);
  // 관리자 수정은 단일 세션으로 정규화 — sessions 합산 근무시간이 수정한 checkIn/checkOut 을
  // 그대로 반영하게(기존 다중 세션은 덮어쓴다. 관리자가 입력한 값이 권위 있는 값).
  const existing = await prisma.attendance.findUnique({ where: { userId_date: { userId: id, date } } });
  const finalIn = checkIn !== undefined ? checkIn : (existing?.checkIn ?? null);
  const finalOut = checkOut !== undefined ? checkOut : (existing?.checkOut ?? null);
  const sessions = finalIn
    ? [{ s: finalIn.toISOString(), e: finalOut ? finalOut.toISOString() : null, src: "edit" }]
    : [];
  const data: { checkIn?: Date | null; checkOut?: Date | null; sessions?: object } = { sessions };
  if (checkIn !== undefined) data.checkIn = checkIn;
  if (checkOut !== undefined) data.checkOut = checkOut;
  const rec = await prisma.attendance.upsert({
    where: { userId_date: { userId: id, date } },
    update: data,
    create: { userId: id, date, checkIn: checkIn ?? null, checkOut: checkOut ?? null, sessions: sessions as object },
  });
  // 출근 기록은 임금/평가 근거가 되는 민감 데이터 — 변경 감사 추적 필수.
  await writeLog(u.id, "ATTENDANCE_EDIT", id, `${date} in=${body.checkIn ?? "·"} out=${body.checkOut ?? "·"}`, req.ip);
  res.json({ attendance: rec });
});

/* ===== Impersonation (사용자 대신 보기) =====
 * 목적: 버그 리포트가 들어왔을 때, 그 유저의 시점에서 직접 화면을 본다.
 * 보안: super-stepup 필수, 1시간 자동 만료, 시작/종료 모두 audit 기록.
 * 모든 액션은 임퍼소네이팅 중에도 (req as any).realUser 로 진짜 사용자가 추적된다.
 */
/* ===== Feature Flags CRUD ===== */
import { evictFlagCache } from "../lib/featureFlags.js";

ops.get("/feature-flags", requireSuperAdminStepUp, async (_req, res) => {
  const rows = await prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
  res.json({ flags: rows });
});

ops.post("/feature-flags", requireSuperAdminStepUp, async (req, res) => {
  const me = (req as any).user;
  const { key, enabled, scope, targets, description } = req.body ?? {};
  if (typeof key !== "string" || !key.match(/^[a-z][a-z0-9._-]{1,60}$/)) {
    return res.status(400).json({ error: "key 는 소문자/숫자/._- 로만 (2~60자)" });
  }
  if (scope && !["GLOBAL", "ROLE", "USER", "TEAM"].includes(scope)) {
    return res.status(400).json({ error: "invalid scope" });
  }
  const row = await prisma.featureFlag.upsert({
    where: { key },
    update: {
      enabled: !!enabled,
      scope: scope ?? "GLOBAL",
      targets: targets ?? null,
      description: description ?? null,
      updatedById: me.id,
    },
    create: {
      key,
      enabled: !!enabled,
      scope: scope ?? "GLOBAL",
      targets: targets ?? null,
      description: description ?? null,
      updatedById: me.id,
    },
  });
  evictFlagCache();
  await writeLog(me.id, "FEATURE_FLAG_UPSERT", key, `enabled=${row.enabled} scope=${row.scope}`, req.ip);
  res.json({ flag: row });
});

ops.delete("/feature-flags/:key", requireSuperAdminStepUp, async (req, res) => {
  const me = (req as any).user;
  await prisma.featureFlag.delete({ where: { key: req.params.key } });
  evictFlagCache();
  await writeLog(me.id, "FEATURE_FLAG_DELETE", req.params.key, undefined, req.ip);
  res.json({ ok: true });
});

/* ===== 역할 권한 (RolePermission) ===== */
import { PERMISSION_CATALOG, getEffectiveMatrix, evictPermissionCache, type PermKey } from "../lib/permissions.js";

ops.get("/role-permissions", requireSuperAdminStepUp, async (_req, res) => {
  const matrix = await getEffectiveMatrix();
  // hidden 키는 UI 에서 노출 안 함 — 카탈로그/매트릭스 둘 다에서 제거.
  const catalog = PERMISSION_CATALOG.filter((c) => !c.hidden);
  const visibleKeys = new Set(catalog.map((c) => c.key));
  const trimmed: Record<string, Record<string, boolean>> = {};
  for (const [role, perms] of Object.entries(matrix)) {
    trimmed[role] = {};
    for (const [k, v] of Object.entries(perms as Record<string, boolean>)) {
      if (visibleKeys.has(k as any)) trimmed[role][k] = v;
    }
  }
  res.json({ catalog, matrix: trimmed });
});

ops.post("/role-permissions", requireSuperAdminStepUp, async (req, res) => {
  const me = (req as any).user;
  const { role, permKey, enabled } = req.body ?? {};
  if (!["ADMIN", "MANAGER", "MEMBER"].includes(role)) return res.status(400).json({ error: "invalid role" });
  const known = PERMISSION_CATALOG.some((c) => c.key === permKey);
  if (!known) return res.status(400).json({ error: "unknown permKey" });
  await prisma.rolePermission.upsert({
    where: { role_permKey: { role, permKey } },
    update: { enabled: !!enabled, updatedById: me.id },
    create: { role, permKey, enabled: !!enabled, updatedById: me.id },
  });
  evictPermissionCache();
  await writeLog(me.id, "ROLE_PERM_UPSERT", `${role}:${permKey}`, `enabled=${!!enabled}`, req.ip);
  res.json({ ok: true });
});

ops.delete("/role-permissions/:role/:permKey", requireSuperAdminStepUp, async (req, res) => {
  const me = (req as any).user;
  await prisma.rolePermission.deleteMany({
    where: { role: req.params.role, permKey: req.params.permKey as PermKey },
  });
  evictPermissionCache();
  await writeLog(me.id, "ROLE_PERM_RESET", `${req.params.role}:${req.params.permKey}`, undefined, req.ip);
  res.json({ ok: true });
});

/* ===== 2FA(패스키) 정책 ===== */

ops.get("/2fa-policy", requireSuperAdminStepUp, async (_req, res) => {
  const policies = await prisma.twoFactorPolicy.findMany();
  // 누락된 role 은 기본값으로 채워서 반환 — 클라가 3개 row 모두 존재한다고 가정 가능.
  const ROLES = ["ADMIN", "MANAGER", "MEMBER"];
  const map = new Map(policies.map((p) => [p.role, p]));
  const merged = ROLES.map((r) => map.get(r) ?? { role: r, requirePasskey: false, gracePeriodDays: 14, updatedAt: new Date(), updatedById: null });
  res.json({ policies: merged });
});

ops.post("/2fa-policy", requireSuperAdminStepUp, async (req, res) => {
  const me = (req as any).user;
  const { role, requirePasskey, gracePeriodDays } = req.body ?? {};
  if (!["ADMIN", "MANAGER", "MEMBER"].includes(role)) return res.status(400).json({ error: "invalid role" });
  const row = await prisma.twoFactorPolicy.upsert({
    where: { role },
    update: { requirePasskey: !!requirePasskey, gracePeriodDays: Number(gracePeriodDays) || 14, updatedById: me.id },
    create: { role, requirePasskey: !!requirePasskey, gracePeriodDays: Number(gracePeriodDays) || 14, updatedById: me.id },
  });
  await writeLog(me.id, "2FA_POLICY_UPSERT", role, `req=${row.requirePasskey} grace=${row.gracePeriodDays}`, req.ip);
  res.json({ policy: row });
});

/** 정책에 미충족인 사용자 명단 — 패스키 없음 + 유예기간 초과. */
ops.get("/2fa-policy/non-compliant", requireSuperAdminStepUp, async (_req, res) => {
  const policies = await prisma.twoFactorPolicy.findMany({ where: { requirePasskey: true } });
  if (policies.length === 0) return res.json({ users: [] });
  const now = Date.now();
  const out: any[] = [];
  for (const p of policies) {
    const cutoff = new Date(now - p.gracePeriodDays * 24 * 60 * 60 * 1000);
    const users = await prisma.user.findMany({
      where: {
        role: p.role,
        active: true,
        createdAt: { lt: cutoff },
        passkeys: { none: {} },
      },
      select: { id: true, name: true, email: true, role: true, team: true, createdAt: true },
    });
    for (const u of users) out.push({ ...u, daysOverdue: Math.floor((now - new Date(u.createdAt).getTime()) / 86_400_000) - p.gracePeriodDays });
  }
  res.json({ users: out });
});

/* ===== Rate-limit Rules + IP Blocks ===== */
import { evictSecurityCache } from "../lib/securityRules.js";

ops.get("/rate-rules", requireSuperAdminStepUp, async (_req, res) => {
  res.json({ rules: await prisma.rateLimitRule.findMany({ orderBy: { createdAt: "desc" } }) });
});
ops.post("/rate-rules", requireSuperAdminStepUp, async (req, res) => {
  const me = (req as any).user;
  const { id, routeGlob, perMin, perHour, scope, enabled, note } = req.body ?? {};
  if (typeof routeGlob !== "string" || routeGlob.length < 2) return res.status(400).json({ error: "routeGlob 필수" });
  const data = {
    routeGlob,
    perMin: Number(perMin) || 60,
    perHour: Number(perHour) || 600,
    scope: ["ip", "user", "global"].includes(scope) ? scope : "ip",
    enabled: !!enabled,
    note: note ?? null,
  };
  const row = id
    ? await prisma.rateLimitRule.update({ where: { id }, data })
    : await prisma.rateLimitRule.create({ data });
  evictSecurityCache();
  await writeLog(me.id, "RATE_RULE_UPSERT", row.id, routeGlob, req.ip);
  res.json({ rule: row });
});
ops.delete("/rate-rules/:id", requireSuperAdminStepUp, async (req, res) => {
  await prisma.rateLimitRule.delete({ where: { id: req.params.id } });
  evictSecurityCache();
  await writeLog((req as any).user.id, "RATE_RULE_DELETE", req.params.id, undefined, req.ip);
  res.json({ ok: true });
});

ops.get("/ip-blocks", requireSuperAdminStepUp, async (_req, res) => {
  res.json({ blocks: await prisma.ipBlock.findMany({ orderBy: { createdAt: "desc" } }) });
});
ops.post("/ip-blocks", requireSuperAdminStepUp, async (req, res) => {
  const me = (req as any).user;
  const { id, cidr, country, reason, enabled, expiresAt } = req.body ?? {};
  if ((!cidr && !country) || (cidr && country)) {
    return res.status(400).json({ error: "cidr 또는 country 중 하나만 지정" });
  }
  const data = {
    cidr: cidr ?? "",
    country: country?.toUpperCase() ?? null,
    reason: reason ?? null,
    enabled: !!enabled,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    createdById: me.id,
  };
  const row = id
    ? await prisma.ipBlock.update({ where: { id }, data })
    : await prisma.ipBlock.create({ data });
  evictSecurityCache();
  await writeLog(me.id, "IP_BLOCK_UPSERT", row.id, cidr || `country:${country}`, req.ip);
  res.json({ block: row });
});
ops.delete("/ip-blocks/:id", requireSuperAdminStepUp, async (req, res) => {
  await prisma.ipBlock.delete({ where: { id: req.params.id } });
  evictSecurityCache();
  await writeLog((req as any).user.id, "IP_BLOCK_DELETE", req.params.id, undefined, req.ip);
  res.json({ ok: true });
});

/* ===== API Tokens =====
 * 평문은 발급 시 1번만 노출. 검증은 sha256(input) === stored hash.
 * Bearer 토큰 미들웨어는 별도 (lib/apiTokenAuth.ts).
 */
ops.get("/api-tokens", requireSuperAdminStepUp, async (_req, res) => {
  const rows = await prisma.apiToken.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ tokens: rows.map((t) => ({ ...t, hash: undefined })) });
});

ops.post("/api-tokens", requireSuperAdminStepUp, async (req, res) => {
  const me = (req as any).user;
  const { name, scopes, expiresAt } = req.body ?? {};
  if (typeof name !== "string" || name.length < 1 || name.length > 80) {
    return res.status(400).json({ error: "이름은 1~80자" });
  }
  // 평문: hin_<32 hex>. base64 보다 hex 가 일부 시스템에서 깨지지 않음.
  const raw = "hin_" + crypto.randomBytes(24).toString("hex"); // 4 + 48 = 52자
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  const prefix = raw.slice(0, 12);
  const exp = expiresAt ? new Date(expiresAt) : null;
  const row = await prisma.apiToken.create({
    data: {
      name,
      hash,
      prefix,
      scopes: typeof scopes === "string" ? scopes : null,
      createdById: me.id,
      expiresAt: exp && !isNaN(exp.getTime()) ? exp : null,
    },
  });
  await writeLog(me.id, "API_TOKEN_CREATE", row.id, `name=${name}`, req.ip);
  // 평문은 응답에만 1번 노출 — 클라가 사용자에게 보여주고 닫히면 끝.
  res.json({ token: { ...row, hash: undefined }, plaintext: raw });
});

ops.delete("/api-tokens/:id", requireSuperAdminStepUp, async (req, res) => {
  const me = (req as any).user;
  await prisma.apiToken.update({
    where: { id: req.params.id },
    data: { revokedAt: new Date() },
  });
  await writeLog(me.id, "API_TOKEN_REVOKE", req.params.id, undefined, req.ip);
  res.json({ ok: true });
});

/* ===== Audit Trail Viewer ===== */

ops.get("/audit", requireSuperAdminStepUp, async (req, res) => {
  const action = typeof req.query.action === "string" ? req.query.action : undefined;
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const fromMs = req.query.from ? Number(req.query.from) : undefined;
  const toMs = req.query.to ? Number(req.query.to) : undefined;
  const companyId = typeof req.query.companyId === "string" && req.query.companyId ? req.query.companyId : undefined;
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? "200"), 10) || 200));

  const where: any = {};
  if (action) where.action = action;
  if (userId) where.userId = userId;
  if (companyId) where.companyId = companyId;
  if (fromMs || toMs) {
    where.createdAt = {};
    if (fromMs) where.createdAt.gte = new Date(fromMs);
    if (toMs) where.createdAt.lte = new Date(toMs);
  }
  if (q) {
    where.OR = [
      { target: { contains: q, mode: "insensitive" } },
      { detail: { contains: q, mode: "insensitive" } },
      { ip: { contains: q } },
    ];
  }

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  res.json({ logs });
});

/** 액션 종류 빠른 목록 — 필터 드롭다운 채우기. */
ops.get("/audit/actions", requireSuperAdminStepUp, async (_req, res) => {
  const rows = await prisma.$queryRawUnsafe<{ action: string; n: bigint }[]>(
    `SELECT "action", COUNT(*)::bigint AS n FROM "AuditLog" GROUP BY "action" ORDER BY n DESC LIMIT 100`
  );
  res.json({ actions: rows.map((r) => ({ action: r.action, count: Number(r.n) })) });
});

/* ===== Soft Trash (휴지통) =====
 * Meeting / Document / Journal / Notice 의 deletedAt != null 항목을 30일 보관 후 영구 삭제.
 * 영구 삭제는 별도 cron 이 아니라 관리자가 명시적으로 비우게 — 사고 방지.
 */
const TRASH_TYPES = ["meeting", "document", "journal", "notice"] as const;
type TrashType = typeof TRASH_TYPES[number];
function trashModel(t: TrashType) {
  return ({ meeting: prisma.meeting, document: prisma.document, journal: prisma.journal, notice: prisma.notice } as const)[t];
}

ops.get("/trash", requireSuperAdminStepUp, async (req, res) => {
  const include = { deletedBy: false }; // we resolve names below
  void include;
  // companyId 가 주어지면 해당 회사의 휴지통만 — 개발자 콘솔의 회사 선택 드롭다운용.
  const companyId = typeof req.query.companyId === "string" && req.query.companyId ? req.query.companyId : undefined;
  const scope = companyId ? { companyId } : {};
  const [meetings, documents, journals, notices] = await Promise.all([
    prisma.meeting.findMany({
      where: { deletedAt: { not: null }, ...scope },
      orderBy: { deletedAt: "desc" },
      take: 200,
      select: { id: true, title: true, deletedAt: true, deletedById: true, authorId: true, author: { select: { name: true } } },
    }),
    prisma.document.findMany({
      where: { deletedAt: { not: null }, ...scope },
      orderBy: { deletedAt: "desc" },
      take: 200,
      select: { id: true, title: true, deletedAt: true, deletedById: true, authorId: true, author: { select: { name: true } } },
    }),
    prisma.journal.findMany({
      where: { deletedAt: { not: null }, ...scope },
      orderBy: { deletedAt: "desc" },
      take: 200,
      select: { id: true, title: true, deletedAt: true, deletedById: true, userId: true, user: { select: { name: true } } },
    }),
    prisma.notice.findMany({
      where: { deletedAt: { not: null }, ...scope },
      orderBy: { deletedAt: "desc" },
      take: 200,
      select: { id: true, title: true, deletedAt: true, deletedById: true, authorId: true, author: { select: { name: true } } },
    }),
  ]);
  res.json({
    meeting: meetings,
    document: documents,
    journal: journals.map((j) => ({ ...j, authorId: j.userId, author: j.user })),
    notice: notices,
  });
});

ops.post("/trash/:type/:id/restore", requireSuperAdminStepUp, async (req, res) => {
  const t = req.params.type as TrashType;
  if (!TRASH_TYPES.includes(t)) return res.status(400).json({ error: "invalid type" });
  const me = (req as any).user;
  await (trashModel(t) as any).update({
    where: { id: req.params.id },
    data: { deletedAt: null, deletedById: null },
  });
  await writeLog(me.id, "TRASH_RESTORE", `${t}:${req.params.id}`, undefined, req.ip);
  res.json({ ok: true });
});

ops.delete("/trash/:type/:id", requireSuperAdminStepUp, async (req, res) => {
  const t = req.params.type as TrashType;
  if (!TRASH_TYPES.includes(t)) return res.status(400).json({ error: "invalid type" });
  const me = (req as any).user;
  await (trashModel(t) as any).delete({ where: { id: req.params.id } });
  await writeLog(me.id, "TRASH_PURGE", `${t}:${req.params.id}`, undefined, req.ip);
  res.json({ ok: true });
});

/** 30일 초과 휴지통 항목 일괄 영구 삭제. */
ops.post("/trash/purge-old", requireSuperAdminStepUp, async (req, res) => {
  const me = (req as any).user;
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [m, d, j, n] = await Promise.all([
    prisma.meeting.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
    prisma.document.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
    prisma.journal.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
    prisma.notice.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
  ]);
  await writeLog(me.id, "TRASH_PURGE_OLD", undefined, `m=${m.count} d=${d.count} j=${j.count} n=${n.count}`, req.ip);
  res.json({ ok: true, counts: { meeting: m.count, document: d.count, journal: j.count, notice: n.count } });
});

/* ===== Health-check Board ===== */

ops.get("/health", requireSuperAdminStepUp, async (_req, res) => {
  const checks: Record<string, { ok: boolean; latencyMs?: number; detail?: string; meta?: any }> = {};

  // DB ping
  {
    const t0 = Date.now();
    try {
      const r = await prisma.$queryRawUnsafe<any[]>("SELECT version() AS v, NOW() AS now");
      checks.db = { ok: true, latencyMs: Date.now() - t0, meta: { version: r?.[0]?.v?.split(" ")[1] ?? "unknown", now: r?.[0]?.now } };
    } catch (e: any) {
      checks.db = { ok: false, latencyMs: Date.now() - t0, detail: String(e?.message ?? e) };
    }
  }

  // 마이그레이션 상태
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 1`
    );
    const latest = rows?.[0];
    checks.migrations = { ok: true, meta: { last: latest?.migration_name, at: latest?.finished_at } };
  } catch (e: any) {
    checks.migrations = { ok: false, detail: String(e?.message ?? e) };
  }

  // S3
  {
    const region = process.env.AWS_REGION?.trim();
    const bucket = process.env.S3_BUCKET?.trim();
    if (!region || !bucket) {
      checks.s3 = { ok: false, detail: "S3_BUCKET / AWS_REGION 미설정" };
    } else {
      const t0 = Date.now();
      try {
        const { S3Client, HeadBucketCommand } = await import("@aws-sdk/client-s3");
        const c = new S3Client({ region });
        await c.send(new HeadBucketCommand({ Bucket: bucket }));
        checks.s3 = { ok: true, latencyMs: Date.now() - t0, meta: { region, bucket } };
      } catch (e: any) {
        checks.s3 = { ok: false, latencyMs: Date.now() - t0, detail: String(e?.message ?? e) };
      }
    }
  }

  // 프로세스 정보
  const mem = process.memoryUsage();
  checks.process = {
    ok: true,
    meta: {
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      nodeVersion: process.version,
      rssMB: Math.round(mem.rss / 1024 / 1024),
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      env: process.env.NODE_ENV ?? "unknown",
    },
  };

  // 환경변수 존재 여부 (값은 노출 X) — 누락된 키 빠르게 발견.
  const KEYS = [
    "JWT_SECRET", "DATABASE_URL", "AWS_REGION", "S3_BUCKET",
    "CHAT_AUDIT_PW", "OPENAI_API_KEY", "SES_FROM",
  ];
  checks.env = {
    ok: true,
    meta: Object.fromEntries(KEYS.map((k) => [k, !!process.env[k]?.trim()])),
  };

  const allOk = Object.values(checks).every((c) => c.ok);
  res.json({ ok: allOk, ts: Date.now(), checks });
});

/* ===== Error Dashboard (5xx grouping) ===== */

ops.get("/errors", requireSuperAdminStepUp, async (req, res) => {
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  const sinceMs = req.query.since === "1h" ? 60 * 60 * 1000
    : req.query.since === "24h" ? 24 * 60 * 60 * 1000
    : req.query.since === "7d" ? 7 * 24 * 60 * 60 * 1000
    : undefined;
  const groups = getErrorGroups({ userId, sinceMs });
  // 사용자 이름 매핑은 클라가 따로 처리 — 여기선 ID 만.
  res.json({
    groups: groups.map((g) => ({
      hash: g.hash,
      message: g.message,
      topFrame: g.topFrame,
      count: g.count,
      firstSeen: g.firstSeen,
      lastSeen: g.lastSeen,
      paths: g.paths,
      userIds: g.userIds,
    })),
  });
});

ops.get("/errors/:hash", requireSuperAdminStepUp, async (req, res) => {
  const g = getErrorGroup(req.params.hash);
  if (!g) return res.status(404).json({ error: "not found" });
  res.json({ group: g });
});

ops.delete("/errors", requireSuperAdminStepUp, async (req, res) => {
  clearErrorGroups();
  await writeLog((req as any).user?.id, "ERROR_DASHBOARD_CLEAR", undefined, undefined, req.ip);
  res.json({ ok: true });
});

/* ===== Session Manager ===== */

/** 활성 세션 목록. ?userId 로 특정 유저만, 기본은 전체 (최근 활동 순). */
ops.get("/sessions", requireSuperAdminStepUp, async (req, res) => {
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  const companyId = typeof req.query.companyId === "string" && req.query.companyId ? req.query.companyId : undefined;
  const onlyActive = req.query.active !== "false";
  const limit = Math.min(500, parseInt(String(req.query.limit ?? "100"), 10) || 100);
  const sessions = await prisma.session.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(companyId ? { user: { companyId } } : {}),
      ...(onlyActive ? { revokedAt: null } : {}),
    },
    orderBy: { lastSeenAt: "desc" },
    take: limit,
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  res.json({ sessions });
});

/** 특정 세션 강제 로그아웃. */
ops.delete("/sessions/:id", requireSuperAdminStepUp, async (req, res) => {
  const me = (req as any).user;
  const s = await prisma.session.findUnique({ where: { id: req.params.id }, select: { id: true, userId: true, revokedAt: true } });
  if (!s) return res.status(404).json({ error: "not found" });
  if (s.revokedAt) return res.json({ ok: true, alreadyRevoked: true });
  await prisma.session.update({ where: { id: s.id }, data: { revokedAt: new Date(), revokedById: me.id } });
  evictSessionCache(s.id);
  await writeLog(me.id, "SESSION_REVOKE", s.id, `user=${s.userId}`, req.ip);
  res.json({ ok: true });
});

/** 특정 유저의 모든 세션 강제 로그아웃. 비밀번호 변경 / 계정 탈취 의심 시 사용. */
ops.post("/sessions/revoke-user/:userId", requireSuperAdminStepUp, async (req, res) => {
  const me = (req as any).user;
  const r = await prisma.session.updateMany({
    where: { userId: req.params.userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: me.id },
  });
  // 캐시는 다음 30초 내 자연 갱신 (개별 evict 는 ID 모름).
  await writeLog(me.id, "SESSION_REVOKE_USER", req.params.userId, `count=${r.count}`, req.ip);
  res.json({ ok: true, count: r.count });
});

/** 전사 강제 로그아웃 — 매우 위험. 시크릿 로테이트 / 데이터 유출 의심 시 사용. */
ops.post("/sessions/revoke-all", requireSuperAdminStepUp, async (req, res) => {
  const me = (req as any).user;
  const r = await prisma.session.updateMany({
    where: { revokedAt: null },
    data: { revokedAt: new Date(), revokedById: me.id },
  });
  await writeLog(me.id, "SESSION_REVOKE_ALL", undefined, `count=${r.count}`, req.ip);
  res.json({ ok: true, count: r.count });
});

ops.post("/impersonate/:id", requireSuperAdminStepUp, async (req, res) => {
  const me = (req as any).user;
  // 임퍼소네이션 중에 또 다른 임퍼소네이션 시작은 금지 — 책임 추적이 흐려짐.
  if ((req as any).impersonatedById) {
    return res.status(409).json({ error: "이미 다른 사용자로 보는 중입니다. 먼저 종료하세요." });
  }
  const target = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, active: true, superAdmin: true },
  });
  if (!target || !target.active) return res.status(404).json({ error: "not found" });
  // 자기 자신은 의미 없음.
  if (target.id === me.id) return res.status(400).json({ error: "본인은 임퍼소네이션할 수 없습니다" });
  // 다른 super-admin 으로 보는 건 막는다 — 권한 상승 우회 위험.
  if (target.superAdmin) return res.status(403).json({ error: "다른 개발자 계정으로는 볼 수 없습니다" });

  const tok = signImpersonate(me.id, target.id);
  setImpCookie(res, tok, req);
  await writeLog(me.id, "IMPERSONATE_START", target.id, target.name, req.ip);
  res.json({ ok: true, target: { id: target.id, name: target.name } });
});

// DELETE 는 me.ts 로 이동 — 임퍼소네이션 중엔 admin 체크가 막혀서 종료 불가.

// 운영 콘솔 서브라우터 마운트 — 반드시 회사 단위 admin 라우트 등록 뒤에 와야
// 회사 요청이 먼저 매칭되고, 콘솔(god-view) 요청만 ops 로 흘러든다.
router.use(ops);

export default router;
