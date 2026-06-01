import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth, writeLog } from "../lib/auth.js";
import { downloadFile, isStorageEnabled } from "../lib/storage.js";
import { UPLOAD_DIR } from "./upload.js";
import { findActiveFolderLink, streamFolderZip } from "./folderShareLink.js";
import path from "node:path";
import fs from "node:fs";

/**
 * 외부 공유 링크 — 로그인 없이 문서 파일 1건을 받을 수 있게 하는 단일 사용 URL.
 * 만료(expiresAt), 다운로드 횟수 상한(maxDownloads), 선택적 비밀번호(passwordHash) 지원.
 * 접근/다운로드/인증실패 모두 ShareLinkAccess 로 감사 로그.
 *
 * 인증 필요 라우터(authed)와 공개 라우터(public) 두 개를 내보낸다 —
 * 공개 라우터는 /api/public-share 로 마운트하고 requireAuth 가 걸리지 않음.
 */

/* =============== 인증 라우터 =============== */
const authed = Router();
authed.use(requireAuth);

const createSchema = z.object({
  documentId: z.string().min(1),
  expiresAt: z.string().datetime().nullable().optional(),
  maxDownloads: z.number().int().positive().max(10_000).nullable().optional(),
  password: z.string().min(1).max(100).nullable().optional(),
});

async function canShareDocument(u: { id: string; role: string }, documentId: string) {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, deletedAt: null },
    select: { id: true, authorId: true, projectId: true, fileUrl: true, fileName: true, title: true },
  });
  if (!doc) return null;
  if (u.role === "ADMIN" || doc.authorId === u.id) return doc;
  if (doc.projectId) {
    const m = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: doc.projectId, userId: u.id } },
      select: { id: true },
    });
    if (m) return doc;
  }
  return null;
}

authed.post("/", async (req, res) => {
  const u = (req as any).user;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const d = parsed.data;
  const doc = await canShareDocument(u, d.documentId);
  if (!doc) return res.status(403).json({ error: "해당 문서에 대한 공유 권한이 없습니다" });
  if (!doc.fileUrl) return res.status(400).json({ error: "파일이 첨부된 문서만 공유 링크를 만들 수 있어요" });

  // 추측 불가 32바이트 토큰 — URL-safe base64.
  const token = crypto.randomBytes(24).toString("base64url");
  const link = await prisma.documentShareLink.create({
    data: {
      documentId: doc.id,
      token,
      createdById: u.id,
      expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
      maxDownloads: d.maxDownloads ?? null,
      passwordHash: d.password ? await bcrypt.hash(d.password, 12) : null,
    },
  });
  await writeLog(u.id, "SHARE_LINK_CREATE", link.id, doc.id);
  res.json({ link: serialize(link) });
});

authed.get("/", async (req, res) => {
  const u = (req as any).user;
  const documentId = String(req.query.documentId ?? "");
  if (!documentId) return res.status(400).json({ error: "documentId 필요" });
  const doc = await canShareDocument(u, documentId);
  if (!doc) return res.status(403).json({ error: "forbidden" });
  const rows = await prisma.documentShareLink.findMany({
    where: { documentId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ links: rows.map(serialize) });
});

authed.delete("/:id", async (req, res) => {
  const u = (req as any).user;
  const row = await prisma.documentShareLink.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: "not found" });
  if (row.createdById !== u.id && u.role !== "ADMIN")
    return res.status(403).json({ error: "forbidden" });
  // 하드 삭제 대신 revokedAt 스탬프 — 감사 로그는 유지.
  await prisma.documentShareLink.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  await writeLog(u.id, "SHARE_LINK_REVOKE", row.id);
  res.json({ ok: true });
});

function serialize(l: any) {
  return {
    id: l.id,
    token: l.token,
    documentId: l.documentId,
    createdAt: l.createdAt,
    expiresAt: l.expiresAt,
    maxDownloads: l.maxDownloads,
    downloads: l.downloads,
    hasPassword: !!l.passwordHash,
    revokedAt: l.revokedAt,
  };
}

/* =============== 공개 라우터 (인증 불필요) =============== */
const pub = Router();

async function findActive(token: string) {
  const link = await prisma.documentShareLink.findUnique({
    where: { token },
    include: { document: { select: { title: true, fileName: true, fileUrl: true, fileType: true, fileSize: true } } },
  });
  if (!link) return { err: 404 as const, link: null };
  if (link.revokedAt) return { err: 410 as const, link: null };
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return { err: 410 as const, link: null };
  if (link.maxDownloads !== null && link.downloads >= link.maxDownloads) return { err: 429 as const, link: null };
  return { err: null, link };
}

