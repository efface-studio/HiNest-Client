import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api , imgSrc} from "../api";
import { useAuth } from "../auth";
import PageHeader from "../components/PageHeader";
import { alertAsync } from "../components/ConfirmHost";
import { isDevAccount, DevBadge } from "../lib/devBadge";

type DirUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  team?: string | null;
  position?: string | null;
  avatarColor?: string;
  avatarUrl?: string | null;
};
type Position = { id: string; name: string; rank: number };
type ViewMode = "tree" | "rank" | "list";

// 직급 키워드 순위 (직급 데이터가 없을 때 fallback)
const RANK_HINTS = ["이사", "부장", "팀장", "과장", "대리", "사원"];

const VIEW_LS_KEY = "hinest.orgchart.view";

export default function OrgChartPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<DirUser[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [dmBusyId, setDmBusyId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>(() => {
    try {
      const v = localStorage.getItem(VIEW_LS_KEY);
      if (v === "tree" || v === "rank" || v === "list") return v;
    } catch {}
    return "rank";
  });

  useEffect(() => {
    try { localStorage.setItem(VIEW_LS_KEY, view); } catch {}
  }, [view]);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  async function load() {
    const [u, p] = await Promise.all([
      api<{ users: DirUser[] }>("/api/users"),
      api<{ teams: string[] }>("/api/users/teams").catch(() => ({ teams: [] })),
    ]);
    if (!aliveRef.current) return;
    setUsers(u.users);
    void p;
  }

  async function loadPositions() {
    try {
      const r = await api<{ positions: Position[] }>("/api/admin/positions");
      if (!aliveRef.current) return;
      setPositions(r.positions);
    } catch {}
  }

  useEffect(() => {
    load();
    loadPositions();
  }, []);

  // 직급 정렬 — 관리자 페이지의 '직급 목록' 순서 그대로 따라감.
  // API 가 이미 rank asc + createdAt asc 로 정렬해서 내려주므로 그 배열 인덱스를 최종 순위로 사용.
  // (등록된 모든 직급의 rank 값이 0 일 때도 관리자 페이지에 보이는 순서와 100% 일치하게 됨)
  const rank = useMemo(() => {
    const idxMap = new Map<string, number>();
    positions.forEach((p, i) => idxMap.set(p.name, i));
    return (name?: string | null) => {
      if (!name) return 9999;
      if (idxMap.has(name)) return idxMap.get(name)!;
      // 등록되지 않은 직급명은 키워드 힌트로 최대한 유사 순위를 추정.
      const idx = RANK_HINTS.findIndex((k) => name.includes(k));
      return idx === -1 ? 5000 : 1000 + idx;
    };
  }, [positions]);

  // 조직도는 "팀에 소속된" 사람만 대상으로 함. 팀이 없는 계정(임시/미배치)은
  // 조직도 계층에 넣으면 '소속 없음' 같은 가짜 팀이 트리에 박혀서 구조가 흐트러짐.
  // 이런 계정들은 팀원 페이지(Directory) 에서만 보이게 두고 조직도에서는 감춤.
  const orgUsers = useMemo(() => users.filter((u) => !!u.team && u.team.trim() !== ""), [users]);

  // 팀별 그룹 + 직급순 정렬
  const grouped = useMemo(() => {
    const map = new Map<string, DirUser[]>();
    for (const u of orgUsers) {
      const t = u.team!;
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(u);
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => rank(a.position) - rank(b.position) || a.name.localeCompare(b.name, "ko"));
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, "ko"));
  }, [orgUsers, rank]);

  // 직급 기준 그룹 — 전사 전체를 직급 레벨별로 묶음.
  // 라벨은 "직급명" 이 같은 사람끼리 한 노드로 — 직급명이 없는 사람은 "직급 미지정" 으로.
  const byRank = useMemo(() => {
    const map = new Map<string, DirUser[]>();
    for (const u of orgUsers) {
      const key = u.position ?? "직급 미지정";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(u);
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    }
    return Array.from(map.entries()).sort(([a, aArr], [b, bArr]) => {
      // 등록된 직급 rank 우선 (낮을수록 상위) — 대표/이사 같은 최상위가 제일 위로.
      const ra = rank(aArr[0]?.position);
      const rb = rank(bArr[0]?.position);
      return ra - rb || a.localeCompare(b, "ko");
    });
  }, [orgUsers, rank]);

  function scheduleWith(target: DirUser) {
    if (target.id === user?.id) return;
    // 일정 페이지로 이동 + TARGETED 스코프로 이 유저를 기본 대상에 꽂아 모달 오픈.
    // 페이지 마운트 레이스를 피하려고 다음 tick 에 이벤트 발행 (목적지에서 리스너 붙을 틈).
    navigate("/schedule");
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("schedule:create", {
          detail: { targetUserIds: [target.id], scope: "TARGETED" as const },
        }),
      );
    }, 30);
  }

  async function startDM(target: DirUser) {
    if (target.id === user?.id) return;
    if (dmBusyId) return;
    setDmBusyId(target.id);
    try {
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

  const totalDesc =
    view === "list"
      ? `총 ${orgUsers.length}명 · ${grouped.length}개 팀 · 직급순 배열`
      : view === "tree"
      ? `총 ${orgUsers.length}명 · ${grouped.length}개 팀 트리 (팀 → 직급 → 인원)`
      : `총 ${orgUsers.length}명 · ${byRank.length}개 직급 계층 (팀 무관)`;

  return (
    <div>
      <PageHeader
        eyebrow="조직"
        title="조직도"
        description={totalDesc}
      />

      {/* 뷰 전환 탭 */}
      <div className="flex items-center gap-1 p-1 bg-ink-100 dark:bg-ink-50 rounded-lg mb-4 w-fit">
        <ViewTab active={view === "rank"} onClick={() => setView("rank")} label="직급 트리" hint="직급 기준(팀 무관)" />
        <ViewTab active={view === "tree"} onClick={() => setView("tree")} label="팀 트리" hint="팀 단위 계층도" />
        <ViewTab active={view === "list"} onClick={() => setView("list")} label="팀 카드" hint="팀별 카드 리스트" />
      </div>

      {view === "list" && (
        <ListView grouped={grouped} meId={user?.id ?? null} dmBusyId={dmBusyId} onDM={startDM} onSchedule={scheduleWith} />
      )}
      {view === "tree" && (
        <TeamTreeView grouped={grouped} rank={rank} meId={user?.id ?? null} dmBusyId={dmBusyId} onDM={startDM} onSchedule={scheduleWith} totalCount={orgUsers.length} />
      )}
      {view === "rank" && (
        <RankTreeView byRank={byRank} meId={user?.id ?? null} dmBusyId={dmBusyId} onDM={startDM} onSchedule={scheduleWith} />
      )}
    </div>
  );
}

function ViewTab({ active, onClick, label, hint }: { active: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={`px-3 py-1.5 text-[12px] font-bold rounded-md transition-colors ${
        active
          ? "bg-white dark:bg-ink-100 text-ink-900 shadow-sm"
          : "text-ink-500 hover:text-ink-700"
      }`}
    >
      {label}
    </button>
  );
}

/* ===================== List View (기존 카드) ===================== */
function ListView({
  grouped,
  meId,
  dmBusyId,
  onDM,
  onSchedule,
}: {
  grouped: [string, DirUser[]][];
  meId: string | null;
  dmBusyId: string | null;
  onDM: (u: DirUser) => void;
  onSchedule: (u: DirUser) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {grouped.map(([team, members]) => (
        <div key={team} className="panel p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-150 bg-gradient-to-r from-brand-50 to-white dark:from-brand-500/10 dark:to-transparent">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-brand-500 text-white grid place-items-center text-[13px] font-extrabold">
                {team[0]}
              </div>
              <div>
                <div className="text-[14px] font-extrabold text-ink-900 tracking-tight">{team}</div>
                <div className="text-[11px] text-ink-500 tabular">{members.length}명</div>
              </div>
            </div>
          </div>
          <div className="divide-y divide-ink-100">
            {members.map((u) => (
              <MemberRow key={u.id} u={u} meId={meId} dmBusyId={dmBusyId} onDM={onDM} onSchedule={onSchedule} />
            ))}
          </div>
        </div>
      ))}
      {grouped.length === 0 && (
        <div className="col-span-3 panel py-14 text-center">
          <div className="text-[13px] font-bold text-ink-800">팀이 없어요</div>
          <div className="text-[12px] text-ink-500 mt-1">관리자 페이지에서 팀을 추가하세요.</div>
        </div>
      )}
    </div>
  );
}

function MemberRow({
  u, meId, dmBusyId, onDM, onSchedule,
}: {
  u: DirUser; meId: string | null; dmBusyId: string | null; onDM: (u: DirUser) => void; onSchedule: (u: DirUser) => void;
}) {
  return (
    <div className="group flex items-center gap-3 px-4 py-2.5 hover:bg-ink-25">
      <UserAvatar u={u} size={36} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold text-ink-900 flex items-center gap-1.5 min-w-0">
          <span className="truncate min-w-0">{u.name}</span>
          {isDevAccount(u) && <DevBadge iconOnly />}
          {u.id === meId && <span className="chip-gray flex-shrink-0">나</span>}
        </div>
        <div className="text-[11px] text-ink-500 truncate">{u.position ?? "—"}</div>
      </div>
      {u.id !== meId && (
        <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100">
          <button
            onClick={() => onSchedule(u)}
            className="btn-icon"
            title="일정 잡기"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </button>
          <button
            onClick={() => onDM(u)}
            disabled={dmBusyId === u.id}
            className="btn-icon disabled:opacity-60"
            title="1:1 대화"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 5h16v11H9l-4 4z" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

/* ===================== Team Tree View =====================
 * 한 패널 안에 "전사" 를 루트로 두고, 그 아래로 각 팀을 세로 체인으로 배치.
 * 각 팀 섹션 내부는 직급 순 세로 체인 (위 → 아래) 으로 직급이 뻗어 내려감.
 * 같은 직급 내 여러 명은 해당 직급 밑에 가로로 펼쳐짐.
 */
function TeamTreeView({
  grouped,
  rank,
  meId,
  dmBusyId,
  onDM,
  onSchedule,
  totalCount,
}: {
  grouped: [string, DirUser[]][];
  rank: (name?: string | null) => number;
  meId: string | null;
  dmBusyId: string | null;
  onDM: (u: DirUser) => void;
  onSchedule: (u: DirUser) => void;
  totalCount: number;
}) {
  return (
    <div className="panel p-5 overflow-x-auto">
      <div className="org-vtree">
        <RootNode label="전사" count={totalCount} />
        <div className="org-vtree-spine">
          {grouped.map(([team, members]) => {
            const byLevel = new Map<string, DirUser[]>();
            for (const m of members) {
              const key = m.position ?? "직급 미지정";
              if (!byLevel.has(key)) byLevel.set(key, []);
              byLevel.get(key)!.push(m);
            }
            const levels = Array.from(byLevel.entries()).sort(
              ([a, aArr], [b, bArr]) => rank(aArr[0]?.position) - rank(bArr[0]?.position) || a.localeCompare(b, "ko"),
            );
            return (
              <div key={team} className="org-vtree-section">
                <div className="org-vtree-node"><TeamNode team={team} count={members.length} /></div>
                <div className="org-vtree-spine org-vtree-spine-inner">
                  {levels.map(([level, ms]) => (
                    <div key={level} className="org-vtree-row">
                      <div className="org-vtree-node"><LevelNode level={level} count={ms.length} /></div>
                      <div className="org-vtree-members">
                        {ms.map((u) => (
                          <div key={u.id} className="org-vtree-member">
                            <PersonNode u={u} meId={meId} dmBusyId={dmBusyId} onDM={onDM} onSchedule={onSchedule} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <TreeStyles />
    </div>
  );
}

/* ===================== Rank Tree View =====================
 * 세로 체인으로 직급이 위→아래로 뻗어나감.
 * 같은 직급 내 여러 명은 해당 직급 밑에 가로로 펼쳐짐.
 */
function RankTreeView({
  byRank,
  meId,
  dmBusyId,
  onDM,
  onSchedule,
}: {
  byRank: [string, DirUser[]][];
  meId: string | null;
  dmBusyId: string | null;
  onDM: (u: DirUser) => void;
  onSchedule: (u: DirUser) => void;
}) {
  const total = byRank.reduce((a, [, arr]) => a + arr.length, 0);
  return (
    <div className="panel p-5 overflow-x-auto">
      <div className="org-vtree">
        <RootNode label="전사 직급 계층" count={total} />
        <div className="org-vtree-spine">
          {byRank.map(([level, members]) => (
            <div key={level} className="org-vtree-row">
              <div className="org-vtree-node"><LevelNode level={level} count={members.length} /></div>
              <div className="org-vtree-members">
                {members.map((u) => (
                  <div key={u.id} className="org-vtree-member">
                    <PersonNode u={u} meId={meId} dmBusyId={dmBusyId} onDM={onDM} onSchedule={onSchedule} showTeam />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <TreeStyles />
    </div>
  );
}

/* ===================== Nodes ===================== */
function RootNode({ label, count }: { label: string; count: number }) {
  return (
    <div className="org-vtree-root">
      <div className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-pop">
        <div className="w-8 h-8 rounded-lg bg-white/20 grid place-items-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
          </svg>
        </div>
        <div>
          <div className="text-[13px] font-extrabold tracking-tight">{label}</div>
          <div className="text-[10px] opacity-80 tabular">{count}명</div>
        </div>
      </div>
    </div>
  );
}

function TeamNode({ team, count }: { team: string; count: number }) {
  return (
    <div className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-brand-500 text-white shadow-pop">
      <div className="w-8 h-8 rounded-lg bg-white/20 grid place-items-center text-[13px] font-extrabold">
        {team[0]}
      </div>
      <div>
        <div className="text-[13px] font-extrabold tracking-tight">{team}</div>
        <div className="text-[10px] opacity-80 tabular">{count}명</div>
      </div>
    </div>
  );
}

function LevelNode({ level, count }: { level: string; count: number }) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-ink-100 dark:bg-ink-100/40 border border-ink-150 text-ink-800">
      <span className="text-[12px] font-bold tracking-tight">{level}</span>
      <span className="text-[10px] text-ink-500 tabular">· {count}</span>
    </div>
  );
}

function PersonNode({
  u, meId, dmBusyId, onDM, onSchedule, showTeam,
}: {
  u: DirUser; meId: string | null; dmBusyId: string | null; onDM: (u: DirUser) => void; onSchedule: (u: DirUser) => void; showTeam?: boolean;
}) {
  const isMe = u.id === meId;
  // width 를 "고정" 해서 '나' 칩 유무와 관계없이 모든 카드 크기가 동일하도록 함.
  return (
    <div className="group flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-ink-150 bg-white dark:bg-ink-50 hover:border-brand-300 hover:shadow-pop transition w-[150px] sm:w-[180px]">
      <UserAvatar u={u} size={28} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-[12px] font-bold text-ink-900 truncate">{u.name}</span>
          {isDevAccount(u) && <DevBadge iconOnly />}
          {isMe && <span className="chip-gray !text-[9px] flex-shrink-0">나</span>}
        </div>
        <div className="text-[10px] text-ink-500 truncate">
          {showTeam ? (u.team ?? "—") : (u.position ?? "—")}
        </div>
      </div>
      {!isMe && (
        <div className="flex items-center gap-0.5 md:opacity-0 md:group-hover:opacity-100 flex-shrink-0">
          <button
            onClick={() => onSchedule(u)}
            className="btn-icon !w-6 !h-6"
            title="일정 잡기"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </button>
          <button
            onClick={() => onDM(u)}
            disabled={dmBusyId === u.id}
            className="btn-icon !w-6 !h-6 disabled:opacity-60"
            title="1:1 대화"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 5h16v11H9l-4 4z" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

function UserAvatar({ u, size }: { u: DirUser; size: number }) {
  return (
    <div
      className="rounded-full overflow-hidden relative flex-shrink-0"
      style={{ width: size, height: size, background: u.avatarUrl ? "transparent" : (u.avatarColor ?? "#3D54C4") }}
    >
      {u.avatarUrl ? (
        <img src={imgSrc(u.avatarUrl)} alt={u.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" decoding="async"/>
      ) : (
        <div
          className="absolute inset-0 grid place-items-center text-white font-extrabold"
          style={{ fontSize: Math.max(10, Math.round(size * 0.42)), letterSpacing: "-0.02em" }}
        >
          {u.name[0]}
        </div>
      )}
    </div>
  );
}

/* ===================== CSS Tree (순수 border 로 연결선) =====================
 * 세로 방향 트리 — 루트가 맨 위, 하위 노드가 아래로 뻗어나감.
 *
 * DOM:
 *   .org-vtree
 *     .org-vtree-root               (루트 노드 — 중앙 정렬)
 *     .org-vtree-spine              (세로 척추 — 각 row 사이를 수직선으로 연결)
 *       .org-vtree-row              (한 직급 row — Level 노드 + 멤버 가로 나열)
 *         .org-vtree-node           (Level / Team 노드 감싸는 중앙 정렬 래퍼)
 *         .org-vtree-members        (해당 직급 소속 멤버 가로 나열)
 *           .org-vtree-member
 *
 * 연결선:
 *   - 루트와 첫 row 사이: .org-vtree-spine::before 가 top 으로 뻗어 루트에 닿음.
 *   - row 들 사이: row 마다 ::before 가 위쪽 16px 세로선을 그림.
 *   - members 가 여러 명일 때: members 컨테이너가 가로로 펼쳐지며 각자 위로 세로선
 *     + members::before 가 가로로 이어지는 수평 커넥터.
 */
function TreeStyles() {
  return (
    <style>{`
      .org-vtree { display: flex; flex-direction: column; align-items: center; min-width: fit-content; padding: 4px; }
      .org-vtree-root { padding-bottom: 0; }
      .org-vtree-spine {
        display: flex;
        flex-direction: column;
        align-items: center;
        position: relative;
        width: 100%;
      }
      .org-vtree-row {
        display: flex;
        flex-direction: column;
        align-items: center;
        position: relative;
        padding-top: 20px;
        min-width: fit-content;
      }
      .org-vtree-row::before {
        content: "";
        position: absolute;
        top: 0; left: 50%;
        width: 2px; height: 20px;
        background: var(--c-ink-200, #E5E7EB);
        transform: translateX(-1px);
      }
      .org-vtree-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        position: relative;
        padding-top: 20px;
        min-width: fit-content;
      }
      .org-vtree-section::before {
        content: "";
        position: absolute;
        top: 0; left: 50%;
        width: 2px; height: 20px;
        background: var(--c-ink-200, #E5E7EB);
        transform: translateX(-1px);
      }
      .org-vtree-spine-inner {
        padding-top: 0;
        gap: 0;
      }
      .org-vtree-node {
        position: relative;
        display: flex;
        justify-content: center;
      }
      .org-vtree-members {
        display: flex;
        justify-content: center;
        gap: 12px 16px;
        /* 인원 많은 직급(사원 등)이 한 줄에 늘어져 가로 스크롤만 강요하던 문제 — 다음 줄로 wrap. */
        flex-wrap: wrap;
        max-width: min(100%, 1200px);
        margin: 2px auto 0;
        position: relative;
        padding-top: 18px;
      }
      /* Level 노드에서 내려가는 세로선 */
      .org-vtree-members::after {
        content: "";
        position: absolute;
        top: 0; left: 50%;
        width: 2px; height: 10px;
        background: var(--c-ink-200, #E5E7EB);
        transform: translateX(-1px);
      }
      .org-vtree-member {
        position: relative;
        padding-top: 8px;
      }
      /* 각 멤버 위 세로 tick */
      .org-vtree-member::before {
        content: "";
        position: absolute;
        top: 0; left: 50%;
        width: 2px; height: 8px;
        background: var(--c-ink-200, #E5E7EB);
        transform: translateX(-1px);
      }
      /* 멤버 사이 가로 연결선 — gap:16px 을 덮도록 좌우 -8px */
      .org-vtree-member::after {
        content: "";
        position: absolute;
        top: 0;
        left: -8px;
        right: -8px;
        height: 2px;
        background: var(--c-ink-200, #E5E7EB);
      }
      .org-vtree-member:first-child::after { left: 50%; right: -8px; }
      .org-vtree-member:last-child::after { left: -8px; right: 50%; }
      .org-vtree-member:only-child::after { display: none; }

      .dark .org-vtree-row::before,
      .dark .org-vtree-section::before,
      .dark .org-vtree-node::before,
      .dark .org-vtree-members::after,
      .dark .org-vtree-member::before,
      .dark .org-vtree-member::after {
        background: rgba(255,255,255,0.14);
      }

      /* 모바일: 가로 중앙정렬 트리는 좁은 폭에서 카드가 넘쳐 연결선이 어긋나므로,
         좌측 정렬 인덴트 트리(세로 스파인 + 각 노드로 뻗는 수평 tick)로 재구성. */
      @media (max-width: 640px) {
        .org-vtree { align-items: stretch; }
        .org-vtree-spine,
        .org-vtree-spine-inner { align-items: stretch; width: 100%; }
        /* 팀 트리: 팀 섹션 내부 직급 스파인을 한 단(22px) 들여써 팀>직급 위계 표현 */
        .org-vtree-spine-inner { padding-left: 22px; }
        .org-vtree-row,
        .org-vtree-section { align-items: stretch; }

        /* 세로 스파인: 각 row/section 좌측 12px 풀하이트 수직선.
           마지막 항목은 노드 중심까지만 그려 'ㄴ'자 코너로 마감(아래로 새는 꼬리 방지). */
        .org-vtree-row::before,
        .org-vtree-section::before {
          left: 12px;
          top: 0;
          height: 100%;
          transform: none;
        }
        .org-vtree-row:last-child::before { height: 34px; }
        .org-vtree-section:last-child::before { height: 46px; }

        /* Level/Team chip: 좌측 스파인에서 수평 tick 으로 연결 */
        .org-vtree-node {
          justify-content: flex-start;
          padding-left: 26px;
        }
        .org-vtree-node::before {
          content: "";
          position: absolute;
          left: 12px;
          top: 50%;
          width: 14px;
          height: 2px;
          background: var(--c-ink-200, #E5E7EB);
          transform: translateY(-1px);
        }

        /* 멤버: 세로 나열 + 각자 좌측 서브 스파인(-4px)에서 수평 tick 으로 카드까지 */
        .org-vtree-members {
          flex-direction: column;
          align-items: stretch;
          gap: 0;
          max-width: none;
          margin: 0;
          padding-top: 0;
          padding-left: 38px;
        }
        .org-vtree-members::after { display: none; }
        .org-vtree-member {
          padding-top: 10px;
          padding-left: 16px;
        }
        .org-vtree-member::before {
          display: block;
          left: -4px;
          top: 0;
          bottom: 0;
          width: 2px;
          height: auto;
          transform: none;
        }
        .org-vtree-member:last-child::before { bottom: auto; height: 31px; }
        .org-vtree-member::after {
          display: block;
          top: 31px;
          left: -4px;
          right: auto;
          width: 20px;
          height: 2px;
          transform: none;
        }
        .org-vtree-member:first-child::after,
        .org-vtree-member:last-child::after,
        .org-vtree-member:only-child::after {
          display: block;
          top: 31px;
          left: -4px;
          right: auto;
          width: 20px;
        }
        .org-vtree-member > div {
          display: flex !important;
          width: 100% !important;
        }
      }
    `}</style>
  );
}
