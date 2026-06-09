import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api , imgSrc} from "../api";
import { alertAsync } from "./ConfirmHost";
import { SkeletonList } from "./Skeleton";

type Results = {
  people?: any[];
  notices?: any[];
  events?: any[];
  documents?: any[];
  messages?: any[];
  meetings?: any[];
  approvals?: any[];
  projects?: any[];
};

/** 페이지 바로가기 — label/aliases 중 하나가 검색어에 포함되면 노출 */
type PageEntry = { label: string; desc: string; path: string; aliases: string[]; emoji: string };
const PAGES: PageEntry[] = [
  { label: "개요", desc: "대시보드 홈", path: "/", aliases: ["home", "dashboard", "홈", "대시보드"], emoji: "🏠" },
  { label: "일정", desc: "회사·팀·개인 일정", path: "/schedule", aliases: ["schedule", "calendar", "캘린더"], emoji: "📅" },
  { label: "근태·월차", desc: "출퇴근 · 연차 신청", path: "/attendance", aliases: ["attendance", "leave", "근태", "월차", "연차", "휴가", "출퇴근"], emoji: "⏰" },
  { label: "업무일지", desc: "일일 업무 기록", path: "/journal", aliases: ["journal", "diary", "업무일지", "일지"], emoji: "📝" },
  { label: "전자결재", desc: "결재 요청·검토", path: "/approvals", aliases: ["approval", "결재", "승인"], emoji: "✅" },
  { label: "공지사항", desc: "회사 공지", path: "/notice", aliases: ["notice", "notification", "공지"], emoji: "📢" },
  { label: "팀원", desc: "구성원 디렉토리", path: "/directory", aliases: ["directory", "member", "people", "팀원", "디렉토리"], emoji: "👥" },
  { label: "조직도", desc: "조직 트리", path: "/org", aliases: ["org", "organization", "조직도", "조직"], emoji: "🏢" },
  { label: "문서함", desc: "회사 문서", path: "/documents", aliases: ["document", "file", "문서", "파일"], emoji: "📄" },
  { label: "계정 관리", desc: "서비스 계정 레지스트리", path: "/accounts", aliases: ["account", "credential", "aws", "vercel", "계정", "크레덴셜"], emoji: "🔑" },
  { label: "법인카드", desc: "카드 사용내역", path: "/expense", aliases: ["expense", "card", "카드", "지출", "법카"], emoji: "💳" },
  { label: "내 프로필", desc: "내 정보 수정", path: "/profile", aliases: ["profile", "me", "프로필", "내정보"], emoji: "🙂" },
];

function matchPages(q: string): PageEntry[] {
  const k = q.trim().toLowerCase();
  if (!k) return [];
  return PAGES.filter((p) =>
    p.label.toLowerCase().includes(k) ||
    p.desc.toLowerCase().includes(k) ||
    p.aliases.some((a) => a.toLowerCase().includes(k))
  );
}

