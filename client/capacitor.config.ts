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
    // 새로고침/페이지 전환 중 WebView 가 비어 보이는 순간을 앱 배경색으로 깔아 검은 깜빡임 차단.
    backgroundColor: "#F5F6F8",
  },
  // iOS WebView 의 기본 배경(투명/검정)이 새로고침·전환 중 그대로 노출돼 하단바·세이프에어리어가
  // 까맣게 깜빡이는 현상이 있다 → 라이트 테마 배경(--c-bg 와 동일) 로 채워 깔끔하게.
  // 다크 모드에선 styles.css 의 background-color 가 위에 덮어 자연스럽게 동작한다.
  ios: {
    backgroundColor: "#F5F6F8",
    // ⚠️ contentInset 은 반드시 "never" — styles.css 의 .hinest-ios 가 이미
    //   `padding-top: calc(56px + env(safe-area-inset-top))` 로 직접 safe-area 를 관리한다.
    //   "automatic" 이면 WKWebView 가 자동으로 safe-area inset 을 추가해 CSS 와 이중 적용 →
    //   콘텐츠가 두 배 아래로 밀려 상단바 위 큰 빈 공간이 생긴다(#338 도입 회귀).
    //   키보드 부드러운 슬라이드는 별도의 Capacitor Keyboard plugin(resize:'native')이 처리.
    contentInset: "never",
    // 링크 롱프레스 시 뜨는 사파리식 미리보기(peek/pop) 비활성화 — 네이티브 앱엔 없는 웹 팝업.
    allowsLinkPreview: false,
  },
  server: {
    androidScheme: "https",
    iosScheme: "https",
    // (B) 원격 URL 방식으로 빠르게 테스트하려면 아래 두 줄의 주석을 해제:
    // url: "https://nest.hi-vits.com",
    // cleartext: false,
    //
    // (C) Dev hot-reload — 개발 중 npm run cap:ios:dev 로 가면 이 분기가 켜진다.
    //     시뮬레이터/실기기가 호스트 Mac 의 Vite dev 서버(http://localhost:1000)를 직접 로드 →
    //     코드 저장 시 HMR 으로 즉시 반영(매번 cap:ios 불필요). cleartext=true 로 http 허용.
    //     env var 가 없으면 평소대로 번들 자산 + Live Updates 흐름.
    ...(process.env.HINEST_CAP_DEV_SERVER
      ? { url: process.env.HINEST_CAP_DEV_SERVER, cleartext: true }
      : {}),
  },
  plugins: {
    // 키보드 등장 애니메이션 — 'native' 리사이즈는 iOS 가 WebView 자체를 키보드 곡선에 맞춰
    // 끌어올린다(CSS 트랜지션 없이도 부드러움). 'body' 보다 자연스럽고 입력 지연이 없다.
    // resizeOnFullScreen=true → 안드로이드 전체화면에서도 동일 동작.
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
    // Capacitor Live Updates (Capgo, MIT, self-hosted) — 셸은 App Store 한 번만 심사받고,
    // 웹 번들(dist)은 우리 서버에서 OTA 로 받는다. autoUpdate=true ⇒ SDK 가 백그라운드에서
    // updateUrl 폴링 → 새 버전이면 zip 다운로드 → 다음 콜드 스타트(앱 재실행) 때 새 번들로 교체.
    //   updateUrl  : POST {device_id, app_id, version, bundle_id, channel} → 새 버전 JSON 응답
    //                서버가 Vercel manifest.json 를 읽어 응답을 만든다(routes/updates.ts).
    //   appReadyTimeout: 새 번들 부팅 후 notifyAppReady() 가 이 시간(ms) 안에 안 불리면 직전
    //                정상 번들로 자동 롤백 → 빌드가 깨져도 사용자가 벽돌 앱을 만나지 않음.
    CapacitorUpdater: {
      autoUpdate: true,
      updateUrl: "https://nest.hi-vits.com/api/updates/check",
      appReadyTimeout: 10000,
      responseTimeout: 20,
      autoDeleteFailed: true,
      autoDeletePrevious: true,
      resetWhenUpdate: true,
    },
    SplashScreen: {
      // 네이티브 스플래시는 솔리드 배경(앱 bg색) 이미지로 콜드 로드만 덮는다. 번들이 로드되면
      // main.tsx 가 즉시 hide() 하고 index.html 의 커스텀 인트로(배지 → 'HiNest' 슬라이드인)가
      // 이어진다. launchAutoHide 안전망으로 1.5초 후 자동으로도 내려간다.
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#F5F6F8",
      showSpinner: false,
    },
  },
};

export default config;
