import { Router } from "express";

/**
 * Capacitor Live Updates (Capgo) self-hosted endpoint.
 *
 * 동작:
 *   1) 셸이 POST /api/updates/check { version, ... } 로 현재 번들 정보를 보낸다.
 *   2) 서버는 https://nest.hi-vits.com/live-updates/manifest.json 을 GET 해 최신 메타를 가져온다
 *      (Vercel 정적 호스팅 — vite build 직후 build-live-update.mjs 가 자동 생성·갱신).
 *   3) manifest.version 이 셸의 version 과 다르면 새 번들 정보 반환, 같으면 'no_new_version_available'.
 *
 * 응답 형식(Capgo SDK 규약):
 *   업데이트 있음:   { version, url(절대 URL), checksum, message? }
 *   최신 상태:       { error: "no_new_version_available", message: "..." }
 *
 * 캐시: manifest 는 자주 안 바뀌므로 60 초 메모리 캐시. 빌드 직후 빠른 전파를 위해 짧게 잡음.
 */
const router = Router();

const MANIFEST_URL =
  process.env.LIVE_UPDATE_MANIFEST_URL ?? "https://nest.hi-vits.com/live-updates/manifest.json";
const PUBLIC_ORIGIN =
  process.env.LIVE_UPDATE_PUBLIC_ORIGIN ?? "https://nest.hi-vits.com";
const CACHE_TTL_MS = 60_000;

type Manifest = {
  version: string;
  url: string; // 보통 상대경로 (예: /live-updates/bundle-abc.zip)
  checksum: string;
  size?: number;
  createdAt?: string;
};

let _cache: { at: number; manifest: Manifest | null } | null = null;

async function getManifest(): Promise<Manifest | null> {
  const now = Date.now();
  if (_cache && now - _cache.at < CACHE_TTL_MS) return _cache.manifest;
  try {
    const r = await fetch(MANIFEST_URL, { headers: { "cache-control": "no-cache" } });
    if (!r.ok) {
      _cache = { at: now, manifest: null };
      return null;
    }
    const m = (await r.json()) as Manifest;
    _cache = { at: now, manifest: m };
    return m;
  } catch {
    _cache = { at: now, manifest: null };
    return null;
  }
}

router.post("/check", async (req, res) => {
  const body = (req.body ?? {}) as { version?: string };
  const manifest = await getManifest();
  if (!manifest || !manifest.version) {
    // 아직 manifest 가 없거나 fetch 실패 — 안전하게 '최신' 응답(앱 정상 동작).
    return res.json({
      error: "no_new_version_available",
      message: "Manifest not available yet.",
    });
  }
  if (body.version === manifest.version) {
    return res.json({
      error: "no_new_version_available",
      message: `Already on ${manifest.version}.`,
    });
  }
  // 새 버전 — 다운로드 URL 을 절대 URL 로 노출 (셸이 그대로 fetch).
  const absoluteUrl = manifest.url.startsWith("http")
    ? manifest.url
    : `${PUBLIC_ORIGIN}${manifest.url}`;
  return res.json({
    version: manifest.version,
    url: absoluteUrl,
    checksum: manifest.checksum,
    message: `Update to ${manifest.version}`,
  });
});

export default router;
