import { Router } from "express";
import { z } from "zod";
import archiver from "archiver";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { requireAuth, writeLog, queryTokenAuth } from "../lib/auth.js";
import { downloadFile, isStorageEnabled } from "../lib/storage.js";
import { UPLOAD_DIR } from "./upload.js";
import { safeUniqueZipEntry } from "../lib/zipSafe.js";
import path from "node:path";
import fs from "node:fs";

const router = Router();
// 폴더 ZIP 다운로드(GET)만 ?token= 쿼리 인증을 허용한다 — 네이티브 앱(Capacitor WKWebView)은
// 인앱 브라우저로 URL 을 직접 열어 받는데, 그땐 Authorization 헤더·쿠키를 못 싣기 때문.
// requireAuth 보다 먼저 ?token= → Bearer 로 승격해야 인증이 통과한다. 다른 라우트(특히 변경
// 요청)엔 적용하지 않아 토큰이 URL/로그에 남는 노출 면을 다운로드 GET 하나로 한정한다.
router.use((req, res, next) => {
  if (req.method === "GET" && /\/folders\/[^/]+\/download\/?$/.test(req.path)) {
    return queryTokenAuth(req, res, next);
  }
  next();
});
router.use(requireAuth);

/* ===== 프로젝트 멤버십 검사 =====
 * 프로젝트 문서함(projectId 지정) 은 ProjectMember 또는 ADMIN 만 접근 가능.
 * ADMIN 은 감사 편의상 모든 프로젝트를 열람/관리할 수 있다.
 */
async function assertProjectMember(
  u: { id: string; role: string },
  projectId: string,
): Promise<boolean> {
  if (u.role === "ADMIN") return true;
  const m = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: u.id } },
    select: { id: true },
  });
  return !!m;
}

/* ===== 내가 접근 가능한 프로젝트 목록 =====
 * 문서함 상단 카테고리 칩 렌더 전용. "전체"(null) + 여기 내려주는 프로젝트들이 칩으로 뜬다.
 * 권한 없는 프로젝트는 애초에 목록에 안 실려서 카테고리 자체가 안 보인다.
 */
router.get("/projects", async (req, res) => {
  const u = (req as any).user;
  // ADMIN 은 전체 프로젝트. 일반 사용자는 ProjectMember join.
  const projects = u.role === "ADMIN"
    ? await prisma.project.findMany({
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, color: true },
      })
    : await prisma.project.findMany({
        where: {
          status: "ACTIVE",
          members: { some: { userId: u.id } },
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true, color: true },
      });
  res.json({ projects });
});

/* ===== 폴더 ===== */
// 전역(프로젝트 아닌) 폴더 가시성 — 기존 로직 그대로.
function folderVisibilityWhere(u: { id: string; team: string | null; role: string }) {
  if (u.role === "ADMIN") return {};
  const ors: any[] = [
    { scope: "ALL" },
    { authorId: u.id },
  ];
  if (u.team) ors.push({ scope: "TEAM", scopeTeam: u.team });
  ors.push({ scope: "CUSTOM", scopeUserIds: { contains: u.id } });
  return { OR: ors };
}

router.get("/folders", async (req, res) => {
  const u = (req as any).user;
  const scope = req.query.scope ? String(req.query.scope) : "all";
  const projectId = req.query.projectId ? String(req.query.projectId) : null;

  if (projectId) {
    // 프로젝트 문서함 — 멤버십만 확인하면 끝. scope 필터는 무시.
    if (!(await assertProjectMember(u, projectId))) {
      return res.status(403).json({ error: "해당 프로젝트에 접근 권한이 없습니다" });
    }
    const folders = await prisma.folder.findMany({
      where: { projectId },
      orderBy: [{ parentId: "asc" }, { createdAt: "asc" }],
    });
    return res.json({ folders });
  }

  // 전역 문서함 — 프로젝트 폴더는 숨김(projectId: null).
  const ands: any[] = [folderVisibilityWhere(u), { projectId: null }];
  if (scope === "team") ands.push({ scope: "TEAM" });
  else if (scope === "private") ands.push({ scope: "PRIVATE", authorId: u.id });
  else if (scope === "custom") ands.push({ scope: "CUSTOM" });
  else if (scope === "public") ands.push({ scope: "ALL" });
  const folders = await prisma.folder.findMany({
    where: { AND: ands },
    orderBy: [{ parentId: "asc" }, { createdAt: "asc" }],
  });
  res.json({ folders });
});

const folderCreateSchema = z.object({
  // name 은 폴더 트리 표시 길이 한도에 맞춰 100자로 제한.
  name: z.string().min(1).max(100),
  parentId: z.string().max(64).nullable().optional(),
  scope: z.enum(["ALL", "TEAM", "PRIVATE", "CUSTOM"]).optional(),
  scopeTeam: z.string().max(80).nullable().optional(),
  // scopeUserIds 는 콤마 문자열로 저장되므로 인원수가 커지면 컬럼 비대 + LIKE 쿼리 저하.
  // 50명까지 허용 — 그 이상은 TEAM/ALL 공개 범위로 쓰는 걸 권장.
  scopeUserIds: z.array(z.string().max(64)).max(50).optional(),
  projectId: z.string().max(64).nullable().optional(),
});

