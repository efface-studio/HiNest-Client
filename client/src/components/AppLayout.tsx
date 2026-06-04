import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { useTheme } from "../theme";
import { api , imgSrc} from "../api";
import BrandLockup from "./BrandLockup";
import NotificationBell from "./NotificationBell";
import SearchModal from "./SearchModal";
import ChatFab from "./ChatFab";
import ImpersonationBanner from "./ImpersonationBanner";
import PreviewBanner from "./PreviewBanner";
import PreviewOnboarding from "./PreviewOnboarding";
import { useApprovalCounts } from "../lib/useApprovalCounts";
import CreateProjectModal from "./CreateProjectModal";
import { NotificationProvider, useNotifications } from "../notifications";
import { PinsProvider, usePins, pinLinkUrl } from "../pins";
import { ROUTE_PREFETCH, loadProject } from "../routes";
import { isDevAccount, DevBadge } from "../lib/devBadge";
import { getDevPagesEnabled, setDevPagesEnabled } from "../lib/devPagesPref";
import { isPreviewMode } from "../lib/previewMock";
import { isInstalledApp, isDesktopApp, nativePlatform } from "../lib/platform";
import { LiquidGlassTabBar, setNativeTabBarHidden, syncNativeTabBarVisibility } from "../lib/liquidGlassTabBar";
import { confirmLogout } from "../lib/confirmLogout";

/**
 * 사이드바 hover/focus prefetch — 사용자가 클릭하기 전에 해당 페이지 청크를
 * 백그라운드로 받아둔다. 같은 dynamic import 는 Vite 가 캐시해서 중복 요청 없음.
 * 실패해도 실제 네비게이션 시 다시 시도되므로 조용히 무시.
 */
function prefetchRoute(to: string) {
  try {
    if (to.startsWith("/projects/")) {
      void loadProject();
      return;
    }
    const fn = ROUTE_PREFETCH[to];
    if (fn) void fn();
  } catch {}
}

/**
 * 페이지 청크 로딩 중 잠깐 보이는 본문 자리. 셸(상단바·하단바)은 그대로 유지되고
 * 본문 영역 높이만 확보해 레이아웃 점프를 막는다. prefetch 덕에 대부분 즉시 교체돼
 * 사실상 거의 안 보인다.
 */
function PageFallback() {
  return <div className="min-h-[60vh]" aria-hidden />;
}

type NavItem = { to: string; label: string; icon: (p: { active?: boolean }) => JSX.Element; end?: boolean };

/** 토글 path → 영향받는 자식 path prefix 매핑. /meetings 끄면 /meetings/123 도 차단. */
function matchPath(pathname: string, set: Set<string>): string | null {
  if (set.size === 0) return null;
  for (const p of set) {
    if (p === "/") {
      if (pathname === "/") return p;
      continue;
    }
    if (pathname === p || pathname.startsWith(p + "/")) return p;
  }
  return null;
}

