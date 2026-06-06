/**
 * 네이티브(iOS/Android) 키보드·상태바 색을 앱 테마(light/dark) 에 맞춰 동기화한다.
 *
 * 기본적으로 iOS 키보드와 상태바는 OS 시스템 설정만 따라간다 — 그래서 앱 안에서 다크 테마를 켜도
 * 키보드는 라이트(시스템 설정)로 떠 어색해진다. Capacitor Keyboard.setStyle / StatusBar.setStyle
 * 을 명시 호출해 앱 테마를 따라가게 만든다.
 *
 * 웹/데스크톱은 플러그인이 없어 reject 되거나 no-op — try/catch 로 안전하게 무시한다.
 */
import { isCapacitorNative } from "./platform";

let _last: "light" | "dark" | null = null;

export async function applyNativeTheme(resolved: "light" | "dark"): Promise<void> {
  if (!isCapacitorNative()) return;
  if (_last === resolved) return; // 같은 값 중복 호출 방지(불필요한 IPC 절약)
  _last = resolved;
  try {
    const { Keyboard, KeyboardStyle } = await import("@capacitor/keyboard");
    await Keyboard.setStyle({ style: resolved === "dark" ? KeyboardStyle.Dark : KeyboardStyle.Light });
  } catch { /* no-op on web/desktop */ }
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    // 다크 배경 위 → 흰 글자(Light), 라이트 배경 위 → 어두운 글자(Dark).
    await StatusBar.setStyle({ style: resolved === "dark" ? Style.Light : Style.Dark });
  } catch { /* StatusBar 플러그인 미설치 환경 — 조용히 무시 */ }
}