router.post("/folders", async (req, res) => {
  const u = (req as any).user;
  const parsed = folderCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const { name, parentId } = parsed.data;
  const projectId = parsed.data.projectId ?? null;

  if (projectId) {
    // 프로젝트 폴더 — 멤버만 생성 가능, scope 관련 필드는 무의미하므로 ALL 로 고정.
    if (!(await assertProjectMember(u, projectId))) {
      return res.status(403).json({ error: "해당 프로젝트에 접근 권한이 없습니다" });
    }
    const folder = await prisma.folder.create({
      data: {
        name: name.trim(),
        parentId: parentId || null,
        scope: "ALL",
        scopeTeam: null,
        scopeUserIds: null,
        authorId: u.id,
        projectId,
      },
    });
    await writeLog(u.id, "FOLDER_CREATE", folder.id, name);
    return res.json({ folder });
  }

  const scope = parsed.data.scope ?? "ALL";
  const scopeTeam = scope === "TEAM" ? (parsed.data.scopeTeam ?? u.team ?? null) : null;
  const scopeUserIds = scope === "CUSTOM" && parsed.data.scopeUserIds?.length
    ? parsed.data.scopeUserIds.join(",")
    : null;
  const folder = await prisma.folder.create({
    data: {
      name: name.trim(),
      parentId: parentId || null,
      scope,
      scopeTeam,
      scopeUserIds,
      authorId: u.id,
    },
  });
  await writeLog(u.id, "FOLDER_CREATE", folder.id, name);
  res.json({ folder });
});

/**
 * 폴더 권한 모델:
 *   - ADMIN: 모두 가능
 *   - 폴더 작성자(authorId == u.id): 수정/삭제 가능
 *   - 프로젝트 폴더(projectId 존재): 프로젝트 멤버 수정/삭제 가능
 * 이전엔 아무 검사도 없어서 일반 유저가 임의 폴더를 리네임/삭제할 수 있는 치명적 결함이었음.
 * 폴더 삭제는 cascade 로 내부 문서까지 지우므로 절대 권한 없는 사용자에게 허용 불가.
 */
async function assertFolderWritable(
  u: { id: string; role: string },
  folderId: string,
): Promise<{ ok: boolean; folder?: { id: string; projectId: string | null; authorId: string | null } }> {
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    select: { id: true, projectId: true, authorId: true },
  });
  if (!folder) return { ok: false };
  if (u.role === "ADMIN") return { ok: true, folder };
  if (folder.authorId && folder.authorId === u.id) return { ok: true, folder };
  if (folder.projectId && (await assertProjectMember(u, folder.projectId))) return { ok: true, folder };
  return { ok: false, folder };
}

/**
 * 폴더의 모든 하위 폴더 ID 를 BFS 로 수집 (자기 자신 포함).
 *   - 스코프/프로젝트 이동 시 하위 폴더·문서까지 같이 옮겨야 가시성이 일관됨.
 *   - 깊이 제한은 별도로 없음 (현실적으로 문서함 깊이가 수 단계를 넘지 않음).
 */
async function collectFolderSubtree(rootId: string): Promise<string[]> {
  const ids: string[] = [rootId];
  let frontier: string[] = [rootId];
  while (frontier.length) {
    const children = await prisma.folder.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    });
    if (!children.length) break;
    const nextIds = children.map((c) => c.id);
    ids.push(...nextIds);
    frontier = nextIds;
  }
  return ids;
}

const folderPatchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  // 스코프/프로젝트 이동 — 드래그 앤 드롭용.
  scope: z.enum(["ALL", "TEAM", "PRIVATE", "CUSTOM"]).nullable().optional(),
  projectId: z.string().max(64).nullable().optional(),
  // 폴더 중첩 이동 — null 이면 루트로, 값이 있으면 해당 폴더의 자식으로.
  parentId: z.string().max(64).nullable().optional(),
});

