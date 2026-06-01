import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { useTheme } from "../theme";
import { api } from "../api";
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
import { isInstalledApp } from "../lib/platform";

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

export default function AppLayout({ children }: { children?: React.ReactNode } = {}) {
  return (
    <NotificationProvider>
      <PinsProvider>
        <AppLayoutInner>{children}</AppLayoutInner>
      </PinsProvider>
    </NotificationProvider>
  );
}

function AppLayoutInner({ children }: { children?: React.ReactNode }) {
  const { user, logout, impersonator } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const { disabled: disabledNav, dev: devNav } = useNavStatus();
  const filterByVisibility = (items: NavItem[]) => items.filter((i) => !disabledNav.has(i.to));
  const isMacDesktop = !!window.hinest?.isDesktop && window.hinest?.platform === "darwin";
  const [isFullscreen, setIsFullscreen] = useState(false);
  // 모바일 사이드바 드로어 — md 미만에서만 의미 있음 (md 이상은 항상 고정 배치)
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

  // 라우트가 바뀌면 드로어는 자동으로 닫는다 — 모바일에서 탭하면 같은 창 위로
  // 메뉴가 덮여 있어 바로 닫혀야 자연스럽다.
  useEffect(() => { setMobileNavOpen(false); }, [loc.pathname]);
  // 드로어 열렸을 때 body 스크롤 잠금 — 데스크톱에는 영향 없음.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [mobileNavOpen]);

  // 창모드에서만 신호등 버튼 여백 필요, 전체화면에선 숨어있으므로 여백 제거
  const showTitlebarSpace = isMacDesktop && !isFullscreen;

  return (
    <div
      className="flex flex-col bg-ink-50 overflow-hidden"
      style={{
        // iOS Safari 의 동적 툴바를 고려한 동적 뷰포트 높이. h-screen(100vh) 은 iOS 에서 URL 바 영역만큼 잘려 보임.
        height: "100dvh",
      }}
    >
      <PreviewBanner safeAreaTop={topSlot === "preview"} />
      <PreviewOnboarding />
      <ImpersonationBanner safeAreaTop={topSlot === "impersonation"} />
      <div className="flex flex-1 min-h-0">
      {/* 모바일 드로어 백드롭 — md 미만에서 열렸을 때만 보임 */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden
        />
      )}
      <aside
        className={`
          w-[232px] bg-white border-r border-ink-150 flex flex-col flex-shrink-0
          md:static md:translate-x-0 md:h-auto
          fixed top-0 left-0 z-40
          h-[100dvh]
          transition-transform duration-200 ease-out
          ${mobileNavOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        `}
      >
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
              className="flex items-center gap-2.5 h-[40px] md:h-[32px] px-3 rounded-full text-[13px] md:text-[12.5px] font-semibold text-ink-500 hover:bg-ink-100 hover:text-ink-900 transition"
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
                  src={user.avatarUrl}
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

      <div className="flex-1 min-w-0 flex flex-col">
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
          onOpenNav={() => setMobileNavOpen(true)}
          safeAreaTop={topSlot === "topbar"}
        />
        <main
          className="flex-1 overflow-y-auto"
          style={{
            // iOS 러버밴드 오버스크롤 방지 — 사용자가 페이지 상단에서 더 끌어내리면
            // 그 동작이 부모 요소로 전파되어 TopBar 가 잠시 사라지며 그 자리에 본문이
            // 노출되는 \"뚫림\" 현상이 발생했다. contain 으로 main 안에서만 스크롤 처리.
            overscrollBehaviorY: "contain",
            // iOS Safari momentum scrolling 안정화.
            WebkitOverflowScrolling: "touch",
          }}
        >
          <div
            className="max-w-[1400px] mx-auto px-4 md:px-8 pt-4 md:pt-6"
            style={{
              // 모바일 하단 네비게이션 바(--hinest-bottomnav-h)·iOS 홈 인디케이터 영역만큼
              // 본문 하단을 비워 마지막 콘텐츠가 바에 가리지 않게 한다. 데스크톱은 var=0 이라
              // 기본 여백(24px)만 남는다.
              paddingBottom:
                "calc(var(--hinest-bottomnav-h, 0px) + env(safe-area-inset-bottom) + 24px)",
            }}
          >
            <RouteVisibilityGate disabled={disabledNav} dev={devNav}>
              {/* /preview 같은 비-라우터-childless 진입 시엔 children 으로 직접 받음. 그 외엔 Outlet. */}
              {children ?? <Outlet />}
            </RouteVisibilityGate>
          </div>
        </main>
      </div>
      <BottomNav
        items={filterByVisibility(BOTTOM_NAV)}
        onOpenAll={() => setMobileNavOpen(true)}
        allActive={mobileNavOpen}
      />
      <ChatFab />
      </div>
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
 * 토스처럼 핵심 탭 몇 개 + "전체" 버튼. "전체"는 좌측 드로어(기존 사이드바 전체 메뉴)를 연다.
 *  - z-20: 드로어 백드롭(z-30)·드로어(z-40)·ChatFab(z-40)보다 아래라 드로어가 열리면 가려진다.
 *  - 아이콘은 currentColor 를 따르므로 부모 color 만 바꾸면 활성/비활성 색이 함께 바뀐다.
 */
function BottomNav({
  items,
  onOpenAll,
  allActive,
}: {
  items: NavItem[];
  onOpenAll: () => void;
  allActive: boolean;
}) {
  // 전자결재 대기 건수 배지 — 사이드바와 동일한 폴링 hook 재사용.
  const approvalCounts = useApprovalCounts();
  const itemCls =
    "relative flex-1 min-w-0 flex flex-col items-center justify-center gap-1 select-none " +
    "text-[10.5px] font-bold tracking-tight leading-none [&_svg]:w-[22px] [&_svg]:h-[22px]";
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-20 flex items-stretch bg-white border-t border-ink-150"
      style={{
        paddingBottom: "env(safe-area-inset-bottom)",
        boxShadow: "0 -6px 20px rgba(20,22,27,0.05)",
      }}
      aria-label="주요 메뉴"
    >
      {items.map((n) => {
        const Icon = n.icon;
        const badge = n.to === "/approvals" ? approvalCounts.pending : 0;
        return (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={itemCls}
            style={({ isActive }) => ({
              height: 56,
              color: isActive ? "var(--c-brand)" : "var(--c-text-3)",
            })}
            onClick={() => prefetchRoute(n.to)}
          >
            <span className="relative inline-flex">
              <Icon />
              {badge > 0 && (
                <span
                  className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-1 rounded-full text-white text-[9px] font-bold grid place-items-center tabular"
                  style={{ background: "var(--c-danger)" }}
                >
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </span>
            <span>{n.label}</span>
          </NavLink>
        );
      })}
      {/* 전체 — 좌측 드로어로 전체 메뉴 열기. 라우트가 아니므로 button. */}
      <button
        type="button"
        onClick={onOpenAll}
        className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 select-none text-[10.5px] font-bold tracking-tight leading-none"
        style={{ height: 56, color: allActive ? "var(--c-brand)" : "var(--c-text-3)" }}
        aria-label="전체 메뉴 열기"
        aria-expanded={allActive}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
        <span>전체</span>
      </button>
    </nav>
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
              className={`group flex items-center gap-2 h-[40px] md:h-[30px] px-3 rounded-full text-[12.5px] font-semibold cursor-pointer transition ${
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
                className="md:opacity-0 md:group-hover:opacity-100 w-7 h-7 md:w-4 md:h-4 grid place-items-center rounded text-ink-400 hover:text-ink-900"
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
    "flex items-center gap-2.5 h-[40px] md:h-[34px] px-3 rounded-full text-[13px] font-bold transition",
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
  "/expense": "법인카드",
  "/admin": "관리자",
  "/profile": "내 프로필",
};

function TopBar({ draggable = false, onOpenNav, safeAreaTop = false }: { draggable?: boolean; onOpenNav?: () => void; safeAreaTop?: boolean }) {
  const loc = useLocation();
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
        className="flex items-center justify-between px-3 md:px-6 border-b border-ink-150 bg-white flex-shrink-0"
        style={{
          // iOS 노치 흡수 — 헤더 자체가 첫 요소일 때만 (배너가 위에 있으면 배너가 처리).
          paddingTop: safeAreaTop ? "env(safe-area-inset-top)" : 0,
          minHeight: 48,
          height: safeAreaTop ? "calc(48px + env(safe-area-inset-top))" : 48,
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
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "var(--c-brand)" }} />
          <span className="text-ink-900 font-bold truncate">{label || "HiNest"}</span>
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
