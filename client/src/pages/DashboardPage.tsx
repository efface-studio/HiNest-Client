import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api , imgSrc} from "../api";
import { useAuth } from "../auth";
import InstallAppBanner from "../components/InstallAppBanner";
import { alertAsync } from "../components/ConfirmHost";
import { isDevAccount, DevBadge } from "../lib/devBadge";
import { isPreviewMode } from "../lib/previewMock";
import { Skeleton } from "../components/Skeleton";

type Notice = { id: string; title: string; content: string; createdAt: string; author: { name: string; isDeveloper?: boolean }; pinned: boolean };
type Event = { id: string; title: string; startAt: string; endAt: string; scope: string; color: string };
type WorkSession = { s: string; e: string | null; src?: string };
type Attendance = { checkIn?: string; checkOut?: string; sessions?: WorkSession[] | null } | null;

/**
 * 개요 — Toss 디자인 톤.
 * 핵심 원칙:
 *  - 그라데이션 X. 단색 surface 위에 큰 숫자 + 작은 라벨로 위계.
 *  - 강조색은 한 가지(브랜드 블루) — 진행률·primary 버튼·아이콘 배경에만.
 *  - 카드는 둥근 모서리 + 부드러운 그림자, 행간/여백 넉넉히.
 *  - 액션은 항상 카드 우측 또는 하단에 정렬, 시각적 무게 가벼운 ghost 또는 단색.
 */
