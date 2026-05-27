import { Router } from "express";
import { z } from "zod";
import { lookup } from "node:dns/promises";
import { requireAuth } from "../lib/auth.js";

/**
 * URL 메타데이터(Open Graph / Twitter Card / 기본 <title>) 추출 — 링크 프리뷰용.
 *
 * 보안:
 *  - 인증 필수 — 무한 SSRF 우회 방지.
 *  - 사설망/메타데이터 IP 차단 (10.*, 172.16-31.*, 192.168.*, 127.*, 169.254.*, ::1).
 *  - http(s) 만 허용. file://, data:, ftp:// 거부.
 *  - 응답 본문 1MB 상한, 5초 타임아웃.
 *  - 내부에서 인메모리 LRU 30분 캐시.
 *
 * 응답: { url, title, description?, image?, siteName?, favicon? }
 */

const router = Router();
router.use(requireAuth);

const schema = z.object({
  url: z.string().url().max(2048),
});

type Meta = {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
};

const cache = new Map<string, { data: Meta; expires: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 500;

function cacheGet(k: string): Meta | null {
  const e = cache.get(k);
  if (!e) return null;
  if (Date.now() > e.expires) {
    cache.delete(k);
    return null;
  }
  return e.data;
}
function cacheSet(k: string, v: Meta) {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(k, { data: v, expires: Date.now() + CACHE_TTL_MS });
}

/** 사설망 / loopback / link-local 호스트명 차단(1차).
 *  실제 SSRF 방어는 아래 isBlockedIp + assertHostSafe 로 DNS resolve 결과까지 검증. */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "metadata.google.internal") return true; // GCP IMDS
  if (h === "metadata.goog") return true;
  return false;
}

/** v4 / v6 모두 커버하는 사설·loopback·link-local·ULA·CGNAT 검사.
 *  Fargate 의 ECS Task Metadata(169.254.170.2), AWS IMDS(169.254.169.254) 모두 link-local 로 잡힘. */
function isBlockedIp(addr: string, family: 4 | 6): boolean {
  if (family === 4) {
    const m = addr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return true; // 파싱 실패 → 안전하게 차단
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0) return true; // "this network"
    if (a === 10) return true; // RFC1918
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local (IMDS 포함)
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  // v6
  const v = addr.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("fe80:")) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(v)) return true; // ULA
  if (v.startsWith("ff")) return true; // multicast
  // IPv4-mapped: ::ffff:a.b.c.d → 안쪽 v4 로 재검사
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIp(mapped[1], 4);
  return false;
}

/** hostname 을 DNS resolve 해서 모든 IP 가 public 인지 검증. 하나라도 사설/loopback 이면 throw. */
async function assertHostSafe(hostname: string): Promise<void> {
  if (isBlockedHost(hostname)) throw new Error("host not allowed");
  // IP 리터럴이면 그 자체로 검사
  const ipLiteralV4 = /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
  const ipLiteralV6 = hostname.includes(":");
  if (ipLiteralV4) {
    if (isBlockedIp(hostname, 4)) throw new Error("host not allowed");
    return;
  }
  if (ipLiteralV6) {
    if (isBlockedIp(hostname.replace(/^\[|\]$/g, ""), 6)) throw new Error("host not allowed");
    return;
  }
  const addrs = await lookup(hostname, { all: true });
  if (!addrs.length) throw new Error("host not allowed");
  for (const { address, family } of addrs) {
    if (isBlockedIp(address, family as 4 | 6)) throw new Error("host not allowed");
  }
}

const META_RE = /<meta[^>]+>/gi;
const TITLE_RE = /<title[^>]*>([^<]+)<\/title>/i;
const LINK_RE = /<link[^>]+>/gi;
const ATTR_RE = /(\w+(?::\w+)?)=["']([^"']*)["']/g;

