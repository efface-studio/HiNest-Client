import { useEffect, useMemo, useState } from "react";
import { api, apiSWR , imgSrc} from "../api";
import { useAuth } from "../auth";
import DateTimePicker from "./DateTimePicker";
import { confirmAsync, alertAsync } from "./ConfirmHost";

type ProjectEvent = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  color: string;
  assigneeIds: string | null;
  createdById: string;
  /** 완료 여부 — 월/주/일/리스트 뷰에서 체크박스로 토글. */
  completed: boolean;
  completedAt: string | null;
  completedById: string | null;
};

export type CalMember = {
  id: string;
  name: string;
  avatarColor: string;
  avatarUrl?: string | null;
  position?: string | null;
  team?: string | null;
};

function parseAssignees(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split(",").filter(Boolean);
}

type View = "month" | "week" | "day";
type Mode = "calendar" | "list";

/* ------------ 날짜 유틸 ------------ */
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
function startOfWeek(d: Date) {
  const c = new Date(d);
  c.setDate(c.getDate() - c.getDay());
  c.setHours(0, 0, 0, 0);
  return c;
}
function endOfWeek(d: Date) {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  e.setHours(23, 59, 59, 999);
  return e;
}
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function fmtHHmm(d: Date) {
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}
/** <input type="datetime-local"> 용 문자열 — 로컬 타임존 기반 YYYY-MM-DDTHH:mm */
function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ------------ 메인 컴포넌트 ------------ */
export default function ProjectCalendar({
  projectId,
  members,
}: {
  projectId: string;
  members: CalMember[];
}) {
  const { user } = useAuth();
  // 담당자 id → 멤버 정보 맵 (아바타 렌더링용)
  const memberMap = useMemo(() => {
    const m = new Map<string, CalMember>();
    for (const x of members) m.set(x.id, x);
    return m;
  }, [members]);
  const [mode, setMode] = useState<Mode>("calendar");
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  /** 담당자 필터 — "all" | "mine" | userId.  */
  const [filter, setFilter] = useState<string>("all");
  const [openCreate, setOpenCreate] = useState(false);
  const [selected, setSelected] = useState<ProjectEvent | null>(null);
  const [form, setForm] = useState(() => initForm());

  function initForm(base?: Date) {
    const now = base ?? new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0);
    const end = new Date(start);
    end.setHours(end.getHours() + 1);
    return {
      title: "",
      description: "",
      startAt: toLocalInput(start),
      endAt: toLocalInput(end),
      allDay: false,
      color: "#3B5CF0",
      assigneeIds: [] as string[],
    };
  }

  function toggleAssignee(uid: string) {
    setForm((f) =>
      f.assigneeIds.includes(uid)
        ? { ...f, assigneeIds: f.assigneeIds.filter((x) => x !== uid) }
        : { ...f, assigneeIds: [...f.assigneeIds, uid] }
    );
  }

  const range = useMemo(() => {
    // 리스트 모드는 항상 해당 달 범위로 로드 — 달력과 쓰는 데이터 범위를 일치시켜 캐시 친화적으로.
    if (mode === "list") return { from: startOfMonth(cursor), to: endOfMonth(cursor) };
    if (view === "month") return { from: startOfMonth(cursor), to: endOfMonth(cursor) };
    if (view === "week") return { from: startOfWeek(cursor), to: endOfWeek(cursor) };
    return { from: startOfDay(cursor), to: endOfDay(cursor) };
  }, [mode, view, cursor]);

  async function load(aliveRef?: { current: boolean }) {
    const q = `from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`;
    // 같은 달을 이전에 열어봤다면 캐시된 이벤트로 즉시 그려주고, 백그라운드에서 갱신.
    // 콜드스타트 구간에 빈 달력 대신 직전 상태가 보이는 편이 체감상 훨씬 낫다.
    await apiSWR<{ events: ProjectEvent[] }>(
      `/api/project/${projectId}/events?${q}`,
      {
        onCached: (res) => { if (!aliveRef || aliveRef.current) setEvents(res.events); },
        onFresh: (res) => { if (!aliveRef || aliveRef.current) setEvents(res.events); },
      }
    );
  }

  /** 필터 적용된 이벤트. "내 일정"은 내가 담당자로 포함된 것 + 내가 만든 것(담당자 없어도 내 스케줄로 취급). */
  const visibleEvents = useMemo(() => {
    if (filter === "all") return events;
    if (filter === "mine") {
      const me = user?.id;
      if (!me) return [];
      return events.filter((ev) => {
        const asg = parseAssignees(ev.assigneeIds);
        return asg.includes(me) || (asg.length === 0 && ev.createdById === me);
      });
    }
    return events.filter((ev) => parseAssignees(ev.assigneeIds).includes(filter));
  }, [events, filter, user?.id]);
  useEffect(() => {
    // projectId·view 등이 빠르게 바뀔 때 이전 요청의 setEvents 가 새 요청 뒤에 도착하면
    // 화면이 stale 해짐. 언마운트/의존성 변경 타이밍에 aliveRef 로 방어.
    const aliveRef = { current: true };
    load(aliveRef);
    return () => { aliveRef.current = false; };
    // eslint-disable-next-line
  }, [projectId, mode, view, cursor]);

  function shift(dir: -1 | 1) {
    const c = new Date(cursor);
    if (mode === "list" || view === "month") c.setMonth(c.getMonth() + dir);
    else if (view === "week") c.setDate(c.getDate() + 7 * dir);
    else c.setDate(c.getDate() + dir);
    setCursor(c);
  }

  function eventsOnDay(d: Date) {
    const s = startOfDay(d);
    const e = endOfDay(d);
    return visibleEvents.filter((ev) => {
      const es = new Date(ev.startAt);
      const ee = new Date(ev.endAt);
      return es <= e && ee >= s;
    });
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    await api(`/api/project/${projectId}/events`, {
      method: "POST",
      json: {
        title: form.title,
        description: form.description || null,
        startAt: new Date(form.startAt).toISOString(),
        endAt: new Date(form.endAt).toISOString(),
        allDay: form.allDay,
        color: form.color,
        assigneeIds: form.assigneeIds,
      },
    });
    setOpenCreate(false);
    setForm(initForm());
    load();
  }

  async function removeEvent(id: string) {
    const ok = await confirmAsync({
      title: "일정 삭제",
      description: "이 일정을 삭제할까요? 되돌릴 수 없어요.",
      tone: "danger",
      confirmLabel: "삭제",
    });
    if (!ok) return;
    // 낙관적 제거.
    const prev = events;
    setEvents((xs) => xs.filter((x) => x.id !== id));
    setSelected(null);
    try {
      await api(`/api/project/${projectId}/events/${id}`, { method: "DELETE" });
    } catch (e: any) {
      setEvents(prev);
      alertAsync({ title: "삭제 실패", description: e?.message ?? "일정 삭제에 실패했어요" });
    }
  }

  /**
   * 완료 상태 토글 — 달력 셀 안의 체크박스 또는 상세 모달에서 호출.
   * 서버 왕복 대기 없이 즉시 로컬 state 를 업데이트(옵티미스틱)하고, 실패 시 원복.
   * 달력 셀에서 쓰이므로 빠른 피드백이 중요하다.
   */
  async function toggleCompleted(ev: ProjectEvent) {
    const next = !ev.completed;
    // 옵티미스틱 반영
    setEvents((prev) =>
      prev.map((e) =>
        e.id === ev.id
          ? {
              ...e,
              completed: next,
              completedAt: next ? new Date().toISOString() : null,
              completedById: next ? user?.id ?? null : null,
            }
          : e
      )
    );
    // 상세 모달이 열려있는 상태에서 토글한 경우도 동기화
    setSelected((sel) =>
      sel && sel.id === ev.id
        ? {
            ...sel,
            completed: next,
            completedAt: next ? new Date().toISOString() : null,
            completedById: next ? user?.id ?? null : null,
          }
        : sel
    );
    try {
      await api(`/api/project/${projectId}/events/${ev.id}`, {
        method: "PATCH",
        json: { completed: next },
      });
    } catch (err) {
      // 실패 시 원복. alert 로 알려주기보다 UI 가 되돌려지는 걸로 충분.
      setEvents((prev) =>
        prev.map((e) => (e.id === ev.id ? ev : e))
      );
      setSelected((sel) => (sel && sel.id === ev.id ? ev : sel));
      console.error("toggle completed failed", err);
    }
  }

  const headerLabel = useMemo(() => {
    if (mode === "list" || view === "month")
      return cursor.toLocaleDateString("ko-KR", { year: "numeric", month: "long" });
    if (view === "week") {
      const s = startOfWeek(cursor);
      const e = endOfWeek(cursor);
      return `${s.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })} – ${e.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}`;
    }
    return cursor.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  }, [mode, view, cursor]);

  return (
    <div>
      {/* 헤더: 뷰 스위처 + 네비 */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-ghost !px-2 !py-1" onClick={() => shift(-1)} aria-label="이전">
            ‹
          </button>
          <div className="font-bold text-slate-900 min-w-[140px] sm:min-w-[180px] text-center">{headerLabel}</div>
          <button className="btn-ghost !px-2 !py-1" onClick={() => shift(1)} aria-label="다음">
            ›
          </button>
          <button
            className="btn-ghost !px-3 !py-1 text-xs"
            onClick={() => setCursor(new Date())}
          >
            오늘
          </button>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {/* 캘린더 ↔ 리스트 모드 토글 — 시각적으로 구분해서 첫번째 그룹 */}
          <div className="flex items-center gap-1 mr-2 pr-2 border-r border-slate-200">
            <ViewBtn active={mode === "calendar"} onClick={() => setMode("calendar")}>캘린더</ViewBtn>
            <ViewBtn active={mode === "list"} onClick={() => setMode("list")}>리스트</ViewBtn>
          </div>
          {/* 캘린더 모드에서만 월/주/일 선택 가능 */}
          {mode === "calendar" && (
            <>
              <ViewBtn active={view === "month"} onClick={() => setView("month")}>월</ViewBtn>
              <ViewBtn active={view === "week"} onClick={() => setView("week")}>주</ViewBtn>
              <ViewBtn active={view === "day"} onClick={() => setView("day")}>일</ViewBtn>
            </>
          )}
          <button
            className="btn-primary !px-3 !py-1 text-xs ml-2"
            onClick={() => {
              setForm(initForm(cursor));
              setOpenCreate(true);
            }}
          >
            + 일정
          </button>
        </div>
      </div>

      {/* 담당자 필터 — 전체 / 내 일정 / 멤버별 */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>전체</FilterChip>
        {user?.id && (() => {
          const me = memberMap.get(user.id);
          const meUrl = me?.avatarUrl;
          return (
            <FilterChip active={filter === "mine"} onClick={() => setFilter("mine")}>
              <span
                className="inline-block w-4 h-4 rounded-full text-white text-[9px] font-bold grid place-items-center mr-1 align-middle overflow-hidden"
                style={{ background: meUrl ? "transparent" : (me?.avatarColor ?? "#64748B") }}
              >
                {meUrl ? (
                  <img src={meUrl} alt={me?.name ?? "내 프로필"} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
                ) : (
                  (me?.name ?? user.name ?? "나")[0]
                )}
              </span>
              내 일정
            </FilterChip>
          );
        })()}
        <span className="mx-1 h-4 w-px bg-slate-200" />
        {members.map((m) => (
          <FilterChip key={m.id} active={filter === m.id} onClick={() => setFilter(m.id)}>
            <span
              className="inline-block w-4 h-4 rounded-full text-white text-[9px] font-bold grid place-items-center mr-1 align-middle overflow-hidden"
              style={{ background: m.avatarUrl ? "transparent" : m.avatarColor }}
            >
              {m.avatarUrl ? (
                <img src={imgSrc(m.avatarUrl)} alt={m.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
              ) : (
                m.name[0]
              )}
            </span>
            {m.name}
          </FilterChip>
        ))}
      </div>

      {mode === "calendar" && view === "month" && (
        <MonthGrid cursor={cursor} events={visibleEvents} onPick={(d) => { setCursor(d); setView("day"); }} memberMap={memberMap} onToggleCompleted={toggleCompleted} />
      )}
      {mode === "calendar" && view === "week" && (
        <WeekView cursor={cursor} eventsOnDay={eventsOnDay} onSelect={setSelected} onPickDay={(d) => { setCursor(d); setView("day"); }} memberMap={memberMap} onToggleCompleted={toggleCompleted} />
      )}
      {mode === "calendar" && view === "day" && (
        <DayView cursor={cursor} events={eventsOnDay(cursor)} onSelect={setSelected} memberMap={memberMap} onToggleCompleted={toggleCompleted} />
      )}
      {mode === "list" && (
        <ListView cursor={cursor} events={visibleEvents} onSelect={setSelected} memberMap={memberMap} onToggleCompleted={toggleCompleted} />
      )}

      {/* 생성 모달 */}
      {openCreate && (
        <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-50" onClick={() => setOpenCreate(false)}>
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">새 일정</h3>
            <form onSubmit={submitCreate} className="space-y-3">
              <div>
                <label className="label">제목</label>
                <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="label">시작</label>
                  <DateTimePicker
                    value={form.startAt}
                    onChange={(v) => setForm({ ...form, startAt: v })}
                  />
                </div>
                <div>
                  <label className="label">종료</label>
                  <DateTimePicker
                    value={form.endAt}
                    onChange={(v) => setForm({ ...form, endAt: v })}
                    min={form.startAt}
                  />
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} />
                종일
              </label>
              <div>
                <label className="label">색상</label>
                <input type="color" className="w-16 h-8 border border-slate-200 rounded" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
              </div>
              <div>
                <label className="label">담당자</label>
                {members.length === 0 ? (
                  <div className="text-xs text-slate-400">프로젝트에 멤버가 없습니다.</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
                    {members.map((m) => {
                      const on = form.assigneeIds.includes(m.id);
                      return (
                        <button
                          type="button"
                          key={m.id}
                          onClick={() => toggleAssignee(m.id)}
                          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs ${on ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 hover:bg-slate-50 text-slate-600"}`}
                        >
                          <span
                            className="w-4 h-4 rounded-full grid place-items-center text-white text-[9px] font-bold overflow-hidden"
                            style={{ background: m.avatarUrl ? "transparent" : m.avatarColor }}
                          >
                            {m.avatarUrl ? (
                              <img src={imgSrc(m.avatarUrl)} alt={m.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
                            ) : (
                              m.name[0]
                            )}
                          </span>
                          {m.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div>
                <label className="label">설명</label>
                <textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-ghost" onClick={() => setOpenCreate(false)}>취소</button>
                <button className="btn-primary">등록</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 상세 모달 */}
      {selected && (
        <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-50" onClick={() => setSelected(null)}>
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-3 h-3 rounded-full" style={{ background: selected.color }} />
              <h3 className={`text-lg font-bold flex-1 ${selected.completed ? "line-through text-slate-400" : ""}`}>{selected.title}</h3>
              {selected.completed && (
                <span className="chip bg-emerald-50 text-emerald-700 border border-emerald-100">완료</span>
              )}
            </div>
            <div className="text-xs text-slate-500 mb-3">
              {new Date(selected.startAt).toLocaleString("ko-KR")} ~ {new Date(selected.endAt).toLocaleString("ko-KR")}
              {selected.allDay && <span className="ml-2 chip bg-slate-100 text-slate-500">종일</span>}
            </div>
            {selected.completed && selected.completedAt && (
              <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-2 py-1.5 mb-3">
                {(() => {
                  const who = selected.completedById ? memberMap.get(selected.completedById) : null;
                  const when = new Date(selected.completedAt).toLocaleString("ko-KR");
                  return who ? `${who.name}님이 ${when}에 완료` : `${when} 완료`;
                })()}
              </div>
            )}
            {parseAssignees(selected.assigneeIds).length > 0 && (
              <div className="mb-3">
                <div className="text-[11px] font-bold text-slate-500 mb-1.5">담당자</div>
                <div className="flex flex-wrap gap-1.5">
                  {parseAssignees(selected.assigneeIds).map((uid) => {
                    const m = memberMap.get(uid);
                    if (!m) return null;
                    return (
                      <span
                        key={uid}
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-100 text-xs"
                      >
                        <span
                          className="w-4 h-4 rounded-full grid place-items-center text-white text-[9px] font-bold overflow-hidden"
                          style={{ background: m.avatarUrl ? "transparent" : m.avatarColor }}
                        >
                          {m.avatarUrl ? (
                            <img src={imgSrc(m.avatarUrl)} alt={m.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
                          ) : (
                            m.name[0]
                          )}
                        </span>
                        {m.name}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            {selected.description && (
              <div className="text-sm text-slate-700 whitespace-pre-wrap mb-4">{selected.description}</div>
            )}
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setSelected(null)}>닫기</button>
              <button
                className={selected.completed ? "btn-ghost" : "btn-primary"}
                onClick={() => toggleCompleted(selected)}
              >
                {selected.completed ? "미완료로 되돌리기" : "완료 처리"}
              </button>
              <button className="btn-ghost text-rose-600" onClick={() => removeEvent(selected.id)}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 일정 완료 체크박스.
 *  - 달력 셀 내부에 얹히는 작은 원형 토글. 체크/미체크 두 상태.
 *  - 이벤트 버퀘이션은 caller 에서 설정 — 셀 클릭 vs 체크박스 클릭을 구분해야 하므로
 *    onClick 에 stopPropagation 을 해서 상세 모달이 같이 열리지 않게 한다.
 *  - 흰색 배경(밝은 색 이벤트) 과 컬러 배경(진한 색 이벤트) 양쪽에서 보이게
 *    tone prop 으로 색을 바꿔 사용한다.
 */
function CompletionCheckbox({
  completed,
  onToggle,
  tone = "on-color",
  size = 14,
}: {
  completed: boolean;
  onToggle: () => void;
  /** "on-color": 이벤트의 진한 배경 위. "on-white": 흰/밝은 배경 위. */
  tone?: "on-color" | "on-white";
  size?: number;
}) {
  const base =
    "rounded border flex-shrink-0 grid place-items-center transition cursor-pointer";
  const palette =
    tone === "on-color"
      ? completed
        ? "bg-white/90 border-white text-slate-700"
        : "bg-white/10 border-white/60 hover:bg-white/25 text-white/90"
      : completed
      ? "bg-brand-500 border-brand-500 text-white"
      : "bg-white border-slate-300 hover:border-brand-400 text-transparent";
  return (
    <span
      role="checkbox"
      aria-checked={completed}
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }
      }}
      className={`${base} ${palette}`}
      style={{ width: size, height: size }}
      title={completed ? "완료 → 미완료로 되돌리기" : "미완료 → 완료 처리"}
    >
      {/* 체크 아이콘 — 완료 상태일 때만 보임. 미완료일 때는 transparent 로 자리차지만. */}
      <svg
        width={Math.max(8, size - 4)}
        height={Math.max(8, size - 4)}
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="2.5 6.5 5 9 9.5 3.5" />
      </svg>
    </span>
  );
}

/** 담당자 아바타 스택 — 최대 3명 보여주고 나머지는 +N. */
function AssigneeStack({
  ids,
  memberMap,
  size = 18,
}: {
  ids: string[];
  memberMap: Map<string, CalMember>;
  size?: number;
}) {
  if (ids.length === 0) return null;
  const shown = ids.slice(0, 3);
  const extra = ids.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((uid, i) => {
        const m = memberMap.get(uid);
        if (!m) return null;
        return (
          <span
            key={uid}
            className="rounded-full grid place-items-center text-white font-bold border-2 border-white overflow-hidden"
            style={{
              background: m.avatarUrl ? "transparent" : m.avatarColor,
              width: size,
              height: size,
              fontSize: Math.max(8, Math.floor(size * 0.5)),
              marginLeft: i === 0 ? 0 : -6,
            }}
            title={m.name}
          >
            {m.avatarUrl ? (
              <img src={imgSrc(m.avatarUrl)} alt={m.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" decoding="async"/>
            ) : (
              m.name[0]
            )}
          </span>
        );
      })}
      {extra > 0 && (
        <span
          className="rounded-full grid place-items-center bg-slate-200 text-slate-600 font-bold border-2 border-white"
          style={{ width: size, height: size, fontSize: Math.max(8, Math.floor(size * 0.45)), marginLeft: -6 }}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border transition ${
        active
          ? "border-brand-500 bg-brand-50 text-brand-700"
          : "border-slate-200 text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function ViewBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-md text-xs font-bold ${active ? "bg-brand-500 text-white" : "text-slate-600 hover:bg-slate-100"}`}
    >
      {children}
    </button>
  );
}

/* ------------ 월 뷰 ------------ */
function MonthGrid({
  cursor,
  events,
  onPick,
  memberMap,
  onToggleCompleted,
}: {
  cursor: Date;
  events: ProjectEvent[];
  onPick: (d: Date) => void;
  memberMap: Map<string, CalMember>;
  onToggleCompleted: (ev: ProjectEvent) => void;
}) {
  const cells = useMemo(() => {
    const first = startOfMonth(cursor);
    const startDay = first.getDay();
    const total = endOfMonth(cursor).getDate();
    const arr: (Date | null)[] = [];
    for (let i = 0; i < startDay; i++) arr.push(null);
    for (let d = 1; d <= total; d++) arr.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [cursor]);

  function on(d: Date) {
    const s = startOfDay(d);
    const e = endOfDay(d);
    return events.filter((ev) => {
      const es = new Date(ev.startAt);
      const ee = new Date(ev.endAt);
      return es <= e && ee >= s;
    });
  }

  const today = new Date();
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="grid grid-cols-7 bg-slate-50 text-[11px] sm:text-xs font-bold text-slate-500">
        {["일", "월", "화", "수", "목", "금", "토"].map((w, i) => (
          <div
            key={w}
            className={`px-1 sm:px-2 py-2 text-center ${i === 0 ? "text-rose-500" : i === 6 ? "text-blue-500" : ""}`}
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((c, i) => {
          if (!c) return <div key={i} className="min-h-[64px] sm:min-h-[128px] border-t border-l border-slate-100 bg-slate-50/40" />;
          const evs = on(c);
          const isToday = sameDay(c, today);
          return (
            <button
              key={i}
              onClick={() => onPick(c)}
              className="min-h-[64px] sm:min-h-[128px] border-t border-l border-slate-100 p-1 sm:p-1.5 text-left hover:bg-slate-50 flex flex-col"
            >
              {/* 날짜 — 오늘이면 브랜드색 원 배경 (점 대신) 으로 표시해서 이벤트 점과 혼동 방지 */}
              <div className="flex items-center leading-none mb-1">
                <span
                  className={`text-[11px] sm:text-xs font-bold tabular ${
                    isToday
                      ? "inline-flex items-center justify-center w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-brand-500 text-white"
                      : "text-slate-700"
                  }`}
                >
                  {c.getDate()}
                </span>
              </div>
              {/* 데스크톱: 이벤트 칩 최대 3개 */}
              <div className="hidden sm:block space-y-0.5">
                {evs.slice(0, 3).map((ev) => {
                  const asg = parseAssignees(ev.assigneeIds);
                  return (
                    <div
                      key={ev.id}
                      className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded text-white ${ev.completed ? "opacity-50" : ""}`}
                      style={{ background: ev.color }}
                      title={ev.title}
                    >
                      <CompletionCheckbox
                        completed={ev.completed}
                        onToggle={() => onToggleCompleted(ev)}
                        size={11}
                      />
                      {asg.length > 0 && (
                        <AssigneeStack ids={asg} memberMap={memberMap} size={12} />
                      )}
                      <span className={`truncate flex-1 ${ev.completed ? "line-through" : ""}`}>{ev.title}</span>
                    </div>
                  );
                })}
                {evs.length > 3 && <div className="text-[10px] text-slate-400">+{evs.length - 3}</div>}
              </div>
              {/* 모바일: 색상 점으로 밀도만 표시 */}
              <div className="sm:hidden flex items-center justify-center flex-wrap gap-[3px] mt-0.5">
                {evs.slice(0, 4).map((ev) => (
                  <span
                    key={ev.id}
                    className={`inline-block w-1.5 h-1.5 rounded-full ${ev.completed ? "opacity-40" : ""}`}
                    style={{ background: ev.color }}
                  />
                ))}
                {evs.length > 4 && (
                  <span className="text-[9px] font-bold text-slate-500 tabular leading-none">
                    +{evs.length - 4}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------ 주 뷰 ------------ */
function WeekView({
  cursor,
  eventsOnDay,
  onSelect,
  onPickDay,
  memberMap,
  onToggleCompleted,
}: {
  cursor: Date;
  eventsOnDay: (d: Date) => ProjectEvent[];
  onSelect: (ev: ProjectEvent) => void;
  onPickDay: (d: Date) => void;
  memberMap: Map<string, CalMember>;
  onToggleCompleted: (ev: ProjectEvent) => void;
}) {
  const s = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(s);
    d.setDate(d.getDate() + i);
    return d;
  });
  const today = new Date();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
      {days.map((d, i) => {
        const evs = eventsOnDay(d);
        const isToday = sameDay(d, today);
        return (
          <div key={i} className="border border-slate-200 rounded-lg overflow-hidden flex flex-col min-h-[80px] sm:min-h-[280px]">
            <button
              onClick={() => onPickDay(d)}
              className={`text-xs font-bold px-2 py-1.5 text-left hover:bg-slate-50 border-b border-slate-100
                ${i === 0 ? "text-rose-500" : i === 6 ? "text-blue-500" : "text-slate-700"}
                ${isToday ? "bg-brand-50" : ""}`}
            >
              {d.getMonth() + 1}/{d.getDate()} ({["일", "월", "화", "수", "목", "금", "토"][i]})
            </button>
            <div className="flex-1 p-1.5 space-y-1 overflow-auto">
              {evs.map((ev) => {
                const asg = parseAssignees(ev.assigneeIds);
                return (
                  <button
                    key={ev.id}
                    onClick={() => onSelect(ev)}
                    className={`w-full text-left text-[11px] px-1.5 py-1 rounded text-white ${ev.completed ? "opacity-55" : ""}`}
                    style={{ background: ev.color }}
                  >
                    <div className="flex items-center gap-1.5">
                      <CompletionCheckbox
                        completed={ev.completed}
                        onToggle={() => onToggleCompleted(ev)}
                        size={13}
                      />
                      <div className={`font-semibold truncate flex-1 ${ev.completed ? "line-through" : ""}`}>{ev.title}</div>
                    </div>
                    <div className="flex items-center justify-between gap-1 mt-0.5 pl-5">
                      {!ev.allDay ? (
                        <span className={`opacity-80 ${ev.completed ? "line-through" : ""}`}>{fmtHHmm(new Date(ev.startAt))}</span>
                      ) : <span />}
                      {asg.length > 0 && <AssigneeStack ids={asg} memberMap={memberMap} size={14} />}
                    </div>
                  </button>
                );
              })}
              {evs.length === 0 && <div className="text-[11px] text-slate-300 text-center py-2">–</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------ 리스트(일자 agenda) 뷰 ------------ */
function ListView({
  cursor,
  events,
  onSelect,
  memberMap,
  onToggleCompleted,
}: {
  cursor: Date;
  events: ProjectEvent[];
  onSelect: (ev: ProjectEvent) => void;
  memberMap: Map<string, CalMember>;
  onToggleCompleted: (ev: ProjectEvent) => void;
}) {
  // 시작일 기준 정렬, 해당 일자별로 그룹핑.
  // 걸치는 다일(多日) 이벤트는 일단 시작일에만 노출 — 필요 시 후속에서 확장.
  const groups = useMemo(() => {
    const sorted = [...events].sort(
      (a, b) => +new Date(a.startAt) - +new Date(b.startAt)
    );
    const map = new Map<string, { date: Date; list: ProjectEvent[] }>();
    for (const ev of sorted) {
      const d = new Date(ev.startAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(key)) {
        map.set(key, { date: startOfDay(d), list: [] });
      }
      map.get(key)!.list.push(ev);
    }
    return Array.from(map.values());
  }, [events]);

  const today = new Date();
  const monthLabel = cursor.toLocaleDateString("ko-KR", { year: "numeric", month: "long" });

  if (groups.length === 0) {
    return (
      <div className="border border-slate-200 rounded-lg py-20 text-center text-sm text-slate-400">
        {monthLabel}에 등록된 일정이 없습니다.
      </div>
    );
  }

  return (
    <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
      {groups.map((g) => {
        const isToday = sameDay(g.date, today);
        const weekday = ["일", "월", "화", "수", "목", "금", "토"][g.date.getDay()];
        return (
          <div key={g.date.toISOString()} className="grid grid-cols-[110px_1fr] gap-4 px-4 py-3">
            <div className="text-right">
              <div className={`text-2xl font-bold tabular ${isToday ? "text-brand-600" : "text-slate-800"}`}>
                {g.date.getDate()}
              </div>
              <div className={`text-[11px] font-bold ${g.date.getDay() === 0 ? "text-rose-500" : g.date.getDay() === 6 ? "text-blue-500" : "text-slate-500"}`}>
                {g.date.getMonth() + 1}월 · {weekday}요일
                {isToday && <span className="ml-1 text-brand-500">· 오늘</span>}
              </div>
            </div>
            <div className="space-y-1.5 min-w-0">
              {g.list.map((ev) => {
                const asg = parseAssignees(ev.assigneeIds);
                return (
                  <button
                    key={ev.id}
                    onClick={() => onSelect(ev)}
                    className={`w-full flex items-center gap-3 text-left border rounded-lg px-3 py-2 hover:bg-slate-50 ${ev.completed ? "border-slate-100 bg-slate-50/60" : "border-slate-100"}`}
                  >
                    <CompletionCheckbox
                      completed={ev.completed}
                      onToggle={() => onToggleCompleted(ev)}
                      tone="on-white"
                      size={18}
                    />
                    <span className={`w-1.5 h-8 rounded flex-shrink-0 ${ev.completed ? "opacity-40" : ""}`} style={{ background: ev.color }} />
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-semibold truncate ${ev.completed ? "text-slate-400 line-through" : "text-slate-900"}`}>{ev.title}</div>
                      <div className={`text-[11px] ${ev.completed ? "text-slate-400" : "text-slate-500"}`}>
                        {ev.allDay ? (
                          <span>종일</span>
                        ) : (
                          <>
                            {fmtHHmm(new Date(ev.startAt))} – {fmtHHmm(new Date(ev.endAt))}
                          </>
                        )}
                      </div>
                    </div>
                    {asg.length > 0 && <AssigneeStack ids={asg} memberMap={memberMap} size={20} />}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------ 일 뷰 ------------ */
function DayView({
  cursor,
  events,
  onSelect,
  memberMap,
  onToggleCompleted,
}: {
  cursor: Date;
  events: ProjectEvent[];
  onSelect: (ev: ProjectEvent) => void;
  memberMap: Map<string, CalMember>;
  onToggleCompleted: (ev: ProjectEvent) => void;
}) {
  const allDay = events.filter((e) => e.allDay);
  const timed = events
    .filter((e) => !e.allDay)
    .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
  return (
    <div className="border border-slate-200 rounded-lg p-4 min-h-[360px]">
      {allDay.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] font-bold text-slate-500 mb-1">종일</div>
          <div className="space-y-1">
            {allDay.map((ev) => (
              <button
                key={ev.id}
                onClick={() => onSelect(ev)}
                className={`w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded text-white ${ev.completed ? "opacity-55" : ""}`}
                style={{ background: ev.color }}
              >
                <CompletionCheckbox
                  completed={ev.completed}
                  onToggle={() => onToggleCompleted(ev)}
                  size={14}
                />
                <span className={ev.completed ? "line-through flex-1" : "flex-1"}>{ev.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="text-[10px] font-bold text-slate-500 mb-2">시간 일정</div>
      {timed.length === 0 && allDay.length === 0 && (
        <div className="text-slate-400 text-sm text-center py-16">이 날짜에 일정이 없습니다.</div>
      )}
      <div className="space-y-1.5">
        {timed.map((ev) => {
          const asg = parseAssignees(ev.assigneeIds);
          return (
            <button
              key={ev.id}
              onClick={() => onSelect(ev)}
              className={`w-full flex items-center gap-3 text-left border rounded-lg px-3 py-2 hover:bg-slate-50 ${ev.completed ? "border-slate-100 bg-slate-50/60" : "border-slate-100"}`}
            >
              <CompletionCheckbox
                completed={ev.completed}
                onToggle={() => onToggleCompleted(ev)}
                tone="on-white"
                size={18}
              />
              <span className={`w-1.5 h-8 rounded ${ev.completed ? "opacity-40" : ""}`} style={{ background: ev.color }} />
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-semibold truncate ${ev.completed ? "text-slate-400 line-through" : "text-slate-900"}`}>{ev.title}</div>
                <div className={`text-[11px] ${ev.completed ? "text-slate-400" : "text-slate-500"}`}>
                  {fmtHHmm(new Date(ev.startAt))} – {fmtHHmm(new Date(ev.endAt))}
                </div>
              </div>
              {asg.length > 0 && <AssigneeStack ids={asg} memberMap={memberMap} size={20} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
