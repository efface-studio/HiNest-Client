import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth";
import { FeatureFlagsProvider } from "./lib/featureFlags";
import { isPreviewMode, ensurePreviewPatched } from "./lib/previewFlag";
import { notifyLiveUpdateReady } from "./lib/liveUpdates";
import { reportClientError } from "./lib/errorReporter";
import { ThemeProvider } from "./theme";
import "./styles.css";

// Capacitor Live Updates — 새 OTA 번들이 로드된 직후 10초 안에 호출돼야 '정상 시작' 으로 간주.
// 안 호출되면 직전 정상 번들로 자동 롤백(벽돌 앱 방지). 네이티브가 아니면 no-op.
void notifyLiveUpdateReady();

// 네이티브 앱 스플래시 — 번들이 로드되면 네이티브 스플래시(솔리드 배경)를 내리고,
// index.html 의 커스텀 인트로 애니메이션(배지 → 'HiNest' 슬라이드인, 2초)을 시작한다.
// 네이티브 스플래시를 내린 직후 시작해야 전체 애니메이션이 보인다. 웹/standalone 은
// index.html 스크립트가 스스로 처리하므로 여기선 네이티브만 다룬다.
if (typeof window !== "undefined" && (window as any).Capacitor?.isNativePlatform?.()) {
  import("@capacitor/splash-screen")
    .then(({ SplashScreen }) => SplashScreen.hide())
    .catch(() => {})
    .finally(() => { (window as any).__hinestSplashGo?.(); });
  // 백그라운드→포그라운드 복귀 시 데이터 재싱크 — iOS WKWebView 는 복귀 때 visibilitychange 가
  // 항상 발화하진 않는다. @capacitor/app 의 appStateChange(isActive) 를 받아 visibilitychange 를
  // 합성 발화해, 기존 가시성 핸들러(알림 reload·결재 카운트·채팅 presence)가 재실행되게 한다(중앙/DRY).
  import("@capacitor/app")
    .then(({ App }) => {
      App.addListener("appStateChange", ({ isActive }) => {
        if (isActive && document.visibilityState === "visible") {
          document.dispatchEvent(new Event("visibilitychange"));
        }
      });
    })
    .catch(() => {});
}

