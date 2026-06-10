/**
 * 안드로이드 배터리 최적화 제외 안내(카카오톡 방식).
 *
 * 백그라운드·잠금 상태에서도 채팅·알림이 즉시 오게 하려면 OEM 배터리 최적화에서 앱이 제외돼야
 * 한다(삼성 절전, 샤오미/화웨이 등 공격적 백그라운드 킬러가 앱을 재워 알림을 늦춤). FCM
 * `priority:high` + 고중요도 채널까지 갖춰도 이 OEM 변수만은 코드로 못 이겨 사용자 설정이 필요하다.
 * 카톡·디스코드도 같은 이유로 사용자에게 "배터리 최적화 제외" 안내를 띄운다.
 *
 * 동작:
 *  - 안드로이드 네이티브에서만(다른 플랫폼·구 APK·플러그인 미가용이면 조용히 no-op).
 *  - 이미 제외돼 있으면 아무것도 안 함.
 *  - 안 돼 있으면 1회 친절 안내(앱 확인 다이얼로그) → "설정 열기" 시 시스템 제외 화면으로 유도.
 *  - 한 번 물어보면(허용/거부 무관) 다시 안 묻는다(localStorage 가드).
 */
import { nativePlatform } from "./platform";
import { HiNestNative } from "./hinestNative";

const ASKED_KEY = "hinest.battery.askedV1";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function ensureAndroidBatteryExemption(): Promise<void> {
  if (typeof window === "undefined") return;
  if (nativePlatform() !== "android") return;
  try {
    if (localStorage.getItem(ASKED_KEY) === "1") return;
  } catch {
    /* localStorage 불가 — 계속 진행 */
  }
  // 이미 제외돼 있으면 안내 불필요. 플러그인 미가용(구 APK 등)이면 조용히 종료.
  try {
    const { ignoring } = await HiNestNative.isIgnoringBatteryOptimizations();
    if (ignoring) return;
  } catch {
    return;
  }
  // 알림 권한 시스템 다이얼로그가 먼저 처리되도록 잠깐 양보(두 시스템 다이얼로그가 겹치지 않게).
  await sleep(2500);
  // 허용/거부 무관 1회만(다시 안 뜨게). 거부해도 사용자가 설정에서 직접 바꿀 수 있음.
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    /* 무시 */
  }
  // 커스텀 안내 다이얼로그 없이 OS '배터리 최적화 제외' 요청 팝업을 바로 띄운다.
  // (예전엔 confirmAsync 안내 → 설정 화면 2단계였는데, 사용자 요청으로 OS 승인 팝업 1번으로 단순화.)
  try {
    await HiNestNative.requestIgnoreBatteryOptimizations();
  } catch {
    /* 인텐트 미지원 등 — 무시 */
  }
}
