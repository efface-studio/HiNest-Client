/**
 * iOS 원격 푸시(APNs) 등록·수신 — @capacitor/push-notifications.
 *
 * 흐름:
 *  1) 로그인/세션복원 후 setupIosPush() 호출 (auth.tsx 의 user effect).
 *  2) 권한 요청 — 이미 결정됐으면 OS 가 프롬프트 없이 기존 결정을 그대로 반환.
 *  3) register() → OS 가 APNs 디바이스 토큰 발급 → 'registration' 이벤트.
 *  4) 토큰을 POST /api/push/register 로 서버에 등록 → 서버가 알림 발생 시 이 토큰으로 APNs 발송.
 *  5) 사용자가 알림을 탭 → 'pushNotificationActionPerformed' → payload 의 linkUrl 로 인앱 이동.
 *  6) 로그아웃 시 unregisterIosPush() → POST /api/push/unregister 로 토큰 제거.
 *
 * iOS 네이티브에서만 동작. android/web/desktop 에선 전부 no-op.
 * @capacitor/push-notifications 는 함수 안에서 동적 import — 웹/데스크톱 번들에 미포함.
 */
import { api } from "../api";
import { isCapacitorNative, nativePlatform } from "./platform";

let listenersReady = false;
let lastToken: string | null = null;

function isIos(): boolean {
  return isCapacitorNative() && nativePlatform() === "ios";
}

/**
 * 알림 탭 시 인앱 네비게이션 — desktopNotify 의 onclick 과 동일한 SPA 라우팅 규약을 따른다.
 *  - /chat?...room=<id> : 우하단 사내톡 팝업 열고 해당 방으로 (chat:open / chat:open-room)
 *  - 그 외 경로 : history.pushState + popstate 로 라우터 이동
 */
function navigateToInApp(url?: string) {
  if (!url) return;
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
    /* 네비게이션 실패는 조용히 무시 */
  }
}

/** 토큰 수신·탭 리스너를 1회만 등록(멱등). */
async function ensureListeners() {
  if (listenersReady) return;
  const { PushNotifications } = await import("@capacitor/push-notifications");

  // APNs 디바이스 토큰 발급 → 서버 등록. (실패해도 다음 로그인/부팅에서 재시도)
  await PushNotifications.addListener("registration", (token) => {
    lastToken = token.value;
    void api("/api/push/register", {
      method: "POST",
      json: { token: token.value, platform: "ios" },
    }).catch(() => {});
  });

  await PushNotifications.addListener("registrationError", (err) => {
    console.warn("push registration error", err);
  });

  // 알림 탭 → linkUrl 로 이동. 커스텀 키(linkUrl)는 APNs payload 최상위에 실어 data 로 전달됨.
  await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const data = (action?.notification?.data ?? {}) as { linkUrl?: string };
    navigateToInApp(data.linkUrl);
  });

  listenersReady = true;
}

/**
 * iOS 원격 푸시 셋업 — 로그인 후/세션 복원 시 호출(멱등).
 * 권한이 이미 결정됐으면 프롬프트 없이 통과하고, 허용 상태면 register() 로 토큰 발급을 유도한다.
 */
export async function setupIosPush(): Promise<void> {
  if (!isIos()) return;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await ensureListeners();

    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== "granted") return; // 거부됨 — 등록하지 않음

    await PushNotifications.register(); // → 'registration' 이벤트 → 서버 등록
  } catch (e) {
    // 푸시 셋업 실패는 앱 흐름을 막지 않는다.
    console.warn("setupIosPush failed", e);
  }
}

/** 로그아웃 시 — 이 기기 토큰을 서버에서 제거해 더 이상 푸시가 가지 않게 한다. */
export async function unregisterIosPush(): Promise<void> {
  if (!isIos()) return;
  try {
    // 세션이 살아있을 때(=로그아웃 API 호출 전) 불려야 401 이 나지 않는다.
    if (lastToken) {
      await api("/api/push/unregister", { method: "POST", json: { token: lastToken } }).catch(() => {});
    }
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.removeAllListeners();
    listenersReady = false;
    lastToken = null;
  } catch {
    /* 무시 */
  }
}
