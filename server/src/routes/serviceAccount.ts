import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { encryptSecret, decryptSecret, hasSecretKey } from "../lib/secretCrypto.js";

/**
 * 서비스 계정 레지스트리 — AWS/Vercel/GitHub 등 외부 서비스의 "누가 어떤 계정을 쓰는지" 기록.
 *
 * 보안 원칙:
 * - 비밀번호/액세스키/토큰은 저장하지 않는다. 어디까지나 "어떤 서비스에 어떤 로그인 ID 로,
 *   누가 담당하는지" 찾기 위한 인덱스. 실제 크레덴셜은 1Password/Bitwarden 같은 전용 도구에 둔다.
 * - `notes` 필드에도 비밀번호는 쓰지 말 것 — 경고 문구는 클라에서 노출.
 *
 * 공개 범위(scope):
 * - ALL      — 전사 공개. 로그인 사용자 전원 열람.
 * - TEAM     — 특정 팀 공개. 동일 team 명을 가진 사용자 + ADMIN/SUPER 만 열람.
 * - PROJECT  — 프로젝트 공개. 해당 프로젝트의 ProjectMember + ADMIN/SUPER 만 열람.
 *
 * 편집 권한: 작성자 본인 또는 ADMIN/SUPER.
 */

const router = Router();
router.use(requireAuth);

const CATEGORIES = [
  "CLOUD", "HOSTING", "VCS", "PAYMENT", "DOMAIN", "EMAIL",
  "MONITOR", "DB", "AI", "TESTING", "OTHER",
] as const;

const SCOPES = ["ALL", "TEAM", "PROJECT"] as const;

