import crypto from "node:crypto";

/**
 * 서비스 계정 비밀번호 같은 짧은 문자열을 저장용으로 암호화/복호화.
 *
 * 키는 env `ACCOUNT_ENC_KEY` — base64 로 32바이트 (권장: `openssl rand -base64 32`).
 *   - 짧거나 base64 가 아니면 sha256 으로 파생시켜 32바이트를 맞춘다 (운영 실수 방어).
 *   - 키가 완전히 비어있으면 export 된 함수가 null 을 던져 라우트에서 400 응답.
 *
 * 포맷: `v1:<iv_b64>:<tag_b64>:<ct_b64>` — AES-256-GCM.
 * 길이 상한: 저장 전 평문 1024B(~= 비밀번호 한도) — 그 이상은 400 으로 거절.
 */

const ALGO = "aes-256-gcm";
const MAX_PLAINTEXT = 1024;

function resolveKey(): Buffer | null {
  const raw = process.env.ACCOUNT_ENC_KEY;
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, "base64");
    if (buf.length === 32) return buf;
  } catch {}
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function hasSecretKey(): boolean {
  return resolveKey() !== null;
}

export function encryptSecret(plaintext: string): string {
  const key = resolveKey();
  if (!key) throw new Error("ACCOUNT_ENC_KEY 가 설정되어 있지 않아요. 비밀번호 저장 기능을 사용할 수 없습니다.");
  if (plaintext.length === 0) throw new Error("빈 값은 저장할 수 없어요.");
  if (Buffer.byteLength(plaintext, "utf8") > MAX_PLAINTEXT) {
    throw new Error("비밀번호가 너무 길어요.");
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(blob: string): string {
  const key = resolveKey();
  if (!key) throw new Error("ACCOUNT_ENC_KEY 가 설정되어 있지 않아요.");
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("잘못된 암호문 포맷이에요.");
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ct = Buffer.from(parts[3], "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
