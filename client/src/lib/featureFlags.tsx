import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";

/**
 * 기능 플래그 클라 — 로그인 상태에서만 fetch, 이후 useFeatureFlag(key) 로 동기 조회.
 * 사용자(user.id)가 바뀌면(로그인·계정 전환) 다시 가져오고, 로그아웃하면 비운다.
 *
 * 서버 /api/feature-flags 는 requireAuth 라 비로그인 fetch 는 무조건 401 — 예전엔
 * 마운트 즉시(로그인 화면 포함) 무가드로 불러서 방문자마다 401 "unauthorized" 가
 * 발생했고, 이것이 콘솔 에러 탭 오보고(#1093)의 주요 발생원이었다.
 */

type FlagsCtx = {
  flags: Record<string, boolean>;
  loading: boolean;
  refresh: () => Promise<void>;
};

const Ctx = createContext<FlagsCtx>({ flags: {}, loading: true, refresh: async () => {} });

export function FeatureFlagsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const r = await api<{ flags: Record<string, boolean> }>("/api/feature-flags");
      setFlags(r.flags ?? {});
    } catch {
      setFlags({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user) {
      // 비로그인(로그인 화면·세션 만료) — 401 이 뻔한 fetch 를 아예 안 보낸다.
      setFlags({});
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return <Ctx.Provider value={{ flags, loading, refresh }}>{children}</Ctx.Provider>;
}

export function useFeatureFlag(key: string): boolean {
  return !!useContext(Ctx).flags[key];
}

/** 한 번에 여러 키 조회. */
export function useFeatureFlags(): Record<string, boolean> {
  return useContext(Ctx).flags;
}

/** \<FeatureGate flag="foo"\>... 조건부 렌더링 helper. */
export function FeatureGate({ flag, fallback = null, children }: { flag: string; fallback?: React.ReactNode; children: React.ReactNode }) {
  const on = useFeatureFlag(flag);
  return <>{on ? children : fallback}</>;
}