export default function DashboardPage() {
  const { user } = useAuth();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [att, setAtt] = useState<Attendance>(null);
  const [now, setNow] = useState(new Date());
  // 첫 로드 완료 여부 — false 동안 빈 영역 대신 Skeleton 을 띄워 깜빡임 제거.
  // 새로고침(load 재호출) 시엔 기존 데이터 유지하면서 백그라운드로 갱신.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const aliveRef = useRef(true);
  const loadTokenRef = useRef(0);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  async function load() {
    const myToken = ++loadTokenRef.current;
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7).toISOString();
    const [n, s, a] = await Promise.all([
      api<{ notices: Notice[] }>("/api/notice"),
      api<{ events: Event[] }>(`/api/schedule?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
      api<{ attendance: Attendance }>("/api/attendance/today"),
    ]);
    if (!aliveRef.current || myToken !== loadTokenRef.current) return;
    setNotices(n.notices.slice(0, 5));
    setEvents(s.events.slice(0, 6));
    setAtt(a.attendance);
    setLoaded(true);
  }
  useEffect(() => { load(); }, []);

  async function checkIn() {
    // 다중 세션 — "다시 출근" 은 이전 기록을 보존하고 새 세션을 추가하므로 강제확인 불필요.
    try {
      await api("/api/attendance/check-in", { method: "POST" });
    } catch (err: any) {
      const title = err?.code === "IP_NOT_ALLOWED" ? "출근 불가" : "출근 실패";
      alertAsync({ title, description: err?.message ?? "출근 처리에 실패했어요" });
      return;
    }
    load();
  }
  async function checkOut() {
    try {
      await api("/api/attendance/check-out", { method: "POST" });
    } catch (err: any) {
      alertAsync({ title: "퇴근 실패", description: err?.message ?? "퇴근 처리에 실패했어요" });
      return;
    }
    load();
  }

  const dateLabel = now.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" });
  // 다중 세션 — sessions 가 있으면 그대로, 없으면 checkIn/checkOut 단일 세션(하위호환).
  const sessions: WorkSession[] = Array.isArray(att?.sessions)
    ? att!.sessions!
    : att?.checkIn ? [{ s: att.checkIn, e: att.checkOut ?? null }] : [];
  const working = sessions.some((s) => !s.e); // 열린 세션 = 근무 중
  const status: WorkStatus = working ? "IN" : sessions.length > 0 ? "OFF" : "NONE";
  // 근무시간 = 모든 세션 합산(열린 세션은 now 까지). "다시 출근" 해도 누적된다.
  const workedMin = sessions.reduce((acc, s) => {
    const start = new Date(s.s).getTime();
    const end = s.e ? new Date(s.e).getTime() : now.getTime();
    return acc + (end > start ? Math.floor((end - start) / 60000) : 0);
  }, 0);
  // 관리자 설정 기반 근무 시각 — 미설정 시 09:00/18:00 fallback.
  const startMin = parseHHmm(user?.workStartTime ?? "") ?? 9 * 60;
  const endMin = parseHHmm(user?.workEndTime ?? "") ?? 18 * 60;
  // 실제 출근시간 반영 — 등록 출근시각(예: 9시)보다 일찍 출근(수동·IP자동)했다면, 그 날만
  // 위젯 시작을 '실제 첫 출근시각'으로 한다(퍼센트도 그 기준). 늦게 출근은 등록 시각 유지.
  const firstInMin = sessions.length
    ? (() => { const d = new Date(sessions[0].s); return d.getHours() * 60 + d.getMinutes(); })()
    : null;
  const effStartMin = firstInMin != null && firstInMin < startMin ? firstInMin : startMin;
  const startLabel = formatHHmm(effStartMin);
  const endLabel = formatHHmm(endMin);
  const dayProgress = useMemo(() => {
    if (endMin <= effStartMin) return 0; // 잘못된 설정은 0%
    // 데모(미리보기)는 방문 시각이 새벽일 수도 있어 절대시각 기준이면 0% 가 떠 자연스럽지 못함.
    // 출근 후 경과 시간(workedMin) 을 근무 총 시간으로 나눠 '근무한 비율' 로 보여준다.
    if (isPreviewMode() && att?.checkIn) {
      return Math.max(0, Math.min(1, workedMin / (endMin - effStartMin)));
    }
    const m = now.getHours() * 60 + now.getMinutes();
    return Math.max(0, Math.min(1, (m - effStartMin) / (endMin - effStartMin)));
  }, [now, effStartMin, endMin, workedMin, att?.checkIn]);

  return (
    <div className="space-y-4">
      <InstallAppBanner />

      {/* 인사 카드 — 흰 패널, 큰 인사 + 작은 부제 */}
      <TossCard className="px-6 py-7 sm:px-8 sm:py-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[12.5px] font-bold text-ink-500 mb-1.5">{dateLabel}</div>
            <h1 className="text-[26px] sm:text-[28px] font-extrabold text-ink-900 tracking-tight flex items-center gap-2 flex-wrap">
              <span>{user?.name ?? ""}님,</span>
              <span className="text-ink-500 font-bold">{greetingFor(now)}</span>
              {isDevAccount(user) && <DevBadge size="sm" />}
            </h1>
          </div>
          <StatusPill status={status} />
        </div>
      </TossCard>

      {/* 오늘의 근무 — Toss 메인 카드 패턴: 큰 값 + 진행률 + 우측 액션 */}
      <TossCard className="px-6 py-6 sm:px-8 sm:py-7">
        <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
          <div>
            <div className="text-[13px] font-bold text-ink-500 mb-1">오늘 근무</div>
            <div className="flex items-baseline gap-1">
              <span className="text-[36px] sm:text-[40px] font-extrabold text-ink-900 tabular-nums" style={{ letterSpacing: "-0.03em" }}>
                {sessions.length ? formatHours(workedMin) : "0"}
              </span>
              <span className="text-[16px] font-bold text-ink-500">시간 {sessions.length ? formatMinutesPart(workedMin) : "0"}분</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={checkIn}
              disabled={working}
              className="px-5 py-2.5 rounded-xl text-[13.5px] font-extrabold transition disabled:opacity-40"
              style={{ background: "var(--c-brand)", color: "#fff" }}
            >
              {working ? "출근됨" : sessions.length ? "다시 출근" : "출근하기"}
            </button>
            <button
              type="button"
              onClick={checkOut}
              disabled={!working}
              className="px-5 py-2.5 rounded-xl text-[13.5px] font-extrabold transition disabled:opacity-40"
              style={{ background: "var(--c-surface-3)", color: "var(--c-text-1)" }}
            >
              퇴근하기
            </button>
          </div>
        </div>

        {/* 진행률 바 — 09~18 */}
        <div>
          <div className="relative h-2 rounded-full overflow-hidden" style={{ background: "var(--c-surface-3)" }}>
            <div
              className="absolute top-0 left-0 h-full rounded-full transition-[width] duration-500"
              style={{ width: `${dayProgress * 100}%`, background: "var(--c-brand)" }}
            />
          </div>
          <div className="flex items-center justify-between mt-2.5 text-[11.5px] font-bold text-ink-500 tabular-nums">
            <span>{startLabel}</span>
            <span className="text-ink-700">{Math.round(dayProgress * 100)}%</span>
            <span>{endLabel}</span>
          </div>
        </div>

        {/* 출근/퇴근 시각 — 카드 하단 부드러운 분리선 */}
        <div className="grid grid-cols-2 gap-4 mt-5 pt-5 border-t" style={{ borderColor: "var(--c-border)" }}>
          <KV label="출근 시각" value={timeOf(att?.checkIn ?? null)} />
          <KV label="퇴근 시각" value={timeOf(att?.checkOut ?? null)} />
        </div>
      </TossCard>

      {/* 빠른 메뉴 — 6 grid, soft tint icon + 라벨 */}
      <TossCard className="p-3">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
          <QuickItem to="/schedule" label="일정" tint="#3182F6" Icon={IconCalendar} />
          <QuickItem to="/journal" label="업무일지" tint="#16A34A" Icon={IconJournal} />
          <QuickItem to="/meetings" label="회의록" tint="#7C3AED" Icon={IconNote} />
          <QuickItem to="/approvals" label="결재" tint="#F59E0B" Icon={IconCheck} />
          <QuickItem to="/expense" label="지출" tint="#DB2777" Icon={IconCard} />
          <QuickItem to="/directory" label="팀원" tint="#0EA5E9" Icon={IconUsers} />
        </div>
      </TossCard>

      {/* 본문 2열 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <ScheduleCard events={events} loaded={loaded} />
          <NoticeCard notices={notices} loaded={loaded} />
        </div>
        <div className="space-y-4">
          <ProfileCard
            name={user?.name ?? ""}
            email={user?.email}
            team={user?.team ?? null}
            position={user?.position ?? null}
            role={user?.role ?? ""}
            avatarUrl={user?.avatarUrl ?? null}
            avatarColor={user?.avatarColor}
            isDeveloper={isDevAccount(user)}
          />
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 *  TossCard — 모든 카드의 베이스. 부드러운 그림자 + 둥근 모서리.
 * ============================================================ */
function TossCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl ${className ?? ""}`}
      style={{
        background: "var(--c-surface-1)",
        boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.04)",
        border: "1px solid var(--c-border)",
      }}
    >
      {children}
    </div>
  );
}

