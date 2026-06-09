import { useEffect, useMemo, useRef, useState } from "react";
import { api, apiSWR } from "../api";
import PageHeader from "../components/PageHeader";
import { Skeleton } from "../components/Skeleton";
import DateTimePicker from "../components/DateTimePicker";
import Portal from "../components/Portal";
import { alertAsync } from "../components/ConfirmHost";
import { useModalDismiss } from "../lib/useModalDismiss";

type Journal = {
  id: string;
  date: string;
  title: string;
  content: string;
  createdAt: string;
};

/**
 * "오늘" 은 항상 KST 기준. 브라우저 로케일이 한국이 아니어도 일지 날짜 기본값이 서울 날짜가 되도록.
 */
const KST_TODAY = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function today() {
  return KST_TODAY.format(new Date());
}

type Mode = "view" | "create" | "edit";

export default function JournalPage() {
  const [list, setList] = useState<Journal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Journal | null>(null);
  const [form, setForm] = useState({ date: today(), title: "", content: "" });
  const [mode, setMode] = useState<Mode>("view");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  // 삭제 버튼 중복 클릭 방지 + native confirm() 대체용 모달 상태.
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  // 삭제 확인 모달: 실행 중이 아니면 Esc / 배경 클릭으로 닫기.
  useModalDismiss(!!confirmRemoveId && !removingId, () => setConfirmRemoveId(null));

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  // SWR — 탭 안에서 재진입 시 즉시 리스트 렌더.
  useEffect(() => {
    apiSWR<{ journals: Journal[] }>("/api/journal", {
      onCached: (d) => {
        if (!aliveRef.current) return;
        setList(d.journals);
        setLoading(false);
        if (d.journals.length && !selected) setSelected(d.journals[0]);
      },
      onFresh: (d) => {
        if (!aliveRef.current) return;
        setList(d.journals);
        setLoading(false);
        if (d.journals.length && !selected) setSelected(d.journals[0]);
      },
      onError: () => { if (aliveRef.current) setLoading(false); },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 데스크탑 새로고침 버튼 — 최신 목록을 강제로 다시 가져온다(현재 선택은 유지).
  // 모바일은 PTR 이 전역으로 담당.
  async function load() {
    try {
      const d = await api<{ journals: Journal[] }>("/api/journal");
      if (!aliveRef.current) return;
      setList(d.journals);
      if (d.journals.length && !selected) setSelected(d.journals[0]);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }
  async function refresh() {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }

  function openCreate() {
    setMode("create");
    setForm({ date: today(), title: "", content: "" });
    setSelected(null);
    setErr("");
  }

  function openEdit(j: Journal) {
    setMode("edit");
    setSelected(j);
    setForm({ date: j.date, title: j.title, content: j.content });
    setErr("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setErr("");
    try {
      if (mode === "edit" && selected) {
        const res = await api<{ journal: Journal }>(`/api/journal/${selected.id}`, {
          method: "PATCH",
          json: form,
        });
        if (!aliveRef.current) return;
        setList((arr) => arr.map((j) => (j.id === res.journal.id ? res.journal : j)));
        setSelected(res.journal);
      } else {
        const res = await api<{ journal: Journal }>("/api/journal", { method: "POST", json: form });
        if (!aliveRef.current) return;
        setList((arr) => [res.journal, ...arr.filter((j) => j.id !== res.journal.id)]);
        setSelected(res.journal);
      }
      setMode("view");
      setForm({ date: today(), title: "", content: "" });
    } catch (e: any) {
      if (!aliveRef.current) return;
      setErr(e?.message ?? "저장 실패");
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  }

  async function remove(id: string) {
    if (removingId) return;
    setRemovingId(id);
    try {
      await api(`/api/journal/${id}`, { method: "DELETE" });
      if (!aliveRef.current) return;
      setList((arr) => arr.filter((j) => j.id !== id));
      if (selected?.id === id) setSelected(null);
      setMode("view");
    } catch (e: any) {
      alertAsync({ title: "삭제 실패", description: e?.message ?? "삭제에 실패했어요" });
    } finally {
      if (aliveRef.current) {
        setRemovingId(null);
        setConfirmRemoveId(null);
      }
    }
  }

  const editing = mode !== "view";
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return list;
    return list.filter(
      (j) => j.title.toLowerCase().includes(k) || j.content.toLowerCase().includes(k) || j.date.includes(k),
    );
  }, [list, q]);
  // 같은 달끼리 그룹핑 — 사이드바 시각 구조 강화.
  const grouped = useMemo(() => {
    const map = new Map<string, Journal[]>();
    for (const j of filtered) {
      const ym = j.date.slice(0, 7);
      if (!map.has(ym)) map.set(ym, []);
      map.get(ym)!.push(j);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div>
      <PageHeader
        title="업무일지"
        description="하루의 업무를 기록하고 회고하세요."
        onRefresh={refresh}
        refreshing={refreshing}
        right={
          <button className="btn-primary btn-lg" onClick={openCreate}>
            + 새 일지
          </button>
        }
      />
      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-5">
        {/* 사이드 리스트 */}
        <aside className="panel p-0 overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 220px)" }}>
          <div className="px-4 py-3 border-b border-ink-100">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[13.5px] font-extrabold text-ink-900">내 일지</div>
              <span className="chip chip-gray !text-[10.5px]">{list.length}</span>
            </div>
            <div className="relative">
              <input
                className="input !h-9 !text-[12.5px] !pl-8"
                placeholder="제목·날짜·본문 검색"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  position: "absolute",
                  left: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--c-text-3)",
                }}
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {loading && filtered.length === 0 ? (
              <div className="px-4 py-4 space-y-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} w="100%" h={56} radius={8} className="block" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <div className="text-[34px] mb-2">📝</div>
                <div className="text-[13px] font-bold text-ink-900">{q ? "검색 결과가 없어요" : "아직 일지가 없어요"}</div>
                <div className="text-[11.5px] text-ink-500 mt-1">{q ? "다른 키워드로 찾아보세요" : "오늘 한 일을 정리해 보세요"}</div>
                {!q && (
                  <button className="btn-ghost btn-xs mt-3" onClick={openCreate}>+ 새 일지 작성</button>
                )}
              </div>
            ) : (
              grouped.map(([ym, items]) => (
                <div key={ym}>
                  <div className="sticky top-0 z-[1] px-4 py-1.5 bg-ink-25 text-[10.5px] font-extrabold text-ink-500 uppercase tracking-[0.06em] border-b border-ink-100">
                    {formatYearMonth(ym)}
                  </div>
                  {items.map((j) => {
                    const active = selected?.id === j.id && mode === "view";
                    return (
                      <button
                        key={j.id}
                        onClick={() => { setSelected(j); setMode("view"); }}
                        className="w-full text-left px-4 py-3 hover:bg-ink-25 transition border-b border-ink-100 flex items-start gap-3"
                        style={active ? { background: "var(--c-brand-soft)" } : undefined}
                      >
                        <div
                          className="flex-shrink-0 w-10 h-10 rounded-xl grid place-items-center text-[10.5px] font-extrabold leading-none"
                          style={{
                            background: active ? "var(--c-brand)" : "var(--c-surface-3)",
                            color: active ? "#fff" : "var(--c-text)",
                          }}
                        >
                          <div>
                            <div className="text-[15px] font-extrabold tabular-nums text-center">
                              {parseInt(j.date.slice(8, 10), 10)}
                            </div>
                            <div className="text-[9px] opacity-80 text-center">{dowOf(j.date)}</div>
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13.5px] font-bold text-ink-900 truncate">{j.title || "(제목 없음)"}</div>
                          <div className="text-[11px] text-ink-500 mt-0.5 line-clamp-1">
                            {j.content.replace(/\s+/g, " ").trim() || "(내용 없음)"}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </aside>

        {/* 본문 */}
        <main className="panel p-0 overflow-hidden flex flex-col" style={{ minHeight: "60vh" }}>
          {editing ? (
            <form onSubmit={save} className="flex flex-col h-full">
              <div className="px-6 pt-5 pb-4 border-b border-ink-100">
                <div className="text-[10.5px] font-extrabold tracking-[0.18em] uppercase text-brand-600">
                  {mode === "edit" ? "EDIT" : "NEW"}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[180px_minmax(0,1fr)] gap-3 mt-2">
                  <div>
                    <label className="field-label">날짜</label>
                    <DateTimePicker mode="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
                  </div>
                  <div>
                    <label className="field-label">제목</label>
                    <input
                      className="input !text-[15px] !font-bold"
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      required
                      maxLength={200}
                      placeholder="오늘 한 일 한 줄 요약"
                      autoFocus={mode === "create"}
                    />
                  </div>
                </div>
              </div>
              <div className="flex-1 px-6 py-4 overflow-auto">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="field-label !mb-0">내용</label>
                  <span className="text-[11px] text-ink-500 tabular-nums">
                    {form.content.length.toLocaleString()} / 20,000
                  </span>
                </div>
                <textarea
                  className="input"
                  rows={16}
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  required
                  maxLength={20_000}
                  placeholder="오늘 한 일 / 잘된 점 / 막힌 점 / 내일 할 일 ..."
                  style={{ resize: "vertical", lineHeight: 1.6, minHeight: 320 }}
                />
                {err && (
                  <div className="mt-3 text-[12px] font-semibold text-red-600">{err}</div>
                )}
              </div>
              <div className="px-6 py-3 border-t border-ink-100 flex justify-end gap-2">
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={saving}
                  onClick={() => {
                    setMode("view");
                    setErr("");
                  }}
                >
                  취소
                </button>
                <button className="btn-primary" disabled={saving}>
                  {saving ? "저장 중…" : mode === "edit" ? "수정 저장" : "저장"}
                </button>
              </div>
            </form>
          ) : selected ? (
            <article className="flex flex-col h-full">
              <div className="px-6 pt-5 pb-4 border-b border-ink-100">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-2 text-[11.5px] text-ink-500 font-bold">
                      <span className="chip chip-brand !text-[10.5px]">{formatDateLong(selected.date)}</span>
                      <span>·</span>
                      <span className="font-mono tabular-nums">{selected.date}</span>
                    </div>
                    <h2 className="text-[24px] font-extrabold mt-2 break-words tracking-tight text-ink-900">
                      {selected.title || "(제목 없음)"}
                    </h2>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button className="btn-ghost btn-xs" onClick={() => openEdit(selected)} disabled={removingId === selected.id}>
                      수정
                    </button>
                    <button
                      className="btn-ghost btn-xs"
                      style={{ color: "var(--c-danger)" }}
                      onClick={() => setConfirmRemoveId(selected.id)}
                      disabled={removingId === selected.id}
                    >
                      {removingId === selected.id ? "삭제 중…" : "삭제"}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex-1 px-6 py-6 overflow-auto">
                <div className="whitespace-pre-wrap text-[14.5px] text-ink-800 leading-[1.75] break-words">
                  {selected.content || <span className="text-ink-400">(내용 없음)</span>}
                </div>
              </div>
            </article>
          ) : (
            <EmptyDetail onCreate={openCreate} />
          )}
        </main>
      </div>

      {confirmRemoveId && (
        <Portal>
        <div
          className="fixed inset-0 z-50 grid place-items-center modal-safe"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
          onClick={() => removingId ? null : setConfirmRemoveId(null)}
        >
          <div className="panel p-5 w-full max-w-[420px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-xl grid place-items-center flex-shrink-0"
                style={{ background: "rgba(220,38,38,0.10)", color: "var(--c-danger)" }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-[15px] font-extrabold text-ink-900">일지 삭제</h3>
                <p className="text-[12.5px] text-ink-600 mt-1 leading-relaxed">
                  이 일지를 삭제할까요? 삭제 후에는 복구할 수 없어요.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                className="btn-ghost"
                onClick={() => setConfirmRemoveId(null)}
                disabled={!!removingId}
              >
                취소
              </button>
              <button
                className="btn-primary"
                style={{ background: "var(--c-danger)" }}
                onClick={() => remove(confirmRemoveId)}
                disabled={!!removingId}
              >
                {removingId ? "삭제 중…" : "삭제"}
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}

function EmptyDetail({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex-1 grid place-items-center px-6 py-16">
      <div className="text-center max-w-[360px]">
        <div className="text-[40px] mb-3">📝</div>
        <div className="text-[16px] font-extrabold text-ink-900">일지를 선택하거나 새로 작성하세요</div>
        <div className="text-[12.5px] text-ink-500 mt-1.5 leading-relaxed">
          하루를 기록해 두면 회고가 쉬워져요.
          <br />
          오늘 한 일·막힌 점·내일 할 일 셋만 남겨도 충분.
        </div>
        <button className="btn-primary mt-5" onClick={onCreate}>+ 새 일지 작성</button>
      </div>
    </div>
  );
}

function dowOf(date: string) {
  const d = new Date(date + "T00:00:00");
  return ["일", "월", "화", "수", "목", "금", "토"][d.getDay()] ?? "";
}
function formatYearMonth(ym: string) {
  const [y, m] = ym.split("-");
  return `${y}년 ${parseInt(m, 10)}월`;
}
function formatDateLong(date: string) {
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}
