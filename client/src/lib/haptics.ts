/**
 * 햅틱 피드백 헬퍼 — iOS/iPadOS 네이티브에서만 동작, 그 외(웹/데스크톱/안드로이드)는 no-op.
 *
 * 네이티브 LiquidGlassTabBar.haptic 을 호출(추가 Capacitor 플러그인 의존성 없음).
 * 탭바 전환은 Swift 쪽 UITabBarDelegate 가 직접 selection 햅틱을 주고, 웹 DOM 의 버튼·토글
 * 탭은 AppLayout 의 전역 pointerdown 리스너가 light 햅틱을 준다(아래 attachGlobalHaptics).
 */
import { nativePlatform } from "./platform";

type HapticStyle = "light" | "medium" | "heavy" | "selection" | "success" | "warning" | "error";

let _plugin: typeof import("./liquidGlassTabBar").LiquidGlassTabBar | null = null;

function isNative(): boolean {
  return nativePlatform() === "ios"; // iPad 도 Capacitor 에선 "ios"
}

export function haptic(style: HapticStyle = "light"): void {
  if (!isNative()) return;
  try {
    if (!_plugin) {
      // 동기 import 캐시 — 첫 호출 시 모듈 로드.
      void import("./liquidGlassTabBar").then((m) => {
        _plugin = m.LiquidGlassTabBar;
        _plugin.haptic({ style }).catch(() => {});
      });
      return;
    }
    void _plugin.haptic({ style }).catch(() => {});
  } catch {
    /* no-op */
  }
}

/**
 * 전역 햅틱 — 버튼·토글·링크·체크박스 탭에 light 햅틱을 자동으로 건다.
 * AppLayout 마운트 시 1회 호출. 반환된 함수로 해제.
 *
 * pointerdown 으로 누르는 순간 즉시 반응(클릭 완료까지 안 기다림 = 더 native 한 느낌).
 * 텍스트 입력/스크롤 영역은 제외해 오발 방지. 비활성(disabled) 요소도 제외.
 */
export function attachGlobalHaptics(): () => void {
  if (!isNative()) return () => {};
  const SELECTOR =
    'button, [role="button"], [role="switch"], [role="tab"], a[href], ' +
    'input[type="checkbox"], input[type="radio"], label[data-haptic], [data-haptic]';
  const handler = (e: PointerEvent) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const el = t.closest(SELECTOR) as HTMLElement | null;
    if (!el) return;
    // 비활성 요소·data-no-haptic 은 제외.
    if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return;
    if (el.closest("[data-no-haptic]")) return;
    // 스위치/체크박스/탭은 selection, 나머지는 light.
    const role = el.getAttribute("role");
    const isToggle =
      role === "switch" ||
      role === "tab" ||
      (el as HTMLInputElement).type === "checkbox" ||
      (el as HTMLInputElement).type === "radio";
    haptic(isToggle ? "selection" : "light");
  };
  // passive — 스크롤 성능 영향 없음. capture 로 자식이 stopPropagation 해도 잡음.
  document.addEventListener("pointerdown", handler, { passive: true, capture: true });
  return () => document.removeEventListener("pointerdown", handler, { capture: true } as any);
}
