import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { api, apiSWR, invalidateCache, imgSrc } from "../api";
import { useAuth } from "../auth";
import PageHeader from "../components/PageHeader";
import { Skeleton } from "../components/Skeleton";
import { resolvePresence, type PresenceStatus, type WorkStatus } from "../lib/presence";
import { alertAsync } from "../components/ConfirmHost";
import { isDevAccount, DevBadge } from "../lib/devBadge";
import { Link } from "react-router-dom";

type DirectoryUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  team?: string | null;
  position?: string | null;
  avatarColor?: string;
  avatarUrl?: string | null;
  presenceStatus?: PresenceStatus | null;
  presenceMessage?: string | null;
  workStatus?: WorkStatus;
};

type ViewMode = "grid" | "list";

export default function DirectoryPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [q, setQ] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [view, setView] = useState<ViewMode>("grid");
  // DM 버튼 연타 방지 — OrgChartPage 와 동일한 이유.
  const [dmBusyId, setDmBusyId] = useState<string | null>(null);
  // 복사 버튼 피드백 — 클릭 후 1.2초 간 "복사됨" 표시.
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // 첫 로드 완료 여부 — Skeleton↔실데이터 전환 분기. (apiSWR 라 loading 플래그가 없음)
  const [loaded, setLoaded] = useState(false);
  // 데스크탑 새로고침 버튼 진행 표시.
  const [refreshing, setRefreshing] = useState(false);
  // 대량 인원 + 그룹핑 필터가 IME 입력을 지연시키지 않도록 deferred.
  const deferredQ = useDeferredValue(q);

  // SWR — 팀원 목록은 변동이 느리므로 캐시 히트 효과가 크다.
  // 데스크탑 새로고침에서도 재사용하도록 콜백으로 추출. alive 가드는 호출부에서 주입.
  const loadUsers = useCallback((isAlive: () => boolean) => {
    return apiSWR<{ users: DirectoryUser[] }>("/api/users", {
      onCached: (d) => { if (isAlive()) { setUsers(d.users); setLoaded(true); } },
      onFresh: (d) => { if (isAlive()) { setUsers(d.users); setLoaded(true); } },
    });
  }, []);

  useEffect(() => {
    // 다른 SWR 페이지들과 동일한 alive 가드 — 언마운트 후 setState 방지.
    let alive = true;
    loadUsers(() => alive);
    return () => { alive = false; };
  }, [loadUsers]);

  // 데스크탑 새로고침 — 캐시 무효화 후 fresh 재요청. 모바일은 PTR 이 전역으로 담당.
  async function refresh() {
    setRefreshing(true);
    try {
      invalidateCache("/api/users");
      await loadUsers(() => true);
    } finally {
      setRefreshing(false);
    }
  }

  const teams = useMemo(
    () => Array.from(new Set(users.map((u) => u.team).filter(Boolean))) as string[],
    [users]
  );

  const filtered = useMemo(() => {
    let arr = users;
    if (teamFilter) arr = arr.filter((u) => u.team === teamFilter);
    const k = deferredQ.trim().toLowerCase();
    if (k) {
      arr = arr.filter((u) =>
        u.name.toLowerCase().includes(k) ||
        u.email.toLowerCase().includes(k) ||
        (u.team ?? "").toLowerCase().includes(k) ||
        (u.position ?? "").toLowerCase().includes(k)
      );
    }
    return arr;
  }, [users, deferredQ, teamFilter]);

  const others = useMemo(() => filtered.filter((u) => u.id !== user?.id), [filtered, user?.id]);

  const grouped = useMemo(() => {
    const map = new Map<string, DirectoryUser[]>();
    for (const u of others) {
      const k = u.team ?? "소속 없음";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(u);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, "ko"));
  }, [others]);

  async function startDM(target: DirectoryUser) {
    if (target.id === user?.id) return;
    if (dmBusyId) return;
    setDmBusyId(target.id);
    try {
      // /chat 페이지를 없앴기 때문에 DM 시작은 우하단 사내톡 팝업을 띄우고
      // 해당 방으로 이동시킨다. ChatFab 이 chat:open-room 이벤트를 구독 중.
      const res = await api<{ room: { id: string } }>("/api/chat/rooms", {
        method: "POST",
        json: { type: "DIRECT", memberIds: [target.id] },
      });
      window.dispatchEvent(new CustomEvent("chat:open"));
      window.dispatchEvent(new CustomEvent("chat:open-room", { detail: { roomId: res.room.id } }));
    } catch (err: any) {
      alertAsync({ title: "대화 시작 실패", description: err?.message ?? "대화 시작에 실패했어요" });
    } finally {
      setDmBusyId(null);
    }
  }

  function copyEmail(target: DirectoryUser) {
    // navigator.clipboard 는 http(s) + secure context 에서만 동작. 구식 브라우저 대비 optional chaining.
    navigator.clipboard?.writeText(target.email).catch(() => {});
    setCopiedId(target.id);
    // 1.2초 뒤 해제 — 클립보드 API 가 실패해도 피드백은 일관되게.
    setTimeout(() => setCopiedId((curr) => (curr === target.id ? null : curr)), 1_200);
  }

  const me = useMemo(() => users.find((u) => u.id === user?.id), [users, user?.id]);

  return (
    <div>
      <PageHeader
        eyebrow="커뮤니케이션"
        title="팀원"
        description="사내 구성원을 조회하고 바로 1:1 대화를 시작할 수 있어요."
        onRefresh={refresh}
        refreshing={refreshing}
      />

      {/* My profile hero */}
      {me && <MyProfileHero me={me} totalCount={users.length} teamCount={teams.length} />}

      {/* Toolbar */}
      <div className="mt-6 mb-4 space-y-2">
        <div className="relative w-full max-w-md">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8E959E" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className="absolute left-3.5 top-1/2 -translate-y-1/2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            className="input pl-9"
            placeholder="이름·이메일·팀·직급으로 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={80}
          />
        </div>

        <div className="flex items-center gap-2">
          {/* 팀 필터 — 좌측 정렬, 넘치면 가로 스크롤 */}
          <div className="flex-1 min-w-0 overflow-x-auto -mx-1 px-1">
            <div className="tabs inline-flex">
              <button
                className={`tab ${teamFilter === "" ? "tab-active" : ""}`}
                onClick={() => setTeamFilter("")}
              >
                전체 <span className="ml-1 tabular text-ink-500">{others.length}</span>
              </button>
              {teams.map((t) => (
                <button key={t} className={`tab ${teamFilter === t ? "tab-active" : ""}`} onClick={() => setTeamFilter(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          {/* 보기 전환 — 우측 정렬 고정 */}
          <div className="tabs flex-shrink-0">
            <button className={`tab ${view === "grid" ? "tab-active" : ""}`} onClick={() => setView("grid")} title="그리드">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
            </button>
            <button className={`tab ${view === "list" ? "tab-active" : ""}`} onClick={() => setView("list")} title="리스트">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {!loaded && grouped.length === 0 ? (
        // 첫 로드 중(캐시 미스) — 그리드 카드 형태의 Skeleton. 아바타 원 + 이름·부서 줄.
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="panel p-4">
              <div className="flex items-center gap-3 mb-3">
                <Skeleton circle w={48} h={48} />
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  <Skeleton w="60%" h={14} />
                  <Skeleton w="40%" h={11} />
                </div>
              </div>
              <Skeleton w="80%" h={11} />
              <div className="mt-3">
                <Skeleton w="100%" h={28} radius={8} />
              </div>
            </div>
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <div className="panel py-20 text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-ink-100 grid place-items-center mb-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8E959E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
            </svg>
          </div>
          <div className="text-[13px] font-bold text-ink-800">팀원이 없어요</div>
          <div className="text-[12px] text-ink-500 mt-1">검색 조건을 바꾸거나 관리자 페이지에서 초대키를 발급해보세요.</div>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([teamName, members]) => (
            <section key={teamName}>
              <div className="flex items-baseline gap-2 mb-3">
                <h2 className="text-[13px] font-extrabold text-ink-900 tracking-tight">{teamName}</h2>
                <span className="text-[12px] text-ink-500 tabular">{members.length}명</span>
                <div className="flex-1 h-px bg-ink-150 ml-2" />
              </div>
              {view === "grid" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {members.map((u) => (
                    <GridCard
                      key={u.id}
                      u={u}
                      onDM={() => startDM(u)}
                      dmBusy={dmBusyId === u.id}
                      onCopyEmail={() => copyEmail(u)}
                      copied={copiedId === u.id}
                    />
                  ))}
                </div>
              ) : (
                <div className="panel p-0 overflow-hidden">
                  {members.map((u, i) => (
                    <ListRow key={u.id} u={u} onDM={() => startDM(u)} divider={i < members.length - 1} dmBusy={dmBusyId === u.id} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/* =============== My Profile Hero =============== */
function MyProfileHero({
  me,
  totalCount,
  teamCount,
}: {
  me: DirectoryUser;
  totalCount: number;
  teamCount: number;
}) {
  return (
    <div
      className="panel p-0 overflow-hidden relative"
      style={{ borderColor: "transparent" }}
    >
      <div
        className="absolute inset-0 opacity-[0.08]"
        style={{
          background: `radial-gradient(circle at 20% 30%, ${me.avatarColor ?? "#3D54C4"}, transparent 55%), radial-gradient(circle at 80% 100%, ${me.avatarColor ?? "#3D54C4"}, transparent 60%)`,
        }}
      />
      <div
        className="absolute top-0 left-0 w-full h-[3px]"
        style={{ background: `linear-gradient(90deg, ${me.avatarColor ?? "#3D54C4"}, ${me.avatarColor ?? "#3D54C4"}80)` }}
      />
      {/* flex-wrap 필수 — 모바일 통계 줄(아래 w-full)이 같은 행에서 폭을 빼앗아 정보
          컬럼이 0 으로 눌리면 이름·직급 텍스트가 한 글자씩 세로로 쪼개진다. wrap 으로
          통계 줄을 다음 줄로 내린다. 데스크톱(md+)은 통계가 인라인이라 한 줄에 다 들어가 wrap 없음. */}
      <div className="relative flex flex-wrap items-center gap-x-5 gap-y-3 p-5">
        <div className="w-16 h-16 rounded-full flex-shrink-0 shadow-pop overflow-hidden relative" style={{ background: me.avatarUrl ? "transparent" : (me.avatarColor ?? "#3D54C4") }}>
          {me.avatarUrl ? (
            <img src={imgSrc(me.avatarUrl)} alt={me.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" decoding="async"/>
          ) : (
            <div className="absolute inset-0 grid place-items-center text-white text-[22px] font-extrabold" style={{ letterSpacing: "-0.03em" }}>
              {me.name[0]}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-[11px] font-extrabold text-ink-500 uppercase tracking-[0.08em]">내 프로필</div>
            <span className="chip-gray">{me.role}</span>
          </div>
          <div className="text-[22px] font-extrabold text-ink-900 mt-0.5 tracking-tight">{me.name}</div>
          <div className="text-[13px] text-ink-600 mt-0.5">
            {me.position ?? "—"}
            {me.team && <span className="text-ink-400"> · {me.team}</span>}
          </div>
          <div className="text-[11px] text-ink-500 tabular mt-0.5">{me.email}</div>
        </div>
        {/* 통계 — 모바일에선 콤팩트 인라인 뱃지, md+ 부터는 큰 숫자 카드 */}
        <div className="hidden md:flex items-center gap-6 pr-2">
          <div className="text-center">
            <div className="text-[11px] font-bold text-ink-500 uppercase tracking-wider">동료</div>
            <div className="text-[22px] font-extrabold text-ink-900 tabular" style={{ letterSpacing: "-0.02em" }}>{totalCount - 1}</div>
          </div>
          <div className="w-px h-10 bg-ink-150" />
          <div className="text-center">
            <div className="text-[11px] font-bold text-ink-500 uppercase tracking-wider">팀</div>
            <div className="text-[22px] font-extrabold text-ink-900 tabular" style={{ letterSpacing: "-0.02em" }}>{teamCount}</div>
          </div>
        </div>
        <div className="md:hidden w-full flex items-center gap-3 text-[12px] text-ink-500">
          <span>동료 <b className="text-ink-900 tabular">{totalCount - 1}</b></span>
          <span className="text-ink-300">·</span>
          <span>팀 <b className="text-ink-900 tabular">{teamCount}</b></span>
        </div>
      </div>
    </div>
  );
}

/* =============== Grid Card =============== */
function GridCard({
  u,
  onDM,
  dmBusy,
  onCopyEmail,
  copied,
}: {
  u: DirectoryUser;
  onDM: () => void;
  dmBusy?: boolean;
  onCopyEmail: () => void;
  copied?: boolean;
}) {
  return (
    <div className="group panel p-0 overflow-hidden relative hover:border-ink-200 transition">
      {/* 상단 color band 제거 — 아바타 뒤로 사각형 배경이 비쳐보이는 문제.
          아바타는 이제 카드 본문 안에 깔끔히 원형만 노출. */}
      <div className="px-4 pt-4 pb-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="relative w-12 h-12 flex-shrink-0">
            <div className="absolute inset-0 rounded-full overflow-hidden" style={{ background: u.avatarUrl ? "transparent" : (u.avatarColor ?? "#3D54C4") }}>
              {u.avatarUrl ? (
                <img src={imgSrc(u.avatarUrl)} alt={u.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" decoding="async"/>
              ) : (
                <div className="absolute inset-0 grid place-items-center text-white text-[16px] font-extrabold" style={{ letterSpacing: "-0.02em" }}>
                  {u.name[0]}
                </div>
              )}
            </div>
            <PresenceDot u={u} size={12} ring={2} />
          </div>
          <Link to={`/users/${u.id}`} className="min-w-0 flex-1 hover:opacity-80 transition">
            <div className="text-[15px] font-extrabold text-ink-900 tracking-tight flex items-center gap-1.5 min-w-0">
              <span className="truncate">{u.name}</span>
              {isDevAccount(u) && <DevBadge iconOnly />}
            </div>
            <div className="text-[12px] text-ink-600 truncate mt-0.5">
              {u.position ?? "—"}
            </div>
          </Link>
          {u.team && <span className="chip-blue flex-shrink-0">{u.team}</span>}
        </div>
        <div className="text-[11px] text-ink-500 tabular truncate">{u.email}</div>
        <PresenceLine u={u} />

        <div className="mt-3 flex items-center gap-1.5">
          <button
            onClick={onDM}
            disabled={dmBusy}
            className="btn-primary btn-xs flex-1 justify-center disabled:opacity-60"
            title={`${u.name}님과 1:1 대화`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 5h16v11H9l-4 4z" />
            </svg>
            {dmBusy ? "…" : "메시지"}
          </button>
          <a
            href={`mailto:${u.email}`}
            className="btn-ghost btn-xs"
            title="이메일"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m3 7 9 6 9-6" />
            </svg>
          </a>
          <button
            onClick={onCopyEmail}
            className="btn-ghost btn-xs"
            title={copied ? "복사됨" : "이메일 복사"}
            aria-live="polite"
          >
            {copied ? (
              // 성공 체크 아이콘 — 1.2초 동안 표시.
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="8" y="8" width="13" height="13" rx="2" />
                <path d="M16 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =============== List Row =============== */
function ListRow({ u, onDM, divider, dmBusy }: { u: DirectoryUser; onDM: () => void; divider: boolean; dmBusy?: boolean }) {
  return (
    <div
      className={`group flex items-center gap-4 px-5 py-3 hover:bg-ink-25 ${
        divider ? "border-b border-ink-100" : ""
      }`}
    >
      <div className="relative w-10 h-10 flex-shrink-0">
        <div className="absolute inset-0 rounded-full overflow-hidden" style={{ background: u.avatarUrl ? "transparent" : (u.avatarColor ?? "#3D54C4") }}>
          {u.avatarUrl ? (
            <img src={imgSrc(u.avatarUrl)} alt={u.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" decoding="async"/>
          ) : (
            <div className="absolute inset-0 grid place-items-center text-white text-[13px] font-extrabold" style={{ letterSpacing: "-0.02em" }}>
              {u.name[0]}
            </div>
          )}
        </div>
        <PresenceDot u={u} size={12} ring={2} />
      </div>
      <Link to={`/users/${u.id}`} className="min-w-0 flex-1 md:w-[28%] md:flex-initial hover:opacity-80 transition">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="text-[14px] font-extrabold text-ink-900 tracking-tight flex items-center gap-1.5 min-w-0">
            <span className="truncate">{u.name}</span>
            {isDevAccount(u) && <DevBadge iconOnly />}
          </div>
          <PresenceBadge u={u} />
        </div>
        <div className="text-[11px] text-ink-500 tabular truncate">{u.email}</div>
      </Link>
      <div className="hidden md:block md:w-[14%]">
        <div className="text-[12px] font-semibold text-ink-800">{u.position ?? "—"}</div>
      </div>
      <div className="hidden md:block flex-1 min-w-0">
        {u.team && <span className="chip-blue">{u.team}</span>}
      </div>
      <div className="touch-reveal flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
        <a href={`mailto:${u.email}`} className="btn-icon" title="이메일">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
        </a>
      </div>
      <button
        onClick={onDM}
        disabled={dmBusy}
        className="btn-primary btn-xs disabled:opacity-60"
        title={`${u.name}님과 1:1 대화`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 5h16v11H9l-4 4z" />
        </svg>
        {dmBusy ? "…" : "메시지"}
      </button>
    </div>
  );
}

/* ===== 업무 상태 표시 — 아바타 오른쪽 아래 점, 이름 옆 뱃지, 프로필 카드 라인 ===== */
function PresenceDot({ u, size = 12, ring = 2 }: { u: DirectoryUser; size?: number; ring?: number }) {
  const p = resolvePresence(u.presenceStatus ?? null, u.workStatus);
  return (
    <span
      title={p.label + (u.presenceMessage ? ` · ${u.presenceMessage}` : "")}
      style={{
        position: "absolute",
        bottom: -1,
        right: -1,
        width: size,
        height: size,
        borderRadius: "50%",
        background: p.color,
        boxShadow: `0 0 0 ${ring}px var(--c-surface, #fff)`,
      }}
    />
  );
}

function PresenceBadge({ u }: { u: DirectoryUser }) {
  const p = resolvePresence(u.presenceStatus ?? null, u.workStatus);
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
      style={{ background: p.color + "18", color: p.color }}
      title={u.presenceMessage ?? undefined}
    >
      <span className="w-1 h-1 rounded-full" style={{ background: p.color }} />
      {p.label}
    </span>
  );
}

function PresenceLine({ u }: { u: DirectoryUser }) {
  const p = resolvePresence(u.presenceStatus ?? null, u.workStatus);
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
      <span className="font-bold" style={{ color: p.color }}>{p.label}</span>
      {u.presenceMessage && <span className="text-ink-500 truncate">· {u.presenceMessage}</span>}
    </div>
  );
}