const baseSchema = z.object({
  serviceName: z.string().trim().min(1).max(80),
  category: z.enum(CATEGORIES).optional().default("OTHER"),
  loginId: z.string().trim().max(200).optional().nullable(),
  // .url() 만으론 javascript:/data: 스킴이 통과한다(저장형 XSS). http(s) 만 허용하도록 refine.
  url: z.string().trim().url().max(500)
    .refine((u) => /^https?:\/\//i.test(u), { message: "http 또는 https URL 만 허용됩니다" })
    .optional().nullable().or(z.literal("")),
  // 커스텀 로고 — 서버에 업로드된 /uploads/... 경로 (또는 외부 URL). 빈 문자열/ null 이면 자동 추측으로 되돌림.
  iconUrl: z.string().trim().max(500).optional().nullable().or(z.literal("")),
  iconShape: z.enum(["SQUIRCLE", "CIRCLE"]).optional(),
  notes: z.string().max(2000).optional().nullable(),
  scope: z.enum(SCOPES).optional().default("ALL"),
  scopeTeam: z.string().trim().max(80).optional().nullable(),
  // 다중 팀 공유 — "내 팀 + 다른 팀들" 형태. scopeTeam 은 레거시/대표값으로 배열의 첫 요소와 동기화한다.
  scopeTeams: z.array(z.string().trim().min(1).max(80)).optional(),
  projectId: z.string().optional().nullable(),
  // 다중 프로젝트 공유 — 대표값(projectId) 외에 추가 공유 프로젝트 id 목록.
  projectIds: z.array(z.string().min(1)).optional(),
  ownerUserId: z.string().optional().nullable(),
  ownerName: z.string().trim().max(80).optional().nullable(),
  // 활성 여부 — 기본 true. 해지/만료된 계정을 삭제 없이 비활성으로 남겨 기록 보존.
  active: z.boolean().optional(),
  // 평문 비밀번호 — 서버에서 즉시 암호화해 passwordEnc 에만 저장.
  // null 로 보내면 기존 저장된 값 삭제, undefined 면 변경 없음(PATCH).
  password: z.string().max(512).nullable().optional(),
});

const createSchema = baseSchema;
const updateSchema = baseSchema.partial();

function isAdmin(user: { role?: string; superAdmin?: boolean }) {
  return !!user.superAdmin || user.role === "ADMIN";
}
function canEdit(user: { id: string; role?: string; superAdmin?: boolean }, row: { createdById: string }) {
  return isAdmin(user) || row.createdById === user.id;
}

/**
 * 현재 유저가 열람 가능한 ServiceAccount 의 where 절을 만든다.
 * ADMIN/SUPER 는 모든 항목을 본다.
 */
async function visibleWhere(user: { id: string; role?: string; superAdmin?: boolean; team?: string | null }) {
  if (isAdmin(user)) return {};

  // 내가 멤버인 프로젝트 id 목록
  const memberships = await prisma.projectMember.findMany({
    where: { userId: user.id },
    select: { projectId: true },
  });
  const projectIds = memberships.map((m) => m.projectId);

  const conditions: any[] = [
    { scope: "ALL" },
    // 본인이 만든 항목은 스코프 불문 보이게 (관리 편의)
    { createdById: user.id },
  ];
  if (user.team) {
    // scope=TEAM 중 단일값(scopeTeam) 일치 OR 배열(scopeTeams) 포함
    conditions.push({ scope: "TEAM", OR: [{ scopeTeam: user.team }, { scopeTeams: { has: user.team } }] });
  }
  if (projectIds.length > 0) {
    conditions.push({
      scope: "PROJECT",
      OR: [
        { projectId: { in: projectIds } },
        { projectIds: { hasSome: projectIds } },
      ],
    });
  }
  return { OR: conditions };
}

/** 목록 — 카테고리·검색·스코프 탭·프로젝트 필터 지원. */
router.get("/", async (req, res) => {
  const user = (req as any).user as { id: string; role?: string; superAdmin?: boolean; team?: string | null };

  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const scope = typeof req.query.scope === "string" ? req.query.scope : undefined;
  const scopeTeam = typeof req.query.scopeTeam === "string" ? req.query.scopeTeam : undefined;
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;

  const where: any = await visibleWhere(user);

  if (category && (CATEGORIES as readonly string[]).includes(category)) {
    where.category = category;
  }
  if (scope && (SCOPES as readonly string[]).includes(scope)) {
    // visibleWhere 와 AND 결합 — 열람 가능 집합 안에서 추가 필터
    where.AND = [{ OR: where.OR }].filter(() => !!where.OR);
    delete where.OR;
    where.AND.push({ scope });
    if (scope === "TEAM" && scopeTeam) where.AND.push({ OR: [{ scopeTeam }, { scopeTeams: { has: scopeTeam } }] });
    if (scope === "PROJECT" && projectId) where.AND.push({ OR: [{ projectId }, { projectIds: { has: projectId } }] });
  } else if (projectId) {
    where.AND = [{ OR: where.OR }].filter(() => !!where.OR);
    delete where.OR;
    where.AND.push({ scope: "PROJECT", OR: [{ projectId }, { projectIds: { has: projectId } }] });
  }

  if (q) {
    const search = [
      { serviceName: { contains: q, mode: "insensitive" as const } },
      { loginId: { contains: q, mode: "insensitive" as const } },
      { ownerName: { contains: q, mode: "insensitive" as const } },
      { notes: { contains: q, mode: "insensitive" as const } },
    ];
    if (Array.isArray(where.AND)) {
      where.AND.push({ OR: search });
    } else if (where.OR) {
      where.AND = [{ OR: where.OR }, { OR: search }];
      delete where.OR;
    } else {
      where.OR = search;
    }
  }

  const rows = await prisma.serviceAccount.findMany({
    where,
    orderBy: [{ category: "asc" }, { serviceName: "asc" }],
    include: {
      ownerUser: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true, email: true, team: true, position: true } },
      createdBy: { select: { id: true, name: true } },
      project: { select: { id: true, name: true, color: true } },
    },
  });

  // 목록 응답엔 암호문을 담지 않는다 — 존재 여부만 알리고, 조회는 별도 reveal 엔드포인트로.
  const accounts = rows.map(({ passwordEnc, ...rest }) => ({ ...rest, hasPassword: !!passwordEnc }));
  res.json({ accounts });
});