router.patch("/folders/:id", async (req, res) => {
  const u = (req as any).user;
  const parsed = folderPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const { name: rawName, scope, projectId, parentId } = parsed.data;
  const name = rawName !== undefined ? rawName.trim().slice(0, 100) : undefined;

  const check = await assertFolderWritable(u, req.params.id);
  if (!check.folder) return res.status(404).json({ error: "not found" });
  if (!check.ok) return res.status(403).json({ error: "forbidden" });

  const wantsScopeMove = scope !== undefined || projectId !== undefined;
  const wantsParentMove = parentId !== undefined;
  const wantsMove = wantsScopeMove || wantsParentMove;
  const data: any = {};
  if (name !== undefined) {
    if (!name) return res.status(400).json({ error: "이름이 필요합니다" });
    data.name = name;
  }

  // 부모 폴더로 이동(중첩) — 스코프 이동과 독립적으로 처리.
  //   - 사이클 방지: 자기 자신 또는 하위로는 이동 금지.
  //   - 부모의 scope/projectId 를 상속 (가시성 일관성 유지).
  if (wantsParentMove && !wantsScopeMove) {
    if (parentId) {
      if (parentId === req.params.id) return res.status(400).json({ error: "자기 자신으로는 이동할 수 없어요" });
      const subtree = await collectFolderSubtree(req.params.id);
      if (subtree.includes(parentId)) {
        return res.status(400).json({ error: "하위 폴더로는 이동할 수 없어요" });
      }
      const parent = await prisma.folder.findUnique({
        where: { id: parentId },
        select: { id: true, projectId: true, scope: true, scopeTeam: true, authorId: true },
      });
      if (!parent) return res.status(404).json({ error: "부모 폴더를 찾을 수 없어요" });
      // 부모 폴더에 대해서도 쓰기 권한 확인.
      const parentCheck = await assertFolderWritable(u, parentId);
      if (!parentCheck.ok) return res.status(403).json({ error: "부모 폴더에 권한이 없어요" });
      data.parentId = parentId;
      data.projectId = parent.projectId;
      data.scope = parent.scope;
      data.scopeTeam = parent.scopeTeam;
      data.scopeUserIds = null;
    } else {
      // parentId=null → 현재 스코프 유지한 채 루트로 빼기.
      data.parentId = null;
    }
  }

  if (wantsScopeMove) {
    // 최상위로 올리고 이동 — 새로운 스코프/프로젝트의 루트로 옮김.
    // (하위 폴더는 parentId 체인 유지로 자연스럽게 딸려 옴.)
    data.parentId = null;

    if (projectId) {
      // 프로젝트로 이동 — 멤버 확인.
      if (!(await assertProjectMember(u, projectId))) {
        return res.status(403).json({ error: "해당 프로젝트에 접근 권한이 없습니다" });
      }
      data.projectId = projectId;
      data.scope = "ALL";
      data.scopeTeam = null;
      data.scopeUserIds = null;
    } else {
      // 프로젝트 해제 + 전역 문서함으로 이동. scope 는 명시값이 있으면 사용, 아니면 ALL 기본.
      data.projectId = null;
      const targetScope = scope ?? "ALL";
      data.scope = targetScope;
      data.scopeTeam = targetScope === "TEAM" ? (u.team ?? null) : null;
      data.scopeUserIds = null; // CUSTOM 은 DnD 로는 지정 불가 — 상세 모달이 따로 담당.
    }
  }

  const folder = await prisma.folder.update({ where: { id: req.params.id }, data });

  // 스코프/프로젝트가 바뀌는 케이스(scope-move 또는 다른 스코프의 부모로 parent-move) 는
  // 하위 폴더·문서까지 동일 범주로 cascade — 가시성 일관성 유지를 위해.
  const scopeChanged = data.scope !== undefined || data.projectId !== undefined;
  if (scopeChanged) {
    const subtreeIds = await collectFolderSubtree(req.params.id);
    const cascade: any = {
      projectId: data.projectId,
      scope: data.scope,
      scopeTeam: data.scopeTeam,
    };
    if (data.scope !== "CUSTOM") cascade.scopeUserIds = null;
    await prisma.folder.updateMany({
      where: { id: { in: subtreeIds.filter((id) => id !== req.params.id) } },
      data: cascade,
    });
    await prisma.document.updateMany({
      where: { folderId: { in: subtreeIds } },
      data: cascade,
    });
  }

  await writeLog(u.id, "FOLDER_UPDATE", folder.id, name ?? (wantsMove ? "move" : ""));
  res.json({ folder });
});

/**
 * 폴더 삭제 — 두 가지 모드.
 *   - 기본 (cascade=true): 폴더 + 하위 폴더 + 그 안의 모든 문서를 통째로 삭제.
 *     Document.folder 관계는 onDelete: SetNull 이라, 문서를 명시적으로 먼저 지우지 않으면
 *     "문서로 이동" 모드와 동일한 결과가 돼 버림. 그래서 cascade 모드는 먼저 문서들을 삭제함.
 *   - keep: 폴더 안의 모든 문서를 현재 폴더의 부모(없으면 루트/ null) 로 옮긴 뒤, 빈 폴더 트리만 삭제.
 *     문서는 보존하고 싶은 사용자를 위한 안전장치.
 */
router.delete("/folders/:id", async (req, res) => {
  const u = (req as any).user;
  const mode = String(req.query.mode || "cascade"); // "cascade" | "keep"
  const check = await assertFolderWritable(u, req.params.id);
  if (!check.folder) return res.status(404).json({ error: "not found" });
  if (!check.ok) return res.status(403).json({ error: "forbidden" });

  const subtreeIds = await collectFolderSubtree(req.params.id);

  if (mode === "keep") {
    // 문서를 부모 폴더로 이동 — parentId 가 없으면 루트(null).
    const target = (await prisma.folder.findUnique({
      where: { id: req.params.id },
      select: { parentId: true },
    }))?.parentId ?? null;
    await prisma.document.updateMany({
      where: { folderId: { in: subtreeIds } },
      data: { folderId: target },
    });
    // 빈 폴더들 삭제 (하위부터 상위 순서는 Prisma cascade 가 처리).
    await prisma.folder.delete({ where: { id: req.params.id } });
    await writeLog(u.id, "FOLDER_DELETE", req.params.id, "keep-docs");
    return res.json({ ok: true, mode: "keep" });
  }

  // cascade — 하위 문서까지 전부 삭제.
  await prisma.document.deleteMany({ where: { folderId: { in: subtreeIds } } });
  await prisma.folder.delete({ where: { id: req.params.id } });
  await writeLog(u.id, "FOLDER_DELETE", req.params.id, "cascade");
  res.json({ ok: true, mode: "cascade" });
});

/* ===== 문서 ===== */
// fileUrl 은 반드시 우리 업로드 경로 형식이어야 함 — javascript:, data:, 외부 URL,
// 그리고 path traversal(../) 모두 차단. (chat.ts 와 동일 정책)
const SAFE_UPLOAD_URL = /^\/uploads\/[A-Za-z0-9._-]+$/;

// TipTap JSON 최대 크기 — 회의록(512KB) 과 동일 기준.
// 이미지 다수 포함해도 통상 수백 KB 안. 너무 크면 Postgres JSONB 파싱/응답 비용 급등.
const DOC_CONTENT_MAX = 512_000;

