import { isPreviewMode, disablePreview } from "../lib/previewFlag";
import { isCapacitorNative } from "../lib/platform";

/**
 * 미리보기 모드 알림 배너 — 화면 최상단 고정. 클릭하면 가입 페이지로.
 * 모바일에서는 한 줄에 압축 (긴 텍스트는 줄임표), 데스크톱에서는 풀 메시지.
 * iOS 노치 영역(var(--sa-top, env(safe-area-inset-top)))을 흡수해서 상태바와 자연스럽게 융합.
 *
 * 네이티브 앱(Capacitor) 에선 배너를 숨긴다 — '전체' 탭의 로그아웃 = 미리보기 종료.
 * (모바일 화면을 데모 마크업 없이 깔끔하게 보여주려는 요구사항.)
 */
export default function PreviewBanner({ safeAreaTop = true }: { safeAreaTop?: boolean }) {
  if (!isPreviewMode()) return null;
  if (isCapacitorNative()) return null;
  return (
    <div
      className="hinest-preview-banner"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 9999,
        background: "linear-gradient(90deg, var(--c-brand) 0%, #7C3AED 100%)",
        color: "#fff",
        paddingTop: safeAreaTop ? "max(7px, calc(var(--sa-top, env(safe-area-inset-top)) + 4px))" : 7,
        paddingBottom: 7,
        paddingLeft: "max(12px, var(--sa-left, env(safe-area-inset-left)))",
        paddingRight: "max(12px, var(--sa-right, env(safe-area-inset-right)))",
      }}
    >
      <div className="flex items-center gap-2 max-w-[1400px] mx-auto">
        <span
          className="flex-1 min-w-0 truncate text-[11.5px] sm:text-[12.5px] font-bold"
          style={{ opacity: 0.95 }}
        >
          <span className="sm:hidden">👀 미리보기 모드 · 데모 데이터예요</span>
          <span className="hidden sm:inline">👀 미리보기 모드 — 데이터는 모두 데모입니다 · 변경 사항은 저장되지 않아요</span>
        </span>
        <button
          type="button"
          onClick={() => {
            try { sessionStorage.removeItem("hinest:preview-onboarded"); } catch {}
            window.location.reload();
          }}
          title="가이드 다시 보기"
          aria-label="가이드 다시 보기"
          className="flex-shrink-0"
          style={{
            background: "rgba(255,255,255,0.16)",
            color: "#fff",
            padding: "4px 10px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 800,
            border: "1px solid rgba(255,255,255,0.26)",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <span className="sm:hidden">가이드</span>
          <span className="hidden sm:inline">가이드 다시 보기</span>
        </button>
        <button
          type="button"
          onClick={() => {
            disablePreview();
            // SPA 네비게이션으로 가면 LoginPage 의 `if (user) return <Navigate to="/" />` 가
            // 데모 user 상태(아직 React 메모리에 남아있음) 때문에 다시 "/" 로 튕긴다.
            // 하드 리로드로 강제 인증 재검증 — /api/me 401 → user=null → /login 정상 표시.
            window.location.href = "/login";
          }}
          className="flex-shrink-0"
          style={{
            background: "#fff",
            color: "var(--c-brand)",
            padding: "4px 11px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 800,
            whiteSpace: "nowrap",
            border: 0,
            cursor: "pointer",
          }}
        >
          <span className="sm:hidden">로그인 →</span>
          <span className="hidden sm:inline">실제 계정으로 로그인 →</span>
        </button>
      </div>
    </div>
  );
}