/**
 * 저장된 비밀번호 복호화.
 *
 * 권한 모델:
 *  - "볼 수 있는 사람 = 페이지에서 항목을 볼 수 있는 사람" — visibleWhere 로 가시성 재확인.
 *    즉 scope=ALL 은 전원, TEAM 은 동팀, PROJECT 는 멤버, ADMIN 은 전체.
 *  - 추가 안전장치로 **본인 로그인 비번 재확인** 필수 (bcrypt.compare).
 *  - 열람은 서버 로그에 감사 흔적을 남긴다.
 *
 * POST 로 놓은 건 body 에 재확인용 평문 비번이 실려 URL/access log 에 남지 않게 하기 위함.
 */
const revealSchema = z.object({ password: z.string().min(1).max(128) });
router.post("/:id/password", async (req, res) => {
  const parsed = revealSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "로그인 비밀번호를 입력해주세요." });
  const user = (req as any).user as { id: string; role?: string; superAdmin?: boolean; team?: string | null };

  // 본인 로그인 비번 재확인. bcrypt.compare 자체가 느려 브루트포스 방어 역할도 겸함.
  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (!me?.passwordHash) return res.status(403).json({ error: "재인증이 필요해요." });
  const ok = await bcrypt.compare(parsed.data.password, me.passwordHash);
  if (!ok) return res.status(403).json({ error: "로그인 비밀번호가 일치하지 않아요." });

  // 가시성 검증 — 목록에서 보이지 않는 항목은 비번도 볼 수 없다.
  const visible = await visibleWhere(user);
  const row = await prisma.serviceAccount.findFirst({
    where: { AND: [{ id: req.params.id }, visible] },
    select: { id: true, passwordEnc: true, serviceName: true },
  });
  if (!row) return res.status(404).json({ error: "해당 계정을 찾을 수 없거나 열람 권한이 없어요." });
  if (!row.passwordEnc) return res.json({ password: null });
  try {
    const password = decryptSecret(row.passwordEnc);
    console.log(`[serviceAccount] reveal by user=${user.id} target=${row.id}(${row.serviceName})`);
    res.json({ password });
  } catch (e: any) {
    res.status(500).json({ error: "복호화 실패: " + (e?.message ?? "") });
  }
});

/** 프로젝트 칩 — 이 페이지 필터에 노출할, 내가 속한 프로젝트 목록. */
router.get("/projects", async (req, res) => {
  const user = (req as any).user as { id: string; role?: string; superAdmin?: boolean };
  const where = isAdmin(user)
    ? { status: "ACTIVE" }
    : { status: "ACTIVE", members: { some: { userId: user.id } } };
  const projects = await prisma.project.findMany({
    where,
    select: { id: true, name: true, color: true },
    orderBy: { name: "asc" },
  });
  res.json({ projects });
});

async function validateScope(
  _user: { id: string; role?: string; superAdmin?: boolean; team?: string | null },
  input: { scope?: string; scopeTeam?: string | null; scopeTeams?: string[]; projectId?: string | null; projectIds?: string[] },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const scope = input.scope ?? "ALL";
  if (scope === "ALL") return { ok: true };
  if (scope === "TEAM") {
    const teams = [
      ...(input.scopeTeam ? [input.scopeTeam] : []),
      ...((input.scopeTeams ?? []).filter(Boolean)),
    ];
    if (teams.length === 0) return { ok: false, error: "팀을 하나 이상 지정해주세요." };
    // "페이지를 볼 수 있는 사람 = 공유 대상 지정 가능" 원칙 — 팀 이름 자유 입력 허용.
    return { ok: true };
  }
  if (scope === "PROJECT") {
    const ids = [
      ...(input.projectId ? [input.projectId] : []),
      ...((input.projectIds ?? []).filter(Boolean)),
    ];
    if (ids.length === 0) return { ok: false, error: "프로젝트를 하나 이상 지정해주세요." };
    const found = await prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (found.length !== ids.length) return { ok: false, error: "선택한 프로젝트 중 일부를 찾을 수 없어요." };
    return { ok: true };
  }
  return { ok: false, error: "알 수 없는 공개 범위에요." };
}

