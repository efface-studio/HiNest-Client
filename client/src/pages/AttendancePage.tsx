import { useEffect, useMemo, useRef, useState } from "react";
import { api, apiSWR } from "../api";
import PageHeader from "../components/PageHeader";
import { useAuth } from "../auth";
import MonthPicker from "../components/MonthPicker";
import DateTimePicker from "../components/DateTimePicker";
import { alertAsync } from "../components/ConfirmHost";
import { useModalDismiss } from "../lib/useModalDismiss";

type Attendance = {
  id: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
};

type Leave = {
  id: string;
  userId: string;
  type: string;
  startDate: string;
  endDate: string;
  reason?: string;
  status: string;
  user?: { name: string; team?: string };
};

function ymNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const KST_TODAY_FMT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function todayKST() {
  return KST_TODAY_FMT.format(new Date());
}

export default function AttendancePage() {
  const { user } = useAuth();
  const [month, setMonth] = useState(ymNow());
  const [records, setRecords] = useState<Attendance[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [allLeaves, setAllLeaves] = useState<Leave[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: "ANNUAL", startDate: "", endDate: "", reason: "" });
  const [saving, setSaving] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  // 제출/승인 직후 load() 가 다시 돌 때, 사용자가 빠르게 탭 이탈하면
  // setState 가 언마운트된 컴포넌트에 박혀 경고+누수. 마지막 응답만 반영하도록 monotonic token.
  const aliveRef = useRef(true);
  const loadTokenRef = useRef(0);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  // 모달 Esc·배경 잠금.
  useModalDismiss(open && !saving, () => setOpen(false));

  async function load() {
    const myToken = ++loadTokenRef.current;
    const [m, l] = await Promise.all([
      api<{ attendances: Attendance[] }>(`/api/attendance/month?month=${month}`),
      api<{ leaves: Leave[] }>("/api/attendance/leave"),
    ]);
    if (!aliveRef.current || myToken !== loadTokenRef.current) return;
    setRecords(m.attendances);
    setLeaves(l.leaves);

    if (user?.role === "ADMIN" || user?.role === "MANAGER") {
      const all = await api<{ leaves: Leave[] }>("/api/attendance/leave?all=1");
      if (!aliveRef.current || myToken !== loadTokenRef.current) return;
      setAllLeaves(all.leaves);
    }
  }

  // SWR — 월별 출퇴근과 휴가 목록은 탭 재진입 시 캐시로 즉시 채움.
  const isReviewer = user?.role === "ADMIN" || user?.role === "MANAGER";
  useEffect(() => {
    let alive = true;
    apiSWR<{ attendances: Attendance[] }>(`/api/attendance/month?month=${month}`, {
      onCached: (d) => { if (alive) setRecords(d.attendances); },
      onFresh: (d) => { if (alive) setRecords(d.attendances); },
    });
    apiSWR<{ leaves: Leave[] }>("/api/attendance/leave", {
      onCached: (d) => { if (alive) setLeaves(d.leaves); },
      onFresh: (d) => { if (alive) setLeaves(d.leaves); },
    });
    if (isReviewer) {
      apiSWR<{ leaves: Leave[] }>("/api/attendance/leave?all=1", {
        onCached: (d) => { if (alive) setAllLeaves(d.leaves); },
        onFresh: (d) => { if (alive) setAllLeaves(d.leaves); },
      });
    }
    return () => { alive = false; };
  }, [month, isReviewer]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!form.startDate || !form.endDate) {
      await alertAsync({ title: "입력 확인", description: "시작/종료일을 선택해주세요" });
      return;
    }
    if (new Date(form.endDate) < new Date(form.startDate)) {
      await alertAsync({ title: "날짜 확인", description: "종료일이 시작일보다 빨라요" });
      return;
    }
    setSaving(true);
    try {
      await api("/api/attendance/leave", { method: "POST", json: form });
      setOpen(false);
      setForm({ type: "ANNUAL", startDate: "", endDate: "", reason: "" });
      await load();
    } catch (err: any) {
      alertAsync({ title: "신청 실패", description: err?.message ?? "휴가 신청에 실패했어요" });
    } finally {
      setSaving(false);
    }
  }

  async function review(id: string, status: string) {
    if (reviewingId) return;
    setReviewingId(id);
    try {
      await api(`/api/attendance/leave/${id}`, { method: "PATCH", json: { status } });
      await load();
    } catch (err: any) {
      alertAsync({ title: "처리 실패", description: err?.message ?? "승인·반려에 실패했어요" });
    } finally {
      setReviewingId(null);
    }
  }

  // === 통계 계산 ===
  const stats = useMemo(() => {
    const completed = records.filter((r) => r.checkIn && r.checkOut);
    const totalMs = completed.reduce(
      (acc, r) => acc + (new Date(r.checkOut!).getTime() - new Date(r.checkIn!).getTime()),
      0,
    );
    const avgMs = completed.length ? totalMs / completed.length : 0;
    const usedDays = leaves
      .filter((l) => l.status === "APPROVED")
      .reduce((acc, l) => acc + dayDiff(l.startDate, l.endDate), 0);
    const pending = leaves.filter((l) => l.status === "PENDING").length;
    return {
      workDays: completed.length,
      avgHours: avgMs ? msToHM(avgMs) : "—",
      usedDays,
      pending,
    };
  }, [records, leaves]);

  const pendingForReviewer = useMemo(
    () => allLeaves.filter((l) => l.status === "PENDING"),
    [allLeaves],
  );
  const handledForReviewer = useMemo(
    () => allLeaves.filter((l) => l.status !== "PENDING"),
    [allLeaves],
  );

  return (
    <div>
      <PageHeader
        title="근태 · 월차"
        description="월별 출퇴근 기록과 휴가 신청을 관리합니다."
        right={
          <div className="flex gap-2 flex-wrap items-center">
            <MonthPicker value={month} onChange={setMonth} />
            <button className="btn-primary btn-lg" onClick={() => setOpen(true)}>
              + 휴가 신청
            </button>
          </div>
        }
      />

      {/* 상단 통계 카드 — 전체 페이지의 시각적 앵커. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard
          label={`${month} 근무일`}
          value={`${stats.workDays}일`}
          accent="brand"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
          }
        />
        <StatCard
          label="평균 근무시간"
          value={stats.avgHours}
          accent="success"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3.5 2" />
            </svg>
          }
        />
        <StatCard
          label="사용한 휴가"
          value={`${stats.usedDays}일`}
          accent="warning"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v6M5 8a7 7 0 0 1 14 0c0 8 -7 14 -7 14s-7 -6 -7 -14z" />
            </svg>
          }
        />
        <StatCard
          label="승인 대기"
          value={`${stats.pending}건`}
          accent="violet"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4l2 2" />
            </svg>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 출퇴근 기록 */}
        <div className="lg:col-span-2 panel p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between">
            <div>
              <div className="text-[15px] font-extrabold text-ink-900">{month} 출퇴근 기록</div>
              <div className="text-[12px] text-ink-500 mt-0.5">총 {records.length}일 기록</div>
            </div>
          </div>
          {records.length === 0 ? (
            <EmptyState
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M3 10h18M8 3v4M16 3v4" />
                </svg>
              }
              title="기록이 없어요"
              hint="이 달은 아직 출퇴근 기록이 없어요. 다른 달도 확인해 보세요."
            />
          ) : (
            <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
              <table className="pro-cards w-full text-[13px] min-w-[480px]">
                <thead className="bg-ink-25 text-ink-500 text-[11px] uppercase tracking-[0.06em]">
                  <tr>
                    <th className="text-left px-5 py-2.5 font-bold">일자</th>
                    <th className="text-left px-5 py-2.5 font-bold">출근</th>
                    <th className="text-left px-5 py-2.5 font-bold">퇴근</th>
                    <th className="text-right px-5 py-2.5 font-bold">근무시간</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => {
                    const d = new Date(r.date + "T00:00:00");
                    const dow = d.getDay();
                    const isWeekend = dow === 0 || dow === 6;
                    const isToday = r.date === todayKST();
                    return (
                      <tr
                        key={r.id}
                        className="border-t border-ink-100"
                        style={{ background: isToday ? "var(--c-brand-soft)" : undefined }}
                      >
                        <td className="cell-primary px-5 py-3">
                          <div className="font-bold text-ink-900">{r.date.slice(5)}</div>
                          <div className="text-[10.5px] mt-0.5" style={{ color: isWeekend ? "var(--c-danger)" : "var(--c-text-3)" }}>
                            {dowLabel(dow)}
                            {isToday && <span className="ml-1 chip chip-brand !text-[9.5px] !py-0">오늘</span>}
                          </div>
                        </td>
                        <td data-label="출근" className="px-5 py-3 font-mono text-ink-800">
                          {r.checkIn ? formatHM(r.checkIn) : <span className="text-ink-400">—</span>}
                        </td>
                        <td data-label="퇴근" className="px-5 py-3 font-mono text-ink-800">
                          {r.checkOut ? formatHM(r.checkOut) : <span className="text-ink-400">—</span>}
                        </td>
                        <td data-label="근무시간" className="px-5 py-3 text-right">
                          {r.checkIn && r.checkOut ? (
                            <span className="font-bold text-ink-900">{durationLabel(r.checkIn, r.checkOut)}</span>
                          ) : (
                            <span className="text-ink-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 내 휴가 신청 */}
        <div className="panel p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between">
            <div>
              <div className="text-[15px] font-extrabold text-ink-900">내 휴가 신청</div>
              <div className="text-[12px] text-ink-500 mt-0.5">최근 신청 {leaves.length}건</div>
            </div>
          </div>
          <div className="p-3 space-y-2 max-h-[60vh] overflow-y-auto">
            {leaves.length === 0 ? (
              <div className="px-2 py-10 text-center text-[12.5px] text-ink-500">
                신청 내역이 없어요.
                <br />
                <button className="btn-ghost btn-xs mt-2" onClick={() => setOpen(true)}>+ 휴가 신청</button>
              </div>
            ) : (
              leaves.map((l) => <LeaveRow key={l.id} l={l} />)
            )}
          </div>
        </div>
      </div>

      {/* 관리자 — 전체 휴가 처리 */}
      {isReviewer && (
        <div className="panel p-0 overflow-hidden mt-5">
          <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between">
            <div>
              <div className="text-[15px] font-extrabold text-ink-900">전체 휴가 신청</div>
              <div className="text-[12px] text-ink-500 mt-0.5">
                대기 <b className="text-ink-900">{pendingForReviewer.length}</b> · 처리됨 {handledForReviewer.length}
              </div>
            </div>
          </div>
          {allLeaves.length === 0 ? (
            <EmptyState
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M3 10h18M8 3v4M16 3v4" />
                </svg>
              }
              title="신청이 없어요"
              hint="구성원의 휴가 신청이 들어오면 여기에 표시돼요."
            />
          ) : (
            <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
              <table className="pro-cards w-full text-[13px] min-w-[720px]">
                <thead className="bg-ink-25 text-ink-500 text-[11px] uppercase tracking-[0.06em]">
                  <tr>
                    <th className="text-left px-5 py-2.5 font-bold">이름</th>
                    <th className="text-left px-5 py-2.5 font-bold">종류</th>
                    <th className="text-left px-5 py-2.5 font-bold">기간</th>
                    <th className="text-left px-5 py-2.5 font-bold">사유</th>
                    <th className="text-left px-5 py-2.5 font-bold">상태</th>
                    <th className="text-right px-5 py-2.5 font-bold">처리</th>
                  </tr>
                </thead>
                <tbody>
                  {[...pendingForReviewer, ...handledForReviewer].map((l) => (
                    <tr key={l.id} className="border-t border-ink-100">
                      <td className="cell-primary px-5 py-3 font-bold text-ink-900">{l.user?.name}</td>
                      <td data-label="종류" className="px-5 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          <LeaveTypeDot type={l.type} />
                          <span className="text-ink-800">{typeLabel(l.type)}</span>
                        </span>
                      </td>
                      <td data-label="기간" className="px-5 py-3 text-ink-700">
                        {formatRange(l.startDate, l.endDate)}
                        <span className="ml-1 text-[11px] text-ink-500">({dayDiff(l.startDate, l.endDate)}일)</span>
                      </td>
                      <td data-label="사유" className="px-5 py-3 text-ink-600" title={l.reason ?? ""}>
                        <span className="block truncate max-w-[240px]">{l.reason || <span className="text-ink-400">—</span>}</span>
                      </td>
                      <td data-label="상태" className="px-5 py-3">
                        <StatusChip status={l.status} />
                      </td>
                      <td className={`${l.status === "PENDING" ? "cell-actions" : "cell-hide-m"} px-5 py-3 text-right`}>
                        {l.status === "PENDING" && (
                          <div className="inline-flex gap-1.5">
                            <button
                              className="btn-primary btn-xs"
                              onClick={() => review(l.id, "APPROVED")}
                              disabled={reviewingId === l.id}
                            >
                              {reviewingId === l.id ? "처리 중…" : "승인"}
                            </button>
                            <button
                              className="btn-ghost btn-xs"
                              style={{ color: "var(--c-danger)" }}
                              onClick={() => review(l.id, "REJECTED")}
                              disabled={reviewingId === l.id}
                            >
                              반려
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 신청 모달 */}
      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center modal-safe"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
          onClick={() => !saving && setOpen(false)}
        >
          <div className="panel p-0 w-full max-w-[480px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div
              className="px-5 py-4"
              style={{
                background: "linear-gradient(135deg, var(--c-brand) 0%, #7C3AED 100%)",
                color: "#fff",
              }}
            >
              <div className="text-[10.5px] font-extrabold tracking-[0.18em] uppercase opacity-90">New Request</div>
              <div className="text-[18px] font-extrabold tracking-tight mt-0.5">휴가 신청</div>
            </div>
            <form onSubmit={submit} className="p-5 space-y-4">
              <div>
                <label className="field-label">종류</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {LEAVE_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setForm({ ...form, type: t.value })}
                      className={`flex flex-col items-center justify-center gap-1 py-2 rounded-xl border text-[11.5px] font-bold transition ${
                        form.type === t.value
                          ? "border-brand-500 bg-brand-50 text-brand-700"
                          : "border-ink-150 text-ink-600 hover:bg-ink-25"
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">시작일</label>
                  <DateTimePicker mode="date" value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} />
                </div>
                <div>
                  <label className="field-label">종료일</label>
                  <DateTimePicker mode="date" value={form.endDate} onChange={(v) => setForm({ ...form, endDate: v })} min={form.startDate} />
                </div>
              </div>
              {form.startDate && form.endDate && new Date(form.endDate) >= new Date(form.startDate) && (
                <div className="px-3 py-2 rounded-lg bg-brand-soft text-[12.5px] font-semibold" style={{ color: "var(--c-brand-soft-fg)" }}>
                  총 <b>{dayDiff(form.startDate, form.endDate)}일</b> · {formatRange(form.startDate, form.endDate)}
                </div>
              )}
              <div>
                <label className="field-label">사유 (선택)</label>
                <textarea
                  className="input"
                  rows={3}
                  maxLength={1000}
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder="비워두어도 신청 가능"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="btn-ghost" onClick={() => setOpen(false)} disabled={saving}>
                  취소
                </button>
                <button className="btn-primary" disabled={saving}>{saving ? "신청 중…" : "신청하기"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const LEAVE_TYPES = [
  { value: "ANNUAL", label: "연차", color: "#3B5CF0" },
  { value: "HALF",   label: "반차", color: "#7C3AED" },
  { value: "SICK",   label: "병가", color: "#DC2626" },
  { value: "TRIP",   label: "외근", color: "#16A34A" },
  { value: "OTHER",  label: "기타", color: "#64748B" },
];

function typeLabel(t: string) {
  return LEAVE_TYPES.find((x) => x.value === t)?.label ?? t;
}

function LeaveTypeDot({ type }: { type: string }) {
  const t = LEAVE_TYPES.find((x) => x.value === type);
  return <span className="w-2 h-2 rounded-full" style={{ background: t?.color ?? "#94A3B8" }} />;
}

function LeaveRow({ l }: { l: Leave }) {
  return (
    <div className="px-3 py-2.5 rounded-xl border border-ink-100 hover:bg-ink-25 transition">
      <div className="flex items-center gap-2">
        <LeaveTypeDot type={l.type} />
        <span className="text-[13px] font-bold text-ink-900">{typeLabel(l.type)}</span>
        <span className="text-[11px] text-ink-500">· {dayDiff(l.startDate, l.endDate)}일</span>
        <span className="ml-auto"><StatusChip status={l.status} /></span>
      </div>
      <div className="text-[11.5px] text-ink-500 mt-1 font-mono">
        {formatRange(l.startDate, l.endDate)}
      </div>
      {l.reason && (
        <div className="text-[12px] text-ink-700 mt-1.5 leading-relaxed line-clamp-2">{l.reason}</div>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  if (status === "APPROVED") return <span className="chip chip-green">승인</span>;
  if (status === "REJECTED") return <span className="chip chip-red">반려</span>;
  if (status === "PENDING") return <span className="chip chip-amber">대기</span>;
  return <span className="chip chip-gray">{status}</span>;
}

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent: "brand" | "success" | "warning" | "violet";
}) {
  const accentStyle = {
    brand: { bg: "var(--c-brand-soft)", fg: "var(--c-brand)" },
    success: { bg: "rgba(22,163,74,0.10)", fg: "var(--c-success)" },
    warning: { bg: "rgba(217,119,6,0.10)", fg: "var(--c-warning)" },
    violet: { bg: "rgba(124,58,237,0.10)", fg: "#7C3AED" },
  }[accent];
  return (
    <div className="panel p-4 flex items-center gap-3">
      <div
        className="w-10 h-10 rounded-xl grid place-items-center flex-shrink-0"
        style={{ background: accentStyle.bg, color: accentStyle.fg }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-bold text-ink-500 uppercase tracking-[0.06em] truncate">{label}</div>
        <div className="text-[19px] font-extrabold text-ink-900 mt-0.5 tracking-tight tabular-nums">{value}</div>
      </div>
    </div>
  );
}

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="px-6 py-14 text-center">
      <div className="w-12 h-12 mx-auto rounded-2xl grid place-items-center mb-3" style={{ background: "var(--c-surface-3)", color: "var(--c-text-3)" }}>
        {icon}
      </div>
      <div className="text-[14px] font-bold text-ink-900">{title}</div>
      <div className="text-[12.5px] text-ink-500 mt-1">{hint}</div>
    </div>
  );
}

// === 유틸 ===
function dowLabel(n: number) {
  return ["일", "월", "화", "수", "목", "금", "토"][n] ?? "";
}
function formatHM(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}
function durationLabel(c: string, o: string) {
  const ms = new Date(o).getTime() - new Date(c).getTime();
  if (ms <= 0) return "-";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}
function msToHM(ms: number) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}
function dayDiff(a: string, b: string) {
  // 양 끝 포함 일수.
  const start = new Date(a + "T00:00:00").getTime();
  const end = new Date(b + "T00:00:00").getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}
function formatRange(a: string, b: string) {
  if (a === b) return a;
  return `${a} ~ ${b}`;
}
