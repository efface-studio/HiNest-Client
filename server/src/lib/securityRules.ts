import type { Request, Response, NextFunction } from "express";
import { prisma } from "./db.js";

/**
 * IP 차단 + Rate-limit 미들웨어. 60s 캐시로 룰을 가져와서 인메모리 카운터로 평가.
 *
 * 단순화 정책:
 *  - CIDR: IPv4 만. v6 는 정확히 일치만 허용 (정밀 prefix 비교 X — 간단함 우선).
 *  - Glob: \`*\`, \`?\` 만. 정규식 변환 1패스.
 *  - Counter: 분/시간 슬라이딩 윈도우 (단순 bucket reset 아님 — 정확성 ↑, 메모리 4x).
 */

type IpRow = { cidr: string; country: string | null; expiresAt: Date | null };
type RateRow = { routeGlob: string; perMin: number; perHour: number; scope: string };

let _ipCache: { rows: IpRow[]; exp: number } | null = null;
let _rateCache: { rows: RateRow[]; exp: number } | null = null;
const TTL = 60_000;

async function getIpBlocks(): Promise<IpRow[]> {
  if (_ipCache && _ipCache.exp > Date.now()) return _ipCache.rows;
  const rows = await prisma.ipBlock.findMany({
    where: { enabled: true },
    select: { cidr: true, country: true, expiresAt: true },
  });
  _ipCache = { rows, exp: Date.now() + TTL };
  return rows;
}

async function getRateRules(): Promise<RateRow[]> {
  if (_rateCache && _rateCache.exp > Date.now()) return _rateCache.rows;
  const rows = await prisma.rateLimitRule.findMany({
    where: { enabled: true },
    select: { routeGlob: true, perMin: true, perHour: true, scope: true },
  });
  _rateCache = { rows, exp: Date.now() + TTL };
  return rows;
}

export function evictSecurityCache() {
  _ipCache = null;
  _rateCache = null;
}

function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  const a = +m[1], b = +m[2], c = +m[3], d = +m[4];
  if ([a, b, c, d].some((n) => n < 0 || n > 255)) return null;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function ipMatches(ip: string, cidr: string): boolean {
  const [base, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr ?? "32", 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return ip === cidr;
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt == null || baseInt == null) return false;
  if (prefix === 0) return true;
  const mask = prefix === 32 ? 0xffffffff : (~((1 << (32 - prefix)) - 1)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function globToRegex(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp("^" + esc + "$");
}

const counter = new Map<string, number[]>(); // key → ts list (오름차순)
const COUNTER_MAX_KEYS = 50_000;

function hit(key: string, now: number): number[] {
  let arr = counter.get(key);
  if (!arr) { arr = []; counter.set(key, arr); }
  if (counter.size > COUNTER_MAX_KEYS) {
    // 가장 오래된 키 일부 정리.
    const dropN = 5000;
    let i = 0;
    for (const k of counter.keys()) { counter.delete(k); if (++i >= dropN) break; }
  }
  // 1시간 초과 항목 제거.
  const cutoff = now - 3_600_000;
  while (arr.length && arr[0] < cutoff) arr.shift();
  arr.push(now);
  return arr;
}

function countSince(arr: number[], sinceMs: number, now: number): number {
  const cutoff = now - sinceMs;
  let n = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] >= cutoff) n++; else break;
  }
  return n;
}

export async function ipBlockMiddleware(req: Request, res: Response, next: NextFunction) {
  // 만료 룰 자동 무효화 — 룰 fetch 시점에 한 번 체크.
  const rows = await getIpBlocks();
  const now = new Date();
  const ip = req.ip ?? "";
  const country = String(req.headers["cf-ipcountry"] ?? "").toUpperCase();
  for (const r of rows) {
    if (r.expiresAt && r.expiresAt < now) continue;
    if (r.country) {
      if (country && r.country.toUpperCase() === country) {
        return res.status(403).json({ error: "blocked", reason: `country:${country}` });
      }
    } else if (ipMatches(ip, r.cidr)) {
      return res.status(403).json({ error: "blocked", reason: `cidr:${r.cidr}` });
    }
  }
  next();
}

export async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  const rows = await getRateRules();
  if (rows.length === 0) return next();
  const path = req.path;
  for (const r of rows) {
    const re = globToRegex(r.routeGlob);
    if (!re.test(path)) continue;
    const keyBase = r.scope === "user"
      ? `u:${(req as any).user?.id ?? "anon"}`
      : r.scope === "global"
        ? "g"
        : `ip:${req.ip}`;
    const k = `${r.routeGlob}|${keyBase}`;
    const arr = hit(k, Date.now());
    const m = countSince(arr, 60_000, Date.now());
    const h = countSince(arr, 3_600_000, Date.now());
    if (m > r.perMin || h > r.perHour) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({ error: "rate limited", rule: r.routeGlob });
    }
  }
  next();
}