function sizeOfJson(v: unknown): number {
  try { return JSON.stringify(v ?? "").length; } catch { return Number.MAX_SAFE_INTEGER; }
}
const docSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  folderId: z.string().max(64).optional().nullable(),
  fileUrl: z.string().regex(SAFE_UPLOAD_URL).max(2000).optional(),
  fileName: z.string().max(255).optional(),
  fileType: z.string().max(80).optional(),
  // 업로드 크기는 upload 라우트에서 파일 용량 체크로 방어하고, 여기서는 int 한도만.
  fileSize: z.number().int().nonnegative().max(500_000_000).optional(),
  // 태그는 콤마로 구분된 문자열. UI에서 20개 이상 넣을 일 없음.
  tags: z.string().max(500).optional(),
  /// TipTap JSON — 메모 타입 문서에만 사용. null/undefined 이면 파일 문서.
  content: z.any().optional(),
  scope: z.enum(["ALL", "TEAM", "PRIVATE", "CUSTOM"]).optional(),
  scopeTeam: z.string().max(80).nullable().optional(),
  // scopeUserIds — folderCreateSchema 와 동일 기준 50명 상한.
  scopeUserIds: z.array(z.string().max(64)).max(50).optional(),
  projectId: z.string().max(64).nullable().optional(),
});

// 생성/수정 응답에 작성자·폴더를 함께 실어 보낸다 — 목록 조회(GET)와 동일한 형태.
// 이게 없으면 클라이언트(메모 카드·뷰어)가 author 를 읽다가 크래시.
const DOC_RELATIONS = {
  author: { select: { name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } },
  folder: { select: { name: true } },
} as const;

function visibilityWhere(u: { id: string; team: string | null; role: string }) {
  if (u.role === "ADMIN") return {};
  const ors: any[] = [
    { scope: "ALL" },
    { authorId: u.id },
  ];
  if (u.team) ors.push({ scope: "TEAM", scopeTeam: u.team });
  ors.push({ scope: "CUSTOM", scopeUserIds: { contains: u.id } });
  return { OR: ors };
}

router.get("/", async (req, res) => {
  const u = (req as any).user;
  const folderId = req.query.folderId ? String(req.query.folderId) : undefined;
  // q 는 title/description/tags 3개 컬럼에 contains: q 로 들어감 — 수KB 입력이면 LIKE 스캔 폭주.
  // 클라이언트 검색창 maxLength(80) 과 맞춰 128자로 하드 캡.
  const rawQ = req.query.q ? String(req.query.q).trim() : "";
  const q = rawQ.length > 128 ? rawQ.slice(0, 128) : rawQ;
  const scope = req.query.scope ? String(req.query.scope) : "all";
  const projectId = req.query.projectId ? String(req.query.projectId) : null;
  // type=memo → content NOT NULL (TipTap JSON); type=file → 파일 문서만; 미지정 → 전체.
  const docType = req.query.type ? String(req.query.type) : undefined;

  if (projectId) {
    // 프로젝트 문서 — 멤버십만 검증.
    if (!(await assertProjectMember(u, projectId))) {
      return res.status(403).json({ error: "해당 프로젝트에 접근 권한이 없습니다" });
    }
    const ands: any[] = [{ projectId }, { deletedAt: null }];
    if (folderId === "root") ands.push({ folderId: null });
    else if (folderId) ands.push({ folderId });
    if (q) ands.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { tags: { contains: q, mode: "insensitive" } },
      ],
    });
    // 상한 500 — 문서함은 폴더/검색으로 좁혀지는 UX 라 실질적으로 넘지 않지만,
    // 누적된 워크스페이스에서 한 번에 모든 문서를 끌어와 수십 MB 응답이 나오는 것을 방지.
    const docs = await prisma.document.findMany({
      where: { AND: ands },
      orderBy: { updatedAt: "desc" },
      take: 500,
      include: {
        author: { select: { name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } },
        folder: { select: { name: true } },
      },
    });
    return res.json({ documents: docs });
  }

  // 전역 문서 — 프로젝트 문서는 숨김.
  const ands: any[] = [visibilityWhere(u), { projectId: null }, { deletedAt: null }];
  if (folderId === "root") ands.push({ folderId: null });
  else if (folderId) ands.push({ folderId });
  if (q) ands.push({
    OR: [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { tags: { contains: q, mode: "insensitive" } },
    ],
  });
  if (scope === "team") ands.push({ scope: "TEAM" });
  else if (scope === "private") ands.push({ scope: "PRIVATE", authorId: u.id });
  else if (scope === "custom") ands.push({ scope: "CUSTOM" });
  else if (scope === "public") ands.push({ scope: "ALL" });
  // 타입 필터: memo=content 있는 것, file=파일 문서, 미지정=전체.
  // ⚠️ content 는 Json? 컬럼 — 리터럴 null 필터({ content: null })는 Prisma 가
  //    클라이언트 검증 단계에서 throw 한다(런타임 500). 반드시 Prisma.AnyNull/DbNull/JsonNull
  //    센티넬을 써야 한다. AnyNull = DB NULL 과 JSON null 둘 다 매칭 → "내용 없음(파일)" 을
  //    가장 안전하게 표현. 메모는 그 여집합(실제 content 보유).
  if (docType === "memo") ands.push({ NOT: { content: { equals: Prisma.AnyNull } } });
  else if (docType === "file") ands.push({ content: { equals: Prisma.AnyNull } });
  // 상한 500 — 프로젝트 문서와 동일. 누적 워크스페이스에서 전체 결과 없이
  // 수십 MB 페이로드가 나오는 것을 방지. UX 는 폴더/검색으로 좁혀지므로 영향 없음.
  const docs = await prisma.document.findMany({
    where: { AND: ands },
    orderBy: { updatedAt: "desc" },
    take: 500,
    include: {
      author: { select: { name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } },
      folder: { select: { name: true } },
    },
  });
  res.json({ documents: docs });
});

