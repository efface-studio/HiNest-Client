import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import AdminLockup from "./AdminLockup";
import { LiquidGlassTabBar } from "../lib/liquidGlassTabBar";
import { nativePlatform } from "../lib/platform";

// 콘솔 탭 라우트 → 네이티브 탭바용 아이콘 에셋(Assets.xcassets) 이름.
const CONSOLE_TAB_ICON: Record<string, string> = {
  "/platform": "tab-company",
  "/super-admin/logs": "tab-logs",
  "/super-admin/system": "tab-system",
  "/super-admin/security": "tab-security",
  "/super-admin/devtools": "tab-devtools",
};
/** 현재 경로에 해당하는 콘솔 탭 key. 더 구체적인(긴) 경로 우선. 없으면 빈 문자열. */
function matchConsoleTab(pathname: string, keys: string[]): string {
  for (const k of [...keys].sort((a, b) => b.length - a.length)) {
    if (pathname === k || pathname.startsWith(k + "/")) return k;
  }
  return "";
}

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
  const { user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

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
  // 개발자 콘솔 전용 계정(consoleOnly)도 회사 앱 진입이 막혀 있어(복귀해도 즉시 콘솔로
  // 튕겨 돌아옴) companyId 가 있어도 복귀 링크를 숨긴다.
  const hasCompany = !!user?.companyId && !user?.consoleOnly;

  // 콘솔도 메인 앱과 동일한 실제 네이티브 리퀴드 글래스 탭바를 쓴다 — 콘솔 전용 탭으로
  // 재설정한다. 성공하면 .hinest-native-tabbar 가 붙어 아래 CSS 글래스 nav 는 숨고 네이티브
  // 바가 대체한다. 콘솔을 떠나면(언마운트) 숨기고, AppLayout 이 다시 마운트되며 앱 탭으로
  // 재설정한다(같은 싱글톤 바). iOS<26/미지원이면 CSS 글래스 nav 가 그대로 폴백.
  useEffect(() => {
    if (nativePlatform() !== "ios") return;
    const tabs = links.map((l) => ({ key: l.to, title: l.label.split(" ")[0], icon: CONSOLE_TAB_ICON[l.to] ?? "" }));
    if (tabs.length === 0) return;
    let cancelled = false;
    let removeListener: (() => void) | undefined;
    (async () => {
      try {
        const res = await LiquidGlassTabBar.configure({ tabs });
        if (cancelled || !res?.active) return;
        document.documentElement.classList.add("hinest-native-tabbar");
        const handle = await LiquidGlassTabBar.addListener("tabSelected", (d: { key?: string }) => {
          if (d?.key) nav(d.key);
        });
        removeListener = () => { try { void handle?.remove?.(); } catch {} };
        LiquidGlassTabBar.setSelected({ key: matchConsoleTab(window.location.pathname, tabs.map((t) => t.key)) }).catch(() => {});
        LiquidGlassTabBar.setVisible({ visible: true }).catch(() => {});
      } catch {
        /* 미지원 → CSS 글래스 nav 폴백 */
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
    LiquidGlassTabBar.setSelected({ key: matchConsoleTab(loc.pathname, links.map((l) => l.to)) }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname]);

  // doLogout 제거 — 콘솔에선 로그아웃 버튼을 노출하지 않는다(사용자 요구).
  // 로그아웃은 회사 페이지에서 처리.

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
        className="console-sidebar hidden md:flex w-[252px] flex-col flex-shrink-0 bg-ink-900 text-white"
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
            {/* 데스크탑 사이드바 user profile — 로그아웃 버튼 제거(사용자 요구).
                콘솔은 회사 앱 안의 운영 도구라 로그아웃은 회사 페이지에서 처리.
                "서비스로 돌아가기"는 사이드바 상단의 큰 버튼이 이미 담당. */}
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
          className="md:hidden bg-white dark:bg-ink-900 text-ink-900 dark:text-white border-b border-ink-150 dark:border-ink-800 flex-shrink-0"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <div className="h-[48px] px-4 flex items-center gap-2">
            {/* onDark 를 넘기지 않으면 AdminLockup 이 앱 테마(resolved)를 따라간다. */}
            <AdminLockup variant="compact" />
            <div className="ml-auto flex items-center gap-1">
              {/* 모바일 콘솔 상단 우측 — '서비스로 돌아가기' 단일 버튼.
                  기존엔 "서비스" 텍스트 + 별도 로그아웃 아이콘 두 개가 있었으나, 콘솔은
                  회사 앱 안의 운영 도구라 로그아웃이 별도로 필요 없음(회사 페이지에서 처리).
                  하나로 통합해 깔끔하게(아이콘은 '왼쪽 화살표' = 돌아가기). */}
              {hasCompany && (
                <button
                  onClick={() => nav("/")}
                  className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-600 hover:text-ink-900 dark:text-white/75 dark:hover:text-white px-2.5 py-1.5 rounded-md hover:bg-ink-50 dark:hover:bg-white/5 transition"
                  aria-label="서비스로 돌아가기"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                  서비스
                </button>
              )}
            </div>
          </div>
        </header>

        <main
          className="flex-1 overflow-y-auto"
          style={{ overscrollBehaviorY: "contain", WebkitOverflowScrolling: "touch" }}
        >
          {/* 모바일은 하단 글래스 바 높이만큼 본문 바닥 여백 확보(데스크톱은 사이드바라 불필요). */}
          <div className="max-w-[1400px] mx-auto px-4 md:px-8 pt-4 pb-[calc(84px+env(safe-area-inset-bottom))] md:py-6">
            <Outlet />
          </div>
        </main>

        {/* ===== 모바일 하단 글래스 그룹 내비 (애플 글래스 스타일, CSS) =====
            데스크톱은 좌측 사이드바를 쓰므로 md:hidden. 콘솔은 AppLayout 과 분리된
            레이아웃이라 네이티브 탭바 플러그인을 쓰지 않고 동일한 --c-glass 토큰으로 맞춘다. */}
        <nav
          // flex: 모바일에서 아이콘을 가로로 배치(예전엔 display 규칙이 없어 세로로 깨져 보였음).
          // md:hidden: 데스크톱(≥1024px, 사이드바 md:flex 와 동일 분기)에선 JS 클래스와 무관하게
          //            순수 CSS 로 숨긴다 — hinest-desktop 클래스가 안 붙는 경로(콘솔 전용 계정 등)
          //            에서도 확실히 사라지도록. 좁은 데스크톱 창은 html.hinest-desktop 규칙이 보강.
          className="console-bottomnav flex md:hidden"
          style={{
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            bottom: "max(10px, env(safe-area-inset-bottom))",
            width: "calc(100% - 24px)",
            maxWidth: 480,
            zIndex: 30,
            borderRadius: 24,
            background: "var(--c-glass)",
            backdropFilter: "blur(22px) saturate(180%)",
            WebkitBackdropFilter: "blur(22px) saturate(180%)",
            border: "1px solid var(--c-glass-border)",
            boxShadow: "0 10px 30px rgba(16,18,27,0.22), inset 0 1px 0 rgba(255,255,255,0.22)",
            padding: "6px 4px",
            alignItems: "stretch",
          }}
          aria-label="운영 콘솔 메뉴"
        >
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 select-none text-[10px] font-bold tracking-tight leading-none"
              style={({ isActive }) => ({ color: isActive ? "var(--c-brand)" : "var(--c-text-3)" })}
            >
              {({ isActive }) => (
                <>
                  <span
                    className="inline-flex items-center justify-center"
                    style={{ width: 44, height: 26, borderRadius: 999, background: isActive ? "var(--c-brand-soft)" : "transparent" }}
                  >
                    <l.icon active={isActive} />
                  </span>
                  <span className="truncate max-w-full px-0.5">{l.label.split(" ")[0]}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
