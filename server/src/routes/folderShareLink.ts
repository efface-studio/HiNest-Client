import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import archiver from "archiver";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth, writeLog } from "../lib/auth.js";
import { getFileStream, isStorageEnabled } from "../lib/storage.js";
import { Readable } from "node:stream";
import { UPLOAD_DIR } from "./upload.js";
import { safeUniqueZipEntry } from "../lib/zipSafe.js";
import path from "node:path";
import fs from "node:fs";

/**
 * 폴더 외부 공유 링크 — 로그인 없이 폴더 ZIP을 받을 수 있는 토큰 URL.
 * 만료(expiresAt), 다운로드 횟수 상한(maxDownloads), 선택적 비밀번호 지원.
 *
 * 인증 필요 라우터는 /api/folder-share-links 에 마운트.
 * 공개 라우터는 shareLink.ts 의 /api/public-share/:token 에서 폴더 타입으로 처리.
 */

/* =============== 인증 라우터 =============== */
const authed = Router();
authed.use(requireAuth);

const createSchema = z.object({
  folderId: z.string().min(1),
  expiresAt: z.string().datetime().nullable().optional(),
  maxDownloads: z.number().int().positive().max(10_000).nullable().optional(),
  password: z.string().min(1).max(100).nullable().optional(),
});

async function canShareFolder(u: { id: string; role: string }, folderId: string) {
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    select: { id: true, name: true, authorId: true, projectId: true },
  });
  if (!folder) return null;
  if (u.role === "ADMIN" || folder.authorId === u.id) return folder;
  if (folder.projectId) {
    const m = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: folder.projectId, userId: u.id } },
      select: { id: true },
    });
    if (m) return folder;
  }
  // scope=ALL 폴더는 누구나 공유 가능
  const f2 = await prisma.folder.findUnique({ where: { id: folderId }, select: { scope: true } });
  if (f2?.scope === "ALL") return folder;
  return null;
}

authed.post("/", async (req, res) => {
  const u = (req as any).user;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const d = parsed.data;
  const folder = await canShareFolder(u, d.folderId);
  if (!folder) return res.status(403).json({ error: "해당 폴더에 대한 공유 권한이 없습니다" });

  const token = crypto.randomBytes(24).toString("base64url");
  const link = await prisma.folderShareLink.create({
    data: {
      folderId: folder.id,
      token,
      createdById: u.id,
      expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
      maxDownloads: d.maxDownloads ?? null,
      passwordHash: d.password ? await bcrypt.hash(d.password, 12) : null,
    },
  });
  await writeLog(u.id, "FOLDER_SHARE_LINK_CREATE", link.id, folder.id);
  res.json({ link: serializeFolder(link) });
});

authed.get("/", async (req, res) => {
  const u = (req as any).user;
  const folderId = String(req.query.folderId ?? "");
  if (!folderId) return res.status(400).json({ error: "folderId 필요" });
  const folder = await canShareFolder(u, folderId);
  if (!folder) return res.status(403).json({ error: "forbidden" });
  const rows = await prisma.folderShareLink.findMany({
    where: { folderId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ links: rows.map(serializeFolder) });
});

authed.delete("/:id", async (req, res) => {
  const u = (req as any).user;
  const row = await prisma.folderShareLink.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: "not found" });
  if (row.createdById !== u.id && u.role !== "ADMIN")
    return res.status(403).json({ error: "forbidden" });
  await prisma.folderShareLink.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  await writeLog(u.id, "FOLDER_SHARE_LINK_REVOKE", row.id);
  res.json({ ok: true });
});

function serializeFolder(l: any) {
  return {
    id: l.id,
    token: l.token,
    folderId: l.folderId,
    createdAt: l.createdAt,
    expiresAt: l.expiresAt,
    maxDownloads: l.maxDownloads,
    downloads: l.downloads,
    hasPassword: !!l.passwordHash,
    revokedAt: l.revokedAt,
  };
}

/* =============== 공개 핸들러 (shareLink.ts 의 pub 라우터에서 호출) =============== */
export async function findActiveFolderLink(token: string) {
  const link = await prisma.folderShareLink.findUnique({
    where: { token },
    include: { folder: { select: { id: true, name: true } } },
  });
  if (!link) return { err: 404 as const, link: null };
  if (link.revokedAt) return { err: 410 as const, link: null };
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return { err: 410 as const, link: null };
  if (link.maxDownloads !== null && link.downloads >= link.maxDownloads) return { err: 429 as const, link: null };
  return { err: null, link };
}

/**
 * 폴더 ZIP 스트림 — 폴더 내 모든 문서 파일을 재귀적으로 수집해서 zip 으로 내보냄.
 * document.ts 의 /folders/:id/download 로직과 동일 패턴.
 */
