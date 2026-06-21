import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { requireAuth } from "../lib/auth.js";
import { isStorageEnabled, uploadFileFromPath } from "../lib/storage.js";

/**
 * 업로드 플로우.
 *  1. multer 는 diskStorage — 파일을 디스크 임시파일로 받는다 (RAM 미경유 → 대용량 OOM 방지).
 *  2. Supabase Storage 활성화 시 → 버킷에 올림. URL 은 /uploads/<key> 로 반환해
 *     기존 클라이언트 코드·DB 저장값이 그대로 유지됨. 실제 파일은 서버가 프록시해서 내려줌.
 *  3. 비활성화 시 (로컬 dev) → 과거와 동일하게 uploads/ 디렉터리에 파일 기록.
 *
 * Fargate/컨테이너 로컬 디스크는 재시작 시 휘발성이므로 프로덕션은 반드시 Supabase 경로를 쓴다.
 */

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 업로드 임시 디렉터리 — multer 가 파일을 RAM 대신 디스크로 받기 위함(아래 diskStorage).
// UPLOAD_DIR 하위에 둬서 dev fallback 의 rename(임시→uploads)이 같은 파일시스템에서 동작.
const TMP_DIR = path.join(UPLOAD_DIR, ".tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// multer는 multipart 파일명을 latin1로 해석해서 한글이 깨짐 → UTF-8로 복원
function fixName(name: string) {
  if (!name) return name;
  // multer/busboy 는 파일명을 브라우저가 보낸 방식에 따라 latin1(구식 `filename=`) 또는
  // UTF-8(`filename*=UTF-8''`, 모던 브라우저)로 디코딩한다. 전자만 latin1→utf8 복원이 필요하고,
  // 후자(이미 올바른 한글)에 복원을 또 하면 "ë³´ê³ ì„œ" 처럼 깨진다(다운로드 이름이 이상해지는 원인).
  // → latin1 상위바이트(0x80–0xFF)가 있고 UTF-8 재해석이 유효할 때만 복원, 아니면 원본 유지.
  try {
    if (!/[-ÿ]/.test(name)) return name; // ASCII / 이미 정상 UTF-8(코드포인트>0xFF) → 그대로
    const decoded = Buffer.from(name, "latin1").toString("utf8");
    return decoded.includes("�") ? name : decoded; // 복원 결과가 깨지면 원본 유지
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

// 용도별 업로드 한도.
//  - 채팅/범용(`/api/upload`)       : 500MB (채팅·메모)
//  - 문서함  (`/api/upload/document`) : 2GB (큰 영상 등 — diskStorage 스트리밍이라 RAM 안전)
//
// diskStorage 사용(과거 memoryStorage 가 OOM 원인). memoryStorage 는 파일 전체를 RAM 에
// 들고 있어, 대용량(수백 MB) 파일을 동시에 여러 개 올리면 Fargate 태스크 RAM 을 초과해
// 프로세스가 죽고(→ 502/연결 끊김) 업로드 배치 전체가 실패했다. diskStorage 로 임시파일에
// 받은 뒤 S3 로 스트리밍(createReadStream)하면 파일 크기·동시성과 무관하게 RAM 이 안정적이다.
const storage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => cb(null, TMP_DIR),
  filename: (_req: any, _file: any, cb: any) =>
    cb(null, `up-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`),
});

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

const uploadChat     = buildUploader(500 * 1024 * 1024);  // 500MB (채팅·메모)
const uploadDocument = buildUploader(2048 * 1024 * 1024); // 2GB (문서함 — 대용량 영상)

const router = Router();
router.use(requireAuth);

// 업로드 후 스토리지에 저장하고 JSON 으로 URL/메타데이터를 내려주는 공용 핸들러.
async function storeAndRespond(req: any, res: any) {
  const f = (req as any).file as {
    path: string;
    originalname: string;
    mimetype: string;
    size: number;
  } | undefined;
  if (!f) return res.status(400).json({ error: "no file" });

  const originalName = fixName(f.originalname);
  const ext = safeExt(originalName);
  const id = crypto.randomBytes(12).toString("hex");
  const base = `${Date.now()}-${id}${ext}`;
  // 신규 키에 업로더의 companyId 를 `cmp_<companyId>__` 접두어로 박는다 — 다운로드 시
  // 다른 회사 유저의 접근을 차단(테넌트 격리)하기 위함. 검사는 /uploads 핸들러
  // (index.ts canAccessUploadKey)에서 한다.
  // cuid companyId 는 [a-z0-9]+ 라 파일명 규칙(/^[A-Za-z0-9._-]+$/)·SAFE_UPLOAD_URL 을 그대로 통과.
  // companyId 가 없거나(플랫폼 운영자) 형식이 어긋나면 접두어 없이 발급 → legacy(인증만) 동작.
  const cid = (req as any).user?.companyId;
  const key =
    typeof cid === "string" && /^[A-Za-z0-9]+$/.test(cid)
      ? `cmp_${cid}__${base}`
      : base;
  const mime = String(f.mimetype || "application/octet-stream");

  try {
    if (isStorageEnabled()) {
      // 임시파일에서 스토리지로 스트리밍 업로드 (S3 는 RAM 미사용).
      await uploadFileFromPath(key, f.path, f.size, mime);
    } else {
      // dev fallback — 임시파일을 uploads/ 로 이동 (같은 FS 라 rename, 버퍼 미사용).
      await fs.promises.rename(f.path, path.join(UPLOAD_DIR, key));
    }
  } catch (e: any) {
    console.error("[upload] failed", e);
    return res.status(500).json({ error: "업로드 저장 실패" });
  } finally {
    // 임시파일 정리 — S3/Supabase 경로는 업로드 후 삭제, dev rename 경로는 이미 옮겨져 없음(무시).
    fs.promises.unlink(f.path).catch(() => {});
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
        // 크기 초과 등으로 실패하면 multer 가 남긴 임시파일을 정리한다.
        const p = (req as any).file?.path;
        if (p) fs.promises.unlink(p).catch(() => {});
        return res.status(400).json({ error: err.message ?? "업로드 실패" });
      }
      next();
    });
  };
}

// 문서함 전용(2GB) — 반드시 범용 라우트보다 먼저 선언해야 `/` 매치보다 앞섬.
router.post("/document", runUploader(uploadDocument), storeAndRespond);

// 채팅/범용(500MB) — 기존 `/api/upload` 를 그대로 유지해 채팅 클라 변경 불필요.
router.post("/", runUploader(uploadChat), storeAndRespond);

export default router;
export { UPLOAD_DIR };
