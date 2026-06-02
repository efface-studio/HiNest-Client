import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, clearApiCache } from "./api";
import { requestNotifPermissionOnLogin } from "./lib/notifPermission";
import { setupIosPush, unregisterIosPush } from "./lib/pushNotifications";

export type User = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "MANAGER" | "MEMBER";
  team?: string | null;
  position?: string | null;
  avatarColor?: string;
  avatarUrl?: string | null;
  superAdmin?: boolean;
  platformAdmin?: boolean;
  companyId?: string | null;
  isDeveloper?: boolean;
  employeeNo?: string | null;
  presenceStatus?: string | null;
  presenceMessage?: string | null;
  presenceUpdatedAt?: string | null;
  workStartTime?: string | null;
  workEndTime?: string | null;
};

export type Impersonator = { id: string; name: string };

type Ctx = {
  user: User | null;
  impersonator: Impersonator | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (data: { inviteKey: string; email: string; name: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthCtx = createContext<Ctx>({} as Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [impersonator, setImpersonator] = useState<Impersonator | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ user: User; impersonator: Impersonator | null }>("/api/me");
      setUser(res.user);
      setImpersonator(res.impersonator ?? null);
    } catch {
      setUser(null);
      setImpersonator(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // iOS 원격 푸시(APNs) 등록 — 로그인·회원가입뿐 아니라 세션 복원(앱 재실행) 시에도
  // 토큰을 재등록하고 탭→이동 리스너를 다시 건다. setupIosPush 는 멱등이며 iOS 외엔 no-op.
  // user.id 가 바뀔 때만(=로그인/계정전환) 1회 실행 — 매 리렌더마다 register() 가 불리지 않게.
  useEffect(() => {
    if (user?.id) void setupIosPush();
  }, [user?.id]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ user: User }>("/api/auth/login", {
      method: "POST",
      json: { email, password },
    });
    // 토큰 만료 후 logout 을 거치지 않고 다른 계정으로 재로그인할 때 이전 사용자 캐시가
    // 섬광처럼 보이는 것을 방지. logout 에서와 동일하게 세션 캐시를 싹 비움.
    clearApiCache();
    setUser(res.user);
    // 로그인 직후 알림 권한 요청(iOS/macOS 등 설치형 앱). 라우팅을 막지 않도록 fire-and-forget.
    void requestNotifPermissionOnLogin();
    // 호출부(LoginPage)가 superAdmin 여부로 진입 경로를 정할 수 있도록 사용자 객체를 반환.
    return res.user;
  }, []);

  const signup = useCallback(async (d: { inviteKey: string; email: string; name: string; password: string }) => {
    const res = await api<{ user: User }>("/api/auth/signup", {
      method: "POST",
      json: d,
    });
    clearApiCache();
    setUser(res.user);
    // 가입(=최초 로그인) 직후에도 동일하게 알림 권한 요청.
    void requestNotifPermissionOnLogin();
  }, []);

  const logout = useCallback(async () => {
    // 미리보기 모드는 서버 호출 없이 플래그만 끄고 빠져나옴.
    if (typeof window !== "undefined" && (window as any).__HINEST_PREVIEW__) {
      const m = await import("./lib/previewMock");
      m.disablePreview();
      setUser(null);
      setImpersonator(null);
      clearApiCache();
      window.location.href = "/login";
      return;
    }
    // iOS 푸시 토큰 해제 — 세션이 살아있을 때(로그아웃 API 호출 전) 보내야 401 이 안 난다. iOS 외엔 no-op.
    await unregisterIosPush();
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    // 다른 사용자가 로그인했을 때 이전 사용자의 프로젝트/캘린더가 깜빡 보이는 사고 방지.
    clearApiCache();
  }, []);

  // useAuth() 는 AppLayout·대부분의 페이지가 구독한다. value 를 매 렌더 새 객체로 만들면
  // AuthProvider 가 리렌더될 때마다 전 구독자가 무효화되므로 useMemo 로 고정한다.
  const value = useMemo(
    () => ({ user, impersonator, loading, login, signup, logout, refresh }),
    [user, impersonator, loading, login, signup, logout, refresh],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