router.post("/", async (req, res) => {
  const parsed = docSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const u = (req as any).user;
  const d = parsed.data;
  const projectId = d.projectId ?? null;

  // 메모 content 크기 상한.
  if (d.content !== undefined && d.content !== null && sizeOfJson(d.content) > DOC_CONTENT_MAX) {
    return res.status(400).json({ error: "메모 내용이 너무 큽니다 (최대 512KB)" });
  }

  if (projectId) {
    if (!(await assertProjectMember(u, projectId))) {
      return res.status(403).json({ error: "해당 프로젝트에 접근 권한이 없습니다" });
    }
    const doc = await prisma.document.create({
      data: {
        title: d.title,
        description: d.description,
        folderId: d.folderId ?? null,
        fileUrl: d.fileUrl,
        fileName: d.fileName,
        fileType: d.fileType,
        fileSize: d.fileSize,
        tags: d.tags,
        content: d.content ?? null,
        authorId: u.id,
        scope: "ALL",
        scopeTeam: null,
        scopeUserIds: null,
        projectId,
      },
      include: DOC_RELATIONS,
    });
    await writeLog(u.id, "DOC_CREATE", doc.id, d.title);
    return res.json({ document: doc });
  }

  const scope = d.scope ?? "ALL";
  const scopeTeam = scope === "TEAM" ? (d.scopeTeam ?? u.team ?? null) : null;
  const scopeUserIds = scope === "CUSTOM" && d.scopeUserIds?.length
    ? d.scopeUserIds.join(",")
    : null;
  const doc = await prisma.document.create({
    data: {
      title: d.title,
      description: d.description,
      folderId: d.folderId ?? null,
      fileUrl: d.fileUrl,
      fileName: d.fileName,
      fileType: d.fileType,
      fileSize: d.fileSize,
      tags: d.tags,
      content: d.content ?? null,
      authorId: u.id,
      scope,
      scopeTeam,
      scopeUserIds,
    },
    include: DOC_RELATIONS,
  });
  await writeLog(u.id, "DOC_CREATE", doc.id, d.title);
  res.json({ document: doc });
});

router.patch("/:id", async (req, res) => {
  const parsed = docSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const u = (req as any).user;
  const exist = await prisma.document.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!exist) return res.status(404).json({ error: "not found" });
  // 작성자 본인 or ADMIN or (프로젝트 문서라면 프로젝트 멤버) 만 수정.
  // 다만 scope/scopeTeam/scopeUserIds/projectId 처럼 **가시성에 영향을 주는 필드는**
  // 작성자 또는 ADMIN 만 변경 가능. 프로젝트 멤버에게 허용하면 원래 PRIVATE 문서가
  // CUSTOM/ALL 로 풀려 회사 전체에 노출될 수 있음.
  const isAuthor = exist.authorId === u.id;
  const isAdmin = u.role === "ADMIN";
  const isProjectMember = exist.projectId
    ? await assertProjectMember(u, exist.projectId)
    : false;
  if (!isAuthor && !isAdmin && !isProjectMember)
    return res.status(403).json({ error: "forbidden" });
  const d = parsed.data;

  // 가시성 필드(scope/scopeTeam/scopeUserIds/projectId) 는 작성자/ADMIN 만 변경 가능.
  // 드래그 앤 드롭으로 프로젝트 칩·스코프 탭에 떨어뜨리는 흐름이 여기를 사용.
  const touchesVisibility =
    d.scope !== undefined || d.scopeTeam !== undefined ||
    d.scopeUserIds !== undefined || d.projectId !== undefined;
  if (touchesVisibility && !(isAuthor || isAdmin)) {
    return res.status(403).json({ error: "공개 범위는 작성자 또는 관리자만 바꿀 수 있어요" });
  }
  // 프로젝트 이동 시 새 프로젝트 멤버십 확인 (ADMIN 은 예외).
  if (d.projectId && !isAdmin) {
    if (!(await assertProjectMember(u, d.projectId))) {
      return res.status(403).json({ error: "해당 프로젝트 멤버만 이동할 수 있어요" });
    }
  }

  const updateData: any = {
    ...(d.title !== undefined && { title: d.title }),
    ...(d.description !== undefined && { description: d.description }),
    ...(d.folderId !== undefined && { folderId: d.folderId }),
    ...(d.tags !== undefined && { tags: d.tags }),
    ...(d.content !== undefined && { content: d.content ?? null }),
  };
  if (touchesVisibility) {
    if (d.projectId !== undefined) {
      updateData.projectId = d.projectId;
      if (d.projectId) {
        // 프로젝트 문서는 scope 가 무의미 — ALL 로 고정, 팀/커스텀 리셋.
        updateData.scope = "ALL";
        updateData.scopeTeam = null;
        updateData.scopeUserIds = null;
        // 프로젝트 바뀌었는데 기존 folderId 가 다른 프로젝트의 폴더면 가시성 깨짐 → 루트로.
        updateData.folderId = null;
      }
    }
    if (d.scope !== undefined && !updateData.projectId) {
      updateData.scope = d.scope;
      updateData.scopeTeam = d.scope === "TEAM"
        ? (d.scopeTeam ?? u.team ?? null)
        : null;
      updateData.scopeUserIds = d.scope === "CUSTOM" && d.scopeUserIds?.length
        ? d.scopeUserIds.join(",")
        : null;
      // 전역으로 빠질 땐 projectId 도 해제 + 프로젝트 폴더 밖으로.
      updateData.projectId = null;
      updateData.folderId = null;
    }
  }

  // content 크기 상한.
  if (d.content !== undefined && d.content !== null && sizeOfJson(d.content) > DOC_CONTENT_MAX) {
    return res.status(400).json({ error: "메모 내용이 너무 큽니다 (최대 512KB)" });
  }

  // 변경 전 스냅샷을 DocumentRevision 에 남김 — title/description/fileUrl/content 의 실질
  // 변경이 있을 때만 기록해 잡음을 줄인다. 폴더 이동·태그 변경만으로는 리비전을 찍지 않음.
  const contentChanged =
    (d.title !== undefined && d.title !== exist.title) ||
    (d.description !== undefined && d.description !== exist.description) ||
    (d.content !== undefined && JSON.stringify(d.content) !== JSON.stringify((exist as any).content));
  if (contentChanged) {
    try {
      await prisma.documentRevision.create({
        data: {
          documentId: exist.id,
          title: exist.title,
          description: exist.description,
          fileUrl: exist.fileUrl,
          fileName: exist.fileName,
          fileType: exist.fileType,
          fileSize: exist.fileSize,
          content: (exist as any).content ?? null,
          editorId: u.id,
        },
      });
    } catch {}
  }

  const doc = await prisma.document.update({
    where: { id: exist.id },
    data: updateData,
    include: DOC_RELATIONS,
  });
  await writeLog(u.id, "DOC_UPDATE", doc.id);
  res.json({ document: doc });
});

