/**
 * iOS App Store 업데이트 자동 감지.
 *
 * 동작:
 *  1) iOS Capacitor 앱에서만 활성(웹/데스크탑/안드는 no-op).
 *  2) iTunes Lookup API(공개 무인증) 로 App Store 의 최신 `version` 을 조회.
 *  3) `@capacitor/app` 의 `App.getInfo().version` 과 비교 — 최신이 더 크면 업데이트 권장.
 *  4) 결과(필요/생략)는 캐시(1시간) — 매 진입 시 itunes 를 때리지 않음.
 *  5) 사용자가 "나중에" 누르면 24시간 dismiss(localStorage 기록) — 같은 버전 계속 안 띄움.
 *
 * 호출부(AppLayout)는 이 결과를 받아 모달을 띄울지 결정한다.
 *
 * 안전장치:
 *  - itunes lookup 실패(네트워크/심사 전이라 결과 없음)는 silent. 절대 throw 안 함.
 *  - 버전 비교는 semver 순서 비교(1.2 < 1.10). x.y.z 만 가정(App Store 정책상 그대로).
 *  - Bundle ID 는 capacitor.config.ts 와 동일(com.hivits.hinest). 변경 시 같이 갱신.
 */

import { nativePlatform } from "./platform";

const BUNDLE_ID = "com.hivits.hinest";
const COUNTRY = "kr";
const CACHE_KEY = "hinest.appstore-check";
const DISMISS_KEY = "hinest.appstore-dismiss";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1시간
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000; // 24시간

export type AppStoreCheckResult = {
  /** 최신 버전이 더 크면 true. */
  needsUpdate: boolean;
  /** 현재 설치된 앱 버전(예: "1.0.2"). */
  current?: string;
  /** App Store 최신 버전(예: "1.0.3"). */
  latest?: string;
  /** App Store 의 앱 페이지(트랙 URL) — "지금 업데이트" 버튼에서 외부 열림. */
  trackUrl?: string;
};

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

function readCache(): AppStoreCheckResult | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { at: number; r: AppStoreCheckResult };
    if (Date.now() - j.at < CACHE_TTL_MS) return j.r;
  } catch { /* corrupt → 무시 */ }
  return null;
}
function writeCache(r: AppStoreCheckResult) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), r })); } catch {}
}

/** "나중에" 로 닫은 버전. 같은 latest 가 다시 떠도 24시간 안엔 안 띄운다. */
function isDismissed(latest: string): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const j = JSON.parse(raw) as { at: number; v: string };
    return j.v === latest && Date.now() - j.at < DISMISS_TTL_MS;
  } catch { return false; }
}
export function dismissAppStoreUpdate(latest: string): void {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify({ at: Date.now(), v: latest })); } catch {}
}

/**
 * 현재 환경에서 App Store 업데이트가 필요한지 결과를 돌려준다.
 *  - iOS 가 아니거나 itunes 호출 실패 → needsUpdate:false
 *  - 같은 버전이거나 더 새 버전 설치 → needsUpdate:false
 *  - 더 큰 버전이 App Store 에 있으면 needsUpdate:true + 비교용 메타
 */
export async function checkAppStoreUpdate(): Promise<AppStoreCheckResult> {
  if (nativePlatform() !== "ios") return { needsUpdate: false };
  const cached = readCache();
  if (cached) return cached;

  try {
    // 현재 설치된 앱 버전.
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    const current = (info.version || "").trim();

    // App Store 최신 버전.
    const url = `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(BUNDLE_ID)}&country=${COUNTRY}&t=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) { const r = { needsUpdate: false, current }; writeCache(r); return r; }
    const data = (await res.json()) as { resultCount: number; results: Array<{ version?: string; trackViewUrl?: string }> };
    if (!data.resultCount || !data.results?.[0]?.version) {
      // 심사 전·국가 미출시 등 — 결과 없음. silent.
      const r = { needsUpdate: false, current }; writeCache(r); return r;
    }
    const latest = data.results[0].version.trim();
    const trackUrl = data.results[0].trackViewUrl;

    const needsUpdate = !!current && compareSemver(current, latest) < 0 && !isDismissed(latest);
    const r: AppStoreCheckResult = { needsUpdate, current, latest, trackUrl };
    writeCache(r);
    return r;
  } catch {
    const r = { needsUpdate: false }; writeCache(r); return r;
  }
}
