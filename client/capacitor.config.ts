import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor 네이티브 셸 설정 — iOS / Android 앱스토어 제출용.
 *
 * 전제: 이 웹앱은 쿠키 기반 세션 인증(hinest_token)을 쓰고, 대부분의 요청이
 * 상대경로(/api, /uploads)다. 네이티브 WebView 의 오리진은 capacitor://localhost(iOS)
 * 또는 https://localhost(Android)라서 상대경로가 서버에 닿지 않는다.
 *
 * 그래서 두 가지 중 하나를 선택한다:
 *
 *  (A) 번들 자산 방식 [기본] — webDir(dist)을 그대로 싣고, API 는 VITE_API_BASE 로
 *      절대 오리진을 주입한다(.env.production 참고). 더 "네이티브"하고 오프라인 셸이
 *      가능하지만, 서버가 네이티브 오리진에 대해 CORS + 쿠키(SameSite=None; Secure)를
 *      허용하거나 토큰 인증을 추가해야 세션이 붙는다. (네이티브 전용 후속 작업)
 *
 *  (B) 원격 URL 방식 — 아래 server.url 주석을 풀어 라이브 사이트를 그대로 로드한다.
 *      모든 상대경로·쿠키가 1st-party 로 동작해 소스 변경이 필요 없다. 대신 Apple
 *      가이드라인 4.2(단순 웹 래퍼) 리스크가 있고 항상 네트워크가 필요하다.
 *
 * appId 는 본인의 Apple Developer / Google Play 번들 ID 로 반드시 교체할 것.
 */
const config: CapacitorConfig = {
  appId: "com.hivits.hinest",
  appName: "HiNest",
  webDir: "dist",
  // 안드로이드 기본 스킴을 https 로 — Secure 쿠키/Service Worker 가 정상 동작하도록.
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: "https",
    iosScheme: "https",
    // (B) 원격 URL 방식으로 빠르게 테스트하려면 아래 두 줄의 주석을 해제:
    // url: "https://nest.hi-vits.com",
    // cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: "#3B5CF0",
      showSpinner: false,
    },
  },
};

export default config;
