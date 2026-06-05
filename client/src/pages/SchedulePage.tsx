import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { api , imgSrc} from "../api";
import { useAuth } from "../auth";
import PageHeader from "../components/PageHeader";
import { getHoliday } from "../lib/holidays";
import DateTimePicker from "../components/DateTimePicker";
import { confirmAsync, alertAsync } from "../components/ConfirmHost";
import Portal from "../components/Portal";

export type Category =
  | "MEETING" | "DEADLINE" | "OUT" | "HOLIDAY" | "EVENT"
  | "BIRTHDAY" | "TASK" | "INTERVIEW" | "TRAINING" | "CLIENT"
  | "SOCIAL" | "HEALTH" | "PERSONAL_C"
  | "COMPANY_HOLIDAY" | "COMPANY_LEAVE"
  | "OTHER";

export type EventScope = "COMPANY" | "TEAM" | "PROJECT" | "PERSONAL" | "TARGETED";

type Event = {
  id: string;
  title: string;
  content?: string;
  scope: EventScope;
  team?: string | null;
  projectId?: string | null;
  project?: { id: string; name: string; color: string } | null;
  category?: Category;
  targetUserIds?: string | null;
  startAt: string;
  endAt: string;
  color: string;
  author: { name: string };
  createdBy: string;
};

type ProjectChip = { id: string; name: string; color: string };

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
}

