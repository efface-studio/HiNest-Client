/**
 * 안드로이드 전용 네이티브 보조 플러그인 브리지.
 *
 * 현재 메서드는 setSessionToken 하나 — 세션 토큰을 네이티브 SharedPreferences 에 보관해
 * HiNestMessagingService(채팅 아바타 알림)가 /uploads 아바타를 인증 다운로드할 수 있게 한다.
 * iOS 의 App Group 공유(LiquidGlassTabBar.setSharedToken)에 대응하는 안드로이드 미러.
 *
 * iOS/웹/데스크톱에는 이 플러그인이 없으므로 registerPlugin 의 웹 폴백(no-op)으로 동작 →
 * 호출해도 안전(reject 를 호출부에서 무시). 실제 동작은 안드로이드 네이티브에서만.
 */
import { registerPlugin } from "@capacitor/core";

export interface HiNestNativePlugin {
  /** 세션 토큰을 네이티브에 보관(아바타 /uploads 인증용). token="" 이면 제거(로그아웃). */
  setSessionToken(options: { token: string }): Promise<void>;
}

export const HiNestNative = registerPlugin<HiNestNativePlugin>("HiNestNative");
