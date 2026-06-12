import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  NoSuchKey,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";

/**
 * 파일 업로드 저장소 래퍼.
 *
 * 2026-04 이관: **Supabase Storage → AWS S3 (ap-northeast-2 Seoul)**
 * 공개 인터페이스(uploadFile / downloadFile / deleteFile) 는 그대로. 라우트 코드 수정 불필요.
 *
 * 우선순위 (모두 환경변수 자동 감지):
 *  1) **S3 활성 시**: 신규 업로드는 무조건 S3. 다운로드도 S3 부터 시도.
 *  2) **Supabase 활성 시 (마이그레이션 기간)**: S3 다운로드에서 404 면 Supabase 로 fallback.
 *     → 마이그레이션 스크립트 돌기 전에 업로드됐던 파일도 404 안 뜨고 계속 내려줌.
 *     → 전부 이관 끝난 뒤 (보통 1~2주) SUPABASE_* env 를 제거해 완전히 S3 전용.
 *  3) **둘 다 없을 시 (로컬 dev)**: `isStorageEnabled()` 가 false → upload 라우트가 디스크 경로로 fallback.
 *
 * 왜: Fargate/컨테이너 로컬 디스크는 재시작 시 휘발성이라 프로덕션에선 오브젝트 스토리지 필수.
 * 서버 프록시 방식(= /uploads/:key 로 서버 거쳐서 다운로드) 은 CSP/인증/Content-Disposition
 * 방어선을 유지하기 위해 그대로 둠. 클라이언트가 직접 presigned URL 로 가는 구성은 다음 단계.
 */

/* ──────────────────────────────────────────────────────────────────────────── */
/* S3 (신규 primary)                                                             */
/* ──────────────────────────────────────────────────────────────────────────── */
const S3_REGION = process.env.AWS_REGION?.trim();
const S3_BUCKET = process.env.S3_BUCKET?.trim();
const S3_ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID?.trim();
const S3_SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY?.trim();

// S3 활성 조건: region + bucket 은 반드시. 자격증명은 2가지 경로 지원.
//  1) 정적 키 (AWS_ACCESS_KEY_ID / SECRET) — 로컬 개발, 외부 PaaS
//  2) IAM 역할 (ECS Task Role, EC2 Instance Profile) — SDK 가 메타데이터 서비스에서 자동 회수
// 2번은 환경변수가 없어도 되므로, 여기선 region+bucket 만 보고 S3 클라이언트를 생성.
// 키가 있으면 명시 주입, 없으면 SDK default credential chain 에 맡김 (ECS → task role).
let s3: S3Client | null = null;
if (S3_REGION && S3_BUCKET) {
  s3 = new S3Client({
    region: S3_REGION,
    ...(S3_ACCESS_KEY && S3_SECRET_KEY
      ? {
          credentials: {
            accessKeyId: S3_ACCESS_KEY,
            secretAccessKey: S3_SECRET_KEY,
          },
        }
      : {}),
  });
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* Supabase (레거시 fallback — 이관 기간에만 필요)                               */
/* ──────────────────────────────────────────────────────────────────────────── */
const SB_URL = process.env.SUPABASE_URL?.trim();
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const SB_BUCKET = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "hinest-uploads";

let supabase: SupabaseClient | null = null;
if (SB_URL && SB_KEY) {
  supabase = createClient(SB_URL, SB_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* Public API                                                                    */
/* ──────────────────────────────────────────────────────────────────────────── */

export function isStorageEnabled(): boolean {
  return !!s3 || !!supabase;
}

/** 파일 저장. 신규 업로드는 S3 우선. */
export async function uploadFile(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  if (s3) {
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET as string,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: "max-age=86400",
      })
    );
    return;
  }
  if (supabase) {
    const { error } = await supabase.storage.from(SB_BUCKET).upload(key, body, {
      contentType,
      upsert: false,
      cacheControl: "86400",
    });
    if (error) throw new Error(`storage upload: ${error.message}`);
    return;
  }
  throw new Error("storage disabled");
}

/**
 * 스트림/Buffer 로 내려받기. S3 → Supabase 순서로 시도.
 * 둘 다 없거나 둘 다에 없으면 null.
 */
