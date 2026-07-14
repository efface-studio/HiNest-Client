import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, clearApiCache } from "./api";
import { setAuthToken, clearAuthToken } from "./lib/authToken";
import { requestNotifPermissionOnLogin } from "./lib/notifPermission";
import { ensureAndroidBatteryExemption } from "./lib/batteryOptimization";
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
  /** 개발자 콘솔 전용 계정 — 회사 앱(일반 페이지) 접근 불가, /super-admin 만 사용. */
  consoleOnly?: boolean;
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
  // 세션 복원 재시도 — 네트워크 오류 시 잠시 후 다시 /api/me. (refreshRef 로 안전한 자기 참조)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef<() => Promise<void>>();

  const refresh = useCallback(async () => {
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    try {
      const res = await api<{ user: User; impersonator: Impersonator | null }>("/api/me");
      setUser(res.user);
      setImpersonator(res.impersonator ?? null);
      setLoading(false);
    } catch (e: any) {
      if (e?.status === 401) {
        // 진짜 인증 실패(세션 만료·무효) — 토큰 제거 + 로그아웃(→ /login).
        clearAuthToken();
        setUser(null);
        setImpersonator(null);
        setLoading(false);
      } else {
        // 네트워크·타임아웃 등 비-401 — 인증 실패가 아니므로 절대 로그아웃하지 않는다(인터넷이 잠깐
        // 끊겨도 로그인 화면으로 안 튕긴다). loading/user 를 건드리지 않아: 첫 로드면 로딩(스켈레톤)
        // 유지, 이미 로그인 상태면 셸 유지. 잠시 후 재시도 → 연결되면 정상 로드, 끝내 401 이면 그때 로그아웃.
        retryTimerRef.current = setTimeout(() => { void refreshRef.current?.(); }, 2500);
      }
    }
  }, []);
  refreshRef.current = refresh;

  useEffect(() => {
    refresh();
    return () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); };
  }, [refresh]);

  // 세션 만료/무효 전역 처리 — 페이지 사용 도중 세션이 끊기면 api.ts 가 'hinest:unauthorized'
  // 를 디스패치한다. 토큰·세션 캐시를 비우고 user 를 null 로 만들면 Protected(App.tsx)가
  // 자동으로 /login 으로 보낸다. (인증 엔드포인트의 401 = 로그인 실패 등은 api.ts 에서 제외.)
  useEffect(() => {
    function onUnauthorized() {
      clearAuthToken();
      clearApiCache();
      setUser(null);
      setImpersonator(null);
    }
    window.addEventListener("hinest:unauthorized", onUnauthorized);
    return () => window.removeEventListener("hinest:unauthorized", onUnauthorized);
  }, []);

  // iOS 원격 푸시(APNs) 등록 — 로그인·회원가입뿐 아니라 세션 복원(앱 재실행) 시에도
  // 토큰을 재등록하고 탭→이동 리스너를 다시 건다. setupIosPush 는 멱등이며 iOS 외엔 no-op.
  // user.id 가 바뀔 때만(=로그인/계정전환) 1회 실행 — 매 리렌더마다 register() 가 불리지 않게.
  useEffect(() => {
    if (user?.id) void setupIosPush();
  }, [user?.id]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ user: User; token?: string }>("/api/auth/login", {
      method: "POST",
      json: { email, password },
    });
    // 네이티브 앱이면 응답에 세션 토큰이 함께 온다 — 저장해두고 이후 요청에 Bearer 헤더로 보낸다.
    // setUser 로 인한 리렌더/이펙트(setupIosPush 등)가 돌기 전에 동기적으로 저장. (웹/데스크톱 no-op)
    setAuthToken(res.token);
    // 토큰 만료 후 logout 을 거치지 않고 다른 계정으로 재로그인할 때 이전 사용자 캐시가
    // 섬광처럼 보이는 것을 방지. logout 에서와 동일하게 세션 캐시를 싹 비움.
    clearApiCache();
    setUser(res.user);
    // 로그인 응답 user 는 /api/me 보다 필드가 적을 수 있어(구버전 서버 등) 풀 객체로
    // 재동기화 — companyId/isDeveloper 누락 시 콘솔 '서비스로 돌아가기'·개발자 뱃지가
    // 하드 리로드 전까지 사라지던 간헐 버그(#1113) 방지. fire-and-forget.
    void refreshRef.current?.();
    // 로그인 직후 알림 권한 요청(iOS/macOS 등 설치형 앱). 라우팅을 막지 않도록 fire-and-forget.
    void requestNotifPermissionOnLogin();
    // 안드로이드: 백그라운드/잠금 상태 알림 신뢰도 위해 배터리 최적화 제외 1회 안내(카톡 방식).
    void ensureAndroidBatteryExemption();
    // 호출부(LoginPage)가 superAdmin 여부로 진입 경로를 정할 수 있도록 사용자 객체를 반환.
    return res.user;
  }, []);

  const signup = useCallback(async (d: { inviteKey: string; email: string; name: string; password: string }) => {
    const res = await api<{ user: User; token?: string }>("/api/auth/signup", {
      method: "POST",
      json: d,
    });
    setAuthToken(res.token);
    clearApiCache();
    setUser(res.user);
    // 로그인과 동일 — 풀 user 재동기화(#1113).
    void refreshRef.current?.();
    // 가입(=최초 로그인) 직후에도 동일하게 알림 권한 요청 + 배터리 최적화 제외 안내(안드로이드).
    void requestNotifPermissionOnLogin();
    void ensureAndroidBatteryExemption();
  }, []);

  const logout = useCallback(async () => {
    // 미리보기 모드는 서버 호출 없이 플래그만 끄고 빠져나옴.
    if (typeof window !== "undefined" && (window as any).__HINEST_PREVIEW__) {
      const m = await import("./lib/previewFlag");
      m.disablePreview();
      clearAuthToken();
      setUser(null);
      setImpersonator(null);
      clearApiCache();
      window.location.href = "/login";
      return;
    }
    // iOS 푸시 토큰 해제 — 세션이 살아있을 때(로그아웃 API 호출 전) 보내야 401 이 안 난다. iOS 외엔 no-op.
    try {
      await unregisterIosPush();
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // 세션이 이미 만료(401)·네트워크 실패여도 로컬 로그아웃은 반드시 완수한다 —
      // 여기서 던지면 로그아웃 버튼의 async onClick 이 unhandledrejection 으로 새서
      // 콘솔 에러 탭에 오보고되고(#1093), 클라가 로그인된 것처럼 남는다.
    }
    // 로그아웃 API 호출(세션 revoke) 이 끝난 뒤에 토큰 제거 — 먼저 지우면 그 요청이 401 난다.
    clearAuthToken();
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
