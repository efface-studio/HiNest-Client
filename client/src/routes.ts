import { lazy } from "react";

/**
 * Route-level 코드 스플리팅 — 각 페이지를 별도 청크로 내보내 초기 JS 를 절반 이하로.
 * 이 파일을 단일 import 지점으로 둬서 사이드바 hover prefetch 에서도 같은 함수를
 * 재사용할 수 있게 한다 (같은 dynamic import 는 Vite 가 캐시하므로 중복 로드 없음).
 *
 * 로그인/회원가입/대시보드·레이아웃은 진입 경로라 eager 유지.
 */

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

export const SchedulePage = lazy(loadSchedule);
export const AttendancePage = lazy(loadAttendance);
export const JournalPage = lazy(loadJournal);
export const NoticePage = lazy(loadNotice);
export const DirectoryPage = lazy(loadDirectory);
export const DocumentsPage = lazy(loadDocuments);
export const ApprovalsPage = lazy(loadApprovals);
export const OrgChartPage = lazy(loadOrgChart);
export const ProfilePage = lazy(loadProfile);
export const ExpensePage = lazy(loadExpense);
export const ProjectPage = lazy(loadProject);
export const MeetingsPage = lazy(loadMeetings);
export const MeetingDetailPage = lazy(loadMeetingDetail);
export const ServiceAccountsPage = lazy(loadAccounts);
export const SnippetsPage = lazy(loadSnippets);
export const UserProfilePage = lazy(loadUserProfile);
export const AdminPage = lazy(loadAdmin);
export const SuperAdminPage = lazy(loadSuperAdmin);
export const MemosPage = lazy(loadMemos);
export const PayrollPage = lazy(loadPayroll);

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
};
