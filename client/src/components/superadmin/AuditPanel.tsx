import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";

type Log = {
  id: string;
  userId: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
};

type ActionRow = { action: string; count: number };

const ACTION_COLORS: Record<string, string> = {
  LOGIN: "#16A34A",
  SIGNUP: "#16A34A",
  IMPERSONATE_START: "#DC2626",
  IMPERSONATE_END: "#9CA3AF",
  SESSION_REVOKE: "#DC2626",
  SESSION_REVOKE_USER: "#DC2626",
  SESSION_REVOKE_ALL: "#7F1D1D",
  USER_GRANT_SUPER: "#7C3AED",
  USER_GRANT_ADMIN: "#7C3AED",
  USER_REVOKE_SUPER: "#7C3AED",
  TRASH_PURGE: "#DC2626",
  TRASH_PURGE_OLD: "#DC2626",
  ERROR_DASHBOARD_CLEAR: "#9CA3AF",
};

export default function AuditPanel() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState("");
  const [filterUserId, setFilterUserId] = useState("");
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterAction) params.set("action", filterAction);
      if (filterUserId.trim()) params.set("userId", filterUserId.trim());
      if (q.trim()) params.set("q", q.trim());
      const r = await api<{ logs: Log[] }>(`/api/admin/audit?${params}`);
      setLogs(r.logs);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filterAction]);

  useEffect(() => {
    api<{ actions: ActionRow[] }>("/api/admin/audit/actions").then((r) => setActions(r.actions));
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, Log[]>();
    for (const l of logs) {
      const k = new Date(l.createdAt).toLocaleDateString("ko-KR");
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(l);
    }
    return Array.from(map.entries());
  }, [logs]);

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <select className="input !py-1.5 max-w-[240px]" value={filterAction} onChange={(e) => setFilterAction(e.target.value)}>
          <option value="">모든 액션</option>
          {actions.map((a) => (
            <option key={a.action} value={a.action}>{a.action} ({a.count})</option>
          ))}
        </select>
        <input className="input flex-1 min-w-[160px]" placeholder="사용자 ID" value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") load(); }} />
        <input className="input flex-1 min-w-[160px]" placeholder="target/detail/IP 검색" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") load(); }} />
        <button className="btn-ghost btn-xs" onClick={load} disabled={loading}>적용</button>
      </div>
      <div className="text-[11px] text-ink-500 mb-2">{loading ? "불러오는 중…" : `${logs.length}건`}</div>

      <div className="overflow-auto" style={{ maxHeight: "60vh" }}>
        {grouped.map(([day, items]) => (
          <div key={day} className="mb-3">
            <div className="text-[10.5px] font-extrabold tracking-[0.06em] uppercase text-ink-500 mb-1.5 px-1">{day}</div>
            <table className="w-full text-[12px] pro-cards">
              <tbody>
                {items.map((l) => {
                  const color = ACTION_COLORS[l.action] ?? "#64748B";
                  return (
                    <tr key={l.id} className="border-b border-ink-100">
                      <td data-label="시각" className="py-1.5 pr-2 whitespace-nowrap text-ink-500 font-mono text-[11px]" style={{ width: 70 }}>
                        {new Date(l.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
                      </td>
                      <td className="cell-primary py-1.5 pr-2 whitespace-nowrap" style={{ width: 200 }}>
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10.5px] font-bold" style={{ background: color + "22", color }}>
                          {l.action}
                        </span>
                      </td>
                      <td data-label="사용자" className="py-1.5 pr-2 whitespace-nowrap" style={{ width: 160 }}>
                        {l.user ? (
                          <span className="font-bold text-ink-900">{l.user.name}</span>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                      <td data-label="대상" className="py-1.5 pr-2 text-ink-700 sm:truncate sm:max-w-[280px] font-mono text-[11px]" title={l.target ?? ""}>{l.target ?? ""}</td>
                      <td data-label="상세" className="py-1.5 pr-2 text-ink-500 sm:truncate sm:max-w-[260px]" title={l.detail ?? ""}>{l.detail ?? ""}</td>
                      <td data-label="IP" className="py-1.5 pr-2 text-ink-500 font-mono text-[10.5px] whitespace-nowrap">{l.ip ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
        {!loading && logs.length === 0 && (
          <div className="py-12 text-center text-ink-500 text-[12px]">조건에 맞는 로그가 없어요</div>
        )}
      </div>
    </div>
  );
}
