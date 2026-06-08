import { Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import { isDesktopApp } from "./lib/platform";
import UpdateBanner from "./components/UpdateBanner";
import DesktopUpdateBanner from "./components/DesktopUpdateBanner";
import ConfirmHost from "./components/ConfirmHost";
import { ErrorBoundary } from "./components/ErrorBoundary";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import CompanySignupPage from "./pages/CompanySignupPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import DownloadPage from "./pages/DownloadPage";
import PublicSharePage from "./pages/PublicSharePage";
import PreviewEntry from "./pages/PreviewEntry";
import PrivacyPolicyPage from "./pages/PrivacyPolicyPage";
import TermsPage from "./pages/TermsPage";
import AppLayout, { MobileMenuPage } from "./components/AppLayout";
import ConsoleLayout from "./components/ConsoleLayout";
import DashboardPage from "./pages/DashboardPage";
import {
  SchedulePage,
  AttendancePage,
  JournalPage,
  NoticePage,
  DirectoryPage,
  DocumentsPage,
  ApprovalsPage,
  OrgChartPage,
  ProfilePage,
  ExpensePage,
  ProjectPage,
  MeetingsPage,
  MeetingDetailPage,
  ServiceAccountsPage,
  SnippetsPage,
  UserProfilePage,
  AdminPage,
  SuperAdminPage,
  MemosPage,
  PayrollPage,
  PlatformPage,
  NotificationsPage,
} from "./routes";

/**
 * 페이지 청크 로드 중 짧게 보이는 스켈레톤.
 * 1) 배경색을 레이아웃과 맞춰 깜빡임 제거
 * 2) 최소 UI — "불러오는 중" 텍스트 없음 (대부분 체감상 안 보일 만큼 빠름)
 */
function RouteFallback() {
  return <div className="min-h-[60vh]" aria-hidden />;
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="h-screen grid place-items-center text-slate-400">
        불러오는 중…
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== "ADMIN") return <Navigate to="/" replace />;
  return <>{children}</>;
}

function SuperOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user?.superAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PlatformOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  // 개발자(superAdmin)도 회사 관리에 접근 가능 — 최상위 권한이므로 항상 허용.
  if (!user?.platformAdmin && !user?.superAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// 운영 콘솔 진입 가드 — 개발자(superAdmin) 또는 플랫폼 운영자(platformAdmin)만.
// 회사 ADMIN 은 여기 들어오지 못하고 회사 앱(/admin)에 그대로 머문다.
function ConsoleOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user?.superAdmin && !user?.platformAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// 회사 앱(일반 페이지) 진입 가드 — 개발자 콘솔 전용 계정(consoleOnly)은 회사 앱에 들어올 수
// 없고 자기 콘솔 홈으로 보낸다. superAdmin 이면 /super-admin, 아니면 /platform 으로 — 그래야
// SuperOnly/PlatformOnly 게이트에 막혀 "/" 로 되돌아오는 리다이렉트 루프가 생기지 않는다.
function CompanyAppGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.consoleOnly) {
    return <Navigate to={user.superAdmin ? "/super-admin" : "/platform"} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  // 라우트 단위 ErrorBoundary 의 reset 트리거 — 다음 페이지로 이동하면 자동 초기화.
  // 이렇게 안 하면 한 페이지에서 에러 나면 다른 메뉴로 가도 fallback 이 계속 보임.
  const { pathname } = useLocation();

  // 데스크톱 디바이스 클래스(.hinest-desktop)를 최상위에서 항상 보장한다.
  // 예전엔 AppLayout 마운트 시에만 붙였는데, 콘솔(ConsoleLayout)은 AppLayout 과 분리된
  // 라우트라 — 특히 회사 앱을 거치지 않고 바로 콘솔로 가는 consoleOnly 계정에선 — 클래스가
  // 안 붙어 "콘솔 하단 네비바 숨김"(html.hinest-desktop .console-bottomnav) CSS 가 안 먹었다.
  // 디바이스 사실(데스크톱 여부)이라 라우트와 무관하게 1회만 판정해 둔다.
  useEffect(() => {
    const isDesktopDevice =
      isDesktopApp() ||
      (typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches);
    document.documentElement.classList.toggle("hinest-desktop", isDesktopDevice);
  }, []);

  return (
    <>
    <UpdateBanner />
    <DesktopUpdateBanner />
    <ConfirmHost />
    <ErrorBoundary resetKey={pathname}>
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/company-signup" element={<CompanySignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/download" element={<DownloadPage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/share/:token" element={<PublicSharePage />} />
        <Route path="/preview" element={<PreviewEntry />} />
        <Route
          path="/"
          element={
            <Protected>
              <CompanyAppGate>
                <AppLayout />
              </CompanyAppGate>
            </Protected>
          }
        >
          <Route index element={<DashboardPage />} />
          {/* 모바일 "전체" 메뉴 페이지 — 하단 바의 전체 탭이 여기로 온다(데스크톱은 사이드바). */}
          <Route path="menu" element={<MobileMenuPage />} />
          {/* 전용 알림 페이지 — 모바일에서 벨을 누르면 드롭다운 대신 여기로 온다(데스크톱은 URL 직접 접근). */}
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="attendance" element={<AttendancePage />} />
          <Route path="journal" element={<JournalPage />} />
          <Route path="notice" element={<NoticePage />} />
          <Route path="directory" element={<DirectoryPage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="org" element={<OrgChartPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="expense" element={<ExpensePage />} />
          <Route path="projects/:id" element={<ProjectPage />} />
          <Route path="meetings" element={<MeetingsPage />} />
          <Route path="meetings/:id" element={<MeetingDetailPage />} />
          <Route path="accounts" element={<ServiceAccountsPage />} />
          <Route path="snippets" element={<SnippetsPage />} />
          <Route path="memos" element={<MemosPage />} />
          {/* 급여명세서 — 관리자는 전체 관리, 직원은 본인 것만 열람(페이지 내부에서 분기) */}
          <Route path="payroll" element={<PayrollPage />} />
          <Route path="users/:id" element={<UserProfilePage />} />
          <Route
            path="admin"
            element={
              <AdminOnly>
                <AdminPage />
              </AdminOnly>
            }
          />
        </Route>

        {/* 운영 콘솔 — 회사 앱(AppLayout)과 완전히 분리된 별도 셸/라우트 트리.
            총관리자(개발자)·플랫폼 운영자 전용. 회사 사이드바에는 노출되지 않는다. */}
        <Route
          element={
            <Protected>
              <ConsoleOnly>
                <ConsoleLayout />
              </ConsoleOnly>
            </Protected>
          }
        >
          <Route
            path="platform"
            element={
              <PlatformOnly>
                <PlatformPage />
              </PlatformOnly>
            }
          />
          <Route
            path="super-admin/*"
            element={
              <SuperOnly>
                <SuperAdminPage />
              </SuperOnly>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
    </>
  );
}
