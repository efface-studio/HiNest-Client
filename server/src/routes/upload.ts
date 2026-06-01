import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { requireAuth } from "../lib/auth.js";
import { isStorageEnabled, uploadFile } from "../lib/storage.js";

/**
 * 업로드 플로우.
 *  1. multer 는 memoryStorage — 파일을 메모리로만 받는다 (디스크 미경유).
 *  2. Supabase Storage 활성화 시 → 버킷에 올림. URL 은 /uploads/<key> 로 반환해
 *     기존 클라이언트 코드·DB 저장값이 그대로 유지됨. 실제 파일은 서버가 프록시해서 내려줌.
 *  3. 비활성화 시 (로컬 dev) → 과거와 동일하게 uploads/ 디렉터리에 파일 기록.
 *
 * Fargate/컨테이너 로컬 디스크는 재시작 시 휘발성이므로 프로덕션은 반드시 Supabase 경로를 쓴다.
 */

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// multer는 multipart 파일명을 latin1로 해석해서 한글이 깨짐 → UTF-8로 복원
function fixName(name: string) {
  if (!name) return name;
  try {
    return Buffer.from(name, "latin1").toString("utf8");
  } catch {
    return name;
  }
}

// XSS 위험이 있는 타입/확장자는 업로드 차단 (HTML/JS/XML 등).
// 같은 origin 에서 서빙되기 때문에 이런 파일을 클릭하면 쿠키/세션에 접근 가능.
//
// SVG 는 예전엔 막혀있었지만 /uploads 서빙 경로에 이미
// `Content-Security-Policy: default-src 'none'; sandbox` + `X-Content-Type-Options: nosniff`
// 가 걸려있어 SVG 내부 스크립트/외부 리소스 로드가 전부 차단됨 → 허용해도 안전.
// (디자이너 아이콘/로고 업로드 수요 때문에 열어둠.)
const BLOCKED_EXTS = new Set([
  ".html", ".htm", ".xhtml", ".xml", ".js", ".mjs", ".cjs",
  ".php", ".phtml", ".jsp", ".asp", ".aspx", ".sh", ".bat", ".cmd",
  ".exe", ".dll", ".app", ".jar",
]);
const BLOCKED_MIME_PREFIXES = [
  "text/html", "application/xhtml", "application/javascript",
  "text/javascript", "application/x-javascript", "application/xml", "text/xml",
];

function safeExt(name: string) {
  // 경로 분리자 제거 + 확장자만 추출
  const base = path.basename(name || "");
  return path.extname(base).toLowerCase();
}

// 메모리 스토리지 — 용도별로 한도가 다름.
//  - 채팅/범용(`/api/upload`)       : 100MB
//  - 문서함  (`/api/upload/document`) : 500MB (큰 파일이 자주 오가는 문서함 전용)
// 참고: memoryStorage 는 전체 파일을 RAM 에 올려두므로, 500MB 동시 업로드가 겹치면
//       Fargate 태스크 RAM(현재 설정 확인 필요) 을 초과할 위험이 있음. 더 키우고 싶다면
//       S3 multipart presigned URL 로 브라우저 → S3 직업로드 경로로 바꾸는 게 정석.
const storage = multer.memoryStorage();

function buildUploader(maxBytes: number) {
  return multer({
    storage,
    limits: { fileSize: maxBytes },
    fileFilter: (_req: any, file: any, cb: any) => {
      const ext = safeExt(fixName(file.originalname || ""));
      if (BLOCKED_EXTS.has(ext)) {
        return cb(new Error(`허용되지 않는 파일 형식입니다 (${ext})`));
      }
      const mime = String(file.mimetype || "").toLowerCase();
      if (BLOCKED_MIME_PREFIXES.some((p) => mime.startsWith(p))) {
        return cb(new Error(`허용되지 않는 MIME 형식입니다 (${mime})`));
      }
      cb(null, true);
    },
  });
}

const uploadChat     = buildUploader(100 * 1024 * 1024); // 100MB
const uploadDocument = buildUploader(500 * 1024 * 1024); // 500MB

const router = Router();
router.use(requireAuth);

// 업로드 후 스토리지에 저장하고 JSON 으로 URL/메타데이터를 내려주는 공용 핸들러.
async function storeAndRespond(req: any, res: any) {
  const f = (req as any).file as {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
  } | undefined;
  if (!f) return res.status(400).json({ error: "no file" });

  const originalName = fixName(f.originalname);
  const ext = safeExt(originalName);
  const id = crypto.randomBytes(12).toString("hex");
  const key = `${Date.now()}-${id}${ext}`;
  const mime = String(f.mimetype || "application/octet-stream");

  try {
    if (isStorageEnabled()) {
      await uploadFile(key, f.buffer, mime);
    } else {
      // dev fallback — 디스크 기록 (프로덕션은 Supabase 경로를 반드시 씀)
      await fs.promises.writeFile(path.join(UPLOAD_DIR, key), f.buffer);
    }
  } catch (e: any) {
    console.error("[upload] failed", e);
    return res.status(500).json({ error: "업로드 저장 실패" });
  }

  let kind: "IMAGE" | "VIDEO" | "FILE" = "FILE";
  if (mime.startsWith("image/")) kind = "IMAGE";
  else if (mime.startsWith("video/")) kind = "VIDEO";

  res.json({
    url: `/uploads/${key}`,
    name: originalName,
    type: mime,
    size: f.size,
    kind,
  });
}

// multer 미들웨어에서 발생한 에러(파일 크기 초과 등)를 400 JSON 으로 돌려준다.
function runUploader(uploader: ReturnType<typeof buildUploader>) {
  return (req: any, res: any, next: any) => {
    uploader.single("file")(req, res, (err: any) => {
      if (err) {
        return res.status(400).json({ error: err.message ?? "업로드 실패" });
      }
      next();
    });
  };
}

// 문서함 전용(500MB) — 반드시 범용 라우트보다 먼저 선언해야 `/` 매치보다 앞섬.
router.post("/document", runUploader(uploadDocument), storeAndRespond);

// 채팅/범용(100MB) — 기존 `/api/upload` 를 그대로 유지해 채팅 클라 변경 불필요.
router.post("/", runUploader(uploadChat), storeAndRespond);

export default router;
export { UPLOAD_DIR };