export default function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Results>({});
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 마운트 유지 + visible 플래그로 enter/exit 애니메이션 분리
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      // 마운트 직후 다음 프레임에 visible=true 로 전환해서 CSS transition 트리거
      const r = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(r);
    } else {
      setVisible(false);
      // transition 끝날 시간만큼 유예 후 언마운트
      const t = setTimeout(() => setMounted(false), 320);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQ("");
      setResults({});
      return;
    }
    // 빠른 open/close 반복 시 stale focus 호출이 재열린 인풋을 낚아채거나 언마운트 된
    // 레퍼런스로 포커스 시도하던 문제 — cleanup 에서 타이머 제거.
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  // 빠르게 타이핑할 때 이전 요청이 나중에 도착해서 결과를 덮는 현상 방지.
  // monotonic token 으로 "가장 최근 요청" 만 UI 에 반영.
  const searchTokenRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    if (!q.trim()) { setResults({}); setSearchError(null); return; }
    setLoading(true);
    setSearchError(null);
    const t = setTimeout(async () => {
      const my = ++searchTokenRef.current;
      try {
        const res = await api<{ results: Results }>(`/api/search?q=${encodeURIComponent(q.trim())}`);
        if (my !== searchTokenRef.current) return;
        setResults(res.results);
      } catch (e: any) {
        if (my !== searchTokenRef.current) return;
        setResults({});
        setSearchError(e?.message ?? "검색에 실패했어요. 잠시 후 다시 시도해주세요.");
      } finally {
        if (my === searchTokenRef.current) setLoading(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  function go(path: string) {
    onClose();
    nav(path);
  }

  /** 사람 결과 클릭 시 — 오른쪽 사내톡 팝업에서 해당 유저와 DM 바로 열기 */
  async function openDirect(userId: string) {
    try {
      const res = await api<{ room: { id: string } }>("/api/chat/rooms", {
        method: "POST",
        json: { type: "DIRECT", memberIds: [userId] },
      });
      onClose();
      window.dispatchEvent(new CustomEvent("chat:open"));
      window.dispatchEvent(new CustomEvent("chat:open-room", { detail: { roomId: res.room.id } }));
    } catch (e: any) {
      // 실패 시 팀원 페이지로 이동하되, 왜 DM 이 안 열렸는지 토스트로 안내
      onClose();
      alertAsync({
        title: "대화방을 열지 못했어요",
        description: e?.message ?? "잠시 후 팀원 페이지에서 다시 시도해주세요.",
      });
      nav("/directory");
    }
  }

  const pageHits = useMemo(() => matchPages(q), [q]);
  const totalCount = useMemo(() => {
    const svr = Object.values(results).reduce((n: number, arr: any) => n + (arr?.length ?? 0), 0);
    return svr + pageHits.length;
  }, [results, pageHits]);

  if (!mounted) return null;
  // 스프링 느낌의 이징 — 살짝 튕기며 내려와 안착
  const SPRING = "cubic-bezier(.34, 1.56, .64, 1)";
  const OUT = "cubic-bezier(.4, 0, .2, 1)";
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center px-4 modal-safe"
      style={{
        paddingTop: "18vh",
        background: visible
          ? "rgba(17, 24, 39, 0.32)"
          : "rgba(17, 24, 39, 0)",
        backdropFilter: visible ? "blur(3px) saturate(110%)" : "blur(0px) saturate(100%)",
        WebkitBackdropFilter: visible ? "blur(3px) saturate(110%)" : "blur(0px) saturate(100%)",
        transition:
          "background .28s ease, backdrop-filter .32s ease, -webkit-backdrop-filter .32s ease",
      }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[640px] panel shadow-pop overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{
          opacity: visible ? 1 : 0,
          transform: visible
            ? "translateY(0) scale(1) rotateX(0deg)"
            : "translateY(-40px) scale(.9) rotateX(-8deg)",
          transformOrigin: "top center",
          transformStyle: "preserve-3d",
          perspective: 1200,
          filter: visible ? "blur(0px)" : "blur(6px)",
          boxShadow: visible
            ? "0 24px 60px -12px rgba(49, 130, 246, 0.35), 0 12px 28px -8px rgba(0,0,0,.18)"
            : "0 0 0 rgba(0,0,0,0)",
          transition: visible
            ? `opacity .26s ${OUT}, transform .42s ${SPRING}, filter .26s ${OUT}, box-shadow .4s ${OUT}`
            : `opacity .2s ${OUT}, transform .28s ${OUT}, filter .2s ${OUT}, box-shadow .2s ${OUT}`,
          willChange: "transform, opacity, filter",
        }}
      >
        <div className="flex items-center gap-3 px-5 h-[52px] border-b border-ink-150">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-ink-400"
            placeholder="사람·공지·일정·문서·메시지 검색…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={80}
          />
          <span className="kbd">ESC</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {!q.trim() ? (
            <div className="py-12 text-center t-caption">원하는 항목을 검색해보세요.</div>
          ) : searchError && totalCount === 0 ? (
            <div className="py-12 text-center">
              <div className="text-[13px] font-bold text-rose-600">{searchError}</div>
              <div className="text-[11px] text-ink-500 mt-1">다시 입력하면 자동으로 재시도돼요.</div>
            </div>
          ) : loading && totalCount === 0 ? (
            <div className="py-3 px-1"><SkeletonList rows={5} /></div>
          ) : totalCount === 0 ? (
            <div className="py-12 text-center">
              <div className="text-[13px] font-bold text-ink-800">결과가 없어요</div>
              <div className="text-[11px] text-ink-500 mt-1">다른 키워드로 다시 검색해보세요.</div>
            </div>
          ) : (
            <div className="py-2">
              {pageHits.length > 0 && (
                <Section label="바로가기">
                  {pageHits.map((p) => (
                    <Row
                      key={`pg-${p.path}`}
                      onClick={() => go(p.path)}
                      icon={<SmallBadge color="#3182F6">{p.emoji}</SmallBadge>}
                    >
                      <div className="text-[13px] font-bold text-ink-900">{p.label}</div>
                      <div className="text-[11px] text-ink-500">{p.desc}</div>
                    </Row>
                  ))}
                </Section>
              )}
              {results.people && results.people.length > 0 && (
                <Section label="사람">
                  {results.people.map((p: any) => (
                    <Row key={`p-${p.id}`} onClick={() => openDirect(p.id)}
                      icon={<Avatar name={p.name} color={p.avatarColor ?? "#3D54C4"} imageUrl={p.avatarUrl ?? null} />}>
                      <div className="text-[13px] font-bold text-ink-900">{p.name}</div>
                      <div className="text-[11px] text-ink-500">{p.position ?? "—"} {p.team && `· ${p.team}`} · {p.email}</div>
                    </Row>
                  ))}
                </Section>
              )}
              {results.notices && results.notices.length > 0 && (
                <Section label="공지">
                  {results.notices.map((n: any) => (
                    <Row key={`n-${n.id}`} onClick={() => go(`/notice`)}
                      icon={<SmallBadge color="#DC2626">📢</SmallBadge>}>
                      <div className="text-[13px] font-bold text-ink-900 truncate">{n.title}</div>
                      <div className="text-[11px] text-ink-500 line-clamp-1">{n.content}</div>
                    </Row>
                  ))}
                </Section>
              )}
              {results.events && results.events.length > 0 && (
                <Section label="일정">
                  {results.events.map((e: any) => (
                    <Row key={`e-${e.id}`} onClick={() => go(`/schedule`)}
                      icon={<SmallBadge color={e.color ?? "#3D54C4"}>📅</SmallBadge>}>
                      <div className="text-[13px] font-bold text-ink-900 truncate">{e.title}</div>
                      <div className="text-[11px] text-ink-500 tabular">
                        {new Date(e.startAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </Row>
                  ))}
                </Section>
              )}
              {results.meetings && results.meetings.length > 0 && (
                <Section label="회의록">
                  {results.meetings.map((m: any) => (
                    <Row key={`mt-${m.id}`} onClick={() => go(`/meetings?id=${m.id}`)}
                      icon={<SmallBadge color="#8B5CF6">🗒</SmallBadge>}>
                      <div className="text-[13px] font-bold text-ink-900 truncate">{m.title}</div>
                      <div className="text-[11px] text-ink-500 truncate">{m.author?.name}</div>
                    </Row>
                  ))}
                </Section>
              )}
              {results.approvals && results.approvals.length > 0 && (
                <Section label="결재">
                  {results.approvals.map((a: any) => (
                    <Row key={`a-${a.id}`} onClick={() => go(`/approvals?id=${a.id}`)}
                      icon={<SmallBadge color="#16A34A">✅</SmallBadge>}>
                      <div className="text-[13px] font-bold text-ink-900 truncate">{a.title}</div>
                      <div className="text-[11px] text-ink-500 truncate">{a.requester?.name} · {a.status}</div>
                    </Row>
                  ))}
                </Section>
              )}
              {results.projects && results.projects.length > 0 && (
                <Section label="프로젝트">
                  {results.projects.map((p: any) => (
                    <Row key={`pr-${p.id}`} onClick={() => go(`/projects/${p.id}`)}
                      icon={<SmallBadge color={p.color ?? "#3D54C4"}>◆</SmallBadge>}>
                      <div className="text-[13px] font-bold text-ink-900 truncate">{p.name}</div>
                      <div className="text-[11px] text-ink-500 truncate">{p.description ?? "—"}</div>
                    </Row>
                  ))}
                </Section>
              )}
              {results.documents && results.documents.length > 0 && (
                <Section label="문서">
                  {results.documents.map((d: any) => (
                    <Row key={`d-${d.id}`} onClick={() => go(`/documents`)}
                      icon={<SmallBadge color="#0EA5E9">📄</SmallBadge>}>
                      <div className="text-[13px] font-bold text-ink-900 truncate">{d.title}</div>
                      <div className="text-[11px] text-ink-500 truncate">{d.folder?.name ?? "루트"} · {d.author?.name}</div>
                    </Row>
                  ))}
                </Section>
              )}
              {results.messages && results.messages.length > 0 && (
                <Section label="메시지">
                  {results.messages.map((m: any) => (
                    <Row key={`m-${m.id}`} onClick={() => {
                      onClose();
                      window.dispatchEvent(new CustomEvent("chat:open"));
                      window.dispatchEvent(new CustomEvent("chat:open-room", { detail: { roomId: m.room.id } }));
                    }}
                      icon={<Avatar name={m.sender.name} color={m.sender.avatarColor} imageUrl={m.sender.avatarUrl ?? null} />}>
                      <div className="text-[13px] font-bold text-ink-900 truncate">{m.sender.name} <span className="text-ink-500 font-medium">· {m.room.name}</span></div>
                      <div className="text-[11px] text-ink-500 line-clamp-1">{m.content}</div>
                    </Row>
                  ))}
                </Section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="px-5 py-1.5 text-[10px] font-extrabold text-ink-500 uppercase tracking-[0.08em]">{label}</div>
      {children}
    </div>
  );
}

function Row({ icon, onClick, children }: { icon: React.ReactNode; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-ink-25 text-left">
      <div className="flex-shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">{children}</div>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#B0B8C1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m9 18 6-6-6-6" />
      </svg>
    </button>
  );
}

function Avatar({ name, color, imageUrl }: { name: string; color: string; imageUrl?: string | null }) {
  return (
    <div className="w-7 h-7 rounded-full grid place-items-center text-white text-[11px] font-bold overflow-hidden" style={{ background: imageUrl ? "transparent" : color, letterSpacing: "-0.02em" }}>
      {imageUrl ? (
        <img src={imgSrc(imageUrl)} alt={name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
      ) : (
        name?.[0] ?? "?"
      )}
    </div>
  );
}

function SmallBadge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div className="w-7 h-7 rounded-md grid place-items-center" style={{ background: color + "20", color }}>
      {children}
    </div>
  );
}
