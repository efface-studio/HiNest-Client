import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 1000,
    strictPort: true,
    host: true,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/uploads": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 1000,
  },
  esbuild: {
    // 프로덕션 번들에서 debugger 삭제, console.log/debug/trace 는 "pure" 로 표시해
    // 반환값 사용 안 하면 dead code 로 제거. console.error/warn 은 살려서 장애 단서 유지.
    drop: ["debugger"],
    pure: ["console.log", "console.debug", "console.trace"],
    // es2020 — 사내 인트라넷이므로 최신 브라우저만 지원. 불필요한 polyfill/transform 제거.
    target: "es2020",
  },
  build: {
    target: "es2020",
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React 코어 — 재배포 시 변하지 않아 장기 캐시.
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "react-vendor";
          }
          // React Router
          if (id.includes("node_modules/react-router")) {
            return "router-vendor";
          }
          // TipTap 에디터 패키지 (~300KB gzip) — 회의록·문서 페이지에서만 사용.
          // 다른 페이지 초기 로드 시 다운로드 생략.
          if (id.includes("node_modules/@tiptap") || id.includes("node_modules/prosemirror")) {
            return "tiptap-vendor";
          }
          // xlsx / xlsx-js-style (~500KB gzip) — 관리자 내보내기 전용.
          // 일반 사용자 세션에서는 아예 다운로드 안 됨.
          if (id.includes("node_modules/xlsx")) {
            return "xlsx-vendor";
          }
          // highlight.js — 마크다운 코드블록 / 스니펫 페이지에서만 사용.
          // 라이브러리 자체가 ~70KB gzip 이라 main bundle 에서 빼두면
          // 첫 페이지(대시보드/로그인) 로드가 그만큼 빨라짐. lazy load 되는
          // syntaxHighlight.ts / markdown.tsx 가 import 시점에 별도 다운로드.
          if (id.includes("node_modules/highlight.js")) {
            return "highlight-vendor";
          }
          // WebAuthn — 개발자 콘솔(SuperStepUpGate) 에서만 호출.
          // 일반 사용자는 다운로드 자체 안 함.
          if (id.includes("node_modules/@simplewebauthn")) {
            return "webauthn-vendor";
          }
        },
      },
    },
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