export async function streamFolderZip(
  folderId: string,
  folderName: string,
  res: any,
) {
  // 하위 폴더를 BFS 로 수집(트리 깊이당 1쿼리, parentId 인덱스 사용) — 전 회사 Folder 테이블을
  // 매 요청 통째로 로드하던 것 제거(공개 endpoint 라 테넌트 스코프도 없어 더 위험했음).
  // document.ts /folders/:id/download 와 동일 패턴.
  type FolderNode = { id: string; name: string; parentId: string | null };
  const subtree: FolderNode[] = [];
  let frontier: string[] = [folderId];
  while (frontier.length) {
    const children = await prisma.folder.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true, name: true, parentId: true },
    });
    if (!children.length) break;
    subtree.push(...children);
    frontier = children.map((c) => c.id);
  }
  const folderMap = new Map(subtree.map((f) => [f.id, f]));
  const folderIds = [folderId, ...subtree.map((f) => f.id)];

  // 해당 폴더들에 속한 문서 — deletedAt:null 필수. 소프트 삭제(deletedAt 만 세팅, fileUrl/folderId 보존)된
  // 문서가 과거 발급된 공개 링크로 계속 다운로드되던 결함 차단(인증 경로 document.ts 와 동작 일치).
  const docs = await prisma.document.findMany({
    where: { folderId: { in: folderIds }, fileUrl: { not: null }, deletedAt: null },
    select: { id: true, title: true, fileName: true, fileUrl: true, folderId: true },
  });

  // 파일 경로 prefix 계산 (폴더 구조 유지)
  function folderPath(id: string | null | undefined): string {
    if (!id || id === folderId) return "";
    const f = folderMap.get(id);
    if (!f) return "";
    const parent = folderPath(f.parentId);
    return parent ? `${parent}/${f.name}` : f.name;
  }

  const zipName = `${folderName.replace(/[\\/:*?"<>|]/g, "_")}.zip`;
  res.setHeader("Content-Type", "application/zip");
  // plain filename 은 ASCII 만 — 한글 폴더명이 그대로 들어가면 Node setHeader 가 ERR_INVALID_CHAR
  // 를 던져 공유 링크 폴더 다운로드가 실패한다. 유니코드 원본명은 filename*=UTF-8'' 가 담당.
  const asciiZip = zipName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${asciiZip}"; filename*=UTF-8''${encodeURIComponent(zipName)}`,
  );

  const archive = archiver("zip", { zlib: { level: 5 } });
  archive.on("error", (err: any) => {
    console.error("[folderShare:zip] archiver error", err);
    if (!res.headersSent) res.status(500).json({ error: "zip failure" });
  });
  archive.pipe(res);

  let added = 0;
  // ZIP slip 방어 — fileName / title / folder.name 모두 사용자 입력이라
  // "../" 같은 segment 가 섞이면 추출 시 상위 디렉토리로 빠질 수 있음.
  // sanitizeZipPath 가 각 segment 의 .. / . 제거 + 절대경로 prefix 제거.
  const usedEntryNames = new Set<string>();
  for (const doc of docs) {
    const key = doc.fileUrl!.replace(/^\/uploads\//, "");
    try {
      // 무버퍼 스트리밍 — 파일을 통째로 RAM 에 올리지 않고 S3 스트림을 archiver 로 바로 흘려보낸다
      // (대용량 폴더 OOM·zip 잘림 방지). archiver 가 다 읽을 때까지 기다린 뒤 다음 파일로.
      const stream = await readFileStream(key);
      if (!stream) continue;
      const prefix = folderPath(doc.folderId);
      const fname = doc.fileName ?? `${doc.title}`;
      const entryPath = safeUniqueZipEntry(usedEntryNames, prefix, fname);
      const s = stream;
      let ok = false;
      await new Promise<void>((resolve) => {
        s.on("end", () => { ok = true; resolve(); });
        s.on("close", () => resolve());
        s.on("error", (err) => { console.error("[folderShare:zip] stream error", key, err); resolve(); });
        archive.append(s, { name: entryPath });
      });
      if (ok) added++;
    } catch (e) {
      console.error("[folderShare:zip] fetch failed", key, e);
    }
  }

  if (added === 0) {
    archive.append("", { name: ".empty" });
  }
  await archive.finalize();
}

async function readFileStream(key: string): Promise<Readable | null> {
  // path traversal 2차 방어 — key 가 안전한 charset 이 아니거나
  // resolve 결과가 UPLOAD_DIR 바깥이면 거부. (1차 방어는 docSchema.fileUrl regex.)
  if (!/^[A-Za-z0-9._-]+$/.test(key)) return null;
  if (isStorageEnabled()) {
    const s = await getFileStream(key);
    if (s) return s;
  }
  const diskPath = path.join(UPLOAD_DIR, key);
  const resolved = path.resolve(diskPath);
  const uploadDirResolved = path.resolve(UPLOAD_DIR);
  if (!resolved.startsWith(uploadDirResolved + path.sep) && resolved !== uploadDirResolved) {
    return null;
  }
  if (fs.existsSync(resolved)) return fs.createReadStream(resolved);
  return null;
}

export { authed as folderShareLinkAuthedRouter };