/* ============================================================
 *  StatusPill — 색칠된 알약. Toss 의 상태 칩 패턴.
 * ============================================================ */
type WorkStatus = "IN" | "OFF" | "NONE";
function StatusPill({ status }: { status: WorkStatus }) {
  const cfg = status === "IN"
    ? { bg: "rgba(22,163,74,0.10)", fg: "var(--c-success)", dot: "var(--c-success)", label: "근무 중" }
    : status === "OFF"
      ? { bg: "var(--c-surface-3)", fg: "var(--c-text-3)", dot: "var(--c-text-3)", label: "퇴근 완료" }
      : { bg: "rgba(245,158,11,0.10)", fg: "#D97706", dot: "#F59E0B", label: "출근 전" };
  return (
    <span
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-extrabold"
      style={{ background: cfg.bg, color: cfg.fg }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

/* ============================================================
 *  Quick item
 * ============================================================ */
function QuickItem({ to, label, tint, Icon }: { to: string; label: string; tint: string; Icon: React.ComponentType<{ color: string }> }) {
  return (
    <Link
      to={to}
      className="flex flex-col items-center justify-center gap-2 py-3 rounded-xl hover:bg-[color:var(--c-surface-3)] transition"
    >
      <span
        className="w-10 h-10 rounded-xl grid place-items-center"
        style={{ background: tint + "1A" }}
      >
        <Icon color={tint} />
      </span>
      <span className="text-[12px] font-bold text-ink-900">{label}</span>
    </Link>
  );
}

/* ============================================================
 *  ScheduleCard
 * ============================================================ */
function ScheduleCard({ events, loaded = true }: { events: Event[]; loaded?: boolean }) {
  const grouped = useMemo(() => groupByDay(events), [events]);
  return (
    <TossCard className="px-5 sm:px-6 py-5">
      <CardHeader title="이번 주 일정" count={events.length} href="/schedule" />
      {!loaded && events.length === 0 ? (
        // 첫 로드 동안 EmptyState 대신 Skeleton — '없어요'가 잠깐 떴다 사라지는 깜빡임 제거
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <Skeleton w={4} h={32} radius={4} />
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <Skeleton w="70%" h={14} />
                <Skeleton w="40%" h={10} />
              </div>
              <Skeleton w={42} h={20} radius={999} />
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <Empty>등록된 일정이 없어요</Empty>
      ) : (
        <div className="mt-1">
          {grouped.map(([day, items]) => (
            <div key={day} className="mt-3 first:mt-2">
              <div className="text-[10.5px] font-extrabold tracking-[0.06em] uppercase text-ink-500 mb-1">{day}</div>
              <ul className="space-y-1">
                {items.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 py-2">
                    <span className="w-1 h-8 rounded-full flex-shrink-0" style={{ background: e.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-extrabold text-ink-900 truncate">{e.title}</div>
                      <div className="text-[11px] text-ink-500 mt-0.5 tabular-nums font-mono">
                        {timeOf(e.startAt)} – {timeOf(e.endAt)}
                      </div>
                    </div>
                    <ScopeChip scope={e.scope} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </TossCard>
  );
}

/* ============================================================
 *  NoticeCard
 * ============================================================ */
function NoticeCard({ notices, loaded = true }: { notices: Notice[]; loaded?: boolean }) {
  return (
    <TossCard className="px-5 sm:px-6 py-5">
      <CardHeader title="공지" count={notices.length} href="/notice" />
      {!loaded && notices.length === 0 ? (
        // 첫 로드 동안 Skeleton — 깜빡임 제거
        <div className="mt-3 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5 py-2">
              <Skeleton w="70%" h={14} />
              <Skeleton w="40%" h={10} />
            </div>
          ))}
        </div>
      ) : notices.length === 0 ? (
        <Empty>아직 공지가 없어요</Empty>
      ) : (
        <ul className="mt-1 divide-y divide-[color:var(--c-border)]">
          {notices.map((n) => (
            <li key={n.id}>
              <Link to={`/notice?id=${n.id}`} className="block py-3 hover:opacity-80 transition">
                <div className="flex items-center gap-1.5 mb-0.5">
                  {n.pinned && (
                    <span className="inline-block px-1.5 py-0.5 rounded text-[9.5px] font-extrabold" style={{ background: "rgba(220,38,38,0.10)", color: "var(--c-danger)" }}>PIN</span>
                  )}
                  <div className="text-[13.5px] font-extrabold text-ink-900 truncate">{n.title}</div>
                </div>
                <div className="text-[11px] text-ink-500 flex items-center gap-1.5 flex-wrap">
                  <span>{n.author?.name}</span>
                  {isDevAccount(n.author) && <DevBadge size="sm" />}
                  <span className="text-ink-300">·</span>
                  <span className="tabular-nums">{relTime(n.createdAt)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </TossCard>
  );
}

/* ============================================================
 *  ProfileCard — Toss 프로필 카드 톤
 * ============================================================ */
function ProfileCard(p: { name: string; email?: string; team: string | null; position: string | null; role: string; avatarUrl: string | null; avatarColor?: string; isDeveloper: boolean }) {
  const initial = (p.name?.[0] ?? "?").toUpperCase();
  return (
    <TossCard className="px-5 sm:px-6 py-5">
      <div className="flex items-center gap-3">
        <div
          className="w-12 h-12 rounded-2xl grid place-items-center text-white text-[18px] font-extrabold overflow-hidden flex-shrink-0"
          style={{ background: p.avatarUrl ? "transparent" : (p.avatarColor ?? "#3D54C4") }}
        >
          {p.avatarUrl ? <img src={imgSrc(p.avatarUrl)} alt={p.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/> : initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[15px] font-extrabold text-ink-900 truncate">{p.name}</span>
            {p.isDeveloper && <DevBadge size="sm" />}
          </div>
          <div className="text-[12px] text-ink-500 truncate">{p.email}</div>
        </div>
      </div>
      <dl className="mt-4 pt-4 border-t" style={{ borderColor: "var(--c-border)" }}>
        <Row label="직급" value={p.position ?? "—"} />
        <Row label="팀" value={p.team ?? "—"} />
        <Row label="권한" value={p.role} mono />
      </dl>
    </TossCard>
  );
}

/* ============================================================
 *  building blocks
 * ============================================================ */
function CardHeader({ title, count, href }: { title: string; count?: number; href?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-[15px] font-extrabold text-ink-900">
        {title}
        {typeof count === "number" && <span className="ml-1.5 text-[12px] font-bold text-ink-400 tabular-nums">{count}</span>}
      </h2>
      {href && <Link to={href} className="text-[12px] font-bold text-ink-500 hover:text-ink-800">전체 →</Link>}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-ink-500 mb-1">{label}</div>
      <div className="text-[18px] font-extrabold text-ink-900 tabular-nums" style={{ letterSpacing: "-0.02em" }}>{value}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 gap-3">
      <dt className="text-[12px] font-bold text-ink-500">{label}</dt>
      <dd className={`text-[13px] font-bold text-ink-900 truncate text-right ${mono ? "font-mono tracking-tight" : ""}`}>{value}</dd>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-center text-[12.5px] text-ink-500">{children}</div>;
}

function ScopeChip({ scope }: { scope: string }) {
  const label = scope === "COMPANY" ? "전사" : scope === "TEAM" ? "팀" : "개인";
  const tint = scope === "COMPANY" ? "var(--c-brand)" : scope === "TEAM" ? "#0EA5E9" : "var(--c-text-3)";
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-extrabold flex-shrink-0" style={{ background: "var(--c-surface-3)", color: tint }}>
      {label}
    </span>
  );
}

/* ===== utils ===== */
function timeOf(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "방금";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}시간 전`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}
function formatHours(min: number): string { return String(Math.floor(min / 60)); }
function formatMinutesPart(min: number): string { return String(min % 60).padStart(2, "0"); }
function parseHHmm(s: string): number | null {
  const m = s?.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? +m[1] * 60 + +m[2] : null;
}
function formatHHmm(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 6) return "오늘도 고생이 많으세요";
  if (h < 11) return "좋은 아침이에요";
  if (h < 14) return "점심은 드셨나요";
  if (h < 18) return "오후도 화이팅이에요";
  if (h < 22) return "오늘도 수고하셨어요";
  return "푹 쉬세요";
}
function groupByDay(events: Event[]): [string, Event[]][] {
  const map = new Map<string, Event[]>();
  for (const e of events) {
    const k = new Date(e.startAt).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(e);
  }
  return Array.from(map.entries());
}

/* ===== icons ===== */
function IconCalendar({ color }: { color: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2.5" /><path d="M3 10h18M8 2v4M16 2v4" /></svg>;
}
function IconJournal({ color }: { color: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" /><path d="M8 9h8M8 13h8M8 17h5" /></svg>;
}
function IconNote({ color }: { color: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></svg>;
}
function IconCheck({ color }: { color: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>;
}
function IconCard({ color }: { color: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2.5" /><path d="M2 10h20" /></svg>;
}
function IconUsers({ color }: { color: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
}