export async function downloadFile(key: string): Promise<{
  buffer: Buffer;
  contentType: string;
  size: number;
} | null> {
  // 1) S3
  if (s3) {
    try {
      const res = await s3.send(
        new GetObjectCommand({ Bucket: S3_BUCKET as string, Key: key })
      );
      const buffer = await streamToBuffer(res.Body as Readable);
      return {
        buffer,
        contentType: res.ContentType || "application/octet-stream",
        size: buffer.byteLength,
      };
    } catch (e: any) {
      // 404 인 경우만 Supabase fallback 으로 흘림. 그 외 에러는 throw.
      const is404 =
        e instanceof NoSuchKey ||
        e?.name === "NoSuchKey" ||
        e?.$metadata?.httpStatusCode === 404;
      if (!is404) throw e;
    }
  }

  // 2) Supabase (레거시)
  if (supabase) {
    const { data, error } = await supabase.storage.from(SB_BUCKET).download(key);
    if (error || !data) return null;
    const ab = await data.arrayBuffer();
    return {
      buffer: Buffer.from(ab),
      contentType: data.type || "application/octet-stream",
      size: ab.byteLength,
    };
  }

  return null;
}

/**
 * 다운로드용 presigned URL — 클라이언트가 ECS 를 거치지 않고 스토리지(S3/Supabase CDN)에서 직접
 * 받게 한다(서버 버퍼링·프록시 hop 제거로 속도 대폭 향상). 만료 짧게(기본 5분).
 *
 *  - downloadName 지정 시: 첨부(attachment)로 그 파일명 강제(Content-Disposition).
 *  - downloadName 미지정 시: inline(브라우저 미리보기).
 * 키가 어느 백엔드에도 없으면 null(호출부가 기존 버퍼 스트림으로 폴백).
 */
export async function getSignedDownloadUrl(
  key: string,
  opts: { downloadName?: string | null; contentType?: string | null; expiresIn?: number } = {}
): Promise<string | null> {
  const expiresIn = opts.expiresIn ?? 300;
  // ⚠️ Content-Disposition 헤더는 ISO-8859-1 만 허용한다(S3 가 한글 등 비-ASCII 가 들어가면
  // InvalidArgument 로 거부). 따라서 plain filename="..." 은 ASCII 로 치환한 폴백을 쓰고, 실제 원본명은
  // RFC 5987 filename*=UTF-8''<percent-encoded> 로 전달한다(최신 브라우저·OS 가 이걸 우선 사용).
  const disposition = opts.downloadName
    ? (() => {
        const asciiFallback = opts.downloadName!
          .replace(/[^\x20-\x7E]/g, "_") // 비-ASCII → _
          .replace(/["\\]/g, "_");
        return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(opts.downloadName!)}`;
      })()
    : "inline";

  // 1) S3 presigned GET — ResponseContentDisposition 으로 파일명/inline 제어.
  if (s3) {
    try {
      const cmd = new GetObjectCommand({
        Bucket: S3_BUCKET as string,
        Key: key,
        ResponseContentDisposition: disposition,
        ...(opts.contentType ? { ResponseContentType: opts.contentType } : {}),
      });
      // s3 캐스팅 — client-s3 와 presigner 의 S3Client 타입이 중복 선언돼 TS 가 비호환으로 보지만
      // 런타임은 동일 인스턴스라 안전(흔한 AWS SDK 버전 타입 이슈).
      return await getSignedUrl(s3 as any, cmd as any, { expiresIn });
    } catch {
      /* 키 없음/실패 → Supabase 시도 */
    }
  }

  // 2) Supabase signed URL — download 옵션에 파일명을 주면 attachment.
  if (supabase) {
    const { data, error } = await supabase.storage
      .from(SB_BUCKET)
      .createSignedUrl(key, expiresIn, opts.downloadName ? { download: opts.downloadName } : undefined);
    if (!error && data?.signedUrl) return data.signedUrl;
  }

  return null;
}

/** 삭제. 양쪽 모두에서 (있는 쪽만) 지움. 없는 객체 삭제 에러는 무시. */
export async function deleteFile(key: string): Promise<void> {
  if (s3) {
    await s3
      .send(new DeleteObjectCommand({ Bucket: S3_BUCKET as string, Key: key }))
      .catch(() => {});
  }
  if (supabase) {
    await supabase.storage
      .from(SB_BUCKET)
      .remove([key])
      .catch(() => {});
  }
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* 내부 helper                                                                   */
/* ──────────────────────────────────────────────────────────────────────────── */

/** AWS SDK v3 의 GetObject 응답 Body 는 Node 환경에서 Readable 스트림. */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}
