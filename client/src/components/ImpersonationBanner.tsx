import { useState } from "react";
import { api, clearApiCache } from "../api";
import { useAuth } from "../auth";
import { alertAsync } from "./ConfirmHost";

/**
 * 임퍼소네이션 중일 때 화면 최상단에 강제로 표시되는 빨간 배너.
 * - 단순한 시각적 경고가 아니라 실수 방지가 핵심: 진행 중인 작업/메시지가 모두 \"내가 아닌 그 사람으로\"
 *   기록된다는 사실을 잊지 않게.
 * - \"종료\" 버튼은 stepup 없이 즉시 풀 수 있도록 (auth.ts 의 DELETE /impersonate 도 같은 정책).
 */
export default function ImpersonationBanner({ safeAreaTop = false }: { safeAreaTop?: boolean }) {
  const { impersonator, user, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!impersonator || !user) return null;

  async function end() {
    if (busy) return;
    setBusy(true);
    try {
      await api("/api/me/impersonate", { method: "DELETE" });
      clearApiCache();
      await refresh();
      // 임퍼소네이트 종료 후엔 새로고침이 가장 안전 — 메모리에 남은 다른 사용자의 응답들 싹 정리.
      window.location.reload();
    } catch (e: any) {
      alertAsync({ title: "종료 실패", description: e?.message ?? "잠시 후 다시 시도해 주세요." });
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 9999,
        background: "linear-gradient(90deg, #DC2626 0%, #B91C1C 100%)",
        color: "#fff",
        paddingTop: safeAreaTop ? "max(8px, calc(var(--sa-top, env(safe-area-inset-top)) + 4px))" : 8,
        paddingBottom: 8,
        paddingLeft: "max(12px, var(--sa-left, env(safe-area-inset-left)))",
        paddingRight: "max(12px, var(--sa-right, env(safe-area-inset-right)))",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontSize: 12.5,
        fontWeight: 700,
        boxShadow: "0 2px 8px rgba(220,38,38,0.3)",
      }}
      role="alert"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 9v4M12 17h.01" />
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      </svg>
      <div className="flex-1 min-w-0 truncate">
        <span style={{ opacity: 0.85 }}>{impersonator.name} →</span>{" "}
        <strong>{user.name}</strong> 으로 보는 중 · 모든 액션이 audit 로그에 기록됩니다
      </div>
      <button
        type="button"
        onClick={end}
        disabled={busy}
        style={{
          background: "rgba(255,255,255,0.18)",
          color: "#fff",
          padding: "4px 12px",
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 800,
          border: "1px solid rgba(255,255,255,0.32)",
        }}
      >
        {busy ? "종료 중…" : "종료"}
      </button>
    </div>
  );
}

/** SuperAdmin 페이지에서 호출 — 사용자 ID 로 임퍼소네이션 시작. */
export async function startImpersonate(userId: string) {
  await api(`/api/admin/impersonate/${userId}`, { method: "POST" });
  clearApiCache();
  // 새로고침으로 모든 화면이 타깃 사용자 시점으로 재시작.
  window.location.href = "/";
}
