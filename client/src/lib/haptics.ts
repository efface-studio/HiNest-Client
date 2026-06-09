/**
 * 햅틱 피드백 헬퍼 — iOS/iPadOS·안드로이드 네이티브에서 동작, 웹/데스크톱은 no-op.
 *
 * iOS: 네이티브 LiquidGlassTabBar.haptic(기존 경로 — 느낌 그대로 유지). 탭바 전환은 Swift
 *      UITabBarDelegate 가 직접 selection 햅틱.
 * 안드로이드: @capacitor/haptics(Vibrator) — iOS 와 동일 지점(attachGlobalHaptics 의 버튼·토글·탭,
 *      data-haptic, AdminPage 드래그 등)에서 같은 강도로 진동. 하단 탭은 CSS 바라 [role=tab]
 *      분기가 selection 햅틱을 준다.
 */
import { isCapacitorNative, nativePlatform } from "./platform";

type HapticStyle = "light" | "medium" | "heavy" | "selection" | "success" | "warning" | "error";

let _plugin: typeof import("./liquidGlassTabBar").LiquidGlassTabBar | null = null;

function isNative(): boolean {
  return isCapacitorNative(); // iOS + Android (웹/데스크톱 제외)
}

/** 안드로이드 햅틱 — @capacitor/haptics 로 매핑(impact/notification). */
function androidHaptic(style: HapticStyle): void {
  void import("@capacitor/haptics")
    .then(({ Haptics, ImpactStyle, NotificationType }) => {
      try {
        if (style === "success" || style === "warning" || style === "error") {
          const type =
            style === "success" ? NotificationType.Success : style === "warning" ? NotificationType.Warning : NotificationType.Error;
          void Haptics.notification({ type }).catch(() => {});
        } else {
          // selection/light → Light, medium → Medium, heavy → Heavy (iOS 강도 차등과 동일 결).
          const impact =
            style === "heavy" ? ImpactStyle.Heavy : style === "medium" ? ImpactStyle.Medium : ImpactStyle.Light;
          void Haptics.impact({ style: impact }).catch(() => {});
        }
      } catch {
        /* no-op */
      }
    })
    .catch(() => {});
}

export function haptic(style: HapticStyle = "light"): void {
  if (!isNative()) return;
  if (nativePlatform() === "android") {
    androidHaptic(style);
    return;
  }
  // iOS — 기존 네이티브 경로(느낌 유지).
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

    // 강도 차등화(사용자 요구):
    //  - selection : 가장 약함. 토글·자주 누르는 작은 버튼(btn-ghost / btn-icon / btn-xs).
    //                네비바 탭 전환도 selection — "딱 적당함" 보존.
    //  - light     : 일반 액션 버튼·링크·CTA(btn-primary 등). 기존 기본값 그대로.
    //  - medium    : 명시적 [data-haptic="medium"] 만 사용(파괴적 액션·중요 확정).
    // 명시 [data-haptic="<style>"] 가 있으면 그걸 우선.
    const explicit = el.getAttribute("data-haptic") as
      | "light" | "medium" | "heavy" | "selection" | "success" | "warning" | "error" | null;
    if (explicit) { haptic(explicit); return; }

    const role = el.getAttribute("role");
    const isToggle =
      role === "switch" ||
      role === "tab" ||
      (el as HTMLInputElement).type === "checkbox" ||
      (el as HTMLInputElement).type === "radio";
    if (isToggle) { haptic("selection"); return; }

    // 작고 자주 누르는 보조 버튼(btn-ghost / btn-icon / btn-xs) — 강도 한 단계 낮춤.
    const cls = el.className || "";
    if (typeof cls === "string" && /\b(btn-ghost|btn-icon|btn-xs)\b/.test(cls)) {
      haptic("selection");
      return;
    }
    haptic("light");
  };
  // passive — 스크롤 성능 영향 없음. capture 로 자식이 stopPropagation 해도 잡음.
  document.addEventListener("pointerdown", handler, { passive: true, capture: true });
  return () => document.removeEventListener("pointerdown", handler, { capture: true } as any);
}
