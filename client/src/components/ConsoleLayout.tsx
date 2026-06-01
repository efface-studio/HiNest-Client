import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import AdminLockup from "./AdminLockup";

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
function LogsIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  );
}
function SystemIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export default function ConsoleLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  // macOS 데스크톱 창모드에서 신호등(트래픽라이트) 버튼 영역 확보 (AppLayout 과 동일) — HiNest 로고 겹침 방지.
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
  //
  // 개발자 콘솔은 기능이 너무 몰려 있어 기능별 그룹(로그·감사 / 시스템·운영 / 보안·권한 /
  // 개발자 도구)으로 쪼개 각각 사이드바 항목으로 노출한다. 라우트는 /super-admin/* 하위.
  const links: ConsoleLink[] = [
    (user?.platformAdmin || user?.superAdmin) && { to: "/platform", label: "회사 관리", desc: "테넌트 가입·승인·정지", icon: CompanyIcon },
    user?.superAdmin && { to: "/super-admin/logs", label: "로그 · 감사", desc: "활동·감사·서버 로그·에러", icon: LogsIcon },
    user?.superAdmin && { to: "/super-admin/system", label: "시스템 · 운영", desc: "헬스·세션·휴지통·플래그·메뉴", icon: SystemIcon },
    user?.superAdmin && { to: "/super-admin/security", label: "보안 · 권한", desc: "보안 룰·2FA·역할·API 토큰", icon: ShieldIcon },
    user?.superAdmin && { to: "/super-admin/devtools", label: "개발자 도구", desc: "API 명세서·콘솔", icon: TerminalIcon },
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
        {/* 신호등 버튼용 드래그 가능 여백 — macOS 창모드에서만 */}
        {showTitlebarSpace && (
          <div
            style={{
              height: 28,
              // @ts-expect-error drag region
              WebkitAppRegion: "drag",
            }}
          />
        )}
        <div className="px-5 h-[52px] flex items-center border-b border-white/10 flex-shrink-0">
          <AdminLockup variant="compact" onDark />
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
        {showTitlebarSpace && (
          <div
            className="bg-ink-50"
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
            <AdminLockup variant="compact" onDark />
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
