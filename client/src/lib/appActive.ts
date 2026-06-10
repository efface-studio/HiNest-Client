/**
 * 네이티브 앱 포그라운드(active) 상태 추적 — @capacitor/app 의 appStateChange.
 *
 * 왜 document.visibilityState 가 아니라 이걸 쓰나:
 *   안드로이드 Capacitor WebView 는 앱을 백그라운드로 내리거나 화면을 잠가도 document.visibilityState
 *   가 "visible"(hidden=false, hasFocus=true)로 남는다 — 실기기(SM-S901N, Android 16)에서 확인됨.
 *   그래서 "포그라운드일 때만" 류의 가드가 안드로이드에선 항상 통과한다. @capacitor/app 의
 *   appStateChange(isActive) 는 Activity onResume/onPause(OS 레벨)에 정확히 대응해 iOS·안드로이드
 *   양쪽에서 신뢰할 수 있다.
 *
 * 비네이티브(웹/데스크톱)에선 항상 true 를 반환한다(호출 측이 네이티브 분기 안에서만 쓰는 전제).
 */
import { isCapacitorNative } from "./platform";

let active = true;
let wired = false;

function ensureWired(): void {
  if (wired || !isCapacitorNative()) return;
  wired = true;
  import("@capacitor/app")
    .then(({ App }) => {
      // 초기 상태 시드(앱은 보통 포그라운드로 시작하지만 정확히 맞춘다).
      App.getState()
        .then((s) => { active = s.isActive; })
        .catch(() => {});
      App.addListener("appStateChange", ({ isActive }) => { active = isActive; });
    })
    .catch(() => {
      /* 플러그인 미가용 — 기본값 active=true 유지 */
    });
}

/** 네이티브 앱이 현재 포그라운드(active)인지. 비네이티브거나 미확정이면 true. */
export function isNativeAppActive(): boolean {
  ensureWired();
  return active;
}