pub.get("/:token", async (req, res) => {
  // 폴더 링크 먼저 확인 (토큰 충돌 없음 — 두 테이블 모두 unique)
  const folderResult = await findActiveFolderLink(req.params.token);
  if (folderResult.link) {
    const fl = folderResult.link;
    const hasPassword = !!fl.passwordHash;
    return res.json({
      // 비밀번호 보호 링크는 인증 전에 파일명·형식을 노출하지 않음.
      document: hasPassword ? null : {
        title: fl.folder.name,
        fileName: `${fl.folder.name}.zip`,
        fileType: "application/zip",
        fileSize: null,
      },
      kind: "folder",
      expiresAt: fl.expiresAt,
      maxDownloads: fl.maxDownloads,
      downloads: fl.downloads,
      hasPassword,
    });
  }
  if (folderResult.err && folderResult.err !== 404) {
    return res.status(folderResult.err).json({ error: statusMsg(folderResult.err) });
  }

  const r = await findActive(req.params.token);
  if (r.err) return res.status(r.err).json({ error: statusMsg(r.err) });
  const link = r.link!;
  const hasPassword = !!link.passwordHash;
  res.json({
    // 비밀번호 보호 링크는 인증 전에 문서 제목·파일명 등을 노출하지 않음.
    document: hasPassword ? null : {
      title: link.document.title,
      fileName: link.document.fileName,
      fileType: link.document.fileType,
      fileSize: link.document.fileSize,
    },
    kind: "document",
    expiresAt: link.expiresAt,
    maxDownloads: link.maxDownloads,
    downloads: link.downloads,
    hasPassword,
  });
});

pub.post("/:token/download", async (req, res) => {
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  // 폴더 링크 처리
  const folderResult = await findActiveFolderLink(req.params.token);
  if (folderResult.link) {
    const fl = folderResult.link;
    if (fl.passwordHash) {
      const ok = await bcrypt.compare(password, fl.passwordHash);
      if (!ok) return res.status(401).json({ error: "비밀번호가 올바르지 않아요" });
    }
    // 원자적 카운트 증가 — 동시 요청이 maxDownloads 를 초과하는 것을 DB 레벨에서 차단
    const folderWhere: any = { id: fl.id, revokedAt: null };
    if (fl.maxDownloads !== null) folderWhere.downloads = { lt: fl.maxDownloads };
    const folderUpdated = await prisma.folderShareLink.updateMany({
      where: folderWhere,
      data: { downloads: { increment: 1 } },
    });
    if (folderUpdated.count === 0) {
      return res.status(429).json({ error: statusMsg(429) });
    }
    return streamFolderZip(fl.folder.id, fl.folder.name, res);
  }
  if (folderResult.err && folderResult.err !== 404) {
    return res.status(folderResult.err).json({ error: statusMsg(folderResult.err) });
  }

  // 문서 링크 처리
  const r = await findActive(req.params.token);
  if (r.err) return res.status(r.err).json({ error: statusMsg(r.err) });
  const link = r.link!;
  if (link.passwordHash) {
    const ok = await bcrypt.compare(password, link.passwordHash);
    if (!ok) {
      await prisma.shareLinkAccess.create({
        data: { companyId: link.companyId, linkId: link.id, action: "AUTH_FAIL", ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 200) },
      });
      return res.status(401).json({ error: "비밀번호가 올바르지 않아요" });
    }
  }
  if (!link.document.fileUrl) return res.status(404).json({ error: "파일이 없어요" });
  const key = link.document.fileUrl.replace(/^\/uploads\//, "");
  const buf = await readFile(key);
  if (!buf) return res.status(404).json({ error: "파일을 찾을 수 없어요" });

  // 원자적 카운트 증가 — updateMany + WHERE 조건으로 동시 요청이 maxDownloads 를 초과하는 것을 방지.
  // count === 0 이면 다른 요청이 먼저 한도를 채웠음을 의미.
  const docWhere: any = { id: link.id, revokedAt: null };
  if (link.maxDownloads !== null) docWhere.downloads = { lt: link.maxDownloads };
  const docUpdated = await prisma.documentShareLink.updateMany({
    where: docWhere,
    data: { downloads: { increment: 1 } },
  });
  if (docUpdated.count === 0) {
    return res.status(429).json({ error: statusMsg(429) });
  }

  await prisma.shareLinkAccess.create({
    data: { companyId: link.companyId, linkId: link.id, action: "DOWNLOAD", ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 200) },
  });

  const fileName = link.document.fileName ?? link.document.title ?? "download";
  res.setHeader("Content-Type", link.document.fileType || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.send(buf);
});

async function readFile(key: string): Promise<Buffer | null> {
  // path traversal 2차 방어 — key 는 반드시 안전한 문자만, ../ 같은 게 끼면 거부.
  // (1차 방어는 docSchema.fileUrl regex; DB 에 과거 데이터가 남아있을 수 있어 여기서 또 막는다.)
  if (!/^[A-Za-z0-9._-]+$/.test(key)) return null;
  if (isStorageEnabled()) {
    const f = await downloadFile(key);
    if (f) return f.buffer;
  }
  const diskPath = path.join(UPLOAD_DIR, key);
  // 한 번 더: 절대경로 resolve 후 UPLOAD_DIR 밖이면 거부.
  const resolved = path.resolve(diskPath);
  const uploadDirResolved = path.resolve(UPLOAD_DIR);
  if (!resolved.startsWith(uploadDirResolved + path.sep) && resolved !== uploadDirResolved) {
    return null;
  }
  if (fs.existsSync(resolved)) return fs.promises.readFile(resolved);
  return null;
}

function statusMsg(code: 404 | 410 | 429) {
  if (code === 404) return "링크를 찾을 수 없어요";
  if (code === 410) return "만료됐거나 취소된 링크예요";
  return "다운로드 한도를 초과했어요";
}

export { authed as shareLinkAuthedRouter, pub as shareLinkPublicRouter };