export default function SchedulePage() {
  const { user } = useAuth();
  const [cursor, setCursor] = useState(() => new Date());
  const [events, setEvents] = useState<Event[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    content: "",
    scope: "COMPANY" as EventScope,
    category: "MEETING" as Category,
    targetUserIds: [] as string[],
    projectId: "" as string,
    startAt: "",
    endAt: "",
    color: "#3B5CF0",
  });
  const [myProjects, setMyProjects] = useState<ProjectChip[]>([]);
  const [dayOpen, setDayOpen] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [view, setView] = useState<"month" | "week">("month");
  // 모바일 월 보기에서 그리드 아래 아젠다가 보여줄 '선택한 하루'. 기본은 오늘(자정 기준).
  // eventsOn 이 날짜를 자정 기준으로 비교하므로 시각이 붙은 new Date() 를 그대로 쓰면 당일 일정이 누락됨.
  const [selectedDay, setSelectedDay] = useState(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  });

  async function load(aliveRef?: { current: boolean }) {
    // 주간 보기가 달 경계를 넘는 경우(이전/다음 달 일부 날짜)까지 커버하도록 앞뒤 1주 여유.
    const fromD = startOfMonth(cursor); fromD.setDate(fromD.getDate() - 7);
    const toD = endOfMonth(cursor); toD.setDate(toD.getDate() + 7);
    const from = fromD.toISOString();
    const to = toD.toISOString();
    const res = await api<{ events: Event[] }>(
      `/api/schedule?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
    if (aliveRef && !aliveRef.current) return;
    setEvents(res.events);
  }

  // cursor 빠르게 넘길 때 이전 달 응답이 나중에 와서 덮는 레이스 방지.
  useEffect(() => {
    const aliveRef = { current: true };
    load(aliveRef);
    return () => { aliveRef.current = false; };
  }, [cursor]);

  // 조직도 등 외부에서 "이 사람과 일정" 을 누르면 TARGETED 로 기본 대상까지 채워 모달을 연다.
  useEffect(() => {
    function onCreate(ev: globalThis.Event) {
      const d = (ev as globalThis.CustomEvent).detail ?? {};
      const targets: string[] = Array.isArray(d.targetUserIds) ? d.targetUserIds.filter((x: unknown) => typeof x === "string") : [];
      setForm((f) => ({
        ...f,
        scope: d.scope === "COMPANY" || d.scope === "TEAM" || d.scope === "PROJECT" || d.scope === "PERSONAL" || d.scope === "TARGETED" ? d.scope : "TARGETED",
        targetUserIds: targets,
      }));
      setOpen(true);
    }
    window.addEventListener("schedule:create", onCreate);
    return () => window.removeEventListener("schedule:create", onCreate);
  }, []);

  // 모달에서 PROJECT 스코프를 선택했을 때 보여줄 프로젝트 목록. 한 번만 로드.
  useEffect(() => {
    let alive = true;
    api<{ projects: ProjectChip[] }>("/api/project")
      .then((r) => { if (alive) setMyProjects(r.projects ?? []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const days = useMemo(() => {
    const first = startOfMonth(cursor);
    const startDay = first.getDay();
    const total = endOfMonth(cursor).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startDay; i++) cells.push(null);
    for (let d = 1; d <= total; d++) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  function eventsOn(d: Date) {
    return events.filter((e) => {
      const s = new Date(e.startAt);
      const en = new Date(e.endAt);
      return d >= new Date(s.getFullYear(), s.getMonth(), s.getDate()) &&
        d <= new Date(en.getFullYear(), en.getMonth(), en.getDate());
    }).sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()); // 시작 시각 순 정렬
  }

  // 주간 보기 — cursor 가 속한 주(일~토) 7일.
  const weekDays = useMemo(() => {
    const s = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    s.setDate(s.getDate() - s.getDay());
    return Array.from({ length: 7 }, (_, i) => new Date(s.getFullYear(), s.getMonth(), s.getDate() + i));
  }, [cursor]);

  // 헤더 ←/→ — 월 보기는 ±1달, 주 보기는 ±7일.
  function navCursor(dir: 1 | -1) {
    if (view === "month") {
      const next = new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1);
      setCursor(next);
      // 아젠다 선택일도 새 달로 옮긴다 — 그 달에 오늘이 있으면 오늘, 아니면 1일. (자정 기준)
      const t = new Date();
      const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
      const sameMonth = today.getFullYear() === next.getFullYear() && today.getMonth() === next.getMonth();
      setSelectedDay(sameMonth ? today : next);
    } else setCursor(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + dir * 7));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!form.startAt || !form.endAt) {
      await alertAsync({ title: "입력 확인", description: "시작/종료 시각을 선택해주세요" });
      return;
    }
    if (form.scope === "TARGETED" && form.targetUserIds.length === 0) {
      await alertAsync({ title: "대상 확인", description: "대상 인원을 1명 이상 선택해주세요" });
      return;
    }
    if (form.scope === "PROJECT" && !form.projectId) {
      await alertAsync({ title: "프로젝트 확인", description: "공유할 프로젝트를 선택해주세요" });
      return;
    }
    if (new Date(form.endAt).getTime() < new Date(form.startAt).getTime()) {
      await alertAsync({ title: "시간 확인", description: "종료 시각이 시작 시각보다 빨라요" });
      return;
    }
    setSaving(true);
    try {
      await api("/api/schedule", {
        method: "POST",
        json: {
          ...form,
          startAt: new Date(form.startAt).toISOString(),
          endAt: new Date(form.endAt).toISOString(),
        },
      });
      setOpen(false);
      setForm({
        title: "",
        content: "",
        scope: "COMPANY",
        category: "MEETING",
        targetUserIds: [],
        projectId: "",
        startAt: "",
        endAt: "",
        color: "#3B5CF0",
      });
      await load();
    } catch (err: any) {
      alertAsync({ title: "등록 실패", description: err?.message ?? "일정 등록에 실패했어요" });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (removingId) return;
    const ok = await confirmAsync({
      title: "일정 삭제",
      description: "이 일정을 삭제할까요? 되돌릴 수 없어요.",
      tone: "danger",
      confirmLabel: "삭제",
    });
    if (!ok) return;
    setRemovingId(id);
    // 낙관적 제거.
    const prev = events;
    setEvents((xs) => xs.filter((x) => x.id !== id));
    try {
      await api(`/api/schedule/${id}`, { method: "DELETE" });
    } catch (err: any) {
      setEvents(prev);
      alertAsync({ title: "삭제 실패", description: err?.message ?? "일정 삭제에 실패했어요" });
    } finally {
      setRemovingId(null);
    }
  }

  const canMakeCompany = user?.role === "ADMIN" || user?.role === "MANAGER";

  return (
    <div>
      <PageHeader
        title="일정관리"
        description="전사/팀/개인 일정을 월별로 관리합니다."
        right={
          <div className="flex items-center gap-2 flex-wrap">
            {/* 월 / 주 보기 토글 */}
            <div className="inline-flex rounded-lg bg-ink-100 p-0.5">
              <button
                className={`px-3 h-8 rounded-md text-[13px] font-bold transition ${view === "month" ? "bg-white shadow-sm text-ink-900" : "text-ink-500"}`}
                onClick={() => setView("month")}
              >월</button>
              <button
                className={`px-3 h-8 rounded-md text-[13px] font-bold transition ${view === "week" ? "bg-white shadow-sm text-ink-900" : "text-ink-500"}`}
                onClick={() => setView("week")}
              >주</button>
            </div>
            <button className="btn-ghost" onClick={() => navCursor(-1)}>←</button>
            <div className="font-bold text-ink-900 w-32 sm:w-40 text-center text-[14px] tabular">
              {view === "month"
                ? `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`
                : `${weekDays[0].getMonth() + 1}.${weekDays[0].getDate()} – ${weekDays[6].getMonth() + 1}.${weekDays[6].getDate()}`}
            </div>
            <button className="btn-ghost" onClick={() => navCursor(1)}>→</button>
            <button className="btn-primary sm:ml-3" onClick={() => setOpen(true)}>
              + 일정 추가
            </button>
          </div>
        }
      />

      {view === "month" ? (
      <>
      <div className="card cal-fullbleed p-0 overflow-hidden">
        <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-100">
          {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
            <div key={d} className={`px-1 sm:px-3 py-2 text-[11px] sm:text-xs font-bold text-center ${i === 0 ? "text-rose-500" : i === 6 ? "text-accent-500" : "text-ink-500"}`}>
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const todays = d ? eventsOn(d) : [];
            const isToday =
              d &&
              new Date().toDateString() === d.toDateString();
            const isSelected = d && d.toDateString() === selectedDay.toDateString();
            const holiday = d ? getHoliday(d) : undefined;
            const isSunday = d && d.getDay() === 0;
            const isSaturday = d && d.getDay() === 6;
            const isRed = holiday || isSunday;

            // 날짜 숫자 색상
            let numClass = "text-ink-700";
            if (isRed) numClass = "text-rose-500";
            else if (isSaturday) numClass = "text-accent-500";

            return (
              <div
                key={i}
                className={`min-h-[64px] sm:min-h-[110px] border-b border-ink-100 ${i % 7 !== 6 ? "border-r" : ""} p-1 sm:p-2 transition-colors ${
                  holiday ? "bg-rose-50/40 dark:bg-rose-500/10" : ""
                } ${isSelected ? "bg-brand-50/70 dark:bg-brand-500/15 sm:bg-transparent sm:dark:bg-transparent" : ""} ${d ? "cursor-pointer sm:cursor-default hover:bg-ink-25 sm:hover:bg-transparent" : ""}`}
                onClick={() => {
                  // 모바일: 셀 탭으로 그 날을 선택 → 아래 아젠다가 해당 날짜 일정으로 갱신.
                  if (d && typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches) {
                    setSelectedDay(d);
                  }
                }}
              >
                {d && (
                  <>
                    <div className="flex items-center justify-between mb-1 gap-1">
                      <div
                        className={`text-[11px] sm:text-xs font-bold tabular ${
                          isToday
                            ? "inline-flex items-center justify-center w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-brand-500 text-white"
                            : numClass
                        }`}
                      >
                        {d.getDate()}
                      </div>
                      {holiday && (
                        <div
                          className="text-[9px] sm:text-[10px] font-bold text-rose-600 dark:text-rose-300 truncate hidden sm:block"
                          title={holiday.name + (holiday.substitute ? " (대체공휴일)" : "")}
                        >
                          {holiday.name.replace(" 대체공휴일", "*")}
                        </div>
                      )}
                    </div>
                    {/* 데스크톱: 이벤트 칩 최대 3개 — 클릭 시 해당 날짜 상세 모달 오픈 (실수 삭제 방지) */}
                    <div className="hidden sm:block space-y-1">
                      {todays.slice(0, 3).map((e) => (
                        <EventChip key={e.id} e={e} onOpenDay={() => setDayOpen(d!)} />
                      ))}
                      {todays.length > 3 && (
                        <button
                          type="button"
                          className="text-[11px] font-bold text-ink-500 hover:text-ink-800 px-1.5"
                          onClick={() => setDayOpen(d!)}
                        >
                          +{todays.length - 3}건 더보기
                        </button>
                      )}
                    </div>
                    {/* 모바일: 색상 점만 최대 4개 + 더 있으면 숫자 */}
                    <div className="sm:hidden flex items-center justify-center flex-wrap gap-[3px] mt-0.5">
                      {todays.slice(0, 4).map((e) => (
                        <span
                          key={e.id}
                          className="inline-block w-1.5 h-1.5 rounded-full"
                          style={{ background: e.color }}
                        />
                      ))}
                      {todays.length > 4 && (
                        <span className="text-[9px] font-bold text-ink-500 tabular leading-none">
                          +{todays.length - 4}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {/* 모바일: 선택한 날의 일정 아젠다 — 그리드 아래 빈 공간을 자연스럽게 채운다. */}
      <div className="sm:hidden mt-3">
        <DayAgenda
          date={selectedDay}
          events={eventsOn(selectedDay)}
          onOpenEvent={() => setDayOpen(selectedDay)}
          onAdd={() => {
            const p = (n: number) => String(n).padStart(2, "0");
            const ymd = `${selectedDay.getFullYear()}-${p(selectedDay.getMonth() + 1)}-${p(selectedDay.getDate())}`;
            setForm((f) => ({ ...f, startAt: `${ymd}T09:00`, endAt: `${ymd}T10:00` }));
            setOpen(true);
          }}
        />
      </div>
      </>
      ) : (
        <WeekAgenda days={weekDays} eventsOn={eventsOn} onOpenDay={(d) => setDayOpen(d)} />
      )}

      {open && (
        <EventModal
          onClose={() => setOpen(false)}
          form={form}
          setForm={setForm}
          onSubmit={create}
          canMakeCompany={canMakeCompany}
          myProjects={myProjects}
          saving={saving}
        />
      )}

      {dayOpen && (
        <DayDetailModal
          date={dayOpen}
          events={eventsOn(dayOpen)}
          onClose={() => setDayOpen(null)}
          onRemove={remove}
          removingId={removingId}
        />
      )}
    </div>
  );
}

/* ============================================================ */
/*                       Event Chip                             */
/* ============================================================ */
/** 주간 보기 — 그 주(일~토) 7일을 세로 아젠다로. 각 날짜의 일정을 시작 시각 순으로 쌓아 보여준다. */
function WeekAgenda({ days, eventsOn, onOpenDay }: { days: Date[]; eventsOn: (d: Date) => Event[]; onOpenDay: (d: Date) => void }) {
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  return (
    <div className="card cal-fullbleed p-0 overflow-hidden divide-y divide-ink-100">
      {days.map((d, i) => {
        const evs = eventsOn(d);
        const isToday = new Date().toDateString() === d.toDateString();
        const dow = d.getDay();
        const numColor = dow === 0 ? "text-rose-500" : dow === 6 ? "text-accent-500" : "text-ink-800";
        const dowColor = dow === 0 ? "text-rose-500" : dow === 6 ? "text-accent-500" : "text-ink-500";
        return (
          <div key={i} className="px-4 py-3.5">
            <div className="flex items-center gap-2 mb-2">
              <span className={`inline-flex items-center justify-center min-w-[26px] h-[26px] px-1.5 rounded-full text-[13px] font-extrabold tabular ${isToday ? "bg-brand-500 text-white" : numColor}`}>
                {d.getDate()}
              </span>
              <span className={`text-[12.5px] font-bold ${dowColor}`}>{DOW[dow]}요일</span>
              {evs.length > 0 && <span className="text-[11px] font-bold text-ink-400 ml-auto tabular">{evs.length}건</span>}
            </div>
            {evs.length === 0 ? (
              <div className="text-[12px] text-ink-400 pl-[34px]">일정 없어요</div>
            ) : (
              <div className="space-y-1.5 pl-[34px]">
                {evs.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onOpenDay(d)}
                    className="w-full flex items-center gap-2.5 text-left rounded-lg hover:bg-ink-25 -mx-1 px-1 py-1 transition"
                  >
                    <span className="w-1 h-9 rounded-full flex-shrink-0" style={{ background: e.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-bold text-ink-900 truncate">{e.title}</div>
                      <div className="text-[11px] text-ink-500 tabular mt-0.5">
                        {new Date(e.startAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                        {" – "}
                        {new Date(e.endAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 월 보기(모바일) — 선택한 하루의 일정 아젠다. 컴팩트한 월 그리드 아래의 빈 공간을
 *  실제 콘텐츠로 채워 'iOS 캘린더'처럼 자연스럽게 만든다. 데스크톱은 셀 안 칩으로 충분해 숨김. */
function DayAgenda({ date, events, onOpenEvent, onAdd }: { date: Date; events: Event[]; onOpenEvent: () => void; onAdd: () => void }) {
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const dow = date.getDay();
  const isToday = new Date().toDateString() === date.toDateString();
  const titleColor = dow === 0 ? "text-rose-500" : dow === 6 ? "text-accent-500" : "text-ink-900";
  return (
    <div className="card cal-fullbleed p-0 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-ink-100">
        <span className={`text-[15px] font-extrabold tabular ${titleColor}`}>
          {date.getMonth() + 1}월 {date.getDate()}일
        </span>
        <span className="text-[12.5px] font-bold text-ink-500">{DOW[dow]}요일</span>
        {isToday && (
          <span className="text-[10px] font-extrabold text-brand-600 bg-brand-50 dark:bg-brand-500/15 px-1.5 py-0.5 rounded-full">오늘</span>
        )}
        <span className="ml-auto text-[12px] font-bold text-ink-400 tabular">{events.length}건</span>
      </div>
      {events.length === 0 ? (
        <button type="button" onClick={onAdd} className="w-full px-4 py-10 flex flex-col items-center gap-1 active:bg-ink-25 transition">
          <span className="text-[13px] text-ink-400">이 날은 일정이 없어요</span>
          <span className="text-[12.5px] font-bold text-brand-600">+ 일정 추가</span>
        </button>
      ) : (
        <div className="divide-y divide-ink-100">
          {events.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={onOpenEvent}
              className="w-full flex items-center gap-3 text-left px-4 py-3 hover:bg-ink-25 active:bg-ink-50 transition"
            >
              <span className="w-1 h-9 rounded-full flex-shrink-0" style={{ background: e.color }} />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-bold text-ink-900 truncate">{e.title}</div>
                <div className="text-[11.5px] text-ink-500 tabular mt-0.5">
                  {new Date(e.startAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                  {" – "}
                  {new Date(e.endAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-300 flex-shrink-0">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EventChip({ e, onOpenDay }: { e: Event; onOpenDay: () => void }) {
  const cat = e.category ? CATEGORIES.find((c) => c.key === e.category) : undefined;
  const start = new Date(e.startAt);
  const end = new Date(e.endAt);
  // 다중일 이벤트면 시간 생략, 단일일이면 HH:mm 표시
  const multi =
    start.toDateString() !== end.toDateString();
  const timeStr = multi
    ? ""
    : start.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <button
      type="button"
      onClick={(ev) => {
        // 셀 onClick 까지 버블링하면 동일한 모달이 두 번 열리는 것처럼 느껴질 수 있음 → 여기서 차단.
        ev.stopPropagation();
        onOpenDay();
      }}
      className="group/ev block w-full text-left hover:opacity-80 transition-opacity"
      title={`${e.title} · 상세 보기`}
    >
      <div
        className="flex items-center gap-1 px-1.5 py-1 border rounded-md"
        style={{
          background: e.color + "14",
          borderColor: e.color + "33",
          color: e.color,
        }}
      >
        <span className="flex-shrink-0" aria-hidden>
          {cat?.icon ?? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="6" />
            </svg>
          )}
        </span>
        <span className="text-[11px] font-bold truncate flex-1" style={{ color: e.color }}>
          {e.title}
        </span>
        {timeStr && (
          <span className="text-[10px] tabular opacity-80 flex-shrink-0">{timeStr}</span>
        )}
      </div>
    </button>
  );
}

/* ============================================================ */
/*                     Day Detail Modal                         */
/* ============================================================ */
function DayDetailModal({
  date,
  events,
  onClose,
  onRemove,
  removingId,
}: {
  date: Date;
  events: Event[];
  onClose: () => void;
  onRemove: (id: string) => void;
  removingId: string | null;
}) {
  const holiday = getHoliday(date);
  return (
    <div className="fixed inset-0 bg-ink-900/40 grid place-items-center modal-safe z-50" onClick={onClose}>
      <div
        className="panel w-full max-w-[480px] shadow-pop overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4 flex items-start justify-between">
          <div>
            <div className="text-[11px] font-extrabold text-ink-500 uppercase tracking-[0.08em]">
              {date.toLocaleDateString("ko-KR", { year: "numeric", month: "long" })}
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <div className="h-display">
                {date.getDate()}일
              </div>
              <div className="text-[13px] text-ink-500 font-semibold">
                {date.toLocaleDateString("ko-KR", { weekday: "long" })}
              </div>
            </div>
            {holiday && (
              <div className="text-[12px] font-bold text-rose-600 mt-1">
                {holiday.name}{holiday.substitute ? " (대체공휴일)" : ""}
              </div>
            )}
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="닫기">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 pb-5 max-h-[60vh] overflow-auto">
          {events.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-ink-500">일정이 없어요.</div>
          ) : (
            <div className="space-y-2">
              {events.map((e) => {
                const cat = e.category ? CATEGORIES.find((c) => c.key === e.category) : undefined;
                const start = new Date(e.startAt);
                const end = new Date(e.endAt);
                return (
                  <div
                    key={e.id}
                    className="panel p-3 flex items-start gap-3"
                    style={{ borderLeft: `3px solid ${e.color}` }}
                  >
                    <div
                      className="w-8 h-8 rounded-lg grid place-items-center flex-shrink-0"
                      style={{ background: e.color + "1A", color: e.color }}
                    >
                      {cat?.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {cat && (
                          <span
                            className="chip"
                            style={{ background: e.color + "1A", color: e.color }}
                          >
                            {cat.label}
                          </span>
                        )}
                        <span className="chip-gray">
                          {e.scope === "COMPANY" ? "전사" :
                           e.scope === "TEAM" ? "팀" :
                           e.scope === "TARGETED" ? "대상 지정" : "개인"}
                        </span>
                      </div>
                      <div className="text-[14px] font-bold text-ink-900 mt-1">{e.title}</div>
                      <div className="text-[11.5px] text-ink-500 mt-0.5 tabular">
                        {start.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        {" — "}
                        {end.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </div>
                      {e.content && (
                        <div className="text-[12px] text-ink-700 mt-2 whitespace-pre-wrap leading-snug">
                          {e.content}
                        </div>
                      )}
                      <div className="text-[11px] text-ink-500 mt-2">
                        작성자 · {e.author.name}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-icon text-danger"
                      onClick={() => onRemove(e.id)}
                      disabled={removingId === e.id}
                      title="삭제"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================ */
/*                       Event Modal                            */
/* ============================================================ */

const EVENT_COLORS = [
  "#3B5CF0", // 브랜드 블루
  "#2962FF", // 액센트 블루
  "#0EA5E9", // 하늘
  "#0891B2", // 청록
  "#14B8A6", // 틸
  "#16A34A", // 그린
  "#65A30D", // 라임
  "#CA8A04", // 머스터드
  "#D97706", // 앰버
  "#EA580C", // 오렌지
  "#DC2626", // 레드
  "#DB2777", // 핑크
  "#C026D3", // 마젠타
  "#9333EA", // 바이올렛
  "#7C3AED", // 퍼플
  "#475569", // 슬레이트
];

const SCOPE_META: Record<EventScope, { label: string; desc: string; icon: JSX.Element }> = {
  PROJECT: {
    label: "프로젝트",
    desc: "선택한 프로젝트 멤버에게만 공유",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
    ),
  },
  PERSONAL: {
    label: "개인",
    desc: "나만 볼 수 있어요",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    ),
  },
  TEAM: {
    label: "팀",
    desc: "같은 팀 구성원에게 공유",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2 20a7 7 0 0 1 14 0" />
        <circle cx="17" cy="10" r="3" />
        <path d="M22 20a6 6 0 0 0-8-5.6" />
      </svg>
    ),
  },
  TARGETED: {
    label: "대상 지정",
    desc: "선택한 구성원에게만 공유",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="m17 11 2 2 4-4" />
      </svg>
    ),
  },
  COMPANY: {
    label: "전사",
    desc: "모든 구성원에게 공유",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" />
      </svg>
    ),
  },
};

const CATEGORIES: { key: Category; label: string; color: string; icon: JSX.Element; adminOnly?: boolean }[] = [
  { key: "MEETING",   label: "회의",      color: "#3B5CF0", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 11a5 5 0 1 0-10 0" /><path d="M3 21v-2a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v2" /><circle cx="12" cy="6" r="3" /></svg> },
  { key: "DEADLINE",  label: "마감",      color: "#DC2626", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg> },
  { key: "OUT",       label: "외근·출장", color: "#16A34A", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s-8-5.5-8-12a8 8 0 1 1 16 0c0 6.5-8 12-8 12z" /><circle cx="12" cy="10" r="3" /></svg> },
  { key: "HOLIDAY",   label: "휴가",      color: "#D97706", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C9 6 7 10 7 14a5 5 0 0 0 10 0c0-4-2-8-5-12z" /></svg> },
  { key: "EVENT",     label: "사내행사",  color: "#9333EA", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V5a6 6 0 0 1 12 0v4" /><path d="M5 9h14l-1.5 11H6.5z" /><path d="M10 14h4" /></svg> },
  { key: "BIRTHDAY",  label: "기념일",    color: "#DB2777", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7" /><path d="M2 21h20M7 12V8a5 5 0 0 1 10 0v4M12 5V2" /></svg> },
  { key: "TASK",      label: "업무",      color: "#0EA5E9", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13l2 2 4-4" /></svg> },
  { key: "INTERVIEW", label: "면접",      color: "#2962FF", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /><path d="m17 5 1.5-1.5M19 7l1.5-1.5" /></svg> },
  { key: "TRAINING",  label: "교육·워크샵", color: "#14B8A6", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10 12 5 2 10l10 5 10-5z" /><path d="M6 12v5c3 2 9 2 12 0v-5" /></svg> },
  { key: "CLIENT",    label: "고객·미팅", color: "#CA8A04", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7h-4V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" /><path d="M10 7V5h4v2" /></svg> },
  { key: "SOCIAL",    label: "회식·모임", color: "#EA580C", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 22h8M12 15v7" /><path d="M17 3H7l1 9a4 4 0 1 0 8 0z" /></svg> },
  { key: "HEALTH",    label: "건강·병원", color: "#DC2626", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg> },
  { key: "PERSONAL_C",label: "개인일정",  color: "#7C3AED", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg> },
  { key: "COMPANY_HOLIDAY", label: "사내 휴일", color: "#E11D48", adminOnly: true, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="m9 14 2 2 4-4" /></svg> },
  { key: "COMPANY_LEAVE",   label: "전사 휴가", color: "#F97316", adminOnly: true, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="6" /><path d="M2 22c3-3 7-3 10 0 3-3 7-3 10 0" /></svg> },
  { key: "OTHER",     label: "일반",      color: "#475569", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18" /></svg> },
];

type EventForm = {
  title: string;
  content: string;
  scope: EventScope;
  category: Category;
  targetUserIds: string[];
  projectId: string;
  startAt: string;
  endAt: string;
  color: string;
};

type DirUser = { id: string; name: string; email: string; team?: string | null; avatarColor?: string; avatarUrl?: string | null; position?: string | null };

/**
 * iOS 키보드가 올라오면 visualViewport 만 키보드 높이만큼 줄어든다(레이아웃 뷰포트·100vh·100dvh 는 그대로).
 * 그래서 화면 중앙 정렬 모달은 키보드가 뜨면 아래쪽(카테고리 칩·푸터의 저장 버튼)이 키보드와 iOS 입력
 * 보조바에 가려진다. 오버레이를 visualViewport 영역(top/height)에 맞추고 패널을 그 안으로 캡(max-h-full)하면,
 * 모달이 항상 키보드 위에 들어와 내부 스크롤만으로 모든 필드·푸터에 접근된다.
 * visualViewport 미지원(구형) 환경에서는 전체 화면으로 폴백하므로 기존 동작과 동일.
 */
function useViewportInset(): { top: number; height: number | string } {
  const read = (): { top: number; height: number | string } => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    return vv ? { top: vv.offsetTop, height: vv.height } : { top: 0, height: "100%" };
  };
  const [inset, setInset] = useState<{ top: number; height: number | string }>(read);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => setInset({ top: vv.offsetTop, height: vv.height });
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, []);
  return inset;
}

function EventModal({
  onClose,
  form,
  setForm,
  onSubmit,
  canMakeCompany,
  myProjects,
  saving,
}: {
  onClose: () => void;
  form: EventForm;
  setForm: (f: EventForm) => void;
  onSubmit: (e: React.FormEvent) => void;
  canMakeCompany: boolean;
  myProjects: ProjectChip[];
  saving: boolean;
}) {
  const scopes: EventScope[] = canMakeCompany
    ? ["COMPANY", "TEAM", "PROJECT", "PERSONAL", "TARGETED"]
    : ["TEAM", "PROJECT", "PERSONAL", "TARGETED"];

  const [directory, setDirectory] = useState<DirUser[]>([]);
  const [userSearch, setUserSearch] = useState("");
  // 입력은 즉시 반영되지만 필터링은 React 가 우선순위 낮춰 스케줄 — 한글 IME 로 빠르게 입력해도
  // 인풋이 끊기지 않고 뒤따르는 대량 리스트 필터가 프레임을 먹지 않음. 디바운스 setTimeout 보다 가벼움.
  const deferredSearch = useDeferredValue(userSearch);
  useEffect(() => {
    if (form.scope !== "TARGETED" || directory.length) return;
    api<{ users: DirUser[] }>("/api/users").then((r) => setDirectory(r.users));
  }, [form.scope, directory.length]);

  function toggleTarget(id: string) {
    setForm({
      ...form,
      targetUserIds: form.targetUserIds.includes(id)
        ? form.targetUserIds.filter((x) => x !== id)
        : [...form.targetUserIds, id],
    });
  }
  function removeTarget(id: string) {
    setForm({ ...form, targetUserIds: form.targetUserIds.filter((x) => x !== id) });
  }

  const filteredDir = useMemo(() => {
    const k = deferredSearch.trim().toLowerCase();
    if (!k) return directory;
    return directory.filter((d) =>
      d.name.toLowerCase().includes(k) ||
      (d.team ?? "").toLowerCase().includes(k) ||
      d.email.toLowerCase().includes(k)
    );
  }, [directory, deferredSearch]);

  // 키보드가 떠도 모달(카테고리 칩·저장 버튼)이 가려지지 않도록 오버레이를 visualViewport 영역에 맞춘다.
  const viewport = useViewportInset();

  return (
    <Portal>
    <div
      className="fixed inset-x-0 bg-ink-900/40 grid place-items-center modal-safe z-50"
      style={{ top: viewport.top, height: viewport.height }}
      onClick={onClose}
    >
      <div
        className="panel w-full max-w-[640px] shadow-pop overflow-hidden max-h-full flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-lg grid place-items-center"
              style={{ background: form.color + "22", color: form.color }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="16" rx="2.5" />
                <path d="M3 10h18M8 3v4M16 3v4" />
              </svg>
            </div>
            <div>
              <div className="h-title">일정 추가</div>
              <div className="text-[11.5px] text-ink-500">팀과 공유할 일정을 만들어보세요</div>
            </div>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="닫기">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={onSubmit} className="flex-1 min-h-0 flex flex-col">
          <div className="px-6 pb-5 space-y-5 flex-1 min-h-0 overflow-y-auto">
            {/* 제목 */}
            <div>
              <label className="field-label">제목</label>
              <input
                className="input"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="무엇을 계획하고 있나요?"
                autoFocus
                required
                maxLength={200}
              />
            </div>

            {/* 시간 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="field-label">시작</label>
                <DateTimePicker
                  value={form.startAt}
                  onChange={(v) => setForm({ ...form, startAt: v })}
                />
              </div>
              <div>
                <label className="field-label">종료</label>
                <DateTimePicker
                  value={form.endAt}
                  onChange={(v) => setForm({ ...form, endAt: v })}
                  min={form.startAt}
                />
              </div>
            </div>

            {/* 카테고리 */}
            <div>
              <label className="field-label">카테고리</label>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.filter((c) => !c.adminOnly || canMakeCompany).map((c) => {
                  const active = form.category === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setForm({ ...form, category: c.key, color: c.color })}
                      className={`inline-flex items-center gap-1.5 h-[32px] px-3 rounded-full border transition text-[12.5px] font-bold`}
                      style={{
                        borderColor: active ? c.color : "var(--c-border-strong)",
                        background: active ? c.color + "1A" : "var(--c-surface)",
                        color: active ? c.color : "var(--c-text-2)",
                      }}
                    >
                      <span className="inline-flex">{c.icon}</span>
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 범위 */}
            <div>
              <label className="field-label">공유 범위</label>
              <div className={`grid gap-2 ${canMakeCompany ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-1 sm:grid-cols-3"}`}>
                {scopes.map((s) => {
                  const meta = SCOPE_META[s];
                  const active = form.scope === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm({ ...form, scope: s })}
                      className={`text-left p-3 rounded-xl border-2 transition ${
                        active
                          ? "border-brand-500 bg-brand-50"
                          : "border-ink-150 hover:border-ink-300 bg-white"
                      }`}
                    >
                      <div
                        className={`flex items-center gap-1.5 ${
                          active ? "text-brand-600" : "text-ink-700"
                        }`}
                      >
                        {meta.icon}
                        <span className="text-[13px] font-bold">{meta.label}</span>
                      </div>
                      <div className="text-[11px] text-ink-500 mt-1 leading-snug">
                        {meta.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 프로젝트 선택 (PROJECT 일 때) — 내가 멤버인 프로젝트만 노출. */}
            {form.scope === "PROJECT" && (
              <div>
                <label className="field-label">프로젝트</label>
                {myProjects.length === 0 ? (
                  <div className="text-[12px] text-ink-500 p-3 rounded-lg border border-ink-150 bg-[color:var(--c-surface-2)]">
                    참여 중인 프로젝트가 없어요. 프로젝트에 먼저 참여한 뒤 다시 시도해주세요.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {myProjects.map((p) => {
                      const active = form.projectId === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setForm({ ...form, projectId: p.id, color: p.color })}
                          className={`flex items-center gap-2 h-10 px-3 rounded-lg border transition text-left ${
                            active
                              ? "border-brand-500 bg-brand-50"
                              : "border-ink-150 hover:border-ink-300 bg-[color:var(--c-surface)]"
                          }`}
                        >
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
                          <span className={`text-[13px] font-bold truncate ${active ? "text-brand-700" : "text-ink-800"}`}>
                            {p.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* 대상 인원 (TARGETED 일 때) */}
            {form.scope === "TARGETED" && (
              <div>
                <label className="field-label">
                  대상 인원 <span className="text-ink-500 font-normal">({form.targetUserIds.length}명)</span>
                </label>

                {/* 선택된 칩 */}
                {form.targetUserIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {form.targetUserIds.map((id) => {
                      const u = directory.find((x) => x.id === id);
                      if (!u) return null;
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1.5 pl-1 pr-1 py-0.5 rounded-full bg-brand-50 border border-brand-200 text-brand-700"
                        >
                          <span
                            className="w-5 h-5 rounded-full grid place-items-center text-white text-[10px] font-bold overflow-hidden"
                            style={{ background: u.avatarUrl ? "transparent" : (u.avatarColor ?? "#3B5CF0") }}
                          >
                            {u.avatarUrl ? (
                              <img src={imgSrc(u.avatarUrl)} alt={u.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
                            ) : (
                              u.name[0]
                            )}
                          </span>
                          <span className="text-[12px] font-bold">{u.name}</span>
                          <button
                            type="button"
                            onClick={() => removeTarget(id)}
                            className="w-4 h-4 rounded-full hover:bg-brand-100 grid place-items-center"
                            aria-label="제거"
                          >
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M18 6 6 18M6 6l12 12" />
                            </svg>
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* 검색 + 리스트 */}
                <div className="panel p-0 overflow-hidden">
                  <div className="px-3 py-2 border-b border-ink-150">
                    <input
                      className="input text-[12px] h-[34px]"
                      placeholder="이름·팀·이메일 검색"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      maxLength={80}
                    />
                  </div>
                  <div className="max-h-[200px] overflow-auto divide-y divide-ink-100">
                    {filteredDir.map((u) => {
                      const checked = form.targetUserIds.includes(u.id);
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => toggleTarget(u.id)}
                          className={`w-full flex items-center gap-3 px-3 py-2 text-left ${
                            checked ? "bg-brand-50" : "hover:bg-ink-25"
                          }`}
                        >
                          <span className="w-5 h-5 rounded border border-ink-300 grid place-items-center flex-shrink-0" style={{ background: checked ? "var(--c-brand)" : "transparent", borderColor: checked ? "var(--c-brand)" : undefined }}>
                            {checked && (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <path d="m5 12 5 5L20 7" />
                              </svg>
                            )}
                          </span>
                          <div
                            className="w-7 h-7 rounded-full grid place-items-center text-white text-[11px] font-bold flex-shrink-0 overflow-hidden"
                            style={{ background: u.avatarUrl ? "transparent" : (u.avatarColor ?? "#3B5CF0") }}
                          >
                            {u.avatarUrl ? (
                              <img src={imgSrc(u.avatarUrl)} alt={u.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
                            ) : (
                              u.name[0]
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-bold text-ink-900 truncate">{u.name}</div>
                            <div className="text-[11px] text-ink-500 truncate">
                              {u.position ?? "—"}{u.team ? ` · ${u.team}` : ""}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                    {filteredDir.length === 0 && (
                      <div className="px-4 py-8 text-center text-[12px] text-ink-500">일치하는 팀원이 없어요.</div>
                    )}
                  </div>
                </div>
                <div className="text-[11px] text-ink-500 mt-1.5">선택한 팀원에게만 일정이 공유되고 알림이 전송돼요.</div>
              </div>
            )}

            {/* 색상 */}
            <div>
              <label className="field-label">색상</label>
              <div className="flex items-center flex-wrap gap-2">
                {EVENT_COLORS.map((c) => {
                  const active = form.color === c;
                  return (
                    <button
                      type="button"
                      key={c}
                      onClick={() => setForm({ ...form, color: c })}
                      aria-label={c}
                      className={`relative w-7 h-7 rounded-full transition ${
                        active ? "scale-110 ring-2 ring-offset-2 ring-ink-800" : "hover:scale-105"
                      }`}
                      style={{ background: c }}
                    >
                      {active && (
                        <svg
                          className="absolute inset-0 m-auto"
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#fff"
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="m5 12 5 5L20 7" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 메모 */}
            <div>
              <label className="field-label">메모 <span className="text-ink-400 font-normal">(선택)</span></label>
              <textarea
                className="input"
                rows={4}
                placeholder="참석자·장소·준비물 등 상세 내용을 적어주세요"
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                maxLength={5_000}
              />
            </div>
          </div>

          {/* 푸터 */}
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-ink-150 bg-ink-25 flex-shrink-0">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>취소</button>
            <button className="btn-primary" disabled={saving}>{saving ? "추가 중…" : "일정 추가"}</button>
          </div>
        </form>
      </div>
    </div>
    </Portal>
  );
}