router.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "잘못된 요청" });
  }
  const input = parsed.data;
  const user = (req as any).user as { id: string; role?: string; superAdmin?: boolean; team?: string | null };

  const scopeCheck = await validateScope(user, input);
  if (!scopeCheck.ok) return res.status(400).json({ error: scopeCheck.error });

  // URL 빈 문자열은 null 로 정규화
  const url = input.url === "" ? null : input.url ?? null;

  let ownerUserId = input.ownerUserId || null;
  if (ownerUserId) {
    const exists = await prisma.user.findUnique({ where: { id: ownerUserId }, select: { id: true } });
    if (!exists) return res.status(400).json({ error: "담당자로 지정한 사용자를 찾을 수 없어요." });
  }

  // 비밀번호는 저장 직전 암호화. 키 없으면 거절.
  let passwordEnc: string | null = null;
  if (input.password) {
    if (!hasSecretKey()) {
      return res.status(400).json({ error: "서버에 암호화 키가 설정되어 있지 않아 비밀번호를 저장할 수 없어요." });
    }
    try { passwordEnc = encryptSecret(input.password); }
    catch (e: any) { return res.status(400).json({ error: e?.message ?? "암호화 실패" }); }
  }

  const scope = input.scope ?? "ALL";
  // 다중 범위 정규화:
  //  - scopeTeam 단일값 + scopeTeams 배열을 합쳐 중복 제거, 공백 제거.
  //  - 대표값(scopeTeam / projectId)은 배열의 첫 요소로 세팅 — 레거시 UI/쿼리 호환.
  const teamsAll = Array.from(new Set(
    [input.scopeTeam, ...(input.scopeTeams ?? [])].map((s) => (s ?? "").trim()).filter(Boolean)
  ));
  const projAll = Array.from(new Set(
    [input.projectId, ...(input.projectIds ?? [])].map((s) => s ?? "").filter(Boolean)
  ));
  const primaryTeam = scope === "TEAM" ? (teamsAll[0] ?? null) : null;
  const primaryProject = scope === "PROJECT" ? (projAll[0] ?? null) : null;
  const row = await prisma.serviceAccount.create({
    data: {
      serviceName: input.serviceName,
      category: input.category ?? "OTHER",
      loginId: input.loginId || null,
      url,
      iconUrl: input.iconUrl === "" ? null : input.iconUrl ?? null,
      iconShape: input.iconShape ?? "SQUIRCLE",
      active: input.active ?? true,
      notes: input.notes || null,
      scope,
      scopeTeam: primaryTeam,
      scopeTeams: scope === "TEAM" ? teamsAll : [],
      projectId: primaryProject,
      projectIds: scope === "PROJECT" ? projAll : [],
      ownerUserId,
      ownerName: input.ownerName || null,
      passwordEnc,
      createdById: user.id,
    },
    include: {
      ownerUser: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true, email: true, team: true, position: true } },
      createdBy: { select: { id: true, name: true } },
      project: { select: { id: true, name: true, color: true } },
    },
  });

  const { passwordEnc: _pw, ...rest } = row;
  res.json({ account: { ...rest, hasPassword: !!_pw } });
});

