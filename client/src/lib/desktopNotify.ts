/**
 * 데스크톱 OS 알림 (Windows Action Center / macOS 알림 센터).
 *
 * 동작 원리:
 *  - 브라우저의 Web Notifications API 사용
 *  - 사용자가 권한을 "허용"하면, 탭이 **포커스를 잃은 상태**에서 새 알림이 도착할 때 OS 토스트가 뜬다
 *  - 탭이 활성 상태면 이미 앱 UI(벨 드롭다운)에서 확인 가능하므로 중복 방지 차원에서 건너뜀
 *  - 동일 알림을 두 번 발송하지 않도록 최근 ID 집합을 localStorage 에 기록
 *
 * 브라우저 지원:
 *  - Windows: Chrome, Edge, Firefox (Windows Action Center 로 뜸, 집중 모드 설정 필요 가능)
 *  - macOS: Chrome, Safari, Edge, Firefox (알림 센터로 뜸, 시스템 설정 > 알림에서 브라우저 허용 필요)
 *  - https 또는 localhost 에서만 동작 (HiNest dev: localhost:1000 ✅)
 */

import { isCapacitorNative } from "./platform";
import { showNativeNotifications } from "./nativeNotify";

export type DesktopNotifPermission = "default" | "granted" | "denied" | "unsupported";

const LS_SEEN = "hinest.notif.seen"; // 이미 알려준 notification id 목록 (localStorage)
const LS_ENABLED = "hinest.notif.desktop"; // 사용자 토글 (on/off)
// 이미-표시한 알림 id 캐시 상한. 너무 작으면(구 500) 채팅 다량 수신 시 아직 안 읽은
// 알림 id 가 밀려나 → 폴백 reload 가 그걸 '처음 본 것'으로 오인해 같은 배너를 다시 띄움(중복).
// 상한을 크게 잡아 현실적인 세션 내 churn 으론 밀려나지 않게 한다. (id 1건 ~25B → 3000건 ~75KB)
const MAX_SEEN = 3000;

function supported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getDesktopPermission(): DesktopNotifPermission {
  if (!supported()) return "unsupported";
  return Notification.permission as DesktopNotifPermission;
}

export async function requestDesktopPermission(): Promise<DesktopNotifPermission> {
  if (!supported()) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    const p = await Notification.requestPermission();
    return p as DesktopNotifPermission;
  } catch {
    return Notification.permission as DesktopNotifPermission;
  }
}

/** Electron 래퍼 안에서 실행 중인지 */
function isElectron() {
  return typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("electron");
}

export function isDesktopEnabled(): boolean {
  if (!supported()) return false;
  // Electron 에선 OS 권한이 항상 granted 이고 사용자 토글과 무관하게 기본 ON
  if (isElectron()) {
    const v = localStorage.getItem(LS_ENABLED);
    if (v === "0") return false;
    return true;
  }
  const v = localStorage.getItem(LS_ENABLED);
  if (v === null) return Notification.permission === "granted";
  return v === "1";
}

export function setDesktopEnabled(on: boolean) {
  localStorage.setItem(LS_ENABLED, on ? "1" : "0");
}

function getSeen(): Set<string> {
  try {
    const arr: string[] = JSON.parse(localStorage.getItem(LS_SEEN) ?? "[]");
    return new Set(arr);
  } catch {
    return new Set();
  }
}
function saveSeen(set: Set<string>) {
  try {
    const arr = Array.from(set);
    const trimmed = arr.slice(-MAX_SEEN);
    localStorage.setItem(LS_SEEN, JSON.stringify(trimmed));
  } catch {}
}

export function markSeen(ids: string[]) {
  const set = getSeen();
  for (const id of ids) set.add(id);
  saveSeen(set);
}

export function alreadySeen(id: string) {
  return getSeen().has(id);
}

export function showDesktopNotification(opts: {
  id: string;
  title: string;
  body?: string;
  url?: string;
  icon?: string;
  tag?: string;
}) {
  if (!supported()) return;
  if (Notification.permission !== "granted") return;
  if (!isDesktopEnabled()) return;
  if (alreadySeen(opts.id)) return;

  // 탭 포커스 중이면 굳이 OS 알림 띄우지 않음 (앱 내 벨로 확인 가능)
  // 단, Electron(데스크톱 앱) 에선 항상 띄운다 (사용자가 앱 켜두고 다른 일 하는 케이스 많음)
  if (
    !isElectron() &&
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    document.hasFocus()
  ) {
    markSeen([opts.id]);
    return;
  }

  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      icon: opts.icon ?? "/favicon.ico",
      tag: opts.tag ?? opts.id,
      silent: false,
    });
    n.onclick = () => {
      try { window.focus(); } catch {}
      if (opts.url) {
        // /chat 페이지 제거됨 — room 링크는 우하단 사내톡 팝업으로 돌린다
        const chatMatch = /^\/chat(?:\?|#).*?room=([^&]+)/.exec(opts.url);
        if (chatMatch) {
          try {
            window.dispatchEvent(new CustomEvent("chat:open"));
            window.dispatchEvent(new CustomEvent("chat:open-room", { detail: { roomId: chatMatch[1] } }));
          } catch {}
        } else if (opts.url.startsWith("/chat")) {
          try { window.dispatchEvent(new CustomEvent("chat:open")); } catch {}
        } else {
          // SPA 네비게이션을 위해 history.pushState + popstate 트리거
          try {
            window.history.pushState({}, "", opts.url);
            window.dispatchEvent(new PopStateEvent("popstate"));
          } catch {}
        }
      }
      n.close();
    };
    markSeen([opts.id]);
  } catch {
    // 실패 시 조용히 무시
  }
}

/** 여러 개를 한 번에 처리. 테스트·초기 동기화 편의용. */
export function deliverPendingNotifications(
  items: { id: string; title: string; body?: string; linkUrl?: string }[]
) {
  // 네이티브(Capacitor): WKWebView 는 Web Notification 미지원 → local-notifications 로 배너 표시(데스크톱 동등).
  if (isCapacitorNative()) {
    const fresh = items.filter((it) => !alreadySeen(it.id));
    if (fresh.length) {
      void showNativeNotifications(fresh);
      markSeen(fresh.map((f) => f.id));
    }
    return;
  }
  if (!supported() || Notification.permission !== "granted" || !isDesktopEnabled()) return;
  for (const it of items) {
    if (alreadySeen(it.id)) continue;
    showDesktopNotification({ id: it.id, title: it.title, body: it.body, url: it.linkUrl });
  }
}