/** 끈 메뉴는 라우트 진입도 차단 / 개발중은 \"개발 중\" 안내 (단, 개발자 + 토글 ON 이면 통과). */
function RouteVisibilityGate({
  disabled,
  dev,
  children,
}: {
  disabled: Set<string>;
  dev: Set<string>;
  children: React.ReactNode;
}) {
  const loc = useLocation();
  const { user } = useAuth();
  const [devPagesOn, setOn] = useState(getDevPagesEnabled);
  useEffect(() => {
    function refresh() { setOn(getDevPagesEnabled()); }
    window.addEventListener("hinest:devPagesChange", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("hinest:devPagesChange", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const isDeveloper = !!user?.isDeveloper;
  if (matchPath(loc.pathname, disabled)) {
    return <BlockedPage />;
  }
  if (matchPath(loc.pathname, dev)) {
    // 개발자 + 토글 ON 이면 안내 없이 그대로 페이지 진입.
    if (isDeveloper && devPagesOn) return <>{children}</>;
    return <UnderConstructionPage isDeveloper={isDeveloper} />;
  }
  return <>{children}</>;
}

/** 비활성된 메뉴 진입 시 안내 — 풀 화면 그라데이션 + 자물쇠 일러스트. */
function BlockedPage() {
  // 라이트 — 차분한 슬레이트 그레이 (텍스트 흰색 유지하면서 너무 어둡지 않게)
  // 다크 — 잉크 톤에 맞춘 더 깊은 검정 그라데이션 (서라운딩 surface 와 자연스럽게 이어짐)
  const { resolved } = useTheme();
  const isDark = resolved === "dark";
  const bg = isDark
    ? "radial-gradient(ellipse at top right, rgba(99,102,241,0.10) 0%, transparent 55%), radial-gradient(ellipse at bottom left, rgba(0,0,0,0.5) 0%, transparent 60%), linear-gradient(135deg, #14161B 0%, #0A0C10 100%)"
    : "radial-gradient(ellipse at top right, rgba(99,102,241,0.16) 0%, transparent 55%), radial-gradient(ellipse at bottom left, rgba(15,23,42,0.5) 0%, transparent 60%), linear-gradient(135deg, #2C3340 0%, #1A1F2A 100%)";
  return (
    <div
      className="relative w-full overflow-hidden rounded-3xl"
      style={{
        minHeight: "min(78vh, 720px)",
        background: bg,
        color: "#fff",
        border: isDark ? "1px solid rgba(255,255,255,0.06)" : "none",
      }}
    >
      {/* 큰 배경 자물쇠 — 시각적 hero */}
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          position: "absolute",
          right: "-6%",
          bottom: "-12%",
          width: "min(640px, 70%)",
          height: "auto",
          color: "rgba(255,255,255,0.05)",
          pointerEvents: "none",
        }}
      >
        <rect x="4" y="11" width="16" height="9" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      {/* 격자 패턴 */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse at center, #000 0%, transparent 75%)",
          pointerEvents: "none",
        }}
      />
      <div className="relative px-6 sm:px-12 py-14 sm:py-20 max-w-[920px]">
        <div
          className="w-20 h-20 rounded-3xl grid place-items-center mb-7"
          style={{
            background: "rgba(255,255,255,0.08)",
            backdropFilter: "blur(10px)",
            border: "1px solid rgba(255,255,255,0.14)",
          }}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="4" y="11" width="16" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </div>
        <div className="text-[12px] font-extrabold tracking-[0.22em] uppercase opacity-70">Restricted</div>
        <h1 className="text-[clamp(28px,5vw,44px)] font-extrabold tracking-tight mt-2 leading-tight">
          이 메뉴는<br />
          잠겨 있어요
        </h1>
        <p className="text-[15px] sm:text-[16px] text-white/75 mt-5 max-w-[560px] leading-relaxed">
          개발자가 이 메뉴를 일시적으로 닫아 두었어요.
          계속 사용해야 한다면 개발자에게 알려주세요.
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-8">
          <NavLink
            to="/"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-[14px] transition"
            style={{ background: "#fff", color: "#0F172A" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            개요로 돌아가기
          </NavLink>
        </div>
      </div>
    </div>
  );
}

/** \"개발 중\" 페이지 — 풀 화면 그라데이션 + 회전 톱니바퀴 + 펄스 도형. */
function UnderConstructionPage({ isDeveloper }: { isDeveloper: boolean }) {
  const { resolved } = useTheme();
  const isDark = resolved === "dark";
  // 라이트 — 비비드 브랜드 → 바이올렛 (현재 톤과 비슷하지만 약간 부드럽게)
  // 다크 — 어두운 잉크 위에 브랜드 글로우만 살짝 — 다크 surrounding 과 자연스럽게 융합
  const bg = isDark
    ? "radial-gradient(ellipse at top, rgba(120,150,255,0.18) 0%, transparent 50%), radial-gradient(ellipse at bottom right, rgba(56,189,248,0.10) 0%, transparent 55%), linear-gradient(135deg, #1A1F2A 0%, #2A1F40 60%, #1F1530 100%)"
    : "radial-gradient(ellipse at top, rgba(167,139,250,0.32) 0%, transparent 55%), radial-gradient(ellipse at bottom right, rgba(56,189,248,0.20) 0%, transparent 55%), linear-gradient(135deg, #3B5CF0 0%, #7C3AED 60%, #581C87 100%)";
  return (
    <div
      className="relative w-full overflow-hidden rounded-3xl"
      style={{
        minHeight: "min(78vh, 720px)",
        background: bg,
        color: "#fff",
        border: isDark ? "1px solid rgba(255,255,255,0.06)" : "none",
      }}
    >
      <style>{`
        @keyframes hinest-uc-pulse { 0%,100% { transform: scale(1); opacity: .5; } 50% { transform: scale(1.18); opacity: .85; } }
        @keyframes hinest-uc-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes hinest-uc-spin-rev { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
        @keyframes hinest-uc-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
      `}</style>

      {/* 배경 펄스 도형들 */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: "-8%",
          right: "-10%",
          width: 380,
          height: 380,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.12)",
          animation: "hinest-uc-pulse 3.6s ease-in-out infinite",
          filter: "blur(2px)",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          bottom: "-12%",
          left: "-8%",
          width: 260,
          height: 260,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.10)",
          animation: "hinest-uc-pulse 4.4s ease-in-out infinite 0.8s",
          pointerEvents: "none",
        }}
      />
      {/* 격자 */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse at center, #000 0%, transparent 75%)",
          pointerEvents: "none",
        }}
      />

      {/* 큰 배경 톱니바퀴 — hero 일러스트 */}
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          position: "absolute",
          right: "-14%",
          bottom: "-22%",
          width: "min(720px, 80%)",
          height: "auto",
          color: "rgba(255,255,255,0.08)",
          pointerEvents: "none",
          animation: "hinest-uc-spin 26s linear infinite",
        }}
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h.04a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.04a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>

      <div className="relative px-6 sm:px-12 py-14 sm:py-20 max-w-[1000px]">
        {/* 작은 톱니바퀴 (반대 방향) — 깊이감 */}
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.6"
          style={{
            position: "absolute",
            top: 40,
            right: 60,
            width: 84,
            height: 84,
            color: "rgba(255,255,255,0.18)",
            animation: "hinest-uc-spin-rev 14s linear infinite",
          }}
          className="hidden md:block"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h.04a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.04a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>

        {/* hero 톱니 카드 */}
        <div
          className="w-24 h-24 rounded-3xl grid place-items-center mb-8"
          style={{
            background: "rgba(255,255,255,0.16)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.24)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
            animation: "hinest-uc-float 4.5s ease-in-out infinite",
          }}
        >
          <svg
            width="44"
            height="44"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            style={{ animation: "hinest-uc-spin 9s linear infinite" }}
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h.04a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.04a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </div>
        <div className="text-[12px] font-extrabold tracking-[0.22em] uppercase opacity-90">Under Construction</div>
        <h1 className="text-[clamp(32px,5.5vw,52px)] font-extrabold tracking-tight mt-2 leading-[1.05]">
          더 좋은 모습으로<br />돌아올게요
        </h1>
        <p className="text-[15px] sm:text-[16px] text-white/85 mt-5 max-w-[560px] leading-relaxed">
          이 페이지는 아직 만드는 중이에요. 새 기능이 완성되면 자동으로 활성화돼서 자연스럽게 사용할 수 있어요.
        </p>

        {/* 진행 표시 — 시각적 데코, 진짜 진행률 아님. 페이지에 활기 추가 */}
        <div className="mt-7 max-w-[560px]">
          <div className="text-[11px] font-bold tracking-[0.14em] uppercase opacity-75 mb-2">In progress</div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.16)" }}>
            <div
              style={{
                height: "100%",
                width: "62%",
                background: "linear-gradient(90deg, #fff 0%, #C4B5FD 100%)",
                borderRadius: 999,
              }}
            />
          </div>
        </div>

        {isDeveloper && (
          <div
            className="mt-7 inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-bold"
            style={{
              background: "rgba(255,255,255,0.18)",
              backdropFilter: "blur(10px)",
              border: "1px solid rgba(255,255,255,0.22)",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            HiNest 개발자 — 사이드바 \"개발 페이지 보기\" 토글로 우회 가능
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 mt-8">
          <NavLink
            to="/"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-[14px] transition"
            style={{ background: "#fff", color: "#3B5CF0" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            개요로 돌아가기
          </NavLink>
        </div>
      </div>
    </div>
  );
}

/** 개발자가 끈/개발중 사이드바 path 들. /api/nav/visibility 응답 + 이벤트로 다른 탭 동기화. */
function useNavStatus() {
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [dev, setDev] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    function load() {
      api<{ disabled: string[]; dev?: string[] }>("/api/nav/visibility")
        .then((r) => {
          if (cancelled) return;
          setDisabled(new Set(r.disabled ?? []));
          setDev(new Set(r.dev ?? []));
        })
        .catch(() => {});
    }
    load();
    function onChange() { load(); }
    window.addEventListener("hinest:navVisibilityChange", onChange);
    window.addEventListener("focus", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener("hinest:navVisibilityChange", onChange);
      window.removeEventListener("focus", onChange);
    };
  }, []);
  return { disabled, dev };
}

const WORK_NAV: NavItem[] = [
  { to: "/", label: "개요", icon: HomeIcon, end: true },
  { to: "/schedule", label: "일정", icon: CalendarIcon },
  { to: "/attendance", label: "근태·월차", icon: ClockIcon },
  { to: "/journal", label: "업무일지", icon: NoteIcon },
  { to: "/meetings", label: "회의록", icon: MeetingIcon },
  { to: "/approvals", label: "전자결재", icon: ApprovalIcon },
];

// 사내톡은 사이드바에서 제거 — 우하단 ChatFab 팝업에서만 접근.
const COMM_NAV: NavItem[] = [
  { to: "/notice", label: "공지사항", icon: MegaIcon },
  { to: "/directory", label: "팀원", icon: PeopleIcon },
  { to: "/org", label: "조직도", icon: OrgIcon },
];

const RESOURCE_NAV: NavItem[] = [
  { to: "/documents", label: "문서함", icon: DocsIcon },
  { to: "/memos", label: "메모", icon: MemoIcon },
  { to: "/payroll", label: "급여명세서", icon: PayrollIcon },
  { to: "/expense", label: "법인카드", icon: CardIcon },
  { to: "/accounts", label: "계정 관리", icon: KeyIcon },
  { to: "/snippets", label: "스니펫", icon: SnippetIcon },
];

// 모바일 하단 탭 바에 직접 노출할 핵심 메뉴(토스 스타일). 나머지 전체 메뉴는
// 다섯 번째 "전체" 버튼이 좌측 드로어(=기존 사이드바)를 열어 보여준다.
// 여기 항목은 전 직원 공통 라우트라 권한 게이팅이 필요 없다. 짧은 라벨로 고른다.
const BOTTOM_NAV: NavItem[] = [
  { to: "/", label: "개요", icon: HomeIcon, end: true },
  { to: "/schedule", label: "일정", icon: CalendarIcon },
  { to: "/approvals", label: "전자결재", icon: ApprovalIcon },
  { to: "/meetings", label: "회의록", icon: MeetingIcon },
];

/** 네이티브 Liquid Glass 탭 바 구성(iOS). 웹 BOTTOM_NAV + "전체" 와 동일 순서, SF Symbol 매핑. */
const NATIVE_GLASS_TABS = [
  { key: "/", title: "개요", icon: "tab-home" },
  { key: "/schedule", title: "일정", icon: "tab-schedule" },
  { key: "/approvals", title: "전자결재", icon: "tab-approval" },
  { key: "/meetings", title: "회의록", icon: "tab-meeting" },
  { key: "/menu", title: "전체", icon: "tab-menu" },
];
/** 현재 경로에 해당하는 네이티브 탭 key. 일치 없으면 빈 문자열(하이라이트 없음). */
function matchNativeTabKey(pathname: string): string {
  for (const k of ["/schedule", "/approvals", "/meetings", "/menu"]) {
    if (pathname === k || pathname.startsWith(k + "/")) return k;
  }
  return pathname === "/" ? "/" : "";
}

export default function AppLayout({ children }: { children?: React.ReactNode } = {}) {
  return (
    <NotificationProvider>
      <PinsProvider>
        <AppLayoutInner>{children}</AppLayoutInner>
      </PinsProvider>
    </NotificationProvider>
  );
}

// ── 모바일 당겨서 새로고침(pull-to-refresh) ───────────────────────────────
const PTR_THRESHOLD = 64; // 이 거리(px) 이상 당기고 놓으면 새로고침 발동
const PTR_MAX = 96; // 시각적 최대 당김 거리(고무줄 감쇠 상한)
const PTR_RESTING = 48; // 새로고침 진행 중 콘텐츠가 머무는 위치
const PTR_ARC_R = 9; // 스피너 호 반지름 (SVG viewBox 24×24, 중심 12,12)
const PTR_CIRC = 2 * Math.PI * PTR_ARC_R; // 호 둘레 — strokeDasharray/Offset 진행도 계산

/**
 * main 스크롤러가 최상단(scrollTop<=0)일 때 아래로 당기면 인디케이터가 따라오고,
 * 임계값을 넘겨 놓으면 window.location.reload() 로 새로고침한다.
 *
 * 터치 기기(pointer:coarse)에서만 동작 — 데스크톱 마우스/트랙패드는 제외한다.
 * iOS 셸 잠금(.hinest-shell-lock)으로 문서 바운스가 막혀 main 이 유일한 스크롤러라,
 * 여기서 touchmove preventDefault 로 네이티브 오버스크롤을 가로채 커스텀 제스처로 쓴다.
 */
const PTR_EASE_WRAP = "transform .25s cubic-bezier(.22,.61,.36,1), opacity .2s ease";
const PTR_EASE_T = "transform .25s cubic-bezier(.22,.61,.36,1)";

function usePullToRefresh() {
  const ref = useRef<HTMLElement>(null);            // main 스크롤러 (리스너·scrollTop)
  const indicatorRef = useRef<HTMLDivElement>(null); // 따라 내려오는 배지 래퍼
  const badgeRef = useRef<HTMLDivElement>(null);     // 원형 배지(살짝 커지는 피드백)
  const ringRef = useRef<SVGSVGElement>(null);       // SVG 스피너(새로고침 중 회전 대상)
  const arcRef = useRef<SVGCircleElement>(null);     // 진행 호(strokeDashoffset 로 진행도 표시)
  const contentRef = useRef<HTMLDivElement>(null);   // 손가락 따라 내려오는 본문
  const [refreshing, setRefreshing] = useState(false);

  // 당김 시각 상태를 React 렌더 없이 DOM 에 직접 쓴다.
  // 기존엔 touchmove 마다 setPull→AppLayoutInner(거대 컴포넌트) 전체 리렌더가 발생해
  // 제스처 중 프레임이 끊겼다. offset(0~PTR_MAX)·progress(0~1) 를 받아 4개 요소 스타일만
  // 갱신한다. animate=false(드래그 추종) / true(놓았을 때 0으로 복귀 애니메이션).
  const applyPull = useCallback((offset: number, progress: number, animate: boolean) => {
    const ind = indicatorRef.current;
    if (ind) {
      ind.style.transform = `translateY(${offset / 2 - 17}px)`;
      ind.style.opacity = String(progress);
      ind.style.transition = animate ? PTR_EASE_WRAP : "none";
    }
    const badge = badgeRef.current;
    if (badge) {
      badge.style.transform = `scale(${0.82 + 0.18 * progress})`;
      badge.style.transition = animate ? PTR_EASE_T : "none";
    }
    const arc = arcRef.current;
    if (arc) {
      // 진행도만큼 호를 채운다 — progress 0=빈 원, 1=가득. 놓을 땐(animate) 짧게 트랜지션.
      arc.style.strokeDashoffset = String(PTR_CIRC * (1 - progress));
      arc.style.transition = animate ? "stroke-dashoffset .2s ease" : "none";
    }
    const content = contentRef.current;
    if (content) {
      content.style.transform = offset > 0 ? `translateY(${offset}px)` : "";
      content.style.transition = animate ? PTR_EASE_T : "none";
    }
  }, []);

  // 새로고침 진입 시: 본문을 머무는 위치(PTR_RESTING)로 고정하고 링을 비결정형 회전으로.
  // (이 상태는 곧 window.location.reload() 로 페이지가 갈아끼워지므로 종단 상태다.)
  useEffect(() => {
    const ind = indicatorRef.current, badge = badgeRef.current;
    const ring = ringRef.current, arc = arcRef.current, content = contentRef.current;
    if (refreshing) {
      const off = PTR_RESTING;
      if (ind) {
        ind.style.transform = `translateY(${off / 2 - 17}px)`;
        ind.style.opacity = "1";
        ind.style.transition = PTR_EASE_WRAP;
      }
      if (badge) {
        badge.style.transform = "scale(1)";
        badge.style.transition = PTR_EASE_T;
      }
      // 비결정형 스피너 — 호를 ~30% 길이로 고정하고 SVG 를 회전(animate-spin)시킨다.
      if (arc) {
        arc.style.transition = "stroke-dashoffset .2s ease";
        arc.style.strokeDasharray = `${PTR_CIRC * 0.3} ${PTR_CIRC}`;
        arc.style.strokeDashoffset = "0";
      }
      if (ring) ring.classList.add("animate-spin");
      // reload 직전 본문을 살짝 내리며 흐리게 — 갑작스러운 새로고침 대신 전환감을 준다.
      // (새 페이지는 마운트 시 .route-fade 로 다시 페이드인되므로 자연스럽게 이어진다.)
      if (content) {
        content.style.transform = `translateY(${off}px)`;
        content.style.transition = "transform .3s cubic-bezier(.22,.61,.36,1), opacity .3s ease";
        content.style.opacity = "0.35";
      }
    } else {
      ring?.classList.remove("animate-spin");
      if (arc) {
        arc.style.strokeDasharray = String(PTR_CIRC);
        arc.style.strokeDashoffset = String(PTR_CIRC);
      }
      if (content) content.style.opacity = "";
    }
  }, [refreshing]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 터치 기기에서만 — 데스크톱에선 PTR 비활성(실수로 전체 새로고침되는 걸 방지).
    if (typeof window !== "undefined" && !window.matchMedia("(pointer: coarse)").matches) return;

    let startY = 0;
    let active = false; // 상단에서 아래로 당기는 제스처가 시작됐는가
    let dist = 0;

    const onStart = (e: TouchEvent) => {
      if (refreshing) return;
      if (e.touches.length !== 1) return;
      if (el.scrollTop > 0) return; // 최상단에서만 시작
      startY = e.touches[0].clientY;
      active = true;
      dist = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      if (el.scrollTop > 0) {
        active = false;
        applyPull(0, 0, true);
        return;
      }
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) {
        // 위로(스크롤 다운) 동작은 네이티브에 맡긴다
        dist = 0;
        applyPull(0, 0, true);
        return;
      }
      dist = Math.min(PTR_MAX, dy * 0.5); // 고무줄 감쇠
      applyPull(dist, Math.min(dist / PTR_THRESHOLD, 1), false);
      if (e.cancelable) e.preventDefault(); // 네이티브 바운스/스크롤 억제
    };
    const onEnd = () => {
      if (!active) return;
      active = false;
      if (dist >= PTR_THRESHOLD) {
        setRefreshing(true); // 새로고침 비주얼은 위 effect 가 적용
        // 스피너 회전 + 본문 페이드아웃이 보이도록 살짝 지연 후 새로고침.
        window.setTimeout(() => window.location.reload(), 360);
      } else {
        applyPull(0, 0, true);
      }
      dist = 0;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [refreshing, applyPull]);

  return { ref, indicatorRef, badgeRef, ringRef, arcRef, contentRef };
}

function AppLayoutInner({ children }: { children?: React.ReactNode }) {
  const { user, logout, impersonator } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { disabled: disabledNav, dev: devNav } = useNavStatus();
  const filterByVisibility = (items: NavItem[]) => items.filter((i) => !disabledNav.has(i.to));
  const isMacDesktop = !!window.hinest?.isDesktop && window.hinest?.platform === "darwin";
  const [isFullscreen, setIsFullscreen] = useState(false);

  // iOS 노치/상태바 영역(env(safe-area-inset-top)) 을 누가 흡수할지 결정.
  // 항상 "맨 위에 첫 번째로 보이는 요소" 만 흡수해서 더블 패딩 방지.
  const isPreview = isPreviewMode();
  const isImpersonating = !!impersonator;
  const topSlot: "preview" | "impersonation" | "topbar" =
    isPreview ? "preview" : isImpersonating ? "impersonation" : "topbar";

  useEffect(() => {
    if (!isMacDesktop || !window.hinest?.onFullscreenChange) return;
    const off = window.hinest.onFullscreenChange((fs) => setIsFullscreen(fs));
    return () => {
      try { off?.(); } catch {}
    };
  }, [isMacDesktop]);

  // 앱 셸 오버스크롤 잠금 — iOS 에서 문서 전체가 고무줄처럼 튕겨 상·하단에 빈 공간이
  // 드러나는 걸 막는다(상단을 당기면 위, 하단바를 올리면 아래). styles.css 의
  // .hinest-shell-lock 이 body 를 position:fixed 로 고정한다. 공개 페이지(로그인/약관)는
  // 문서 스크롤이 필요하므로 AppLayout 이 마운트된 동안에만 <html> 에 클래스를 토글한다.
  useEffect(() => {
    const el = document.documentElement;
    el.classList.add("hinest-shell-lock");
    // iOS 네이티브(아이폰·아이패드)에서만 글래스 하단 네비 스타일 + 본문 하단 클리어런스 적용.
    // (웹/안드로이드/Electron 데스크톱은 클래스가 안 붙어 기존 디자인 그대로.)
    el.classList.toggle("hinest-ios", nativePlatform() === "ios");
    // 데스크톱(Electron 또는 마우스+호버 가능 브라우저)은 창을 폰 크기로 줄여도 모바일
    // 레이아웃으로 바뀌지 않도록 플래그. 실제 터치 폰/태블릿(coarse pointer)은 제외.
    const isDesktopDevice =
      isDesktopApp() ||
      (typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches);
    el.classList.toggle("hinest-desktop", isDesktopDevice);
    return () => el.classList.remove("hinest-shell-lock");
  }, []);

  // 스플래시(index.html 의 웹 오버레이) 동안엔 네이티브 탭 바를 숨긴다 — 네이티브 바는
  // 웹뷰 위에 뜨는 별도 뷰라 웹 스플래시로는 가려지지 않아 위로 비친다. 스플래시가 끝나면
  // (hinest:splash-done) 숨김 사유를 풀어 다시 보이게 한다.
  useEffect(() => {
    if (nativePlatform() !== "ios") return;
    // 스플래시 오버레이가 DOM 에 살아있으면(콜드 실행) 탭바 숨김. 새로고침 땐 인덱스 스크립트가
    // 파싱 즉시 제거하므로 마운트 시점엔 이미 없어 숨기지 않는다. (window 플래그는 main.tsx 가
    // 비동기로 늦게 세팅돼 마운트보다 늦을 수 있어, 요소 존재 여부를 신호로 쓴다.)
    setNativeTabBarHidden("splash", !!document.getElementById("hinest-splash"));
    const onDone = () => setNativeTabBarHidden("splash", false);
    window.addEventListener("hinest:splash-done", onDone);
    return () => window.removeEventListener("hinest:splash-done", onDone);
  }, []);

  // 네이티브 Liquid Glass 탭 바(iOS 26 UIGlassEffect) — 성공하면 웹 하단 바를 숨기고
  // 실제 애플 글래스 바가 대체한다. 미지원(iOS<26)/실패면 아무 일도 없고 웹 CSS 글래스 바가 폴백.
  useEffect(() => {
    if (nativePlatform() !== "ios") return;
    let cancelled = false;
    let removeListener: (() => void) | undefined;
    (async () => {
      try {
        const res = await LiquidGlassTabBar.configure({ tabs: NATIVE_GLASS_TABS });
        if (cancelled || !res?.active) return;
        document.documentElement.classList.add("hinest-native-tabbar");
        const handle = await LiquidGlassTabBar.addListener("tabSelected", (d) => {
          if (d?.key) nav(d.key);
        });
        removeListener = () => { try { void handle?.remove?.(); } catch {} };
        LiquidGlassTabBar.setSelected({ key: matchNativeTabKey(window.location.pathname) }).catch(() => {});
        // 바 생성 직후 현재 숨김 사유(채팅·모달·라우트) 기준으로 가시성 재적용.
        syncNativeTabBarVisibility();
      } catch {
        // iOS<26 / 미지원 → 웹 CSS 글래스 바 폴백(아무 것도 하지 않음).
      }
    })();
    return () => {
      cancelled = true;
      removeListener?.();
      document.documentElement.classList.remove("hinest-native-tabbar");
      LiquidGlassTabBar.setVisible({ visible: false }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 경로 변화 → 네이티브 탭 하이라이트 동기화.
  useEffect(() => {
    if (nativePlatform() !== "ios") return;
    LiquidGlassTabBar.setSelected({ key: matchNativeTabKey(pathname) }).catch(() => {});
    // 라우트만으로 하단 바를 숨기지 않는다. 예전엔 /notifications 에서 숨겼는데, 그 페이지엔
    // 뒤로가기 버튼이 없어 탭바까지 사라지면 빠져나갈 길이 없어 갇혔다(사용자 제보). 알림은
    // 일반 페이지처럼 탭바를 유지해 다른 탭으로 나갈 수 있게 한다. (모달·채팅은 별도 사유로 숨김)
    const hideOnRoutes: string[] = [];
    setNativeTabBarHidden("route", hideOnRoutes.some((r) => pathname === r || pathname.startsWith(r + "/")));
  }, [pathname]);

  // 모달이 열려 있는 동안 네이티브 바 숨김. 모달 오버레이는 .modal-safe 로 표시돼 있으므로
  // DOM 에 그게 존재하는지 관찰한다. (채팅 풀스크린은 ChatFab 이 별도로 'chat' 사유로 숨김.)
  useEffect(() => {
    if (nativePlatform() !== "ios") return;
    let raf = 0;
    const check = () => {
      raf = 0;
      setNativeTabBarHidden("modal", !!document.querySelector(".modal-safe"));
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(check); };
    const obs = new MutationObserver(schedule);
    obs.observe(document.body, { childList: true, subtree: true });
    check();
    return () => {
      obs.disconnect();
      if (raf) cancelAnimationFrame(raf);
      setNativeTabBarHidden("modal", false);
    };
  }, []);

  // 모바일 당겨서 새로고침 — main 스크롤러에 ref 를 물려 제스처를 감지한다.
  // 당김 비주얼(인디케이터·링·본문 오프셋)은 훅이 ref 로 직접 DOM 에 쓰므로
  // 제스처 중에는 이 컴포넌트가 리렌더되지 않는다.
  const {
    ref: mainRef,
    indicatorRef: ptrIndicatorRef,
    badgeRef: ptrBadgeRef,
    ringRef: ptrRingRef,
    contentRef: ptrContentRef,
  } = usePullToRefresh();

  // 창모드에서만 신호등 버튼 여백 필요, 전체화면에선 숨어있으므로 여백 제거
  const showTitlebarSpace = isMacDesktop && !isFullscreen;

  return (
    <div
      className="flex flex-col bg-ink-50 overflow-hidden"
      style={{
        // 셸 잠금(.hinest-shell-lock)이 body 를 position:fixed; inset:0 으로 가시 뷰포트에
        // 정확히 고정하므로, #root(height:100%) 를 거쳐 여기서도 100% 로 받으면 그 고정 박스에
        // 픽셀 단위로 일치한다. 예전의 100dvh 는 body 고정 박스(ICB 기준)와 별개로 측정돼
        // iOS 툴바 전환 구간에서 둘이 어긋나면 하단 네비 아래로 body 배경(--c-bg) 한 줄이
        // 새어 보였다("safe line"). 100% 로 받아 그 틈을 없앤다. (잠금으로 문서가 스크롤·
        // 바운스하지 않으므로 옛 100vh 의 iOS URL 바 잘림 문제는 발생하지 않는다.)
        height: "100%",
      }}
    >
      <PreviewBanner safeAreaTop={topSlot === "preview"} />
      <PreviewOnboarding />
      <ImpersonationBanner safeAreaTop={topSlot === "impersonation"} />
      <div className="flex flex-1 min-h-0">
      {/* 사이드바 — 데스크톱(md+) 전용. 모바일은 하단 바 + /menu 페이지를 쓰므로 숨긴다. */}
      <aside className="app-sidebar hidden md:flex w-[232px] bg-white border-r border-ink-150 flex-col flex-shrink-0">
        {/* 신호등 영역용 드래그 가능 상단바 — 사이드바 배경과 통일 */}
        {showTitlebarSpace && (
          <div
            style={{
              height: 28,
              // @ts-expect-error drag region
              WebkitAppRegion: "drag",
            }}
          />
        )}
        <div
          className="px-5 flex items-center border-b border-ink-150 flex-shrink-0"
          style={{
            // 모바일 드로어에서 fixed inset-y-0 로 떠 있을 때 iOS 노치를 흡수.
            // 데스크톱(md+)에선 env() = 0 이라 영향 없음.
            paddingTop: "env(safe-area-inset-top)",
            height: "calc(48px + env(safe-area-inset-top))",
          }}
        >
          <BrandLockup height={34} />
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-5">
          {/* 개발자가 끈 항목은 메뉴에서 제외. 섹션 자체가 비면 라벨도 안 보이게. */}
          {(() => { const items = filterByVisibility(WORK_NAV); return items.length > 0 && <NavSection label="워크스페이스" items={items} dev={devNav} />; })()}
          {(() => { const items = filterByVisibility(COMM_NAV); return items.length > 0 && <NavSection label="커뮤니케이션" items={items} dev={devNav} />; })()}
          {(() => { const items = filterByVisibility(RESOURCE_NAV); return items.length > 0 && <NavSection label="자료·재무" items={items} dev={devNav} />; })()}
          <PinsSection />
          <ProjectsSection />

          {user?.role === "ADMIN" && (
            <div>
              <SectionLabel>관리</SectionLabel>
              <NavLink
                to="/admin"
                className={({ isActive }) => navClass(isActive)}
                onMouseEnter={() => prefetchRoute("/admin")}
                onFocus={() => prefetchRoute("/admin")}
              >
                {({ isActive }) => (<><ShieldIcon active={isActive} /><span>관리자</span></>)}
              </NavLink>
            </div>
          )}

          {/* 운영 콘솔 진입 — 개발자(superAdmin)/플랫폼 운영자(platformAdmin) 전용.
              실제 화면은 회사 앱과 분리된 별도 셸(ConsoleLayout)에서 렌더된다. 진입하면
              AppLayout 자체가 언마운트되므로 여기 링크는 "콘솔로 나가기" 성격이다. */}
          {(user?.superAdmin || user?.platformAdmin) && (
            <div>
              <SectionLabel>운영</SectionLabel>
              <NavLink
                to={user?.platformAdmin ? "/platform" : "/super-admin"}
                className={({ isActive }) => navClass(isActive)}
                onMouseEnter={() => prefetchRoute(user?.platformAdmin ? "/platform" : "/super-admin")}
                onFocus={() => prefetchRoute(user?.platformAdmin ? "/platform" : "/super-admin")}
              >
                {({ isActive }) => (<><DevIcon active={isActive} /><span>운영 콘솔</span></>)}
              </NavLink>
            </div>
          )}
        </nav>

        {/* 앱 다운로드 — 웹 브라우저로 접속한 경우에만. 설치형 앱(데스크톱·모바일)에서는 숨김. */}
        {!isInstalledApp() && (
          <div className="border-t border-ink-150 px-2 pt-2">
            <NavLink
              to="/download"
              className="tap-row flex items-center gap-2.5 h-[40px] md:h-[32px] px-3 rounded-full text-[13px] md:text-[12.5px] font-semibold text-ink-500 hover:bg-ink-100 hover:text-ink-900 transition"
              title="데스크톱 · 모바일 앱 다운로드"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>앱 다운로드</span>
            </NavLink>
          </div>
        )}

        <div
          className="border-t border-ink-150 px-2 pt-2 flex-shrink-0"
          style={{
            // iOS 홈 인디케이터 영역 흡수 — 모바일 드로어가 화면 끝까지 닿을 때 가려지지 않도록.
            // 이전엔 calc(8px + safe-area) 였지만 iOS PWA 에서 chip 아래로 ~42px 의 빈 공간이
            // 시각적으로 두드러져 사용자가 "이상한 공간" 으로 인식했음. safe-area 만 남기고
            // 추가 8px 은 제거 — 인디케이터 바로 위까지 chip 이 닿게.
            paddingBottom: "max(8px, env(safe-area-inset-bottom))",
          }}
        >
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-ink-50">
            <NavLink to="/profile" className="flex items-center gap-2.5 flex-1 min-w-0" title="프로필">
              {user?.avatarUrl ? (
                <img
                  src={imgSrc(user.avatarUrl)}
                  alt={user.name ?? ""}
                  className="avatar avatar-sm object-cover" loading="lazy" decoding="async"/>
              ) : (
                <div
                  className="avatar avatar-sm"
                  style={{ background: user?.avatarColor ?? "#3B5CF0" }}
                >
                  {user?.name?.[0] ?? "?"}
                </div>
              )}
              <div className="min-w-0 flex-1">
                {/* 사이드바 폭이 좁아 라벨 풀버전 배지가 이름을 밀어내는 문제 — iconOnly 로 통일.
                    풀 라벨은 마이페이지 미리보기에서 별도로 보이므로 정보 손실 없음. */}
                <div className="text-[13px] font-semibold text-ink-900 flex items-center gap-1.5 min-w-0">
                  <span className="truncate min-w-0">{user?.name}</span>
                  {isDevAccount(user) && <DevBadge iconOnly />}
                </div>
                <div className="text-[11px] text-ink-500 truncate">{user?.email}</div>
              </div>
            </NavLink>
            {/* 개발자 전용 — \"개발 중\" 페이지 진입 토글 (사이드바 빠른 스위치).
                마이페이지의 \"개발자 옵션\" 패널과 같은 localStorage 키 공유. */}
            {isDevAccount(user) && <DevQuickToggle />}
            <button
              onClick={async () => {
                if (!(await confirmLogout())) return;
                await logout();
                nav("/login");
              }}
              className="btn-icon"
              title="로그아웃"
              aria-label="로그아웃"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
                <path d="m16 17 5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col relative">
        {showTitlebarSpace && (
          <div
            className="bg-white"
            style={{
              height: 28,
              // @ts-expect-error drag region
              WebkitAppRegion: "drag",
            }}
          />
        )}
        <TopBar
          draggable={showTitlebarSpace}
          safeAreaTop={topSlot === "topbar"}
        />
        <main
          ref={mainRef}
          className="flex-1 overflow-y-auto app-main-scroll"
          style={{
            // iOS 러버밴드 오버스크롤 방지 — 사용자가 페이지 상단에서 더 끌어내리면
            // 그 동작이 부모 요소로 전파되어 TopBar 가 잠시 사라지며 그 자리에 본문이
            // 노출되는 \"뚫림\" 현상이 발생했다. contain 으로 main 안에서만 스크롤 처리.
            overscrollBehaviorY: "contain",
            // iOS Safari momentum scrolling 안정화.
            WebkitOverflowScrolling: "touch",
            // 가로 스크롤 차단 — 풀블리드 달력 등 일부 요소가 미세하게 넘쳐도 좌우 스크롤이
            // 생기지 않게 한다(세로 스크롤은 유지). 본문은 vertical 스크롤만 필요.
            overflowX: "hidden",
            // 당겨서 새로고침 인디케이터의 절대 배치 기준.
            position: "relative",
          }}
        >
          {/* 당겨서 새로고침 인디케이터 — 당김 거리에 따라 따라 내려오고, 새로고침 중엔 회전. */}
          <div
            aria-hidden
            ref={ptrIndicatorRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "center",
              pointerEvents: "none",
              zIndex: 5,
              // 초기 idle 값 — 당김 비주얼은 usePullToRefresh 가 ref 로 직접 갱신한다.
              transform: "translateY(-17px)",
              opacity: 0,
            }}
          >
            <div
              ref={ptrBadgeRef}
              style={{
                width: 34,
                height: 34,
                borderRadius: 999,
                background: "var(--c-surface)",
                boxShadow: "0 4px 14px rgba(20,22,27,.16), 0 0 0 1px rgba(20,22,27,.05)",
                display: "grid",
                placeItems: "center",
                // 당길수록 살짝 커지는 촉각 피드백 — 초기값, 이후 ref 로 갱신.
                transform: "scale(0.82)",
              }}
            >
              {/* iOS 시스템 새로고침 스피너 — 회색 12-스포크(UIActivityIndicator 모양).
                  당기는 중엔 indicator opacity 로 서서히 나타나고(결정형 대용), 새로고침 중엔
                  SVG 전체가 animate-spin 으로 회전해 애플 기본 스피너처럼 보인다.
                  스포크별 opacity 그라데이션 + 회전 = 애플 특유의 '꼬리' 스핀 효과. */}
              <svg
                aria-hidden
                ref={ptrRingRef}
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                style={{ display: "block", transformOrigin: "center" }}
              >
                {Array.from({ length: 12 }).map((_, i) => (
                  <rect
                    key={i}
                    x="11"
                    y="2.5"
                    width="2"
                    height="6"
                    rx="1"
                    fill="var(--c-brand)"
                    opacity={0.18 + (0.82 * i) / 11}
                    transform={`rotate(${i * 30} 12 12)`}
                  />
                ))}
              </svg>
            </div>
          </div>
          <div
            ref={ptrContentRef}
            className="max-w-[1400px] mx-auto px-4 md:px-8 pt-4 md:pt-6"
            style={{
              // 본문 하단 여백 — 토큰(--hinest-main-pb)으로 분기(styles.css).
              //  · 모바일(<md): in-flow 하단 바가 자체 높이+세이프에어리어를 차지하므로
              //    스크롤 영역이 바 위에서 끝난다 → 본문은 숨 쉴 여백 24px 만(이중 여백 방지).
              //  · md+(태블릿 등): 하단 바가 없어 콘텐츠가 화면 바닥까지 닿는다 → 끝까지
              //    스크롤해도 마지막 콘텐츠가 홈 인디케이터(하단 세이프라인)에 가려지지 않게
              //    max(24px, env(safe-area-inset-bottom)) 로 인디케이터 위에서 끝낸다.
              paddingBottom: "var(--hinest-main-pb)",
              // 당겨서 새로고침 — 콘텐츠가 손가락을 따라 내려오는 촉각 피드백.
              //   transform/transition 은 usePullToRefresh 가 ref 로 직접 갱신한다
              //   (touchmove 마다 setState→전체 리렌더하던 것을 제거).
            }}
          >
            <RouteVisibilityGate disabled={disabledNav} dev={devNav}>
              {/* /preview 같은 비-라우터-childless 진입 시엔 children 으로 직접 받음. 그 외엔 Outlet. */}
              {/* 페이지가 lazy 라, 셸까지 감싸던 상위 Suspense 가 fallback 을 띄우면 상단바·하단바가
                  통째로 사라졌다 다시 나타났다. Suspense 를 본문(Outlet) 안쪽으로 내려 페이지 청크가
                  로드되는 동안에도 셸은 유지하고 본문만 잠깐 비운다. key=pathname 으로 라우트가 바뀔
                  때마다 가벼운 페이드를 다시 재생해 전환을 부드럽게 한다. */}
              <Suspense fallback={<PageFallback />}>
                <div key={pathname} className="route-fade">
                  {children ?? <Outlet />}
                </div>
              </Suspense>
            </RouteVisibilityGate>
          </div>
        </main>
      </div>
      <ChatFab />
      </div>
      {/* 하단 네비게이션 바 — 루트 100dvh 플렉스의 마지막 in-flow 형제.
          이전엔 position:fixed 였는데 iOS 에서 탭으로 페이지를 이동하다 보면 바가
          본문 위로 떠오르며 바 아래 빈 공간이 생기는 버그가 있었다(고정 좌표가
          동적 뷰포트와 어긋남). in-flow 형제로 두면 바가 항상 뷰포트 바닥에 물려
          있어 떠오르지 않는다. md+ 에선 md:hidden 으로 display:none → 공간 0. */}
      <BottomNav items={filterByVisibility(BOTTOM_NAV)} />
    </div>
  );
}

function NavSection({ label, items, dev }: { label: string; items: NavItem[]; dev?: Set<string> }) {
  // 공지사항 미읽음 알림 개수 — 사이드바에 배지로 표시
  const { bellItems, ready } = useNotifications();
  const noticeUnread = bellItems.filter((n) => n.type === "NOTICE" && !n.readAt).length;
  // 결재 대기 — 별도 폴링 hook (30s + 가시성 복귀 시 즉시).
  const approvalCounts = useApprovalCounts();

  // 새 공지가 들어왔을 때만 파란 펄스.
  // - 새로고침/재오픈은 localStorage 마지막 본 카운트와 비교해 증가하지 않으면 패스.
  // - 앱 꺼진 사이 공지가 쌓였다면 켤 때 1회 발동.
  const [noticePulse, setNoticePulse] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const KEY = "hinest:lastSeenNoticeUnread";
    const lastSeen = Number(localStorage.getItem(KEY) ?? "0");
    if (noticeUnread > lastSeen) {
      setNoticePulse(true);
      const t = setTimeout(() => setNoticePulse(false), 2800);
      localStorage.setItem(KEY, String(noticeUnread));
      return () => clearTimeout(t);
    }
    localStorage.setItem(KEY, String(noticeUnread));
  }, [noticeUnread, ready]);

  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="space-y-0.5">
        {items.map((n) => {
          const Icon = n.icon;
          const badgeCount = n.to === "/notice"
            ? noticeUnread
            : n.to === "/approvals"
              ? approvalCounts.pending
              : 0;
          const pulseHere = n.to === "/notice" && noticePulse;
          return (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => navClass(isActive) + (pulseHere ? " siri-pulse-bg" : "")}
              onMouseEnter={() => prefetchRoute(n.to)}
              onFocus={() => prefetchRoute(n.to)}
            >
              {({ isActive }) => (
                <>
                  <Icon active={isActive} />
                  <span className="flex-1 inline-flex items-center gap-1.5 min-w-0">
                    <span className="truncate min-w-0">{n.label}</span>
                    {dev?.has(n.to) && (
                      // 작은 점 하나로 \"개발 중\" 표시 — 큰 칩 라벨이 사이드바 톤을 무너뜨려서 다운그레이드.
                      <span
                        className="flex-shrink-0"
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "var(--c-warning)",
                          boxShadow: "0 0 0 2px color-mix(in srgb, var(--c-warning) 22%, transparent)",
                        }}
                        title="개발 중인 메뉴 — 들어가면 안내 화면이 뜹니다"
                        aria-label="개발 중"
                      />
                    )}
                  </span>
                  {badgeCount > 0 && (
                    <span className="ml-auto min-w-[18px] h-[18px] px-1.5 rounded-full bg-danger text-white text-[10px] font-bold grid place-items-center tabular">
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 모바일 전용 하단 네비게이션 바 — md(768px) 미만에서만 보인다(데스크톱은 고정 사이드바).
 * 토스처럼 핵심 탭 몇 개 + "전체" 탭. "전체"는 좌측 드로어가 아니라 전용 페이지(/menu)로 이동한다.
 *  - z-20: ChatFab(z-40) 보다 아래. (모바일 사이드 드로어는 폐지됨 — /menu 페이지가 대체)
 *  - 아이콘은 currentColor 를 따르므로 부모 color 만 바꾸면 활성/비활성 색이 함께 바뀐다.
 */
function BottomNav({ items }: { items: NavItem[] }) {
  // 전자결재 대기 건수 배지 — 사이드바와 동일한 폴링 hook 재사용.
  const approvalCounts = useApprovalCounts();
  // iOS 네이티브(아이폰)에서는 화면 하단에 떠 있는 애플 리퀴드 글래스 스타일 바(반투명+blur).
  // 그 외(웹·안드로이드·Electron 데스크톱)는 기존 in-flow 솔리드 바 그대로 — 무회귀.
  // (본문이 바 뒤로 지나가도록 클리어런스는 styles.css 의 html.hinest-ios --hinest-main-pb 가 담당.)
  const ios = nativePlatform() === "ios";
  return (
    <nav
      className={"app-bottomnav md:hidden flex items-stretch" + (ios ? "" : " flex-shrink-0")}
      style={
        ios
          ? {
              // 화면 하단에 떠 있는 알약형 글래스 바. 좌우 12px 여백 안에서 중앙 정렬 +
              // 최대 폭 제한 → 아이패드처럼 넓은 화면에서도 가로로 늘어지지 않고 가운데 알약.
              position: "fixed",
              left: "50%",
              transform: "translateX(-50%)",
              width: "calc(100% - 24px)",
              maxWidth: 480,
              bottom: "max(10px, env(safe-area-inset-bottom))",
              zIndex: 30,
              borderRadius: 26,
              // 반투명 + blur — 뒤로 스크롤되는 본문이 비쳐 보이는 글래스 질감.
              background: "var(--c-glass)",
              backdropFilter: "blur(22px) saturate(180%)",
              WebkitBackdropFilter: "blur(22px) saturate(180%)",
              border: "1px solid var(--c-glass-border)",
              boxShadow: "0 10px 30px rgba(16,18,27,0.22), inset 0 1px 0 rgba(255,255,255,0.22)",
              padding: "6px 4px",
              overflow: "hidden",
            }
          : {
              // 테마 변수로 칠해 다크 모드에서도 자연스럽게(이전엔 bg-white 고정이라 다크에서 깨졌음).
              background: "var(--c-surface)",
              borderTop: "1px solid var(--c-border)",
              // 홈 인디케이터 회피용 하단 여백. safe-area 없으면(env=0) 0.
              paddingBottom: "max(env(safe-area-inset-bottom) - 10px, 0px)",
              boxShadow: "0 -8px 24px rgba(20,22,27,0.06)",
            }
      }
      aria-label="주요 메뉴"
    >
      {items.map((n) => {
        const Icon = n.icon;
        const badge = n.to === "/approvals" ? approvalCounts.pending : 0;
        return (
          <BottomNavTab key={n.to} to={n.to} end={n.end} label={n.label} badge={badge}>
            <Icon />
          </BottomNavTab>
        );
      })}
      {/* 전체 — 전용 메뉴 페이지로 이동(좌측 드로어 아님). NavLink 라 현재 위치면 활성색. */}
      <BottomNavTab to="/menu" label="전체" ariaLabel="전체 메뉴">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </BottomNavTab>
    </nav>
  );
}

/**
 * 하단 바의 탭 한 칸. 활성 시 아이콘 뒤로 brand-soft 알약(pill)이 떠서 "지금 이 탭" 을
 * 또렷이 보여준다(토스 스타일). 색·아이콘은 currentColor 를 따르므로 NavLink 의 color 만
 * 바꾸면 활성/비활성이 함께 전환되고, pill 배경만 isActive 로 토글한다.
 */
function BottomNavTab({
  to,
  end,
  label,
  badge = 0,
  ariaLabel,
  children,
}: {
  to: string;
  end?: boolean;
  label: string;
  badge?: number;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={ariaLabel}
      onPointerDown={() => prefetchRoute(to)}
      onClick={() => prefetchRoute(to)}
      className={
        "relative flex-1 min-w-0 flex flex-col items-center justify-center gap-1 select-none " +
        "text-[10.5px] font-bold tracking-tight leading-none [&_svg]:w-[22px] [&_svg]:h-[22px]"
      }
      style={({ isActive }) => ({
        // 탭 한 칸 높이. 56→50→44(HIG 최소)로 낮췄다가 "조금 더 높게" 피드백에 +5 = 49px.
        // 터치 타깃은 셀 전체(flex-1 × 49px)라 HIG 최소 44pt 를 여유 있게 만족한다.
        height: 49,
        color: isActive ? "var(--c-brand)" : "var(--c-text-3)",
      })}
    >
      {({ isActive }) => (
        <>
          <span
            className="inline-flex items-center justify-center transition-colors duration-200"
            style={{
              width: 44,
              height: 28,
              borderRadius: 999,
              background: isActive ? "var(--c-brand-soft)" : "transparent",
            }}
          >
            <span className="relative inline-flex">
              {children}
              {badge > 0 && (
                <span
                  className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-1 rounded-full text-white text-[9px] font-bold grid place-items-center tabular"
                  style={{ background: "var(--c-danger)", boxShadow: "0 0 0 2px var(--c-surface)" }}
                >
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </span>
          </span>
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

/**
 * 모바일 "전체" 메뉴 페이지 — 하단 바의 "전체" 탭이 이 라우트(/menu)로 이동한다.
 * 과거엔 좌측 사이드 드로어로 열었지만 토스처럼 전용 페이지로 분리했다.
 * 데스크톱 사이드바와 동일한 NavSection/PinsSection/ProjectsSection 을 그대로 재사용해
 * 항목·배지·권한 노출 규칙이 사이드바와 어긋나지 않게 한다(단일 출처).
 * AppLayout 의 Outlet 안에서 렌더되므로 하단 바·ChatFab·각종 Provider 가 그대로 유지된다.
 */
export function MobileMenuPage() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const { disabled: disabledNav, dev: devNav } = useNavStatus();
  const filterByVisibility = (items: NavItem[]) => items.filter((i) => !disabledNav.has(i.to));
  const work = filterByVisibility(WORK_NAV);
  const comm = filterByVisibility(COMM_NAV);
  const res = filterByVisibility(RESOURCE_NAV);

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* 프로필 카드 — 탭하면 내 프로필로 */}
      <NavLink
        to="/profile"
        className="flex items-center gap-3 p-3.5 rounded-2xl bg-ink-50 border border-ink-150 hover:bg-ink-100 transition"
      >
        {user?.avatarUrl ? (
          <img
            src={imgSrc(user.avatarUrl)}
            alt={user.name ?? ""}
            className="rounded-full object-cover flex-shrink-0"
            style={{ width: 46, height: 46 }}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div
            className="rounded-full grid place-items-center text-white font-bold flex-shrink-0"
            style={{ width: 46, height: 46, background: user?.avatarColor ?? "#3B5CF0" }}
          >
            {user?.name?.[0] ?? "?"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold text-ink-900 truncate flex items-center gap-1.5">
            <span className="truncate min-w-0">{user?.name}</span>
            {isDevAccount(user) && <DevBadge iconOnly />}
          </div>
          <div className="text-[12.5px] text-ink-500 truncate">{user?.email}</div>
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-400 flex-shrink-0">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </NavLink>

      {/* 메뉴 그룹 — 데스크톱 사이드바와 동일 컴포넌트 재사용 */}
      {work.length > 0 && <NavSection label="워크스페이스" items={work} dev={devNav} />}
      {comm.length > 0 && <NavSection label="커뮤니케이션" items={comm} dev={devNav} />}
      {res.length > 0 && <NavSection label="자료·재무" items={res} dev={devNav} />}
      <PinsSection />
      <ProjectsSection />

      {user?.role === "ADMIN" && (
        <div>
          <SectionLabel>관리</SectionLabel>
          <NavLink to="/admin" className={({ isActive }) => navClass(isActive)}>
            {({ isActive }) => (<><ShieldIcon active={isActive} /><span>관리자</span></>)}
          </NavLink>
        </div>
      )}

      {(user?.superAdmin || user?.platformAdmin) && (
        <div>
          <SectionLabel>운영</SectionLabel>
          <NavLink
            to={user?.platformAdmin ? "/platform" : "/super-admin"}
            className={({ isActive }) => navClass(isActive)}
          >
            {({ isActive }) => (<><DevIcon active={isActive} /><span>운영 콘솔</span></>)}
          </NavLink>
        </div>
      )}

      {/* 앱 다운로드 — 웹 브라우저 접속 시에만(설치형 앱에선 숨김) */}
      {!isInstalledApp() && (
        <div>
          <NavLink
            to="/download"
            className="flex items-center gap-2.5 h-[44px] px-3 rounded-full text-[13px] font-semibold text-ink-700 hover:bg-ink-100 hover:text-ink-900 transition"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>앱 다운로드</span>
          </NavLink>
        </div>
      )}

      {/* 로그아웃 */}
      <button
        type="button"
        onClick={async () => { if (!(await confirmLogout())) return; await logout(); nav("/login"); }}
        className="w-full flex items-center justify-center gap-2 h-[46px] rounded-full border border-ink-150 text-[13px] font-bold text-ink-600 hover:bg-ink-100 hover:text-ink-900 transition"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
          <path d="m16 17 5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
        <span>로그아웃</span>
      </button>
    </div>
  );
}

type ProjectLite = {
  id: string;
  name: string;
  color: string;
  status: "ACTIVE" | "ARCHIVED";
};

/** 사이드바 본인 정보 옆 \"개발 중 페이지 보기\" 빠른 토글 — 개발자 전용. */
function DevQuickToggle() {
  const [on, setOn] = useState<boolean>(() => getDevPagesEnabled());
  useEffect(() => {
    function refresh() { setOn(getDevPagesEnabled()); }
    window.addEventListener("hinest:devPagesChange", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("hinest:devPagesChange", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  function toggle() {
    const next = !on;
    setOn(next);
    setDevPagesEnabled(next);
  }
  return (
    <button
      type="button"
      onClick={toggle}
      className="btn-icon"
      title={on ? "“개발 중” 페이지 진입 켜짐 — 클릭해서 끄기" : "“개발 중” 페이지 진입 꺼짐 — 클릭해서 켜기"}
      aria-label={on ? "개발 페이지 보기 끄기" : "개발 페이지 보기 켜기"}
      style={{
        position: "relative",
        color: on ? "var(--c-warning)" : "var(--c-text-3)",
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
      <span
        aria-hidden
        style={{
          position: "absolute",
          right: 2,
          bottom: 2,
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: on ? "var(--c-warning)" : "var(--c-border-strong)",
          border: "1.5px solid var(--c-surface)",
        }}
      />
    </button>
  );
}

/**
 * 사이드바 "팀" 섹션 — 내가 참여중인 프로젝트 목록.
 * - 아직 참여 프로젝트가 없어도 섹션 자체는 노출해서 "여기가 프로젝트 모이는 곳이다" 를 알 수 있게.
 * - 활성 프로젝트만 기본 노출, ARCHIVED 는 숨김.
 */
function ProjectsSection() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openCreate, setOpenCreate] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // ADMIN 은 본인이 멤버가 아니어도 전체 프로젝트를 사이드바에서 열람.
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    let alive = true;
    api<{ projects: ProjectLite[] }>(isAdmin ? "/api/project?all=1" : "/api/project")
      .then((r) => {
        if (!alive) return;
        setProjects(r.projects);
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [isAdmin, reloadKey]);

  // 다른 화면(프로젝트 설정 모달의 이름/색/보관/삭제 등)에서 프로젝트가 바뀌면
  // 사이드바 목록도 다시 불러온다(projects:reload 커스텀 이벤트).
  useEffect(() => {
    const onReload = () => setReloadKey((k) => k + 1);
    window.addEventListener("projects:reload", onReload);
    return () => window.removeEventListener("projects:reload", onReload);
  }, []);

  const active = projects.filter((p) => p.status === "ACTIVE");

  return (
    <div>
      <div className="flex items-center justify-between pr-1">
        <SectionLabel>프로젝트</SectionLabel>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setOpenCreate(true)}
            className="w-5 h-5 mb-1.5 grid place-items-center rounded-full text-ink-500 hover:text-ink-900 hover:bg-ink-100 transition"
            title="새 프로젝트"
            aria-label="새 프로젝트"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        )}
      </div>
      <div className="space-y-0.5">
        {active.map((p) => (
          <NavLink
            key={p.id}
            to={`/projects/${p.id}`}
            className={({ isActive }) => navClass(isActive)}
            onMouseEnter={() => prefetchRoute(`/projects/${p.id}`)}
            onFocus={() => prefetchRoute(`/projects/${p.id}`)}
          >
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: p.color }}
            />
            <span className="flex-1 truncate">{p.name}</span>
          </NavLink>
        ))}
        {loaded && active.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-ink-400">
            참여중인 프로젝트가 없습니다.
          </div>
        )}
      </div>
      {isAdmin && (
        <CreateProjectModal
          open={openCreate}
          onClose={() => setOpenCreate(false)}
          onCreated={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}

/**
 * 즐겨찾기(핀) — 문서·회의록·공지·프로젝트·채팅방을 한 곳에 모은다.
 * 드래그로 순서 재정렬 가능. 없으면 섹션 자체 숨김.
 */
function PinsSection() {
  const { pins, ready, reorder, toggle } = usePins();
  const nav = useNavigate();
  const [dragId, setDragId] = useState<string | null>(null);

  if (!ready || pins.length === 0) return null;

  const handleClick = (p: typeof pins[number]) => {
    const url = pinLinkUrl(p);
    if (url.startsWith("#chat:")) {
      const roomId = url.slice("#chat:".length);
      window.dispatchEvent(new CustomEvent("chat:open"));
      window.dispatchEvent(new CustomEvent("chat:open-room", { detail: { roomId } }));
    } else {
      nav(url);
    }
  };

  const onDrop = (overId: string) => {
    if (!dragId || dragId === overId) { setDragId(null); return; }
    const ids = pins.map((p) => p.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(overId);
    if (from === -1 || to === -1) { setDragId(null); return; }
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    reorder(next);
    setDragId(null);
  };

  return (
    <div>
      <SectionLabel>즐겨찾기</SectionLabel>
      <div className="space-y-0.5">
        {pins.map((p) => {
          const label = p.label ?? p.name ?? "삭제된 항목";
          const icon = PIN_TYPE_ICON[p.targetType as keyof typeof PIN_TYPE_ICON] ?? "•";
          return (
            <div
              key={p.id}
              draggable
              onDragStart={(e) => { setDragId(p.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.id); }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
              onDrop={(e) => { e.preventDefault(); onDrop(p.id); }}
              onDragEnd={() => setDragId(null)}
              className={`tap-row group flex items-center gap-2 h-[40px] md:h-[30px] px-3 rounded-full text-[12.5px] font-semibold cursor-pointer transition ${
                dragId === p.id ? "opacity-40" : ""
              } ${p.missing ? "text-ink-400" : "text-ink-700 hover:bg-ink-100 hover:text-ink-900"}`}
              title={p.missing ? "원본이 삭제되었어요 — 클릭해서 핀 해제" : label}
              onClick={() => (p.missing ? toggle(p.targetType, p.targetId) : handleClick(p))}
            >
              <span className="text-[11px] opacity-70">{icon}</span>
              <span className="flex-1 truncate">{label}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggle(p.targetType, p.targetId); }}
                className="touch-reveal md:opacity-0 md:group-hover:opacity-100 w-7 h-7 md:w-4 md:h-4 grid place-items-center rounded text-ink-400 hover:text-ink-900"
                title="핀 해제"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PIN_TYPE_ICON = {
  DOCUMENT: "📄",
  MEETING: "🗒",
  NOTICE: "📢",
  PROJECT: "◆",
  CHAT_ROOM: "💬",
} as const;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 mb-1.5 text-[10px] font-bold text-ink-500 uppercase tracking-[0.08em]">
      {children}
    </div>
  );
}

function navClass(active: boolean) {
  return [
    "tap-row flex items-center gap-2.5 h-[40px] md:h-[34px] px-3 rounded-full text-[13px] font-bold transition",
    active ? "nav-active" : "text-ink-700 hover:bg-ink-100 hover:text-ink-900",
  ].join(" ");
}

/* ---------- TopBar ---------- */
const BREADCRUMB: Record<string, string> = {
  "/": "개요",
  "/schedule": "일정",
  "/attendance": "근태·월차",
  "/journal": "업무일지",
  "/notice": "공지사항",
  "/directory": "팀원",
  "/org": "조직도",
  "/documents": "문서함",
  "/accounts": "계정 관리",
  "/snippets": "스니펫",
  "/approvals": "전자결재",
  "/meetings": "회의록",
  "/expense": "법인카드",
  "/admin": "관리자",
  "/profile": "내 프로필",
  "/menu": "전체",
};

function TopBar({ draggable = false, onOpenNav, safeAreaTop = false }: { draggable?: boolean; onOpenNav?: () => void; safeAreaTop?: boolean }) {
  const loc = useLocation();
  const { chatUnread } = useNotifications();
  const label = loc.pathname.startsWith("/projects/")
    ? "프로젝트"
    : BREADCRUMB[loc.pathname] ?? "";
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
      // Cmd+T — 사내톡 팝업 토글 (ChatFab 이 전역 이벤트로 받음)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "t") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("chat:toggle"));
      }
      if (e.key === "Escape" && searchOpen) setSearchOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  return (
    <>
      <header
        className={
          "app-topbar flex items-center justify-between px-3 md:px-6 border-b border-ink-150 bg-white flex-shrink-0 " +
          // 모바일 56px / 데스크톱 48px(기존 유지). 노치(safe-area-top)가 있으면 그만큼 더해
          // 콘텐츠 영역 높이는 그대로 두고 상태바 밑으로 안 깔리게 한다.
          (safeAreaTop
            ? "min-h-[calc(56px+env(safe-area-inset-top))] md:min-h-[calc(48px+env(safe-area-inset-top))]"
            : "min-h-[56px] md:min-h-[48px]")
        }
        style={{
          // iOS 노치 흡수 — 헤더 자체가 첫 요소일 때만 (배너가 위에 있으면 배너가 처리).
          paddingTop: safeAreaTop ? "env(safe-area-inset-top)" : 0,
          ...(draggable ? ({ WebkitAppRegion: "drag" } as React.CSSProperties) : undefined),
        }}
      >
        <div
          className="flex items-center gap-2 text-[13px] min-w-0"
          style={draggable ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties) : undefined}
        >
          {/* 모바일 햄버거 — md 이상은 숨김 */}
          {onOpenNav && (
            <button
              type="button"
              className="md:hidden w-9 h-9 -ml-1 mr-0.5 grid place-items-center rounded-full text-ink-700 hover:bg-ink-100"
              onClick={onOpenNav}
              title="메뉴"
              aria-label="메뉴 열기"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </button>
          )}
          <span className="w-2 h-2 md:w-1.5 md:h-1.5 rounded-full flex-shrink-0" style={{ background: "var(--c-brand)" }} />
          <span className="text-[17px] md:text-[13px] text-ink-900 font-bold truncate">{label || "HiNest"}</span>
        </div>

        <div
          className="flex items-center gap-2"
          style={draggable ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties) : undefined}
        >
          <button
            onClick={() => setSearchOpen(true)}
            className="hidden md:flex items-center gap-2 h-[34px] px-4 rounded-full bg-ink-50 border border-ink-150 text-ink-500 text-[12px] hover:bg-ink-100 hover:border-ink-200 min-w-[260px]"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <span className="flex-1 text-left">검색</span>
            <span className="kbd">⌘K</span>
          </button>
          {/* 사내톡 런처 — 모바일(<md) 전용. 상단바 벨 옆에 두고 클릭 시 전역 "chat:toggle"
              이벤트로 ChatFab 패널을 토글한다(패널/리스너는 ChatFab 에 그대로 있음).
              데스크톱(md+)은 ChatFab 의 우하단 FAB 를 그대로 쓰므로 여기선 숨긴다. */}
          <button
            className="btn-icon relative md:hidden !w-[40px] !h-[40px]"
            onClick={() => window.dispatchEvent(new CustomEvent("chat:toggle"))}
            title="사내톡"
            aria-label={chatUnread > 0 ? `사내톡 · 안 읽은 메시지 ${chatUnread}건` : "사내톡"}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
            {chatUnread > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-danger text-white text-[10px] font-bold grid place-items-center tabular">
                {chatUnread > 99 ? "99+" : chatUnread}
              </span>
            )}
          </button>
          <NotificationBell />
        </div>
      </header>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}

/* ---------- Icons ---------- */
type I = { active?: boolean };
const swInv = (a?: boolean) => (a ? "#fff" : "#6B7280");

function svgBase(_active: boolean, path: React.ReactNode) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  );
}
function HomeIcon({ active }: I) { return svgBase(!!active, <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h4v-6h6v6h4V9.5" /></>); }
function CalendarIcon({ active }: I) { return svgBase(!!active, <><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4" /></>); }
function ClockIcon({ active }: I) { return svgBase(!!active, <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>); }
function NoteIcon({ active }: I) { return svgBase(!!active, <><path d="M5 4h10l4 4v12H5z" /><path d="M14 4v5h5M8 13h8M8 16h5" /></>); }
function MeetingIcon({ active }: I) { return svgBase(!!active, <><path d="M4 5h16v11H4z" /><path d="M4 5 12 12l8-7" /><path d="M8 20h8M12 16v4" /></>); }
function MegaIcon({ active }: I) { return svgBase(!!active, <><path d="M3 10v4a2 2 0 0 0 2 2h2l8 5V3L7 8H5a2 2 0 0 0-2 2Z" /><path d="M19 8a5 5 0 0 1 0 8" /></>); }
function PeopleIcon({ active }: I) { return svgBase(!!active, <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>); }
function OrgIcon({ active }: I) { return svgBase(!!active, <><rect x="8" y="3" width="8" height="6" rx="1" /><rect x="3" y="15" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" /><path d="M12 9v3M6 15v-3h12v3" /></>); }
function DocsIcon({ active }: I) { return svgBase(!!active, <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>); }
function MemoIcon({ active }: I) { return svgBase(!!active, <><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></>); }
function ApprovalIcon({ active }: I) { return svgBase(!!active, <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="m9 14 2 2 4-4" /></>); }
function CardIcon({ active }: I) { return svgBase(!!active, <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 11h18M7 16h4" /></>); }
function KeyIcon({ active }: I) { return svgBase(!!active, <><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.5 12.5 10-10M17 7l3 3M15.5 8.5l3 3" /></>); }
function SnippetIcon({ active }: I) { return svgBase(!!active, <><path d="m8 3-4 4 4 4M16 3l4 4-4 4" /><path d="M14 4 10 20" /></>); }
function ShieldIcon({ active }: I) { return svgBase(!!active, <><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></>); }
function PayrollIcon({ active }: I) { return svgBase(!!active, <><path d="M4 4h16v16H4z" /><path d="M8 8h8M8 12h8M8 16h5" /></>); }
function DevIcon({ active }: I) { return svgBase(!!active, <><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>); }
const _unused_swInv = swInv;
