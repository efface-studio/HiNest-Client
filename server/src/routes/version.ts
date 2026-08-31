import { Router } from "express";

/**
 * 데스크톱 앱 버전 관리 엔드포인트.
 *
 * 배포 플로우:
 *  - 새 데스크톱 앱 빌드를 발행할 때, 아래 LATEST_DESKTOP_VERSION 을 올리고 서버 재시작
 *  - 클라이언트는 이 값과 자기 앱 버전(preload 에서 넘겨주는 electron app.getVersion) 을 비교
 *  - 다르면 UpdateBanner 로 "새 버전 나왔어요" 안내 후 재시작 유도
 *
 * 나중에 electron-updater 붙이면:
 *  - downloadUrl 을 돌려주고 앱이 자동으로 내려받음
 *  - hardForce 플래그가 true 면 모달을 닫을 수 없게 만들 수도 있음
 */

export const LATEST_DESKTOP_VERSION = process.env.DESKTOP_VERSION ?? "0.1.3";
export const MIN_DESKTOP_VERSION = process.env.DESKTOP_MIN_VERSION ?? "0.0.0";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    latest: LATEST_DESKTOP_VERSION,
    min: MIN_DESKTOP_VERSION,
    releasedAt: new Date().toISOString(),
    notes: "버그 수정 및 안정성 개선.",
  });
});

export default router;
