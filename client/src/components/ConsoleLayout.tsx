import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import BrandLockup from "./BrandLockup";

/**
 * 운영 콘솔 셸 — 총관리자(개발자)/플랫폼 운영자 전용. 회사 앱(AppLayout)과
 * 완전히 분리된 별도 레이아웃이다. 회사 사이드바·알림·핀·사내톡 등 테넌트 UI 를
 * 일절 가져오지 않고, 어두운 사이드바로 "지금은 운영 영역" 임을 시각적으로 구분한다.
 *
 * 라우팅: App.tsx 에서 /platform·/super-admin 를 이 레이아웃 아래로 옮겼다.
 * 접근 가드(ConsoleOnly: superAdmin||platformAdmin)는 라우터에서 처리.
 */

type ConsoleLink = { to: string; label: string; desc: string; icon: (p: { active?: boolean }) => JSX.Element };

function CompanyIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" />
      <path d="M9 9v.01" /><path d="M9 12v.01" /><path d="M9 15v.01" /><path d="M9 18v.01" />
    </svg>
  );
}
function TerminalIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

export default function ConsoleLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  // macOS Electron 창모드에선 신호등 버튼이 좌상단 콘텐츠를 침범한다 — AppLayout 과
  // 동일하게 상단에 드래그 가능한 28px 여백을 두어 로고/본문이 가려지지 않게 한다.
  // 전체화면에선 신호등이 숨으므로 여백 제거.
  const isMacDesktop = !!window.hinest?.isDesktop && window.hinest?.platform === "darwin";
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    if (!isMacDesktop || !window.hinest?.onFullscreenChange) return;
    const off = window.hinest.onFullscreenChange((fs) => setIsFullscreen(fs));
    return () => {
      try { off?.(); } catch {}
    };
  }, [isMacDesktop]);
  const showTitlebarSpace = isMacDesktop && !isFullscreen;

  // 회사 관리는 플랫폼 운영자뿐 아니라 개발자(superAdmin)에게도 노출 — 개발자는 최상위
  // 권한이므로 테넌트 가입 승인까지 직접 처리할 수 있어야 한다.
  const links: ConsoleLink[] = [
    (user?.platformAdmin || user?.superAdmin) && { to: "/platform", label: "회사 관리", desc: "테넌트 가입·승인·정지", icon: CompanyIcon },
    user?.superAdmin && { to: "/super-admin", label: "개발자 콘솔", desc: "로그·감사·시스템 설정", icon: TerminalIcon },
  ].filter(Boolean) as ConsoleLink[];

  // 회사 소속이 있는 운영자만 서비스로 복귀 가능. 순수 플랫폼 운영자(companyId=null)는
  // 돌아갈 회사 앱이 없으므로 복귀 링크를 숨긴다.
  const hasCompany = !!user?.companyId;

  async function doLogout() {
    await logout();
    nav("/login");
  }

  function itemClass(isActive: boolean) {
    return [
      "flex items-start gap-2.5 px-3 py-2 rounded-xl transition",
      isActive ? "bg-white/12 text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white/90",
    ].join(" ");
  }

  return (
    <div className="flex bg-ink-50" style={{ height: "100dvh" }}>
      {/* ===== 데스크톱 사이드바 (어두운 운영 테마) ===== */}
      <aside
        className="hidden md:flex w-[252px] flex-col flex-shrink-0 bg-ink-900 text-white"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
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
        <div className="px-5 h-[52px] flex items-center gap-2 border-b border-white/10 flex-shrink-0">
          <BrandLockup tone="dark" height={24} subtitle={false} />
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wide"
            style={{ background: "var(--c-brand)", color: "#fff" }}
          >
            운영 콘솔
          </span>
        </div>

        {hasCompany && (
          <div className="px-2 pt-3 flex-shrink-0">
            <button
              onClick={() => nav("/")}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[12.5px] font-semibold text-white/75 bg-white/[0.06] hover:bg-white/[0.12] hover:text-white transition"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
              </svg>
              서비스로 돌아가기
            </button>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => itemClass(isActive)}>
              {({ isActive }) => (
                <>
                  <span className="mt-0.5 flex-shrink-0" style={{ color: isActive ? "#fff" : undefined }}>
                    <l.icon active={isActive} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold leading-tight">{l.label}</span>
                    <span className="block text-[11px] text-white/45 leading-tight mt-0.5">{l.desc}</span>
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div
          className="border-t border-white/10 px-2 py-2 flex-shrink-0 space-y-1"
          style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-center gap-2 px-3 py-2">
            <div
              className="avatar avatar-sm flex-shrink-0"
              style={{ background: user?.avatarColor ?? "#3B5CF0" }}
            >
              {user?.name?.[0] ?? "?"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold truncate">{user?.name}</div>
              <div className="text-[10.5px] text-white/45 truncate">{user?.email}</div>
            </div>
            <button onClick={doLogout} className="text-white/50 hover:text-white transition" title="로그아웃" aria-label="로그아웃">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* ===== 모바일 상단바 + 본문 ===== */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* 신호등 영역용 드래그 가능 상단바 — 본문 배경과 통일 */}
        {showTitlebarSpace && (
          <div
            className="bg-ink-50 flex-shrink-0"
            style={{
              height: 28,
              // @ts-expect-error drag region
              WebkitAppRegion: "drag",
            }}
          />
        )}
        <header
          className="md:hidden bg-ink-900 text-white flex-shrink-0"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <div className="h-[48px] px-4 flex items-center gap-2">
            <BrandLockup tone="dark" height={22} subtitle={false} />
            <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-md uppercase" style={{ background: "var(--c-brand)" }}>
              운영 콘솔
            </span>
            <div className="ml-auto flex items-center gap-1">
              {hasCompany && (
                <button onClick={() => nav("/")} className="text-[12px] font-semibold text-white/70 hover:text-white px-2 py-1">
                  서비스
                </button>
              )}
              <button onClick={doLogout} className="text-white/60 hover:text-white px-2 py-1" aria-label="로그아웃">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" />
                </svg>
              </button>
            </div>
          </div>
          <div className="px-2 pb-2 flex gap-1 overflow-x-auto">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  [
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-semibold whitespace-nowrap transition",
                    isActive ? "bg-white/15 text-white" : "text-white/60 hover:text-white",
                  ].join(" ")
                }
              >
                <l.icon />
                {l.label}
              </NavLink>
            ))}
          </div>
        </header>

        <main
          className="flex-1 overflow-y-auto"
          style={{ overscrollBehaviorY: "contain", WebkitOverflowScrolling: "touch" }}
        >
          <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-4 md:py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
