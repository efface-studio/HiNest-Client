import { useEffect } from "react";
import { useAuth } from "../auth";
import { clearApiCache } from "../api";
import { enablePreview } from "../lib/previewFlag";
import AppLayout from "../components/AppLayout";
import DashboardPage from "./DashboardPage";

/**
 * /preview 진입점 — 미리보기 모드 + 데모 사용자로 부트스트랩한 뒤 실제 워크스페이스 그대로 렌더.
 *
 * 디자인 결정:
 *  - 더 이상 nav("/") 로 리다이렉트하지 않음 → URL 이 `/preview` 그대로 유지돼 공유/북마크 가능.
 *  - 사이드바에서 다른 메뉴(예: 회의록) 를 클릭하면 그때 /meetings 등으로 자연스럽게 이동.
 *  - 데모 사용자가 아직 로드되기 전엔 짧은 환영 화면을 보여줘 깜빡임 방지.
 */
export default function PreviewEntry() {
  const { user, refresh } = useAuth();

  useEffect(() => {
    // 동기 플래그 세팅 → 모든 후속 api() 호출이 mock 으로 단락.
    enablePreview();
    clearApiCache();
    refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // user 가 아직 채워지기 전 (1프레임~) — 환영 화면.
  if (!user) {
    return (
      <div
        className="min-h-screen grid place-items-center px-6"
        style={{ background: "linear-gradient(180deg, var(--c-surface-1) 0%, var(--c-surface-2) 100%)" }}
      >
        <div className="text-center max-w-[420px]">
          <div
            className="w-14 h-14 mx-auto rounded-2xl grid place-items-center mb-5"
            style={{
              background: "linear-gradient(135deg, var(--c-brand) 0%, #7C3AED 100%)",
              boxShadow: "0 10px 28px rgba(67,56,202,0.28)",
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <div className="text-[20px] font-extrabold text-ink-900 tracking-tight">HiNest 미리보기</div>
          <div className="text-[13px] text-ink-500 mt-2 leading-relaxed">
            로그인 없이 실제 화면을 둘러보실 수 있어요.<br />
            데모 데이터로 가입하지 않고도 모든 기능을 미리 체험해 보세요.
          </div>
          <div className="mt-6 inline-flex items-center gap-2 text-[12px] text-ink-500">
            <span
              className="inline-block w-3 h-3 rounded-full"
              style={{ background: "var(--c-brand)", animation: "hinest-pulse 1.1s ease-in-out infinite" }}
            />
            잠시만 기다려 주세요…
          </div>
        </div>
        <style>{`@keyframes hinest-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.7); } }`}</style>
      </div>
    );
  }

  // 데모 사용자 로드 완료 → 평소처럼 AppLayout + DashboardPage 렌더 (URL = /preview 유지).
  // AppLayout 안의 PreviewOnboarding 이 자동으로 온보딩 카드를 띄움.
  // 사이드바 클릭으로 /schedule 같은 다른 페이지로 이동하면 그때 일반 라우트로 자연스럽게 빠짐.
  return (
    <AppLayout>
      <DashboardPage />
    </AppLayout>
  );
}