router.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "잘못된 요청" });
  }
  const user = (req as any).user as { id: string; role?: string; superAdmin?: boolean; team?: string | null };
  const id = req.params.id;

  const existing = await prisma.serviceAccount.findUnique({
    where: { id },
    select: { id: true, createdById: true, scope: true, scopeTeam: true, scopeTeams: true, projectId: true, projectIds: true },
  });
  if (!existing) return res.status(404).json({ error: "존재하지 않는 계정이에요." });
  if (!canEdit(user, existing)) {
    return res.status(403).json({ error: "이 계정을 수정할 권한이 없어요." });
  }

  const input = parsed.data;

  // scope 변경 검증 — 변경 시 (또는 스코프 관련 필드 변경 시) 유효성 체크
  const nextScope = input.scope ?? existing.scope;
  const nextScopeTeams = input.scopeTeams !== undefined
    ? input.scopeTeams
    : existing.scopeTeams ?? [];
  const nextScopeTeam = input.scopeTeam !== undefined
    ? input.scopeTeam
    : existing.scopeTeam;
  const nextProjectIds = input.projectIds !== undefined
    ? input.projectIds
    : existing.projectIds ?? [];
  const nextProjectId = input.projectId !== undefined ? input.projectId : existing.projectId;
  const scopeRelatedChanged =
    input.scope !== undefined || input.scopeTeam !== undefined || input.scopeTeams !== undefined ||
    input.projectId !== undefined || input.projectIds !== undefined;
  if (scopeRelatedChanged) {
    const check = await validateScope(user, {
      scope: nextScope,
      scopeTeam: nextScopeTeam,
      scopeTeams: nextScopeTeams,
      projectId: nextProjectId,
      projectIds: nextProjectIds,
    });
    if (!check.ok) return res.status(400).json({ error: check.error });
  }

  const data: any = {};
  if (input.serviceName !== undefined) data.serviceName = input.serviceName;
  if (input.category !== undefined) data.category = input.category;
  if (input.loginId !== undefined) data.loginId = input.loginId || null;
  if (input.url !== undefined) data.url = input.url === "" ? null : input.url;
  if (input.iconUrl !== undefined) data.iconUrl = input.iconUrl === "" ? null : input.iconUrl;
  if (input.iconShape !== undefined) data.iconShape = input.iconShape;
  if (input.active !== undefined) data.active = input.active;
  if (input.notes !== undefined) data.notes = input.notes || null;
  if (input.ownerName !== undefined) data.ownerName = input.ownerName || null;
  if (input.ownerUserId !== undefined) {
    const next = input.ownerUserId || null;
    if (next) {
      const exists = await prisma.user.findUnique({ where: { id: next }, select: { id: true } });
      if (!exists) return res.status(400).json({ error: "담당자로 지정한 사용자를 찾을 수 없어요." });
    }
    data.ownerUserId = next;
  }
  if (scopeRelatedChanged) {
    const teamsAll = Array.from(new Set(
      [nextScopeTeam, ...(nextScopeTeams ?? [])].map((s) => (s ?? "").trim()).filter(Boolean)
    ));
    const projAll = Array.from(new Set(
      [nextProjectId, ...(nextProjectIds ?? [])].map((s) => s ?? "").filter(Boolean)
    ));
    data.scope = nextScope;
    data.scopeTeam = nextScope === "TEAM" ? (teamsAll[0] ?? null) : null;
    data.scopeTeams = nextScope === "TEAM" ? teamsAll : [];
    data.projectId = nextScope === "PROJECT" ? (projAll[0] ?? null) : null;
    data.projectIds = nextScope === "PROJECT" ? projAll : [];
  }
  // 비밀번호 — undefined 면 변경 없음, null/빈 문자열은 제거, 값이 있으면 암호화.
  if (input.password !== undefined) {
    if (input.password === null || input.password === "") {
      data.passwordEnc = null;
    } else {
      if (!hasSecretKey()) {
        return res.status(400).json({ error: "서버에 암호화 키가 설정되어 있지 않아 비밀번호를 저장할 수 없어요." });
      }
      try { data.passwordEnc = encryptSecret(input.password); }
      catch (e: any) { return res.status(400).json({ error: e?.message ?? "암호화 실패" }); }
    }
  }

  const row = await prisma.serviceAccount.update({
    where: { id },
    data,
    include: {
      ownerUser: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true, email: true, team: true, position: true } },
      createdBy: { select: { id: true, name: true } },
      project: { select: { id: true, name: true, color: true } },
    },
  });
  const { passwordEnc: _pw, ...rest } = row;
  res.json({ account: { ...rest, hasPassword: !!_pw } });
});

router.delete("/:id", async (req, res) => {
  const user = (req as any).user as { id: string; role?: string; superAdmin?: boolean };
  const existing = await prisma.serviceAccount.findUnique({ where: { id: req.params.id }, select: { id: true, createdById: true } });
  if (!existing) return res.status(404).json({ error: "존재하지 않는 계정이에요." });
  if (!canEdit(user, existing)) {
    return res.status(403).json({ error: "이 계정을 삭제할 권한이 없어요." });
  }
  await prisma.serviceAccount.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

export default router;