function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(tag)) !== null) {
    out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function extractMeta(html: string, base: URL): Meta {
  const meta: Meta = { url: base.toString() };
  // <meta property="..." content="..."> / <meta name="..." content="...">
  const tags: { prop: string; content: string }[] = [];
  let m: RegExpExecArray | null;
  META_RE.lastIndex = 0;
  while ((m = META_RE.exec(html)) !== null) {
    const a = parseAttrs(m[0]);
    const prop = (a.property || a.name || "").toLowerCase();
    const content = a.content;
    if (prop && content) tags.push({ prop, content });
  }
  const find = (...keys: string[]) =>
    tags.find((t) => keys.includes(t.prop))?.content;

  meta.title = find("og:title", "twitter:title");
  meta.description = find("og:description", "twitter:description", "description");
  const image = find("og:image", "og:image:url", "twitter:image", "twitter:image:src");
  if (image) {
    try {
      meta.image = new URL(image, base).toString();
    } catch {}
  }
  meta.siteName = find("og:site_name", "application-name");

  // <title> fallback
  if (!meta.title) {
    const t = TITLE_RE.exec(html);
    if (t) meta.title = decodeEntities(t[1].trim());
  }
  if (meta.title) meta.title = decodeEntities(meta.title);
  if (meta.description) meta.description = decodeEntities(meta.description);

  // favicon — <link rel="icon" href="..."> 우선, 없으면 /favicon.ico.
  let faviconHref: string | undefined;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(html)) !== null) {
    const a = parseAttrs(m[0]);
    const rel = (a.rel || "").toLowerCase();
    if (rel.includes("icon") && a.href) {
      faviconHref = a.href;
      break;
    }
  }
  try {
    meta.favicon = new URL(faviconHref || "/favicon.ico", base).toString();
  } catch {}

  // 너무 긴 값은 잘라서 응답 부풀지 않게.
  if (meta.title && meta.title.length > 200) meta.title = meta.title.slice(0, 200);
  if (meta.description && meta.description.length > 400)
    meta.description = meta.description.slice(0, 400);

  return meta;
}

router.post("/", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid url" });
  let url: URL;
  try {
    url = new URL(parsed.data.url);
  } catch {
    return res.status(400).json({ error: "invalid url" });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return res.status(400).json({ error: "http(s) only" });
  }
  try {
    await assertHostSafe(url.hostname);
  } catch {
    return res.status(400).json({ error: "host not allowed" });
  }

  const cached = cacheGet(url.toString());
  if (cached) return res.json(cached);

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 5000);
  try {
    // redirect: "manual" 로 직접 처리 — 매 hop 마다 호스트 재검증해서 SSRF 우회 차단.
    // 30x → Location 헤더 추출 → 다시 assertHostSafe → 최대 3회.
    let target = url;
    let r: Response | null = null;
    const MAX_HOPS = 3;
    for (let hop = 0; hop < MAX_HOPS + 1; hop++) {
      r = await fetch(target.toString(), {
        signal: ac.signal,
        redirect: "manual",
        headers: {
          // 일부 사이트(GitHub, X)는 user-agent 가 비면 차단/404. 일반 브라우저 처럼 위장.
          "user-agent": "Mozilla/5.0 (compatible; HiNestBot/1.0; +unfurl)",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      // 30x 면 Location 따라가기 전에 재검증
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get("location");
        if (!loc) break;
        let next: URL;
        try {
          next = new URL(loc, target);
        } catch {
          return res.status(400).json({ error: "bad redirect" });
        }
        if (next.protocol !== "http:" && next.protocol !== "https:") {
          return res.status(400).json({ error: "http(s) only" });
        }
        try {
          await assertHostSafe(next.hostname);
        } catch {
          return res.status(400).json({ error: "host not allowed" });
        }
        target = next;
        continue;
      }
      break;
    }
    if (!r) return res.status(200).json({ url: url.toString() });
    if (!r.ok) {
      return res.status(200).json({ url: url.toString() });
    }
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("text/html") && !ct.includes("xml")) {
      // HTML 이 아니면 메타 추출 의미 없음 → URL 만 반환.
      return res.status(200).json({ url: url.toString() });
    }
    // 1MB 까지만 읽기 — 큰 페이지에서 무한 다운로드 방지.
    const buf = await r.arrayBuffer();
    const limited = buf.byteLength > 1_000_000 ? buf.slice(0, 1_000_000) : buf;
    const html = new TextDecoder("utf-8", { fatal: false }).decode(limited);
    const meta = extractMeta(html, target);
    cacheSet(url.toString(), meta);
    res.json(meta);
  } catch (e: any) {
    if (e?.name === "AbortError") {
      return res.status(504).json({ error: "fetch timeout", url: url.toString() });
    }
    res.status(200).json({ url: url.toString() });
  } finally {
    clearTimeout(t);
  }
});

export default router;
