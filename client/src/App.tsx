import { Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import UpdateBanner from "./components/UpdateBanner";
import DesktopUpdateBanner from "./components/DesktopUpdateBanner";
import ConfirmHost from "./components/ConfirmHost";
import { ErrorBoundary } from "./components/ErrorBoundary";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import DownloadPage from "./pages/DownloadPage";
import PublicSharePage from "./pages/PublicSharePage";
import PreviewEntry from "./pages/PreviewEntry";
import AppLayout from "./components/AppLayout";
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

export default function App() {
  // 라우트 단위 ErrorBoundary 의 reset 트리거 — 다음 페이지로 이동하면 자동 초기화.
  // 이렇게 안 하면 한 페이지에서 에러 나면 다른 메뉴로 가도 fallback 이 계속 보임.
  const { pathname } = useLocation();
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
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/download" element={<DownloadPage />} />
        <Route path="/share/:token" element={<PublicSharePage />} />
        <Route path="/preview" element={<PreviewEntry />} />
        <Route
          path="/"
          element={
            <Protected>
              <AppLayout />
            </Protected>
          }
        >
          <Route index element={<DashboardPage />} />
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
          <Route
            path="payroll"
            element={
              <AdminOnly>
                <PayrollPage />
              </AdminOnly>
            }
          />
          <Route path="users/:id" element={<UserProfilePage />} />
          <Route
            path="admin"
            element={
              <AdminOnly>
                <AdminPage />
              </AdminOnly>
            }
          />
          <Route
            path="super-admin"
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
