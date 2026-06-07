import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { applyNativeTheme, applyNativeInterfaceStyle } from "./lib/nativeTheme";

export type ThemeMode = "light" | "dark" | "system";

const KEY = "hinest.theme";

function getSystemDark() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(mode: ThemeMode) {
  const isDark = mode === "dark" || (mode === "system" && getSystemDark());
  const root = document.documentElement;
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
}

type Ctx = {
  mode: ThemeMode;
  resolved: "light" | "dark";
  setMode: (m: ThemeMode) => void;
};

const ThemeCtx = createContext<Ctx>({ mode: "system", resolved: "light", setMode: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    const saved = localStorage.getItem(KEY) as ThemeMode | null;
    return saved ?? "system";
  });
  const [resolved, setResolved] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const saved = (localStorage.getItem(KEY) as ThemeMode | null) ?? "system";
    return saved === "dark" || (saved === "system" && getSystemDark()) ? "dark" : "light";
  });

  const setMode = useCallback((m: ThemeMode) => {
    localStorage.setItem(KEY, m);
    setModeState(m);
  }, []);

  useEffect(() => {
    applyTheme(mode);
    setResolved(mode === "dark" || (mode === "system" && getSystemDark()) ? "dark" : "light");
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      applyTheme("system");
      setResolved(getSystemDark() ? "dark" : "light");
    };
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, [mode]);

  // resolved 가 바뀔 때마다 네이티브 키보드/상태바 색도 동기화 — iOS 가 시스템 설정만 따라가
  // 앱에서 다크 테마를 켜도 키보드가 라이트로 뜨던 문제 해결.
  useEffect(() => {
    void applyNativeTheme(resolved);
  }, [resolved]);

  // mode 가 바뀔 때 네이티브 윈도우/탭바 트레잇도 동기화 — 다크모드 사용자의 탭바가
  // 라이트로 고정되던 회귀 수정. system 모드는 OS 설정을 따라가도록 .unspecified 로 전달.
  useEffect(() => {
    void applyNativeInterfaceStyle(mode);
  }, [mode]);

  const value = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
