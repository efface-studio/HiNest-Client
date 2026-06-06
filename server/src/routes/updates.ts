import { Router } from "express";

/**
 * Capacitor Live Updates (Capgo) self-hosted endpoint.
 *
 * 셸(iOS/Android 네이티브 앱)이 정기적으로 이 endpoint 에 현재 번들 정보를 POST 해
 * 새 버전이 있는지 묻는다. 응답 형식은 Capgo SDK 규약을 따른다:
 *   업데이트 있음:   { version, url, checksum, sessionKey?, message? }
 *   최신 상태:       { error: "no_new_version_available", message: "..." }
 *
 * Phase 1 (현재): 항상 "최신 상태" 응답 — 셸/네트워크 경로만 살려두고, 실제 OTA 배포는
 *   Phase 2 에서 zip 배포 파이프라인이 들어간 뒤 활성화. 그때까지 클라 capacitor.config 도
 *   autoUpdate=false 라 사실상 호출되지 않지만, 셸 환경 변화로 호출돼도 안전하도록 endpoint
 *   자체는 살아있게 둔다.
 *
 * Phase 2 에서 할 일:
 *   1) 빌드 산출물 dist/ 를 zip → S3/Vercel 정적 호스팅 위치에 업로드
 *   2) 메타(version, checksum, url)를 DB/객체스토리지에 저장
 *   3) 이 endpoint 가 (currentVersion, channel) 보고 새 메타 있으면 그걸 반환
 *   4) (선택) /api/updates/stats — 다운로드/실패 통계 수집
 */
const router = Router();

router.post("/check", (_req, res) => {
  // Phase 1 placeholder — 새 번들 없음 응답.
  res.json({
    error: "no_new_version_available",
    message: "No new version available (Live Updates Phase 1 — OTA pipeline not active yet).",
  });
});

export default router;
