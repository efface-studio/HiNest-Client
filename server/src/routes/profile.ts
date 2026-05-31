import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { randomBytes } from "node:crypto";
import { prisma } from "../lib/db.js";
import {
  requireAuth,
  writeLog,
  evictUserCache,
  evictSessionCache,
  clearAuthCookie,
} from "../lib/auth.js";

const router = Router();
router.use(requireAuth);

const schema = z.object({
  name: z.string().min(1).max(200).optional(),
  avatarColor: z.string().regex(/^#([0-9A-Fa-f]{6})$/).optional(),
  // 업로드 후 받은 /uploads/... 경로. "" 또는 null 을 보내면 삭제로 처리해 색상 fallback.
  // 경로 길이 상한 — /uploads/<uuid>.ext 정도라 500자면 충분.
  avatarUrl: z.string().max(500).nullable().optional(),
});

router.patch("/", async (req, res) => {
  const u = (req as any).user;
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const d: any = { ...parsed.data };
  // 빈 문자열은 명시적 제거로 해석
  if (d.avatarUrl === "") d.avatarUrl = null;
  // 업로드된 경로 외 외부 URL 은 막아둔다 (프로필 이미지 프록시 우회/SSRF 방지).
  if (typeof d.avatarUrl === "string" && !d.avatarUrl.startsWith("/uploads/")) {
    return res.status(400).json({ error: "유효하지 않은 이미지 경로입니다." });
  }
  const user = await prisma.user.update({
    where: { id: u.id },
    data: d,
    select: { id: true, name: true, email: true, avatarColor: true, isDeveloper: true, avatarUrl: true, team: true, position: true, role: true },
  });
  await writeLog(u.id, "PROFILE_UPDATE", u.id, JSON.stringify(d));
  res.json({ user });
});

const pwSchema = z.object({
  current: z.string().min(1).max(200),
  // 8자 이상 — 가입 시 기준과 일치. 과거 6자 계정도 다음 변경 시 이 규칙을 따라 8자로 강제.
  // bcrypt 는 72바이트 초과분을 조용히 잘라내므로 128 자로 상한을 둬서 사용자에게 힌트를 강제.
  next: z.string().min(8).max(128),
});

// 비밀번호 변경은 current 검증에 의존하는 bruteforce 경로. 전역 apiLimiter(600/분)보다
// 훨씬 빡빡하게 — 동일 IP 기준 10분 10회로 제한.
const passwordChangeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "비밀번호 변경 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요." },
});

router.post("/password", passwordChangeLimiter, async (req, res) => {
  const u = (req as any).user;
  const parsed = pwSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "새 비밀번호는 8자 이상" });
  const user = await prisma.user.findUnique({ where: { id: u.id } });
  if (!user) return res.status(404).json({ error: "not found" });
  const ok = await bcrypt.compare(parsed.data.current, user.passwordHash);
  if (!ok) {
    await writeLog(u.id, "PASSWORD_CHANGE_FAIL", undefined, undefined, req.ip);
    return res.status(401).json({ error: "현재 비밀번호가 일치하지 않습니다" });
  }
  const hash = await bcrypt.hash(parsed.data.next, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
  await writeLog(u.id, "PASSWORD_CHANGE", undefined, undefined, req.ip);
  res.json({ ok: true });
});

// 회원 탈퇴(셀프) — 앱스토어/플레이스토어의 "인앱 계정 삭제 제공" 규정 준수.
//
// B2B HR 앱이라 하드 삭제(cascade) 대신 "개인식별정보 익명화 + 자격증명 파기 + 비활성화" 방식.
//   - 근태·급여처럼 회사가 법적으로 보존해야 하는 업무 기록은 userId 로 연결된 채 남되,
//     사용자 행의 PII(이름·이메일·전화·생년월일·HR 상세 등)는 제거한다.
//   - 비밀번호/패스키/세션 등 인증 자격증명은 즉시 파기 → 어떤 방법으로도 재로그인 불가.
const deleteSchema = z.object({ password: z.string().min(1).max(200) });

router.delete("/account", passwordChangeLimiter, async (req, res) => {
  const u = (req as any).user;
  const parsed = deleteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "비밀번호 확인이 필요합니다" });

  const user = await prisma.user.findUnique({ where: { id: u.id } });
  if (!user) return res.status(404).json({ error: "not found" });

  // 본인 의사 재확인 — 현재 비밀번호 검증.
  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) {
    await writeLog(u.id, "ACCOUNT_DELETE_FAIL", undefined, "bad password", req.ip);
    return res.status(401).json({ error: "비밀번호가 일치하지 않습니다" });
  }

  // 플랫폼 운영자 계정은 셀프 탈퇴 차단 — 운영 잠금 사고 방지.
  if (user.platformAdmin) {
    return res.status(403).json({ error: "플랫폼 운영자 계정은 탈퇴할 수 없습니다" });
  }

  // 마지막 활성 관리자 보호 — 회사에 관리자가 본인뿐이면 차단(테넌트 고아화 방지).
  if (user.role === "ADMIN" && user.companyId) {
    const otherAdmins = await prisma.user.count({
      where: { companyId: user.companyId, role: "ADMIN", active: true, id: { not: user.id } },
    });
    if (otherAdmins === 0) {
      return res.status(409).json({
        error: "회사의 마지막 관리자는 탈퇴할 수 없어요. 다른 관리자를 먼저 지정해 주세요.",
        code: "LAST_ADMIN",
      });
    }
  }

  // 이메일 unique 슬롯 해제 + 추적 불가능한 placeholder. id 는 cuid 라 충돌 없음.
  const anonEmail = `deleted+${user.id}@deleted.hinest.local`;
  // 어떤 비밀번호로도 매칭되지 않는 무작위 해시.
  const deadHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);

  const sessionsToEvict = await prisma.session.findMany({
    where: { userId: user.id, revokedAt: null },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        email: anonEmail,
        name: "(탈퇴한 사용자)",
        passwordHash: deadHash,
        superPasswordHash: null,
        active: false,
        resignedAt: user.resignedAt ?? new Date(),
        lockedAt: new Date(),
        avatarUrl: null,
        avatarColor: "#9CA3AF",
        phone: null,
        birthDate: null,
        note: null,
        presenceStatus: null,
        presenceMessage: null,
        team: null,
        position: null,
        hrCode: null,
        affiliation: null,
        employeeNo: null,
        workplace: null,
        department: null,
        jobDuty: null,
        employmentType: null,
        employmentCategory: null,
        contractType: null,
        gender: null,
        disabilityType: null,
        disabilityLevel: null,
        hireDate: null,
      },
    });
    // 인증 자격증명 파기 (전역 모델 — 테넌트 스코프 무관).
    await tx.passkey.deleteMany({ where: { userId: user.id } });
    await tx.desktopBiometric.deleteMany({ where: { userId: user.id } });
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
    // 개인 설정 파기.
    await tx.notificationPref.deleteMany({ where: { userId: user.id } });
    await tx.pin.deleteMany({ where: { userId: user.id } });
    // 모든 활성 세션 무효화 → 전 기기 로그아웃.
    await tx.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: user.id },
    });
  });

  for (const s of sessionsToEvict) evictSessionCache(s.id);
  evictUserCache(user.id);
  await writeLog(user.id, "ACCOUNT_DELETE", user.id, "self-serve", req.ip);
  clearAuthCookie(res, req);
  res.json({ ok: true });
});

export default router;
