import { createContext, useCallback, useContext, useEffect, useState } from "react";

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

  return <ThemeCtx.Provider value={{ mode, resolved, setMode }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
