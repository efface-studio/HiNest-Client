/**
 * 로그인 직후 알림 권한을 요청한다 — iOS/Android(Capacitor) · macOS/Windows(Electron) 전용.
 *
 * 왜 "로그인 시점"인가:
 *  - Apple/Google 모두 콜드 런치 즉시보다 맥락 있는 시점(로그인 후) 요청을 권장한다.
 *    (App Store 심사에서도 권한 프롬프트 타이밍을 본다)
 *  - 미리보기("둘러보기") 모드는 실제 로그인이 아니므로 요청하지 않는다.
 *
 * 플랫폼별 동작:
 *  - iOS/Android (Capacitor): @capacitor/local-notifications 의 requestPermissions()
 *    → OS 네이티브 "알림 허용" 시스템 프롬프트. 원격 푸시(APNs/FCM)·서버 연동 불필요.
 *  - macOS/Windows (Electron): 렌더러의 Notification.requestPermission() 은 Electron 에선
 *    프롬프트 없이 즉시 "granted" 라 소용이 없다. 대신 main 프로세스가 첫 알림을 실제로
 *    post 하는 순간 OS 가 권한 프롬프트를 띄우므로, window.hinest.showNotification() 으로
 *    환영 알림을 1회 발송해 프롬프트를 끌어낸다.
 *  - 일반 웹: 자동 요청하지 않는다. 브라우저는 Notification.requestPermission() 호출 시
 *    사용자 제스처(클릭) 컨텍스트를 요구하는데(특히 Safari/Firefox), 로그인은 비동기 콜백이라
 *    제스처가 끊겨 무시된다. 웹은 기존대로 프로필 설정의 "데스크톱 알림 켜기" 버튼으로 요청한다.
 *
 * 한 번 물어보면(허용/거부 무관) 다시 묻지 않도록 localStorage 플래그로 가드한다.
 * (요청이 예외로 실패하면 플래그를 세우지 않아 다음 로그인에서 재시도)
 */
import { isCapacitorNative, isDesktopApp, nativePlatform } from "./platform";

const ASKED_KEY = "hinest.notif.askedOnLogin";

function isPreview(): boolean {
  return typeof window !== "undefined" && (window as { __HINEST_PREVIEW__?: boolean }).__HINEST_PREVIEW__ === true;
}

function alreadyAsked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

function markAsked() {
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    /* localStorage 불가 환경 — 무시 */
  }
}

/**
 * 로그인/회원가입 성공 직후 호출한다. 흐름을 막지 않도록 fire-and-forget(void) 로 부른다.
 * 설치형 앱(iOS/Android/데스크톱)에서만 1회 권한 프롬프트를 띄운다.
 */
export async function requestNotifPermissionOnLogin(): Promise<void> {
  if (typeof window === "undefined") return;
  if (isPreview()) return; // 데모(둘러보기) 모드에선 요청하지 않음
  if (alreadyAsked()) return;

  try {
    if (isCapacitorNative()) {
      if (nativePlatform() === "ios") {
        // iOS 는 원격 푸시(APNs) 경로가 권한 요청+토큰 등록을 모두 담당한다.
        // (auth.tsx 의 user effect → setupIosPush). 여기선 중복 요청하지 않음.
        return;
      }
      // Android — 네이티브 로컬 알림 권한 (원격 FCM 은 추후). 동적 import 로 웹/데스크톱 번들엔 미포함.
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      await LocalNotifications.requestPermissions();
      markAsked();
    } else if (isDesktopApp()) {
      // macOS/Windows (Electron) — 첫 알림 post 가 OS 권한 프롬프트를 띄운다
      await window.hinest?.showNotification?.({
        title: "HiNest",
        body: "로그인되었습니다. 새 소식이 생기면 여기로 알려드릴게요.",
      });
      markAsked();
    }
    // 일반 웹은 위 주석대로 자동 요청하지 않음(프로필 토글로 처리).
  } catch {
    // 권한 요청 실패는 조용히 무시 — 앱 흐름을 막지 않는다 (플래그 미설정 → 다음 로그인 재시도)
  }
}
