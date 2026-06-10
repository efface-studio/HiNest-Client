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

import { isCapacitorNative, nativePlatform } from "./platform";
import { showNativeNotifications } from "./nativeNotify";
import { isNativeAppActive } from "./appActive";

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

/** 발신자 기본 아바타(색 원형 + 이름 첫 글자)를 그려 dataURL 로. Electron 알림 아이콘용. */
function avatarDataUrl(name?: string, color?: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  try {
    const size = 64;
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return undefined;
    ctx.fillStyle = color || "#3D54C4";
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(size * 0.44)}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(name?.[0] ?? "?", size / 2, size / 2 + 2);
    return c.toDataURL("image/png");
  } catch {
    return undefined;
  }
}

/** 지금 사용자가 보고 있는 채팅방 id. ChatMiniApp 이 활성 방을 setActiveChatRoom 으로
 *  설정하면, 그 방으로 향하는 알림은 OS 시스템 알림을 띄우지 않는다(화면에 이미 떠 있으니
 *  불필요). 전역 모듈 변수로 두는 이유: showDesktopNotification 이 React 트리 밖에서도 호출돼
 *  React state 로는 동기적으로 못 읽음. */
let __activeChatRoomId: string | null = null;
export function setActiveChatRoom(roomId: string | null) {
  __activeChatRoomId = roomId;
}
export function getActiveChatRoom(): string | null {
  return __activeChatRoomId;
}
/** opts.url 이 채팅 룸 링크면 roomId 추출. /chat?room=X 또는 #room=X 둘 다 지원. */
function chatRoomIdFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const m = /[?#&]room=([^&]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

export function showDesktopNotification(opts: {
  id: string;
  title: string;
  body?: string;
  url?: string;
  icon?: string;
  tag?: string;
  actorName?: string;
  actorColor?: string;
}) {
  if (!isDesktopEnabled()) return;
  if (alreadySeen(opts.id)) return;

  // 사용자가 지금 보고 있는 채팅방으로 향하는 알림은 시스템 알림 스킵 — 화면에 이미 떠 있음.
  // (서버 active-viewer 게이트가 APNs 만 막아 데스크탑/웹 알림이 새던 문제 보완.)
  const rid = chatRoomIdFromUrl(opts.url);
  if (rid && rid === __activeChatRoomId) {
    markSeen([opts.id]);
    return;
  }

  // ── Electron(데스크톱 앱): 검증된 메인 프로세스 경로로 보낸다 ───────────────────
  // 렌더러의 Web Notification API 는 Mac App Store(샌드박스)+원격 URL 빌드에서
  // Notification.permission 이 "granted" 로 안 잡혀 위 게이트에 조용히 막히는 경우가 있다.
  // (로그인 환영 알림이 잘 뜨는 건 메인 프로세스 IPC 라서 — 동일 경로를 재사용한다.)
  // 데스크톱 앱은 창을 트레이로 숨겨두고 쓰는 일이 많아 포커스와 무관하게 항상 띄운다.
  if (isElectron()) {
    try {
      // 발신자 아바타(이니셜+색)를 알림 아이콘으로. 사진 URL 은 알림 데이터에 없어 기본 아바타.
      const icon = opts.icon ?? avatarDataUrl(opts.actorName, opts.actorColor);
      void window.hinest?.showNotification?.({ title: opts.title, body: opts.body, icon });
    } catch {}
    markSeen([opts.id]);
    return;
  }

  // ── 일반 웹 브라우저: Web Notifications API ───────────────────────────────────
  if (!supported()) return;
  if (Notification.permission !== "granted") return;

  // 탭 포커스 중이면 굳이 OS 알림 띄우지 않음 (앱 내 벨로 확인 가능)
  if (
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
  items: { id: string; title: string; body?: string; linkUrl?: string; actorName?: string; actorColor?: string }[]
) {
  // 네이티브(Capacitor): WKWebView 는 Web Notification 미지원 → local-notifications 로 배너 표시.
  if (isCapacitorNative()) {
    // Android: 채팅 알림은 FCM(HiNestMessagingService)이 전경·후경 모두에서 발신자 아바타로 직접
    // 그린다 → JS 로컬 배너는 항상 중복이고, 로컬 배너(vis=PRIVATE)가 여러 개 쌓이면 시스템 자동그룹
    // 요약(PRIVATE)이 잠금화면 내용까지 가린다. 그래서 Android 에선 채팅 항목을 JS 배너 후보에서
    // 제외(FCM 가 소유). iOS 는 전경에서 APNs 가 억제되므로 JS 배너로 보완해야 해 유지한다.
    const isAndroid = nativePlatform() === "android";
    const candidates = isAndroid
      ? items.filter((it) => !((it.linkUrl ?? "").includes("room=") || (it.linkUrl ?? "").startsWith("/chat")))
      : items;
    const fresh = candidates.filter((it) => !alreadySeen(it.id));
    if (fresh.length) {
      // 항상 seen 처리 — 포그라운드 복귀 시 같은 알림이 로컬배너로 재등장하지 않게.
      markSeen(fresh.map((f) => f.id));
      // ★ 포그라운드(active)일 때만 로컬 배너를 띄운다. 백그라운드면 원격 푸시(iOS=APNs+NSE,
      //   Android=FCM+HiNestMessagingService)가 발신자 아바타 알림을 처리하므로, 여기서 로컬
      //   알림을 스케줄하면 중복 + "앱로고=아바타 X" 배너가 같이 떠버린다(특히 Android: 로컬 배너는
      //   vis=PRIVATE 라 잠금화면 내용까지 가려지고, 여러 개가 시스템 자동그룹으로 묶임).
      //   ⚠️ document.visibilityState 는 Android WebView 에서 백그라운드/잠금에도 "visible" 로
      //   남아(실기기 확인) 가드가 무력화됐다 → @capacitor/app 의 실제 앱 상태(appStateChange)로 가드.
      const foreground = isNativeAppActive();
      if (foreground) void showNativeNotifications(fresh);
    }
    return;
  }
  // Electron 은 showDesktopNotification 이 메인 프로세스 경로로 처리하므로 렌더러 권한 게이트를
  // 건너뛴다. 일반 웹만 미리 권한/지원을 확인(불필요한 루프 회피).
  if (!isElectron() && (!supported() || Notification.permission !== "granted")) return;
  if (!isDesktopEnabled()) return;
  for (const it of items) {
    if (alreadySeen(it.id)) continue;
    showDesktopNotification({ id: it.id, title: it.title, body: it.body, url: it.linkUrl, actorName: it.actorName, actorColor: it.actorColor });
  }
}
