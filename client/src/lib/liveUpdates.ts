/**
 * Capacitor Live Updates (Capgo, self-hosted) — 클라이언트 셸 통합.
 *
 * 동작 원리:
 *  - 네이티브 셸은 App Store 한 번만 심사받고, 이후 dist(웹 번들)는 우리 서버에서 OTA 로 받는다.
 *  - autoUpdate 가 켜져 있으면 SDK 가 백그라운드에서 updateUrl 을 폴링 → 새 버전이 있으면
 *    다운로드해 두고, 다음 콜드 스타트(앱 재실행)부터 새 번들로 교체된다.
 *  - 새 번들이 로드된 직후 10초 안에 notifyAppReady() 가 호출돼야 '정상 시작'으로 간주된다.
 *    안 호출되면 직전 정상 번들로 자동 롤백 → 빌드가 깨져도 사용자가 "벽돌 앱" 을 만나지 않음.
 *
 * Phase:
 *   1 (현재): notifyAppReady 만 호출. autoUpdate=false 라 실 OTA 는 아직. 셸/롤백 메커니즘 검증.
 *   2 (예정): 서버 endpoint + zip 배포 자동화 들어가면 autoUpdate=true 로 전환해 실 OTA 시작.
 */
import { isCapacitorNative } from "./platform";

/** 앱 진입점에서 가장 먼저 호출. 10초 안에 호출 못 하면 직전 번들로 자동 롤백. */
export async function notifyLiveUpdateReady(): Promise<void> {
  if (!isCapacitorNative()) return;
  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
    await CapacitorUpdater.notifyAppReady();
  } catch {
    // 플러그인 미가용(웹/데스크톱) — 조용히 무시. 또는 첫 빌드라 네이티브 측 미반영.
  }
}
