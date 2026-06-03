import { isCapacitorNative } from "./platform";

/**
 * 네이티브(Capacitor iOS/Android) 포그라운드 OS 알림 배너.
 *
 * 데스크톱은 Web Notification API(desktopNotify.ts)로 앱을 보고 있을 때도 OS 배너를 띄우는데,
 * WKWebView 는 Web Notification 을 지원하지 않아 모바일에선 포그라운드 배너가 안 떴다.
 * 모바일은 @capacitor/local-notifications 로 같은 배너를 띄워 데스크톱과 동등하게 만든다.
 * (백그라운드/종료 상태는 APNs 원격 푸시가 담당 — 별개 경로.)
 *
 * 웹/데스크톱에서는 전부 no-op.
 */

export type NotifItem = { id: string; title: string; body?: string; linkUrl?: string };

/** 알림 탭 시 인앱 라우팅 — 데스크톱 OS 알림 onclick 과 동일(채팅방 열기 / SPA 이동). */
export function routeNotifLink(url?: string | null) {
  if (!url || typeof window === "undefined") return;
  try {
    const chatMatch = /^\/chat(?:\?|#).*?room=([^&]+)/.exec(url);
    if (chatMatch) {
      window.dispatchEvent(new CustomEvent("chat:open"));
      window.dispatchEvent(new CustomEvent("chat:open-room", { detail: { roomId: chatMatch[1] } }));
    } else if (url.startsWith("/chat")) {
      window.dispatchEvent(new CustomEvent("chat:open"));
    } else {
      window.history.pushState({}, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  } catch {
    /* noop */
  }
}

let _seq = 1;

/** 포그라운드에서 받은 알림을 로컬 OS 알림 배너로 표시. 권한 없으면 조용히 스킵. */
export async function showNativeNotifications(items: NotifItem[]): Promise<void> {
  if (!isCapacitorNative() || !items.length) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== "granted") return; // 권한은 로그인 시 푸시 흐름에서 요청됨
    await LocalNotifications.schedule({
      notifications: items.slice(0, 5).map((it) => ({
        // LocalNotifications id 는 32bit 정수여야 한다.
        id: (Date.now() + _seq++) % 2_147_483_000,
        title: it.title,
        body: it.body ?? "",
        extra: { linkUrl: it.linkUrl ?? null },
      })),
    });
  } catch {
    /* 플러그인 미탑재/실패 — 조용히 무시 */
  }
}

let _wired = false;
/** 로컬 알림 탭 → 인앱 라우팅 리스너. 앱 시작 시 1회만. */
export async function initNativeNotificationTaps(): Promise<void> {
  if (!isCapacitorNative() || _wired) return;
  _wired = true;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.addListener("localNotificationActionPerformed", (a) => {
      routeNotifLink((a.notification.extra as { linkUrl?: string | null } | undefined)?.linkUrl);
    });
  } catch {
    /* noop */
  }
}
