import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, apiSWR, invalidateCache , imgSrc} from "../api";
import { useAuth } from "../auth";
import PageHeader from "../components/PageHeader";
import { alertAsync } from "../components/ConfirmHost";
import { isDevAccount, DevBadge } from "../lib/devBadge";

type MeetingRow = {
  id: string;
  title: string;
  visibility: "ALL" | "PROJECT" | "SPECIFIC";
  projectId: string | null;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string; avatarColor: string; avatarUrl?: string | null };
  project: { id: string; name: string; color: string } | null;
};

type Vis = MeetingRow["visibility"];
type FilterKey = "all" | "mine" | Vis;
type SortKey = "date" | "updated";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "mine", label: "내가 쓴 것" },
  { key: "ALL", label: "전사 공개" },
  { key: "PROJECT", label: "프로젝트" },
  { key: "SPECIFIC", label: "특정 인원" },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "date", label: "회의 날짜" },
  { key: "updated", label: "최근 수정" },
];

/** 회의록 목록 + 새로 만들기. */
export default function MeetingsPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState<MeetingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);

  // 새로고침해도 필터 유지.
  const [sp, setSp] = useSearchParams();
  const FILTER_KEYS = new Set<FilterKey>(FILTERS.map((f) => f.key));
  const visibilityFilter: FilterKey = (FILTER_KEYS.has((sp.get("filter") ?? "") as FilterKey)
    ? (sp.get("filter") as FilterKey)
    : "all");
  const setVisibilityFilter = (f: FilterKey) => {
    const next = new URLSearchParams(sp);
    if (f === "all") next.delete("filter");
    else next.set("filter", f);
    setSp(next, { replace: true });
  };

  // 정렬 — 기본은 회의 날짜(=생성일) 기준. 최근 수정으로도 볼 수 있게 토글.
  const sortKey: SortKey = (sp.get("sort") === "updated" ? "updated" : "date");
  const setSortKey = (s: SortKey) => {
    const next = new URLSearchParams(sp);
    if (s === "date") next.delete("sort");
    else next.set("sort", s);
    setSp(next, { replace: true });
  };

  useEffect(() => {
    let alive = true;
    apiSWR<{ meetings: MeetingRow[] }>("/api/meeting", {
      onCached: (r) => { if (!alive) return; setRows(r.meetings); setLoading(false); },
      onFresh: (r) => { if (!alive) return; setRows(r.meetings); setLoading(false); },
      onError: () => alive && setLoading(false),
    });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    let arr = rows;
    if (visibilityFilter === "mine") arr = arr.filter((m) => m.authorId === user?.id);
    else if (visibilityFilter !== "all") arr = arr.filter((m) => m.visibility === visibilityFilter);
    const k = q.trim().toLowerCase();
    if (k) arr = arr.filter((m) => m.title.toLowerCase().includes(k) || m.author.name.toLowerCase().includes(k));
    // 서버는 updatedAt desc 로 주지만 화면 기준에 맞춰 다시 정렬.
    const field = sortKey === "updated" ? "updatedAt" : "createdAt";
    arr = [...arr].sort((a, b) => new Date(b[field]).getTime() - new Date(a[field]).getTime());
    return arr;
  }, [rows, q, visibilityFilter, user?.id, sortKey]);

  // 통계 — 상단 카드용. 무거운 계산 아님.
  const stats = useMemo(() => {
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    return {
      total: rows.length,
      mine: rows.filter((m) => m.authorId === user?.id).length,
      thisWeek: rows.filter((m) => now - new Date(m.updatedAt).getTime() < weekMs).length,
    };
  }, [rows, user?.id]);

  async function createNew() {
    if (creating) return;
    setCreating(true);
    try {
      const r = await api<{ meeting: { id: string } }>("/api/meeting", {
        method: "POST",
        json: {
          title: "제목 없는 회의록",
          content: { type: "doc", content: [{ type: "paragraph" }] },
          visibility: "ALL",
        },
      });
      invalidateCache("/api/meeting");
      nav(`/meetings/${r.meeting.id}?edit=1`);
    } catch (e: any) {
      alertAsync({ title: "생성 실패", description: e?.message ?? "회의록 생성 실패" });
    } finally {
      setCreating(false);
    }
  }

  // 같은 날짜끼리 시각적으로 묶으면 시간 흐름이 잘 잡힘. 그룹 기준도 정렬 기준에 맞춤.
  const grouped = useMemo(() => {
    const map = new Map<string, MeetingRow[]>();
    for (const m of filtered) {
      const iso = sortKey === "updated" ? m.updatedAt : m.createdAt;
      const k = dateGroupKey(iso);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
    return Array.from(map.entries());
  }, [filtered, sortKey]);

  return (
    <div>
      <PageHeader
        title="회의록"
        description="노션처럼 서식을 넣어 작성하고, 공개 범위를 세밀하게 지정하세요."
        right={
          <button className="btn-primary btn-lg" onClick={createNew} disabled={creating}>
            {creating ? "생성 중…" : "+ 새 회의록"}
          </button>
        }
      />

      {/* 통계 카드 — 페이지 진입 시 빠른 컨텍스트 제공. */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <StatCard
          label="전체 회의록"
          value={stats.total}
          accent="brand"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6M8 13h8M8 17h5" />
            </svg>
          }
        />
        <StatCard
          label="내가 쓴 것"
          value={stats.mine}
          accent="violet"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4h2v16h-2zM5 8h2v12H5zM17 8h2v12h-2z" />
            </svg>
          }
        />
        <StatCard
          label="이번 주 업데이트"
          value={stats.thisWeek}
          accent="success"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v6M12 22v-6M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M2 12h6M22 12h-6M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24" />
            </svg>
          }
        />
      </div>

      {/* 검색 + 필터 칩 */}
      <div className="panel p-4 mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <input
              className="input !pl-9"
              placeholder="제목·작성자로 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={80}
            />
            <svg
              width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
              style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--c-text-3)" }}
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mt-3">
          {FILTERS.map((f) => {
            const active = visibilityFilter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setVisibilityFilter(f.key)}
                className="text-[12px] font-bold px-3 py-1.5 rounded-full transition"
                style={{
                  background: active ? "var(--c-brand)" : "var(--c-surface-3)",
                  color: active ? "#fff" : "var(--c-text-2)",
                  border: active ? "1px solid var(--c-brand)" : "1px solid transparent",
                }}
              >
                {f.label}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[11px] text-ink-500 mr-1">
              {loading ? "불러오는 중…" : `${filtered.length}개`}
            </span>
            <div
              className="inline-flex items-center rounded-full p-0.5"
              style={{ background: "var(--c-surface-3)" }}
            >
              {SORTS.map((s) => {
                const active = sortKey === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSortKey(s.key)}
                    className="text-[11.5px] font-bold px-2.5 py-1 rounded-full transition"
                    style={{
                      background: active ? "var(--c-surface-1)" : "transparent",
                      color: active ? "var(--c-text-1)" : "var(--c-text-3)",
                      boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                    }}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 본문 */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState onCreate={createNew} hasFilter={q !== "" || visibilityFilter !== "all"} />
      ) : (
        <div className="space-y-5">
          {grouped.map(([day, items]) => (
            <div key={day}>
              <div className="text-[11px] font-extrabold tracking-[0.06em] uppercase text-ink-500 mb-2 px-1">
                {day}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {items.map((m) => (
                  <MeetingCard key={m.id} m={m} sortKey={sortKey} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MeetingCard({ m, sortKey }: { m: MeetingRow; sortKey: SortKey }) {
  const projectColor = m.project?.color ?? "#94A3B8";
  const timeIso = sortKey === "updated" ? m.updatedAt : m.createdAt;
  const timeLabel = sortKey === "updated" ? "수정" : "작성";
  return (
    <Link
      to={`/meetings/${m.id}`}
      className="panel p-0 overflow-hidden hover:!border-brand-300 transition group block"
    >
      {/* 좌측 색띠 — 프로젝트 색 / 없으면 회색 */}
      <div className="flex">
        <div className="w-1.5 flex-shrink-0" style={{ background: projectColor }} aria-hidden />
        <div className="flex-1 p-4 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="text-[15px] font-extrabold text-ink-900 line-clamp-2 leading-snug group-hover:text-brand-600 transition">
              {m.title || "제목 없음"}
            </div>
            <VisibilityBadge v={m.visibility} />
          </div>
          <div className="flex items-end justify-between gap-2 mt-3">
            <div className="flex items-center gap-2 text-[11.5px] text-ink-500 flex-wrap min-w-0">
              <AuthorChip author={m.author} />
              <span className="text-ink-300">·</span>
              <span title={`${timeLabel}: ${new Date(timeIso).toLocaleString("ko-KR")}`}>
                {formatRelative(timeIso)}
              </span>
              {m.project && (
                <>
                  <span className="text-ink-300">·</span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.project.color }} />
                    {m.project.name}
                  </span>
                </>
              )}
            </div>
            {/* 우측 하단 — 마지막 수정 시간. 본문 내 시간 라벨이 \"작성\"일 땐 보완 정보, \"수정\"일 땐 같은 값이라 굳이 강조하지 않도록 톤다운. */}
            <span
              className="text-[10.5px] text-ink-400 flex-shrink-0 tabular-nums"
              title={`마지막 수정: ${new Date(m.updatedAt).toLocaleString("ko-KR")}`}
            >
              수정 {formatExactDateTime(m.updatedAt)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function AuthorChip({ author }: { author: MeetingRow["author"] }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="w-5 h-5 rounded-full grid place-items-center text-white text-[10px] font-bold flex-shrink-0 overflow-hidden"
        style={{ background: author.avatarUrl ? "transparent" : author.avatarColor }}
      >
        {author.avatarUrl ? (
          <img src={imgSrc(author.avatarUrl)} alt={author.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
        ) : (
          (author.name[0] ?? "?")
        )}
      </span>
      <span className="font-semibold text-ink-700">{author.name}</span>
      {isDevAccount(author) && <DevBadge iconOnly />}
    </span>
  );
}

function VisibilityBadge({ v }: { v: Vis }) {
  // 라이트/다크 양쪽에서 자연스러운 톤 — 기존 chip 클래스 재사용해 테마 통일.
  if (v === "ALL") {
    return (
      <span className="chip chip-green !text-[10px] !py-0.5 !px-2 inline-flex items-center gap-1 flex-shrink-0">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        전사
      </span>
    );
  }
  if (v === "PROJECT") {
    return (
      <span className="chip chip-blue !text-[10px] !py-0.5 !px-2 inline-flex items-center gap-1 flex-shrink-0">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        프로젝트
      </span>
    );
  }
  return (
    <span className="chip chip-amber !text-[10px] !py-0.5 !px-2 inline-flex items-center gap-1 flex-shrink-0">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      </svg>
      특정 인원
    </span>
  );
}

function StatCard({
  label, value, icon, accent,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent: "brand" | "success" | "violet";
}) {
  const a = {
    brand: { bg: "var(--c-brand-soft)", fg: "var(--c-brand)" },
    success: { bg: "rgba(22,163,74,0.10)", fg: "var(--c-success)" },
    violet: { bg: "rgba(124,58,237,0.10)", fg: "#7C3AED" },
  }[accent];
  return (
    <div className="panel p-3 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center gap-1.5 sm:gap-3">
      <div
        className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl grid place-items-center flex-shrink-0"
        style={{ background: a.bg, color: a.fg }}
      >
        {icon}
      </div>
      <div className="min-w-0 w-full">
        <div className="text-[10.5px] sm:text-[11px] font-bold text-ink-500 uppercase tracking-[0.04em] leading-tight">{label}</div>
        <div className="text-[18px] sm:text-[19px] font-extrabold text-ink-900 mt-0.5 tabular-nums">{value}</div>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="panel p-4 animate-pulse">
      <div className="h-4 rounded w-2/3 mb-3" style={{ background: "var(--c-surface-3)" }} />
      <div className="h-3 rounded w-1/3" style={{ background: "var(--c-surface-3)" }} />
    </div>
  );
}

function EmptyState({ onCreate, hasFilter }: { onCreate: () => void; hasFilter: boolean }) {
  return (
    <div className="panel p-12 text-center">
      <div
        className="w-14 h-14 mx-auto rounded-2xl grid place-items-center mb-3"
        style={{ background: "var(--c-brand-soft)", color: "var(--c-brand)" }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M8 13h8M8 17h5" />
        </svg>
      </div>
      <div className="text-[15px] font-extrabold text-ink-900">
        {hasFilter ? "조건에 맞는 회의록이 없어요" : "첫 회의록을 만들어 볼까요"}
      </div>
      <div className="text-[12.5px] text-ink-500 mt-1.5 leading-relaxed">
        {hasFilter
          ? "검색어를 바꾸거나 다른 필터를 시도해 보세요."
          : "오늘 회의 안건과 결정 사항을 정리해 두면 다음 회의가 가벼워져요."}
      </div>
      {!hasFilter && (
        <button className="btn-primary mt-5" onClick={onCreate}>+ 새 회의록 만들기</button>
      )}
    </div>
  );
}

function dateGroupKey(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const t = startOfDay(today);
  const dt = startOfDay(d);
  const diffDays = Math.round((t - dt) / 86400000);
  if (diffDays === 0) return "오늘";
  if (diffDays === 1) return "어제";
  if (diffDays < 7) return `${diffDays}일 전`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}주 전`;
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long" });
}

/** 정확한 날짜+시간 — 우측 하단 \"수정\" 라벨용. 같은 해면 연도 생략. */
function formatExactDateTime(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const datePart = d.toLocaleDateString("ko-KR", sameYear
    ? { month: "numeric", day: "numeric" }
    : { year: "numeric", month: "numeric", day: "numeric" });
  const timePart = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${datePart} ${timePart}`;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "방금";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}시간 전`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)}일 전`;
  return d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}
