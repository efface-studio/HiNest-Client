/**
 * 네이티브(iOS/Android) 키보드·상태바 색을 앱 테마(light/dark) 에 맞춰 동기화한다.
 *
 * 기본적으로 iOS 키보드와 상태바는 OS 시스템 설정만 따라간다 — 그래서 앱 안에서 다크 테마를 켜도
 * 키보드는 라이트(시스템 설정)로 떠 어색해진다. Capacitor Keyboard.setStyle / StatusBar.setStyle
 * 을 명시 호출해 앱 테마를 따라가게 만든다.
 *
 * 웹/데스크톱은 플러그인이 없어 reject 되거나 no-op — try/catch 로 안전하게 무시한다.
 */
import { isCapacitorNative, nativePlatform } from "./platform";

let _last: "light" | "dark" | null = null;

export async function applyNativeTheme(resolved: "light" | "dark"): Promise<void> {
  if (!isCapacitorNative()) return;
  if (_last === resolved) return; // 같은 값 중복 호출 방지(불필요한 IPC 절약)
  _last = resolved;
  // Keyboard.setStyle 은 iOS 전용 — Android 에선 UNIMPLEMENTED 로 reject 돼
  // (try/catch 로 무해하지만) logcat 에 에러가 찍힌다. iOS 에서만 호출.
  if (nativePlatform() === "ios") {
    try {
      const { Keyboard, KeyboardStyle } = await import("@capacitor/keyboard");
      await Keyboard.setStyle({ style: resolved === "dark" ? KeyboardStyle.Dark : KeyboardStyle.Light });
    } catch { /* no-op on web/desktop */ }
  }
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    // 다크 배경 위 → 흰 글자(Light), 라이트 배경 위 → 어두운 글자(Dark).
    await StatusBar.setStyle({ style: resolved === "dark" ? Style.Light : Style.Dark });
  } catch { /* StatusBar 플러그인 미설치 환경 — 조용히 무시 */ }
}

let _lastMode: "light" | "dark" | "system" | null = null;

/**
 * 앱 테마 모드(light/dark/system)를 네이티브 윈도우/탭바 트레잇에 반영한다.
 *
 * resolved(light|dark) 가 아니라 mode 를 받는 이유: system 모드는 .unspecified 로 둬야
 * OS 설정을 따라가고 WebView 의 prefers-color-scheme 도 정상 동작한다. 명시(light/dark)
 * 모드는 그 색으로 고정. 저장은 네이티브가 하므로 다음 실행 첫 페인트부터 올바른 색.
 */
export async function applyNativeInterfaceStyle(mode: "light" | "dark" | "system"): Promise<void> {
  if (!isCapacitorNative()) return;
  if (_lastMode === mode) return;
  _lastMode = mode;
  try {
    const { LiquidGlassTabBar } = await import("./liquidGlassTabBar");
    await LiquidGlassTabBar.setInterfaceStyle({ style: mode });
  } catch { /* iOS<26 미지원/플러그인 부재 — 무해하게 무시 */ }
}
