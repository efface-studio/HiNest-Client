/**
 * 네이티브 앱(Capacitor) 세션 토큰 저장소.
 *
 * iOS WKWebView 는 origin 이 https://localhost 라, 다른 도메인인 API 서버가 발급한 세션
 * 쿠키가 cross-site(third-party)로 취급돼 추적 방지(ITP)에 막힌다. 그래서 로그인 직후엔
 * 메모리의 user 로 동작하지만, 새로고침하면 /api/me 가 쿠키 없이 호출돼 401 → 로그아웃된다.
 *
 * 해결: 로그인 응답으로 받은 세션 JWT 를 localStorage 에 저장하고, 모든 API 요청에
 * `Authorization: Bearer` 헤더로 실어 보낸다(쿠키/ITP 에 의존하지 않음).
 *
 * 네이티브에서만 동작한다 — 웹/데스크톱은 기존 httpOnly 쿠키를 그대로 쓰고 토큰을 저장하지
 * 않는다(JS 가 토큰을 읽을 수 없게 두어 XSS 토큰 탈취 표면을 만들지 않음). localStorage 는
 * WKWebView 에서 새로고침·앱 재실행 후에도 유지된다.
 */
import { isCapacitorNative, nativePlatform } from "./platform";
import { LiquidGlassTabBar } from "./liquidGlassTabBar";
import { HiNestNative } from "./hinestNative";

const KEY = "hinest.authToken";

/** 저장된 세션 토큰. 네이티브가 아니거나 없으면 null. */
export function getAuthToken(): string | null {
  if (!isCapacitorNative()) return null;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** 토큰 저장(네이티브 한정). falsy 면 제거. 웹/데스크톱은 no-op. */
export function setAuthToken(token: string | null | undefined): void {
  if (!isCapacitorNative()) return;
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage 비활성/quota — 무시 */
  }
  // 채팅 발신자 아바타 알림이 /uploads 인증에 쓰도록 네이티브에 토큰을 공유한다. 토큰 없으면 빈 값=제거.
  //  · iOS: 공유 App Group(NSE 가 읽음). App Group 미설정/구버전이면 내부 no-op·reject → 무시(무해).
  //  · Android: SharedPreferences(HiNestMessagingService 가 읽음). 플러그인 없으면 reject → 무시(무해).
  try {
    void LiquidGlassTabBar.setSharedToken({ token: token ?? "" }).catch(() => {});
  } catch {
    /* 플러그인 미가용 — 무시 */
  }
  if (nativePlatform() === "android") {
    try {
      void HiNestNative.setSessionToken({ token: token ?? "" }).catch(() => {});
    } catch {
      /* 플러그인 미가용 — 무시 */
    }
  }
}

/** 로그아웃·세션 만료 시 저장 토큰 제거. */
export function clearAuthToken(): void {
  setAuthToken(null);
}