/**
 * 문서 버전 히스토리 — 수정 전 스냅샷 목록. 최신 → 과거 순.
 * 권한은 해당 문서를 수정할 수 있는 사람과 동일 (작성자/ADMIN/프로젝트 멤버).
 */
router.get("/:id/revisions", async (req, res) => {
  const u = (req as any).user;
  const exist = await prisma.document.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!exist) return res.status(404).json({ error: "not found" });
  const isAuthor = exist.authorId === u.id;
  const isAdmin = u.role === "ADMIN";
  const isProjectMember = exist.projectId ? await assertProjectMember(u, exist.projectId) : false;
  if (!isAuthor && !isAdmin && !isProjectMember) return res.status(403).json({ error: "forbidden" });
  const rows = await prisma.documentRevision.findMany({
    where: { documentId: exist.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { editor: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } } },
  });
  res.json({ revisions: rows });
});

/** 특정 리비전으로 문서를 되돌림. 되돌리기 직전 값도 한 번 더 스냅샷 → 되돌리기 취소 가능. */
router.post("/:id/revisions/:revId/restore", async (req, res) => {
  const u = (req as any).user;
  const exist = await prisma.document.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!exist) return res.status(404).json({ error: "not found" });
  const isAuthor = exist.authorId === u.id;
  const isAdmin = u.role === "ADMIN";
  const isProjectMember = exist.projectId ? await assertProjectMember(u, exist.projectId) : false;
  if (!isAuthor && !isAdmin && !isProjectMember) return res.status(403).json({ error: "forbidden" });
  const rev = await prisma.documentRevision.findUnique({ where: { id: req.params.revId } });
  if (!rev || rev.documentId !== exist.id) return res.status(404).json({ error: "revision not found" });
  // 복구 직전 현재 상태도 하나 남겨둠.
  await prisma.documentRevision.create({
    data: {
      documentId: exist.id,
      title: exist.title,
      description: exist.description,
      fileUrl: exist.fileUrl,
      fileName: exist.fileName,
      fileType: exist.fileType,
      fileSize: exist.fileSize,
      editorId: u.id,
    },
  });
  const doc = await prisma.document.update({
    where: { id: exist.id },
    data: {
      title: rev.title,
      description: rev.description,
      fileUrl: rev.fileUrl,
      fileName: rev.fileName,
      fileType: rev.fileType,
      fileSize: rev.fileSize,
    },
  });
  await writeLog(u.id, "DOC_REVISION_RESTORE", exist.id, rev.id);
  res.json({ document: doc });
});

router.delete("/:id", async (req, res) => {
  const u = (req as any).user;
  const exist = await prisma.document.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!exist) return res.status(404).json({ error: "not found" });
  const isAuthor = exist.authorId === u.id;
  const isAdmin = u.role === "ADMIN";
  // 프로젝트 문서함: 단순 멤버십만으로 타인 문서를 삭제할 수 없음.
  // 작성자 본인 또는 전사 ADMIN / MANAGER 만 허용.
  const isManagerOrAbove = u.role === "ADMIN" || u.role === "MANAGER";
  const isProjectMember = exist.projectId
    ? await assertProjectMember(u, exist.projectId)
    : false;
  const canDelete = isAuthor || isAdmin || (isProjectMember && isManagerOrAbove);
  if (!canDelete)
    return res.status(403).json({ error: "forbidden" });
  await prisma.document.update({ where: { id: exist.id }, data: { deletedAt: new Date(), deletedById: (req as any).user?.id } });
  await writeLog(u.id, "DOC_DELETE", req.params.id);
  res.json({ ok: true });
});

