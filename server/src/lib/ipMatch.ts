/**
 * IP 주소 ↔ CIDR 매칭 유틸 — 회사 출근 IP 화이트리스트 검사용.
 *
 * 의존성 없이 IPv4/IPv6 둘 다 처리. 단일 IP 도 "/32"(IPv4) / "/128"(IPv6) 로 정규화해 동일 코드패스.
 * trust proxy=1 환경에서 req.ip 는 ALB X-Forwarded-For 의 첫 클라이언트 IP — 이걸 normalize 후 매칭.
 */

/** "::ffff:1.2.3.4" 같은 IPv4-mapped IPv6 를 순수 IPv4 로 푼다. 아니면 그대로. */
export function normalizeClientIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const s = ip.trim();
  if (!s) return null;
  // IPv4-mapped IPv6
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s);
  if (m) return m[1];
  return s;
}

/** "192.168.1.0/24" → { kind:'v4', addr:Uint8Array, prefix:24 } */
type CIDR =
  | { kind: "v4"; bytes: Uint8Array; prefix: number }
  | { kind: "v6"; bytes: Uint8Array; prefix: number };

function ipv4ToBytes(ip: string): Uint8Array | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const n = Number(parts[i]);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out[i] = n;
  }
  return out;
}

function ipv6ToBytes(ip: string): Uint8Array | null {
  // 매우 단순 파서 — :: 압축 + 16비트 그룹. embedded IPv4 (예: ::ffff:1.2.3.4) 도 처리.
  try {
    let s = ip.toLowerCase();
    // IPv4-embedded 변환 — "::ffff:1.2.3.4" 의 끝 IPv4 를 2개 16진 그룹으로
    const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (tail) {
      const b = ipv4ToBytes(tail[1]);
      if (!b) return null;
      const hi = (b[0] << 8) | b[1];
      const lo = (b[2] << 8) | b[3];
      s = s.slice(0, tail.index) + hi.toString(16) + ":" + lo.toString(16);
    }
    const parts = s.split("::");
    if (parts.length > 2) return null;
    const left = parts[0] ? parts[0].split(":") : [];
    const right = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
    const zerosNeeded = 8 - (left.length + right.length);
    if (zerosNeeded < 0) return null;
    const groups = [...left, ...new Array(zerosNeeded).fill("0"), ...right];
    if (groups.length !== 8) return null;
    const out = new Uint8Array(16);
    for (let i = 0; i < 8; i++) {
      const n = parseInt(groups[i] || "0", 16);
      if (!Number.isInteger(n) || n < 0 || n > 0xffff) return null;
      out[i * 2] = (n >> 8) & 0xff;
      out[i * 2 + 1] = n & 0xff;
    }
    return out;
  } catch {
    return null;
  }
}

/** CIDR 문자열을 파싱 — 잘못된 형식이면 null. 단일 IP 도 허용(=/32 또는 /128). */
export function parseCidr(input: string): CIDR | null {
  const s = input.trim();
  if (!s) return null;
  const [addr, maskStr] = s.includes("/") ? s.split("/") : [s, ""];
  if (addr.includes(".")) {
    const bytes = ipv4ToBytes(addr);
    if (!bytes) return null;
    const prefix = maskStr === "" ? 32 : Number(maskStr);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
    return { kind: "v4", bytes, prefix };
  }
  if (addr.includes(":")) {
    const bytes = ipv6ToBytes(addr);
    if (!bytes) return null;
    const prefix = maskStr === "" ? 128 : Number(maskStr);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return null;
    return { kind: "v6", bytes, prefix };
  }
  return null;
}

/** 사용자 입력 CIDR 검증(유효성만). */
export function isValidCidr(input: string): boolean {
  return parseCidr(input) !== null;
}

/** ip(평문) 가 CIDR 안에 속하는가. */
function ipInCidr(ip: string, c: CIDR): boolean {
  const bytes = c.kind === "v4" ? ipv4ToBytes(ip) : ipv6ToBytes(ip);
  if (!bytes || bytes.length !== c.bytes.length) return false;
  let bitsLeft = c.prefix;
  for (let i = 0; i < bytes.length && bitsLeft > 0; i++) {
    const take = Math.min(8, bitsLeft);
    const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
    if ((bytes[i] & mask) !== (c.bytes[i] & mask)) return false;
    bitsLeft -= take;
  }
  return true;
}

/** ip 가 cidrs 중 하나라도 매치되면 true. cidrs 가 비어있으면 false(통과 안 함). */
export function ipMatchesAny(ip: string, cidrs: string[]): boolean {
  if (!cidrs.length) return false;
  for (const raw of cidrs) {
    const c = parseCidr(raw);
    if (c && ipInCidr(ip, c)) return true;
  }
  return false;
}
