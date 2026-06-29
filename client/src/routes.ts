import { lazy, type ComponentType } from "react";

/**
 * Route-level 코드 스플리팅 — 각 페이지를 별도 청크로 내보내 초기 JS 를 절반 이하로.
 * 이 파일을 단일 import 지점으로 둬서 사이드바 hover prefetch 에서도 같은 함수를
 * 재사용할 수 있게 한다 (같은 dynamic import 는 Vite 가 캐시하므로 중복 로드 없음).
 *
 * 로그인/회원가입/대시보드·레이아웃은 진입 경로라 eager 유지.
 */

/**
 * React.lazy 래퍼 — 동적 청크 import 가 실패(주로 새 배포로 옛 해시 청크가 404)
 * 하면 ErrorBoundary("페이지 표시 중 문제가 발생했어요") 로 흘려보내는 대신
 * 1회만 새로고침해 최신 번들로 자가복구한다.
 *
 * 왜 필요한가: 앱을 켜둔 채(특히 iOS standalone PWA) 옛 엔트리를 들고 있는
 * 인스턴스가 "아직 한 번도 안 들어간 라우트" 로 이동하면 옛 해시 청크를 import()
 * 하다 404 → React.lazy reject → ErrorBoundary 가 떠 페이지가 "안 들어가진다".
 * main.tsx 의 vite:preloadError 핸들러가 1차 방어선이지만, 그 이벤트가 안 잡는
 * 직접 import() reject 경로와 핸들러를 아직 안 실은 옛 인스턴스까지 메우는
 * belt-and-suspenders 2차 방어선.
 *
 * main.tsx 핸들러와 같은 sessionStorage 가드 키(hinest:chunk-reload-ts, 10초 창)
 * 를 공유해 이중 reload·무한 루프를 막는다. 2번째 시도까지 실패(=10초 내 재발,
 * 진짜 청크 소실/네트워크 장애)면 reject 를 그대로 전파해 ErrorBoundary 가
 * 안내 화면을 띄우게 둔다(reload 루프 방지). dev(localhost)에서는 HMR 충돌을
 * 피하려 새로고침하지 않는다.
 */
const CHUNK_RELOAD_KEY = "hinest:chunk-reload-ts";

function lazyWithReload<
  // React.lazy 와 동일한 시그니처 — props 가진 페이지 컴포넌트(예: DocumentsPage)
  // 도 받으려면 any 가 불가피(ComponentType<unknown> 은 props 변성 때문에 거절됨).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends ComponentType<any>
>(factory: () => Promise<{ default: T }>) {
  return lazy(() =>
    factory().catch((err) => {
      const isLocal =
        typeof window !== "undefined" &&
        /localhost|127\.0\.0\.1/.test(window.location.hostname);
      let last = 0;
      try {
        last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
      } catch {
        /* sessionStorage 차단 환경 — 가드 없이 1회 reload 허용 */
      }
      if (!isLocal && Date.now() - last > 10_000) {
        try {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
        } catch {
          /* noop */
        }
        // 최신 index.html(=최신 청크 해시) 로 자가복구. SW 가 navigation 을
        // no-store 로 처리하므로 reload 한 번이면 최신 번들을 받는다.
        window.location.reload();
        // reload 가 잡힐 때까지 영원히 pending 인 Promise → Suspense fallback 을
        // 유지해 ErrorBoundary 깜빡임 없이 곧바로 새로고침되게 한다.
        return new Promise<{ default: T }>(() => {});
      }
      // 가드에 걸림(=재발) → 그대로 ErrorBoundary 로.
      throw err;
    })
  );
}

export const loadSchedule = () => import("./pages/SchedulePage");
export const loadAttendance = () => import("./pages/AttendancePage");
export const loadJournal = () => import("./pages/JournalPage");
export const loadNotice = () => import("./pages/NoticePage");
export const loadDirectory = () => import("./pages/DirectoryPage");
export const loadDocuments = () => import("./pages/DocumentsPage");
export const loadApprovals = () => import("./pages/ApprovalsPage");
export const loadOrgChart = () => import("./pages/OrgChartPage");
export const loadProfile = () => import("./pages/ProfilePage");
export const loadExpense = () => import("./pages/ExpensePage");
export const loadProject = () => import("./pages/ProjectPage");
export const loadMeetings = () => import("./pages/MeetingsPage");
export const loadMeetingDetail = () => import("./pages/MeetingDetailPage");
export const loadAccounts = () => import("./pages/ServiceAccountsPage");
export const loadSnippets = () => import("./pages/SnippetsPage");
export const loadUserProfile = () => import("./pages/UserProfilePage");
export const loadAdmin = () => import("./pages/AdminPage");
export const loadSuperAdmin = () => import("./pages/SuperAdminPage");
export const loadMemos = () => import("./pages/MemosPage");
export const loadPayroll = () => import("./pages/PayrollPage");
export const loadPlatform = () => import("./pages/PlatformPage");
export const loadNotifications = () => import("./pages/NotificationsPage");
export const loadDesignSystem = () => import("./pages/DesignSystemPage");

export const SchedulePage = lazyWithReload(loadSchedule);
export const AttendancePage = lazyWithReload(loadAttendance);
export const JournalPage = lazyWithReload(loadJournal);
export const NoticePage = lazyWithReload(loadNotice);
export const DirectoryPage = lazyWithReload(loadDirectory);
export const DocumentsPage = lazyWithReload(loadDocuments);
export const ApprovalsPage = lazyWithReload(loadApprovals);
export const OrgChartPage = lazyWithReload(loadOrgChart);
export const ProfilePage = lazyWithReload(loadProfile);
export const ExpensePage = lazyWithReload(loadExpense);
export const ProjectPage = lazyWithReload(loadProject);
export const MeetingsPage = lazyWithReload(loadMeetings);
export const MeetingDetailPage = lazyWithReload(loadMeetingDetail);
export const ServiceAccountsPage = lazyWithReload(loadAccounts);
export const SnippetsPage = lazyWithReload(loadSnippets);
export const UserProfilePage = lazyWithReload(loadUserProfile);
export const AdminPage = lazyWithReload(loadAdmin);
export const SuperAdminPage = lazyWithReload(loadSuperAdmin);
export const MemosPage = lazyWithReload(loadMemos);
export const PayrollPage = lazyWithReload(loadPayroll);
export const PlatformPage = lazyWithReload(loadPlatform);
export const NotificationsPage = lazyWithReload(loadNotifications);
export const DesignSystemPage = lazyWithReload(loadDesignSystem);

/** 사이드바 경로별 prefetch 함수 매핑 — hover/focus 시 호출해 청크 선로딩. */
export const ROUTE_PREFETCH: Record<string, () => Promise<unknown>> = {
  "/schedule": loadSchedule,
  "/attendance": loadAttendance,
  "/journal": loadJournal,
  "/notice": loadNotice,
  "/directory": loadDirectory,
  "/documents": loadDocuments,
  "/approvals": loadApprovals,
  "/org": loadOrgChart,
  "/profile": loadProfile,
  "/expense": loadExpense,
  "/admin": loadAdmin,
  "/super-admin": loadSuperAdmin,
  "/meetings": loadMeetings,
  "/accounts": loadAccounts,
  "/snippets": loadSnippets,
  "/memos": loadMemos,
  "/payroll": loadPayroll,
  "/platform": loadPlatform,
};