/* ===== 다운로드 =====
 * 개별 문서 파일: 기존 /uploads/<key>?download=1 경로를 그대로 사용. 별도 엔드포인트 불필요.
 * 폴더 전체: 해당 폴더의 모든 문서 파일을 ZIP 으로 묶어 스트리밍.
 *
 * 권한 — 전역 문서의 경우 visibilityWhere 에 걸린 것만, 프로젝트 폴더는 멤버만.
 * 폴더 자체를 못 보면 애초에 이 엔드포인트로 접근 불가.
 */

/** 저장소/디스크 어디든 해당 파일의 Buffer 를 꺼낸다. 없으면 null.
 *  path traversal 2차 방어 — key 가 안전한 charset 이 아니거나 resolve 결과가
 *  UPLOAD_DIR 바깥이면 거부. (1차 방어는 docSchema.fileUrl regex.) */
async function fetchFileBuffer(key: string): Promise<Buffer | null> {
  if (!/^[A-Za-z0-9._-]+$/.test(key)) return null;
  if (isStorageEnabled()) {
    const f = await downloadFile(key);
    if (f) return f.buffer;
  }
  // 디스크 fallback (dev / legacy)
  const diskPath = path.join(UPLOAD_DIR, key);
  const resolved = path.resolve(diskPath);
  const uploadDirResolved = path.resolve(UPLOAD_DIR);
  if (!resolved.startsWith(uploadDirResolved + path.sep) && resolved !== uploadDirResolved) {
    return null;
  }
  if (fs.existsSync(resolved)) {
    return fs.promises.readFile(resolved);
  }
  return null;
}

