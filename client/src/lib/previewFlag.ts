/**
 * 미리보기(둘러보기) 모드 — 경량 플래그 모듈.
 *
 * 왜 분리했나(2026-06-09 성능):
 *   isPreviewMode/enablePreview/disablePreview 는 main.tsx·AppLayout·DashboardPage 등이
 *   "정적" import 한다. 이게 같은 모듈(previewMock.ts)의 ~95KB 목 데이터(DEMO_USERS,
 *   MEETING_BODIES 등)를 프로덕션 메인 번들로 끌어와 모든 사용자 첫 로드에 ~25KB(gzip)를
 *   다운로드시켰다. 플래그·정리 로직만 이 경량 모듈로 떼고, 무거운 네트워크 패치(목 데이터
 *   참조)는 미리보기가 실제 활성일 때만 `import("./previewMock")` 로 지연 로드한다.
 *   → 일반 사용자 번들에서 목 데이터 완전 제거. api.ts/auth.tsx 는 이미 동적 import 라 무관.
 */

export const PREVIEW_KEY = "hinest:preview";
export const PREVIEW_ROLE_KEY = "hinest:preview:role";

/** 미리보기 데모 사용자 권한. 기본은 일반 사원(MEMBER). */
export type PreviewRole = "member" | "manager" | "admin" | "super" | "platform";
const PREVIEW_ROLES: PreviewRole[] = ["member", "manager", "admin", "super", "platform"];

/**
 * 역할 전환(`/preview?role=`)을 받아들일 부모 창 origin.
 * 미리보기는 외부 잠재고객이 보는 데모라 관리/운영 화면을 감추는 게 기본이고,
 * efface 디자인 시스템(component.efface.dev)이 iframe 으로 띄워 디자인을 검사할 때만 푼다.
 */
const PREVIEW_ROLE_PARENTS = ["https://component.efface.dev", "http://localhost:5190"];

function embeddedByAllowedParent(): boolean {
  if (typeof window === "undefined" || window.parent === window) return false;
  try {
    const anc = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
    if (anc && anc.length) return PREVIEW_ROLE_PARENTS.includes(anc[anc.length - 1]);
    // Firefox 는 ancestorOrigins 가 없다 — referrer 로 대신
    return PREVIEW_ROLE_PARENTS.some((o) => document.referrer.startsWith(o + "/") || document.referrer === o);
  } catch {
    return false;
  }
}

/**
 * `/preview?role=…` 를 세션에 기록한다. 허용된 부모에 임베드됐거나 로컬 개발일 때만.
 * 미리보기 안에서 다른 페이지로 옮겨도 sessionStorage 로 유지된다.
 */
export function applyPreviewRoleFromUrl(): void {
  if (typeof window === "undefined") return;
  const raw = new URLSearchParams(window.location.search).get("role");
  if (!raw) return;
  const role = raw.toLowerCase() as PreviewRole;
  if (!PREVIEW_ROLES.includes(role)) return;
  const local = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (!local && !embeddedByAllowedParent()) return;
  try {
    if (role === "member") sessionStorage.removeItem(PREVIEW_ROLE_KEY);
    else sessionStorage.setItem(PREVIEW_ROLE_KEY, role);
  } catch {}
}

export function getPreviewRole(): PreviewRole {
  try {
    const v = sessionStorage.getItem(PREVIEW_ROLE_KEY) as PreviewRole | null;
    return v && PREVIEW_ROLES.includes(v) ? v : "member";
  } catch {
    return "member";
  }
}

function active(): boolean {
  if (typeof window === "undefined") return false;
  if ((window as any).__HINEST_PREVIEW__ === true) return true;
  try {
    return sessionStorage.getItem(PREVIEW_KEY) === "1";
  } catch {
    return false;
  }
}

let _patchRequested = false;
/** 무거운 네트워크 패치(목 데이터 포함)를 지연 로드해 적용. 미리보기 활성 시에만 호출됨. */
function lazyInstall(): Promise<void> {
  _patchRequested = true;
  return import("./previewMock")
    .then((m) => m.installNetworkPatches())
    .catch(() => {});
}

/**
 * 미리보기 활성 여부(동기). api.ts/여러 hook 이 검사용으로 호출.
 * 활성인데 아직 네트워크 패치가 안 깔렸으면 무거운 모듈을 지연 로드해 깐다(fire-and-forget).
 * api() 호출은 어차피 동기 window.__HINEST_PREVIEW__ 플래그로 단락되므로 패치 지연과 무관하게 안전.
 */
export function isPreviewMode(): boolean {
  const on = active();
  if (on) {
    (window as any).__HINEST_PREVIEW__ = true;
    if (!_patchRequested) void lazyInstall();
  }
  return on;
}

/**
 * 미리보기 네트워크 패치가 적용 완료될 때까지 기다린다(렌더 전 보장용 — main.tsx 부트스트랩).
 * 비활성이면 즉시 resolve(무거운 모듈 로드 안 함 → 일반 사용자 비용 0).
 */
export function ensurePreviewPatched(): Promise<void> {
  if (!active()) return Promise.resolve();
  (window as any).__HINEST_PREVIEW__ = true;
  return lazyInstall();
}

export function enablePreview(): void {
  if (typeof window === "undefined") return;
  (window as any).__HINEST_PREVIEW__ = true;
  try {
    sessionStorage.setItem(PREVIEW_KEY, "1");
  } catch {}
  void lazyInstall();
}

export function disablePreview(): void {
  if (typeof window === "undefined") return;
  (window as any).__HINEST_PREVIEW__ = false;
  try {
    sessionStorage.removeItem(PREVIEW_KEY);
    sessionStorage.removeItem(PREVIEW_ROLE_KEY);
  } catch {}
  // 네트워크 패치 해제 — 무거운 모듈이 이미 로드된 경우에만 실제 효과(아니면 패치도 안 깔림).
  void import("./previewMock")
    .then((m) => m.uninstallNetworkPatches())
    .catch(() => {});
  // 데모 동안 누적된 SWR 캐시 정리 — 실 서버 호출 시 stale 가짜 데이터 방지. (목 데이터 불필요·경량)
  try {
    const PREFIX = "hinest.swr:";
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  } catch {}
  // 미리보기 동안 localStorage 에 누적될 수 있는 데모-결정 키들 정리 — 실 가입 후 데모 ID 잔존으로 색/상태가 어긋나는 일 방지.
  try {
    const PREFIXES = ["chat:theme:", "chat:lastSeen:", "hinest:lastSeenNoticeUnread", "emoji-recent", "desktop-notify-seen", "hinest:notif-prefs"];
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (PREFIXES.some((p) => k === p || k.startsWith(p))) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {}
}
