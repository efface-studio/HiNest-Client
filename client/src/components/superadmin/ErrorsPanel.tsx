import { useEffect, useState } from "react";
import { api } from "../../api";
import { confirmAsync } from "../ConfirmHost";
import { relTime } from "./relTime";
import Portal from "../Portal";

type Group = {
  hash: string;
  message: string;
  topFrame: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  paths: string[];
  userIds: string[];
};

type Detail = Group & {
  recent: { ts: number; status: number; method: string; path: string; message: string; stack: string; userId: string | null; ua: string | null; ip: string | null }[];
};

const SINCE_OPTS: { key: "1h" | "24h" | "7d" | "all"; label: string }[] = [
  { key: "1h", label: "1시간" },
  { key: "24h", label: "24시간" },
  { key: "7d", label: "7일" },
  { key: "all", label: "전체" },
];

/** 5xx 에러 그루핑 — 동일 스택은 한 그룹. 발생 추이 + 영향 사용자 + 스택 상세. */
export default function ErrorsPanel() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [since, setSince] = useState<"1h" | "24h" | "7d" | "all">("24h");
  const [userIdFilter, setUserIdFilter] = useState("");
  const [openHash, setOpenHash] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (since !== "all") params.set("since", since);
      if (userIdFilter.trim()) params.set("userId", userIdFilter.trim());
      const r = await api<{ groups: Group[] }>(`/api/admin/errors?${params}`);
      setGroups(r.groups);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [since]);

  async function loadDetail(hash: string) {
    setOpenHash(hash);
    setDetail(null);
    const r = await api<{ group: Detail }>(`/api/admin/errors/${hash}`);
    setDetail(r.group);
  }

  async function clearAll() {
    if (!(await confirmAsync({ title: "에러 그룹 모두 비우기?", description: "프로세스 재시작과 같은 효과 (인메모리). 카운터·last_seen 초기화." }))) return;
    await api("/api/admin/errors", { method: "DELETE" });
    await load();
  }

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="inline-flex rounded-full p-0.5" style={{ background: "var(--c-surface-3)" }}>
          {SINCE_OPTS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setSince(o.key)}
              className="text-[11.5px] font-bold px-2.5 py-1 rounded-full"
              style={{
                background: since === o.key ? "var(--c-surface-1)" : "transparent",
                color: since === o.key ? "var(--c-text-1)" : "var(--c-text-3)",
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
        <input
          className="input flex-1 min-w-[180px]"
          placeholder='사용자 ID 필터 ("이 사용자에게서만" — ID 입력)'
          value={userIdFilter}
          onChange={(e) => setUserIdFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") load(); }}
        />
        <button className="btn-ghost btn-xs" onClick={load} disabled={loading}>새로고침</button>
        <button className="btn-ghost btn-xs" style={{ color: "var(--c-danger)" }} onClick={clearAll}>모두 비우기</button>
      </div>
      <div className="text-[11px] text-ink-500 mb-2">{loading ? "불러오는 중…" : `${groups.length}개 그룹 · ${groups.reduce((a, g) => a + g.count, 0)}회 발생`}</div>

      <div className="overflow-auto" style={{ maxHeight: "60vh" }}>
        {groups.length === 0 && !loading && (
          <div className="py-12 text-center text-ink-500 text-[12px]">에러 없음 ✨</div>
        )}
        {groups.map((g) => (
          <div key={g.hash} className="border-b border-ink-100 py-2.5">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 px-2 py-0.5 rounded" style={{ background: "rgba(220,38,38,0.12)", color: "var(--c-danger)", fontSize: 10.5, fontWeight: 800 }}>
                ×{g.count}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold text-ink-900 truncate">{g.message}</div>
                <div className="text-[10.5px] text-ink-500 font-mono mt-0.5 truncate">{g.topFrame || "—"}</div>
                <div className="text-[10.5px] text-ink-500 mt-1">
                  {g.paths.slice(0, 4).join(" · ")}{g.paths.length > 4 ? ` …+${g.paths.length - 4}` : ""}
                  {g.userIds.length > 0 && <span> · {g.userIds.length}명 영향</span>}
                  <span> · 마지막 {relTime(g.lastSeen)}</span>
                </div>
              </div>
              <button className="btn-ghost btn-xs" onClick={() => loadDetail(g.hash)}>스택</button>
            </div>
          </div>
        ))}
      </div>

      {openHash && (
        <Portal>
        <div className="fixed inset-0 bg-ink-900/40 grid place-items-center modal-safe z-50" onClick={() => setOpenHash(null)}>
          <div className="panel w-full max-w-[840px] max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-ink-150 flex items-center justify-between">
              <div className="text-[14px] font-extrabold text-ink-900">에러 상세 · {openHash}</div>
              <button className="btn-icon" onClick={() => setOpenHash(null)} aria-label="닫기">×</button>
            </div>
            <div className="px-5 py-4 overflow-auto text-[12px] flex-1">
              {!detail ? (
                <div className="py-8 text-center text-ink-500">불러오는 중…</div>
              ) : (
                <>
                  <div className="font-bold mb-1 text-ink-900">{detail.message}</div>
                  <div className="text-ink-500 mb-3">발생 {detail.count}회 · {new Date(detail.firstSeen).toLocaleString("ko-KR")} ~ {new Date(detail.lastSeen).toLocaleString("ko-KR")}</div>
                  {detail.recent.map((ev, i) => (
                    <div key={i} className="mb-4">
                      <div className="text-[11px] text-ink-500 mb-1">
                        {new Date(ev.ts).toLocaleTimeString("ko-KR")} · {ev.method} {ev.path} · {ev.status}
                        {ev.userId && <span> · user:{ev.userId.slice(0, 8)}</span>}
                      </div>
                      <pre
                        className="text-[10.5px] font-mono p-2 rounded whitespace-pre-wrap"
                        style={{ background: "var(--c-surface-3)", color: "var(--c-text-1)", maxHeight: 240, overflow: "auto" }}
                      >
                        {ev.stack || ev.message}
                      </pre>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}