router.get("/folders/:id/download", async (req, res) => {
  const u = (req as any).user;
  try {
  const folder = await prisma.folder.findUnique({ where: { id: req.params.id } });
  if (!folder) return res.status(404).json({ error: "not found" });

  // 권한 검사 — 프로젝트 폴더면 멤버만, 전역이면 folderVisibilityWhere 와 같은 규칙.
  if (folder.projectId) {
    if (!(await assertProjectMember(u, folder.projectId))) {
      return res.status(403).json({ error: "forbidden" });
    }
  } else if (u.role !== "ADMIN") {
    const ok =
      folder.scope === "ALL" ||
      folder.authorId === u.id ||
      (folder.scope === "TEAM" && folder.scopeTeam === u.team) ||
      (folder.scope === "CUSTOM" && folder.scopeUserIds?.split(",").includes(u.id));
    if (!ok) return res.status(403).json({ error: "forbidden" });
  }

  // 하위 폴더 전체를 BFS 로 수집(트리 깊이당 1쿼리)한 뒤, 문서는 단일 in-쿼리로 한 번에.
  // 이전 구현은 폴더마다 docs+subs 2쿼리를 재귀로 돌려 폴더 수에 비례한 N+1 이었음.
  // 서브폴더만 있고 루트엔 파일이 없어도 하위까지 훑으므로 404 로 떨어지지 않음.
  const rootId = folder.id;
  type FolderNode = { id: string; name: string; parentId: string | null };
  const subtree: FolderNode[] = [];
  let frontier: string[] = [rootId];
  while (frontier.length) {
    const children = await prisma.folder.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true, name: true, parentId: true },
    });
    if (!children.length) break;
    subtree.push(...children);
    frontier = children.map((c) => c.id);
  }

  // 폴더 경로(prefix) 를 메모리에서 계산 — 루트는 빈 문자열.
  const folderMap = new Map(subtree.map((f) => [f.id, f]));
  function folderPath(id: string | null, seen: Set<string> = new Set()): string {
    if (!id || id === rootId) return "";
    if (seen.has(id)) return ""; // 데이터 손상으로 parentId 사이클이 생겨도 무한 재귀(스택오버플로) 방지
    seen.add(id);
    const f = folderMap.get(id);
    if (!f) return "";
    const safe = f.name.replace(/[\\/:*?"<>|]/g, "_");
    const parent = folderPath(f.parentId, seen);
    return parent ? `${parent}/${safe}` : safe;
  }

  const folderIds = [rootId, ...subtree.map((f) => f.id)];
  const docs = await prisma.document.findMany({
    where: { folderId: { in: folderIds }, fileUrl: { not: null }, deletedAt: null },
    select: { fileUrl: true, fileName: true, title: true, folderId: true },
  });

  type Collected = { fileUrl: string; fileName: string | null; title: string; relPath: string };
  const collected: Collected[] = [];
  for (const d of docs) {
    if (d.fileUrl) collected.push({ fileUrl: d.fileUrl, fileName: d.fileName, title: d.title, relPath: folderPath(d.folderId) });
  }

  if (collected.length === 0) {
    return res.status(404).json({ error: "폴더에 다운로드할 파일이 없어요" });
  }

  // 파일명 중복 시 "(2)" "(3)" 꼬리 번호. safeUniqueZipEntry 가 ZIP slip 방어
  // (sanitizeZipPath) + 중복 회피를 한 번에 처리. fileName / title / 폴더 name 에
  // "../" 가 섞여 들어와도 추출 시 상위 디렉토리로 빠지지 않음.
  const usedEntries = new Set<string>();

  const zipName = `${folder.name.replace(/[\\/:*?"<>|]/g, "_")}.zip`;
  res.setHeader("Content-Type", "application/zip");
  const encodedZip = encodeURIComponent(zipName);
  // ★ plain filename="..." 은 ASCII 만 허용 — Node res.setHeader 는 헤더 값에 비-ASCII(한글 등)가
  //   있으면 ERR_INVALID_CHAR 를 던진다. 한글 폴더명("회사 정보")이 그대로 들어가 모든 한글 폴더
  //   다운로드가 500 으로 실패했음. 유니코드 원본명은 filename*=UTF-8'' 가 담당하고, plain 은
  //   ASCII 폴백(비-ASCII → "_")으로 둔다(구형 클라 호환).
  const asciiZip = zipName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${asciiZip}"; filename*=UTF-8''${encodedZip}`,
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");

  // 중간 압축 수준으로 충분. 대용량 이미지/영상은 어차피 이미 압축돼있어 level 올려도 효과 미미.
  const archive = archiver("zip", { zlib: { level: 5 } });
  archive.on("error", (err) => {
    console.error("[doc:zip] archiver error", err);
    if (!res.headersSent) res.status(500).json({ error: "zip failure" });
    else res.end();
  });
  archive.pipe(res);

  // 엔트리명을 "먼저" 결정적으로 계산(문자열 연산이라 즉시) — 이후 fetch 를 병렬화해도
  // safeUniqueZipEntry 의 "(2)" 중복 꼬리 번호가 순서에 흔들리지 않게.
  const planned: { key: string; name: string }[] = [];
  for (const d of collected) {
    if (!d.fileUrl.startsWith("/uploads/")) continue;
    const key = d.fileUrl.slice("/uploads/".length);
    if (!key) continue;
    const name = safeUniqueZipEntry(usedEntries, d.relPath || "", d.fileName || d.title || key);
    planned.push({ key, name });
  }

  // ★ 속도 개선 — 예전엔 파일을 "순차" 로 S3 에서 받아(왕복 latency 가 직렬 합산) 폴더가 크면
  //   매우 느렸다. 동시성 제한(워커 3개)으로 S3 fetch 를 겹쳐 체감 속도를 크게 줄인다.
  //   cap=3 은 메모리 상한(최대 3개 파일 버퍼 동시 보유)과 속도의 절충 — 대용량 파일 다수에서도
  //   Fargate 메모리를 과하게 먹지 않게. (완전한 무버퍼 스트리밍은 storage 스트림 API 후속 과제.)
  const CONCURRENCY = 3;
  let added = 0;
  let idx = 0;
  async function worker() {
    while (idx < planned.length) {
      const e = planned[idx++];
      let buf: Buffer | null = null;
      try {
        buf = await fetchFileBuffer(e.key);
      } catch (err) {
        console.error("[doc:zip] fetch failed", e.key, err);
      }
      if (buf) {
        archive.append(buf, { name: e.name }); // archiver 가 내부 큐로 직렬화 — 동시 append 안전
        added++;
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, planned.length) }, () => worker()));
  } catch (err) {
    console.error("[doc:zip] collect loop failed", err);
  }

  if (added === 0) {
    // 헤더 이미 보냈으므로 JSON 에러로 바꿀 수 없음 — 빈 zip 을 마감해서
    // 최소한 클라이언트 다운로드가 '무한 로딩' 으로 멈추는 것만 피함.
    console.warn("[doc:zip] no readable files", folder.id);
  }

  // ★ 감사 로그는 다운로드 "전에" + 비차단으로 — 예전엔 finalize 뒤 await writeLog 였는데,
  //   writeLog 가 던지면(compression 버퍼링으로 헤더가 아직 안 나간 사이) 글로벌 에러 핸들러가
  //   500 JSON("서버 오류가 발생했습니다")을 내보내 다운로드가 통째로 실패했다(사용자 신고).
  //   로깅 실패가 다운로드를 깨뜨리면 안 되므로 fire-and-forget + catch.
  void writeLog(u.id, "FOLDER_DOWNLOAD", folder.id, `${folder.name} (${added} files)`).catch((e) =>
    console.error("[doc:zip] writeLog failed (non-fatal)", e),
  );

  // finalize 실패도 다운로드 스트림 한정 처리 — 글로벌 핸들러로 새어 500 JSON 이 되지 않게.
  // (헤더가 이미 나갔으면 어차피 JSON 으로 못 바꾸고, 안 나갔으면 stream 을 깔끔히 끝낸다.)
  try {
    await archive.finalize();
  } catch (err) {
    console.error("[doc:zip] finalize failed", folder.id, err);
    if (!res.headersSent) res.status(500).json({ error: "압축 파일을 만들지 못했어요. 잠시 후 다시 시도해주세요." });
    else { try { res.end(); } catch {} }
  }
  } catch (err) {
    // 핸들러 전체 안전망 — 권한·BFS·쿼리·folderPath 등 헤더 전송 전 어떤 예외든 여기서 잡아
    // 깔끔한 500 으로 응답한다(express-async-errors 로 새어 글로벌 "서버 오류가 발생했습니다"가
    // 되던 것을 방지). 실제 원인은 폴더 id 와 함께 로깅 → CloudWatch 에서 추적 가능.
    console.error("[doc:zip] folder download failed", req.params.id, err);
    if (!res.headersSent) {
      res.status(500).json({ error: "폴더 다운로드 중 오류가 발생했어요. 잠시 후 다시 시도하거나 개별 파일로 받아주세요." });
    } else {
      try { res.end(); } catch {}
    }
  }
});

export default router;