// 키보드가 뜰 때 가운데 모달이 가려지지 않도록 — visualViewport 로 키보드 높이를 추적해
// CSS 변수 --hinest-kb-inset 에 싣는다. .modal-safe 오버레이가 이만큼 하단 패딩을 받아
// place-items-center 패널이 키보드 위로 올라온다. (모든 모달이 body 로 포털돼 일괄 적용)
if (typeof window !== "undefined" && window.visualViewport) {
  const vv = window.visualViewport;
  const root = document.documentElement;
  let raf = 0;
  const update = () => {
    raf = 0;
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty("--hinest-kb-inset", inset > 1 ? `${Math.round(inset)}px` : "0px");
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
  vv.addEventListener("resize", schedule);
  vv.addEventListener("scroll", schedule);
  update();
}

// iOS Safari 는 user-scalable=no 를 무시하므로 제스처/더블탭 확대를 JS 로 차단.
if (typeof window !== "undefined") {
  // ─────────────────────────────────────────────────────────────
  // 동적 청크 로드 실패 자동 복구 — iOS 단독형 PWA 옛 번들 고착 대응.
  // ─────────────────────────────────────────────────────────────
  // 새 배포가 나오면 해시된 청크 파일명이 바뀐다. 앱을 켜둔 채(특히 iOS
  // standalone PWA)로 옛 index/엔트리를 들고 있는 인스턴스가 "아직 한 번도
  // 안 들어간 라우트"로 이동하면, 옛 해시의 청크를 import() 하다 404 로
  // 실패하고 React.lazy 가 reject → ErrorBoundary("페이지 표시 중 문제")가 뜬다.
  // (대표적으로 자주 안 들어가는 급여명세서 같은 페이지에서 먼저 드러남.)
  //
  // 대응: Vite 의 vite:preloadError(동적 import 프리로드 실패) 를 잡아 1회만
  // 새로고침한다. SW 가 navigation 요청을 no-store 로 처리해 항상 최신
  // index.html(=최신 청크 해시)을 받으므로 reload 한 번으로 복구된다.
  // 무한 새로고침 방지: 10초 창 안에서는 재시도하지 않고 에러를 그대로
  // 흘려보내(기본 동작) ErrorBoundary 가 뜨게 한다 — 진짜로 청크가 사라진
  // 경우(네트워크 장애 등)에 reload 루프로 빠지지 않도록.
  // 로컬(dev)에서는 HMR 과 충돌하지 않도록 등록하지 않는다.
  if (!/localhost|127\.0\.0\.1/.test(window.location.hostname)) {
    window.addEventListener("vite:preloadError", () => {
      const KEY = "hinest:chunk-reload-ts";
      let last = 0;
      try { last = Number(sessionStorage.getItem(KEY) || 0); } catch {}
      if (Date.now() - last > 10_000) {
        try { sessionStorage.setItem(KEY, String(Date.now())); } catch {}
        window.location.reload();
      }
      // 10초 내 재발이면 reload 생략 → 기본 동작으로 ErrorBoundary 표시.
    });
  }

  // 전역 클라이언트 에러 → 운영 콘솔 "에러" 탭으로 보고(지금까진 클라 에러가 서버로 안 갔음).
  // 폭주 방지(10초/5건)는 reportClientError 내부. chunk reload(vite:preloadError)와는 별개.
  window.addEventListener("error", (e) => {
    const err = (e as ErrorEvent).error;
    reportClientError(err?.message || (e as ErrorEvent).message || "window error", err?.stack);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = (e as PromiseRejectionEvent).reason as { message?: string; stack?: string } | undefined;
    reportClientError(r?.message || String(r ?? "unhandledrejection"), r?.stack);
  });

  // 파일을 화면 빈 곳(드롭존이 아닌 데)에 떨어뜨리면 브라우저/Electron 이 그 파일로 페이지를
  // 이동시켜(앱이 통째로 사라짐) 버린다 — 메모에 사진 드롭하다 살짝 빗나가면 겪는 문제.
  // 메모·문서함 등 실제 드롭존은 자기 onDrop 에서 preventDefault 하므로 defaultPrevented 가 켜진다
  // → 그 외(처리 안 된) 파일 드롭만 막아 페이지가 날아가지 않게 한다. 내부 드래그(정렬 등)는
  // dataTransfer 에 "Files" 가 없어 건드리지 않음.
  const dropHasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  document.addEventListener("dragover", (e) => { if (dropHasFiles(e)) e.preventDefault(); });
  document.addEventListener("drop", (e) => { if (dropHasFiles(e) && !e.defaultPrevented) e.preventDefault(); });

  // 핀치 줌 (iOS)
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener("gesturechange", (e) => e.preventDefault());
  document.addEventListener("gestureend", (e) => e.preventDefault());
  // 더블탭 줌
  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 350) e.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false }
  );
  // 두 손가락 터치 줌 방지
  document.addEventListener(
    "touchmove",
    (e) => {
      if ((e as TouchEvent).touches.length > 1) e.preventDefault();
    },
    { passive: false }
  );

  // ─────────────────────────────────────────────────────────────
  // PWA 서비스 워커 등록 + 새 버전 감지 → "새 버전이 있어요" 배너
  // ─────────────────────────────────────────────────────────────
  // - 기본 동작: 사용자가 앱을 연 채로 새 배포가 나오면, navigator.serviceWorker
  //   가 새 SW 를 fetch 하고 updatefound 이벤트로 알림.
  // - 배너는 AppLayout 쪽에서 "hinest:update-ready" 커스텀 이벤트를 수신해서 표시.
  //   여기선 등록과 이벤트 전파만 담당.
  // - localhost 에선 등록 안 함 (dev 에서 캐시 꼬이는 거 방지).
  // 미리보기 모드면 SW 등록 자체 skip — /sw.js GET, 30분 update 폴링, controllerchange 자동 새로고침 모두
  // 데모 방문자에게 불필요. 실 서버 요청도 안 가게.
  if ("serviceWorker" in navigator && !/localhost|127\.0\.0\.1/.test(window.location.hostname) && !isPreviewMode()) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          // 페이지 로드 시점에 이미 대기 중인 SW 가 있으면 즉시 알림
          if (reg.waiting) {
            window.dispatchEvent(new CustomEvent("hinest:update-ready", { detail: { reg } }));
          }
          reg.addEventListener("updatefound", () => {
            const nw = reg.installing;
            if (!nw) return;
            nw.addEventListener("statechange", () => {
              if (nw.state === "installed" && navigator.serviceWorker.controller) {
                // 이미 활성 SW 가 있고 + 새 SW 가 설치 완료 → 업데이트 대기 중
                window.dispatchEvent(new CustomEvent("hinest:update-ready", { detail: { reg } }));
              }
            });
          });
          // 30분마다 업데이트 체크 (앱을 켜놓고 방치하는 경우 대비)
          setInterval(() => { reg.update().catch(() => {}); }, 30 * 60 * 1000);
          // 탭이 포그라운드로 돌아올 때 즉시 한번 확인 — 다른 일 보고 돌아왔을 때
          // 30분을 기다리지 않고 바로 새 버전을 끌어오게.
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
              reg.update().catch(() => {});
            }
          });
        })
        .catch(() => { /* 서비스 워커 등록 실패는 무시 */ });

      // 새 SW 가 활성화되면 한번 자동 새로고침 (사용자가 배너의 "새로고침" 을 눌렀을 때)
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });
    });
  }
}

function renderApp() {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <FeatureFlagsProvider>
              <App />
            </FeatureFlagsProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </React.StrictMode>
  );
}

// 미리보기 모드 부트스트랩 — 새로고침 후 fetch/EventSource 가 실제 서버로 새지 않게, 무거운
// 목 데이터 모듈(previewMock)을 지연 로드해 네트워크 패치를 적용한 "뒤에" 렌더한다.
// 일반 사용자(미리보기 아님)는 ensurePreviewPatched 가 즉시 resolve → previewMock 을 아예
// 로드하지 않아 메인 번들에서 목 데이터(~25KB gzip)가 빠진다. preview 일 때만 짧게 await.
ensurePreviewPatched().finally(renderApp);
