import { Router } from "express";
import { z } from "zod";
import archiver from "archiver";
import { prisma } from "../lib/db.js";
import { requireAuth, writeLog } from "../lib/auth.js";
import { downloadFile, isStorageEnabled } from "../lib/storage.js";
import { UPLOAD_DIR } from "./upload.js";
import { safeUniqueZipEntry } from "../lib/zipSafe.js";
import path from "node:path";
import fs from "node:fs";

const router = Router();
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
    const parentId = check.folder.projectId ? null : null; // 현재 모델은 Folder.parentId 기반. 최상위면 null.
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
    void parentId; // 린트 무시 — 향후 프로젝트 이동 고려 자리.
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

  const doc = await prisma.document.update({ where: { id: exist.id }, data: updateData });
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

  // 재귀적으로 하위 폴더까지 순회해 파일 수집. 기존엔 최상위 folderId 만 훑어서
  // 서브폴더만 있고 루트엔 파일이 없는 폴더를 받으면 404 로 떨어졌음.
  type Collected = { fileUrl: string; fileName: string | null; title: string; relPath: string };
  const collected: Collected[] = [];
  async function walk(folderId: string, prefix: string) {
    const docs = await prisma.document.findMany({
      where: { folderId, fileUrl: { not: null }, deletedAt: null },
      select: { fileUrl: true, fileName: true, title: true },
    });
    for (const d of docs) {
      if (d.fileUrl) collected.push({ fileUrl: d.fileUrl, fileName: d.fileName, title: d.title, relPath: prefix });
    }
    const subs = await prisma.folder.findMany({
      where: { parentId: folderId },
      select: { id: true, name: true },
    });
    for (const s of subs) {
      const safe = s.name.replace(/[\\/:*?"<>|]/g, "_");
      await walk(s.id, prefix ? `${prefix}/${safe}` : safe);
    }
  }
  await walk(folder.id, "");

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
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${zipName.replace(/"/g, "")}"; filename*=UTF-8''${encodedZip}`,
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

  let added = 0;
  try {
    for (const d of collected) {
      // 업로드 경로 파싱 — 기존 regex 가 너무 빡빡해 파일명에 허용되지 않는 글자가 하나라도
      // 들어있으면 통째로 스킵됐음. key 추출은 마지막 슬래시 이후의 원시 문자열로.
      if (!d.fileUrl.startsWith("/uploads/")) continue;
      const key = d.fileUrl.slice("/uploads/".length);
      if (!key) continue;
      let buf: Buffer | null = null;
      try {
        buf = await fetchFileBuffer(key);
      } catch (err) {
        console.error("[doc:zip] fetch failed", key, err);
      }
      if (!buf) continue;
      const entryName = safeUniqueZipEntry(usedEntries, d.relPath || "", d.fileName || d.title || key);
      archive.append(buf, { name: entryName });
      added++;
    }
  } catch (err) {
    console.error("[doc:zip] collect loop failed", err);
  }

  if (added === 0) {
    // 헤더 이미 보냈으므로 JSON 에러로 바꿀 수 없음 — 빈 zip 을 마감해서
    // 최소한 클라이언트 다운로드가 '무한 로딩' 으로 멈추는 것만 피함.
    console.warn("[doc:zip] no readable files", folder.id);
  }

  await archive.finalize();
  await writeLog(u.id, "FOLDER_DOWNLOAD", folder.id, `${folder.name} (${added} files)`);
});

export default router;
