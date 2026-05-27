import { Router } from "express";

/**
 * 데스크톱 앱 다운로드 프록시.
 *
 * 왜 직접 GitHub Releases 링크를 두지 않는가:
 *   1) Chrome / Edge 의 "Safe Browsing" 평판 시스템은 도메인+파일명 조합 기반.
 *      github.com/.../releases/download/... 직접 링크는 매번 새 평판으로 시작.
 *      자체 도메인(api.nest.hi-vits.com)에서 일관된 경로(/api/download/windows)로
 *      배포하면 평판이 점진적으로 쌓여 \"이 파일은 일반적으로 다운로드되지 않습니다\"
 *      경고가 시간이 지나면서 사라진다.
 *   2) 명시적 Content-Type / Content-Disposition 으로 일부 브라우저의
 *      MIME 추측 실패에 의한 다운로드 실패를 차단.
 *   3) GitHub 의 release 자산 URL 이 바뀌어도 클라이언트는 그대로 사용 가능.
 *
 * 보안:
 *   - 이 엔드포인트는 GET 만 받고 외부 GitHub Releases 의 정해진 자산만 스트림.
 *     사용자 입력으로 fetch URL 이 정해지지 않으므로 SSRF 위험 없음.
 *   - 인증 불필요 — 다운로드 페이지는 공개.
 *
 * 코드 서명:
 *   궁극적인 해결은 EV Code Signing Cert (Windows) / Apple Developer ID (macOS) 로
 *   서명하는 것. 그 전엔 SmartScreen 경고를 사용자가 \"추가 정보 → 실행\" 으로
 *   넘기는 안내 UI 가 최선. README/DownloadPage 에 명시.
 */

const router = Router();

const RELEASES_BASE = "https://github.com/Xixn2/HiNest-Desktop/releases/latest/download";

// 화이트리스트된 자산만 프록시 가능. 키 = URL 경로, 값 = upstream 파일명.
const ASSETS: Record<string, { upstream: string; filename: string; contentType: string }> = {
  windows: {
    upstream: "HiNest-Setup.exe",
    filename: "HiNest-Setup.exe",
    contentType: "application/octet-stream",
  },
  "mac-arm64": {
    upstream: "HiNest-arm64.dmg",
    filename: "HiNest-arm64.dmg",
    contentType: "application/x-apple-diskimage",
  },
  "mac-x64": {
    upstream: "HiNest-x64.dmg",
    filename: "HiNest-x64.dmg",
    contentType: "application/x-apple-diskimage",
  },
};

router.get("/:asset", async (req, res) => {
  const asset = ASSETS[req.params.asset];
  if (!asset) return res.status(404).json({ error: "unknown asset" });

  const upstreamUrl = `${RELEASES_BASE}/${asset.upstream}`;
  try {
    const r = await fetch(upstreamUrl, { redirect: "follow" });
    if (!r.ok || !r.body) {
      // 404 (해당 자산이 아직 안 올라온 릴리스) 또는 5xx — 그대로 패스.
      return res.status(r.status === 404 ? 404 : 502).json({
        error: r.status === 404 ? "아직 빌드되지 않은 파일입니다" : "다운로드 서버 오류",
      });
    }

    // 명시적 다운로드 헤더 — 브라우저 MIME 추측 실패로 인한 \"안전하지 않은 파일\" 분류 차단.
    res.setHeader("Content-Type", asset.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${asset.filename}"; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    // 업스트림에서 길이 알 수 있으면 그대로 전달 — 브라우저 진행률 바.
    const len = r.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);
    // 브라우저 캐시 1시간 — 새 릴리스가 자주 안 나오므로 안전.
    res.setHeader("Cache-Control", "public, max-age=3600");

    // ETag 가 있으면 그대로 전달 — 브라우저가 304 활용 가능.
    const etag = r.headers.get("etag");
    if (etag) res.setHeader("ETag", etag);

    // ReadableStream → Node.js Readable → res.
    // Node 18+ 의 web stream interop 사용.
    const { Readable } = await import("node:stream");
    Readable.fromWeb(r.body as any).pipe(res);
  } catch (e: any) {
    console.error("[desktopDownload] proxy failed", upstreamUrl, e?.message ?? e);
    if (!res.headersSent) {
      res.status(502).json({ error: "다운로드 서버 오류" });
    } else {
      res.end();
    }
  }
});

export default router;
