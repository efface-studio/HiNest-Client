import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, apiSWR, imgSrc, invalidateCache } from "../api";
import { useAuth } from "../auth";
import { confirmAsync, alertAsync } from "../components/ConfirmHost";
import { Skeleton, SkeletonText } from "../components/Skeleton";
import Select, { type SelectOption } from "../components/Select";
import PinButton from "../components/PinButton";
import ShareButton from "../components/ShareButton";
import RevisionHistoryModal from "../components/RevisionHistoryModal";
import MeetingAttachments, { type MeetingAttachment } from "../components/MeetingAttachments";
import { copyToClipboard, absoluteUrl } from "../lib/clipboard";
import { isDevAccount, DevBadge } from "../lib/devBadge";
// TipTap 에디터는 ~300KB 덩어리 — 회의록 상세 페이지 안에서 다시 한 번 나눠서
// 제목/메타/공개범위 UI 가 먼저 보이고, 에디터는 뒤따라 로드되도록 함.
const MeetingEditor = lazy(() => import("../components/MeetingEditor"));

type Visibility = "ALL" | "PROJECT" | "SPECIFIC";

type Viewer = {
  id: string;
  userId: string;
  user: { id: string; name: string; team: string | null; position: string | null; avatarColor: string; avatarUrl?: string | null };
};

type Meeting = {
  id: string;
  title: string;
  content: any;
  visibility: Visibility;
  tags?: string | null;
  projectId: string | null;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string; avatarColor: string; avatarUrl?: string | null };
  project: { id: string; name: string; color: string } | null;
  viewers: Viewer[];
  attachments?: MeetingAttachment[];
};

type ProjectLite = { id: string; name: string; color: string };
type UserLite = { id: string; name: string; email: string; team: string | null; position: string | null; avatarColor: string; avatarUrl?: string | null };

export default function MeetingDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [edit, setEdit] = useState<boolean>(searchParams.get("edit") === "1");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState<any>(null);
  const [visibility, setVisibility] = useState<Visibility>("ALL");
  const [tags, setTags] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [viewerIds, setViewerIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | null>(null);

  const [myProjects, setMyProjects] = useState<ProjectLite[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);

  // 최초 로드
  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    apiSWR<{ meeting: Meeting }>(`/api/meeting/${id}`, {
      onCached: (r) => {
        if (!alive) return;
        applyMeeting(r.meeting);
        setLoading(false);
      },
      onFresh: (r) => {
        if (!alive) return;
        applyMeeting(r.meeting);
        setLoading(false);
      },
      onError: (e) => {
        if (!alive) return;
        setErr(e.message || "불러올 수 없습니다");
        setLoading(false);
      },
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function applyMeeting(m: Meeting) {
    setMeeting(m);
    setTitle(m.title);
    setContent(m.content ?? { type: "doc", content: [{ type: "paragraph" }] });
    setVisibility(m.visibility);
    setTags(m.tags ?? "");
    setProjectId(m.projectId);
    setViewerIds(m.viewers.map((v) => v.userId));
    setErr(null);
  }

  // 수정 모드 진입 시 보조 데이터 로드 (공개 범위 설정용)
  useEffect(() => {
    if (!edit) return;
    api<{ projects: ProjectLite[] }>(user?.role === "ADMIN" ? "/api/project?all=1" : "/api/project")
      .then((r) => setMyProjects(r.projects))
      .catch(() => {});
    api<{ users: UserLite[] }>("/api/users")
      .then((r) => setUsers(r.users))
      .catch(() => {});
  }, [edit, user?.role]);

  // 멘션 자동완성 — 현재 편집 중인 공개 범위(visibility/projectId/viewerIds)를
  // 서버로 보내 열람 가능한 유저만 반환받는다. 편집 중 상태가 바뀌어도 항상
  // 최신 값을 쓰도록 ref 로 감싼다 (에디터 재생성 방지).
  const scopeRef = useRef({ visibility, projectId, viewerIds, meetingId: id });
  useEffect(() => {
    scopeRef.current = { visibility, projectId, viewerIds, meetingId: id };
  }, [visibility, projectId, viewerIds, id]);
  const mentionFetcher = useCallback(async (q: string) => {
    const s = scopeRef.current;
    const params = new URLSearchParams();
    if (s.meetingId) params.set("meetingId", s.meetingId);
    else {
      params.set("visibility", s.visibility);
      if (s.projectId) params.set("projectId", s.projectId);
      if (s.viewerIds.length) params.set("viewerIds", s.viewerIds.join(","));
    }
    if (q) params.set("q", q);
    try {
      const r = await api<{ users: any[] }>(`/api/meeting/mentionable?${params.toString()}`);
      return r.users;
    } catch {
      return [];
    }
  }, []);

  const canEdit = useMemo(() => {
    if (!meeting || !user) return false;
    return meeting.authorId === user.id || user.role === "ADMIN";
  }, [meeting, user]);

  const projectOptions = useMemo<SelectOption[]>(
    () => [
      { value: "", label: "프로젝트 선택…" },
      ...myProjects.map((p) => ({ value: p.id, label: p.name, searchText: p.name })),
    ],
    [myProjects],
  );

  // 자동 저장 — 1.5초 디바운스 (저장 중이면 타이머만 다시 걸어서 race 방지)
  const saveTimerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  useEffect(() => {
    if (!edit || !meeting || !canEdit) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      if (savingRef.current) {
        // 이미 저장 중이면 끝난 뒤 한 번 더 저장하도록 마크
        pendingRef.current = true;
        return;
      }
      doSave();
    }, 1500);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, visibility, tags, projectId, viewerIds, edit, canEdit]);

  async function doSave() {
    if (!meeting || !canEdit) return;
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const payload: any = {
        title: title.trim() || "제목 없는 회의록",
        content,
        visibility,
        tags: tags.trim() || undefined,
        projectId: visibility === "PROJECT" ? projectId : null,
      };
      if (visibility === "SPECIFIC") payload.viewerIds = viewerIds;
      await api(`/api/meeting/${meeting.id}`, { method: "PATCH", json: payload });
      invalidateCache("/api/meeting");
      setLastSaved(Date.now());
      setErr(null);
    } catch (e: any) {
      setErr(e?.message ?? "저장 실패");
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (pendingRef.current) {
        pendingRef.current = false;
        // 저장하는 동안 추가 변경이 있었다면 한 번 더 저장
        void doSave();
      }
    }
  }

  const [deleting, setDeleting] = useState(false);
  async function remove() {
    if (!meeting || !canEdit || deleting) return;
    const ok = await confirmAsync({
      title: "회의록 삭제",
      description: "이 회의록을 삭제할까요? 되돌릴 수 없어요.",
      tone: "danger",
      confirmLabel: "삭제",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api(`/api/meeting/${meeting.id}`, { method: "DELETE" });
      invalidateCache("/api/meeting");
      nav("/meetings");
    } catch (e: any) {
      alertAsync({ title: "삭제 실패", description: e?.message ?? "삭제 실패" });
      setDeleting(false);
    }
  }

  function toggleViewer(uid: string) {
    setViewerIds((prev) => (prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]));
  }

  if (err && !meeting) {
    return (
      <div className="text-center py-16 text-slate-400">
        <div>{err}</div>
        <Link to="/meetings" className="text-brand-500 text-sm mt-2 inline-block">← 목록으로</Link>
      </div>
    );
  }
  if (!meeting && loading) {
    // 회의록 상세 첫 로딩 — '불러오는 중…' 텍스트 대신 형태가 비슷한 Skeleton.
    // 사용자 입장에서 다음에 나타날 컨텐츠(헤더·작성자·본문 단락)의 형태가 미리 보여 깜빡임이 줄어든다.
    return (
      <div className="max-w-[860px] mx-auto px-5 py-8 flex flex-col gap-5">
        <Skeleton w="60%" h={32} radius={8} />
        <div className="flex items-center gap-2">
          <Skeleton circle w={22} h={22} />
          <Skeleton w={120} h={12} />
          <Skeleton w={80} h={12} />
        </div>
        <div className="panel p-5 flex flex-col gap-3 mt-2">
          <SkeletonText lines={4} />
          <SkeletonText lines={5} />
          <SkeletonText lines={3} />
        </div>
      </div>
    );
  }
  if (!meeting) return null;

  return (
    <div className="max-w-4xl mx-auto print-area">
      {/* A4 인쇄 — 본문만 출력하고 사이드바/버튼/네비를 숨김. 1.5cm 여백, 12pt 본문. */}
      <style>{`
        @media print {
          @page { size: A4; margin: 1.5cm; }
          html, body { background: #fff !important; color: #000 !important; }
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; left: 0; top: 0; width: 100%; max-width: none !important; padding: 0; }
          .no-print { display: none !important; }
          .ProseMirror, article, h1, h2, h3, p, li, td, th { color: #000 !important; }
          a { color: #000 !important; text-decoration: underline; }
          img { max-width: 100% !important; page-break-inside: avoid; }
          h1, h2, h3 { page-break-after: avoid; }
          table, pre, blockquote { page-break-inside: avoid; }
        }
        /* 모바일 헤더 액션바 콤팩트화 — 폰 화면에서 버튼 6개+타임스탬프가 빽빽하게 줄바꿈되는 걸 완화.
           .btn-ghost(높이 36px)는 언레이어드라 Tailwind 유틸로 못 줄이므로 스코프 선택자(0,2,0)로 덮어쓴다.
           아이콘 핀 버튼(btn-icon)이 32px이므로 텍스트 버튼도 32px로 맞춰 한 줄 높이를 통일한다. */
        @media (max-width: 640px) {
          .mtg-actions { gap: 6px; }
          .mtg-actions .btn-ghost { height: 32px; padding: 0 10px; font-size: 12px; }
        }
      `}</style>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap no-print">
        <Link to="/meetings" className="text-[13px] text-slate-500 hover:text-brand-600 flex-shrink-0">
          ← 회의록 목록
        </Link>
        <div className="mtg-actions flex items-center gap-2 flex-wrap justify-end">
          <button
            type="button"
            className="btn-ghost inline-flex items-center gap-1"
            title="이 회의록 링크 복사"
            onClick={() =>
              copyToClipboard(absoluteUrl(`/meetings/${meeting.id}`), {
                title: "링크 복사됨",
                description: "사내톡에 붙여넣으면 이 회의록으로 바로 이동돼요.",
              })
            }
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72" />
            </svg>
            링크 복사
          </button>
          <PinButton type="MEETING" id={meeting.id} label={meeting.title} />
          <ShareButton
            variant="icon"
            payload={{
              kind: "MEETING",
              title: meeting.title?.trim() || "제목 없는 회의록",
              href: `/meetings/${meeting.id}`,
            }}
          />
          <button className="btn-ghost no-print" onClick={() => window.print()} title="A4 인쇄">인쇄</button>
          <button className="btn-ghost" onClick={() => setHistoryOpen(true)} title="버전 히스토리">히스토리</button>
          {canEdit && !edit && (
            <button className="btn-ghost" onClick={() => { setEdit(true); setSearchParams({ edit: "1" }); }}>
              편집
            </button>
          )}
          {canEdit && edit && (
            <>
              <span className="text-[11.5px] text-slate-400">
                {saving ? "저장 중…" : lastSaved ? `저장됨 ${new Date(lastSaved).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}` : ""}
              </span>
              <button className="btn-ghost" onClick={() => { setEdit(false); setSearchParams({}); }}>
                미리보기
              </button>
              <button className="btn-ghost text-danger" onClick={remove} disabled={deleting}>
                {deleting ? "삭제 중…" : "삭제"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 제목 */}
      {edit ? (
        <input
          className="w-full text-[24px] sm:text-[32px] font-extrabold bg-transparent border-none outline-none mb-2 placeholder-slate-300"
          placeholder="회의록 제목"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
      ) : (
        <h1 className="text-[24px] sm:text-[32px] font-extrabold mb-2 break-words">{meeting.title}</h1>
      )}

      {/* 메타 정보 */}
      <div className="flex items-center gap-2 mb-5 text-[12px] text-slate-500 flex-wrap">
        <span className="inline-flex items-center gap-1.5">
          <span className="avatar avatar-xs overflow-hidden" style={{ background: meeting.author.avatarUrl ? "transparent" : meeting.author.avatarColor }}>
            {meeting.author.avatarUrl ? (
              <img src={imgSrc(meeting.author.avatarUrl)} alt={meeting.author.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
            ) : (
              meeting.author.name[0]
            )}
          </span>
          {meeting.author.name}
          {isDevAccount(meeting.author) && <DevBadge iconOnly />}
        </span>
        <span>·</span>
        <span>{new Date(meeting.createdAt).toLocaleString("ko-KR", { year: "numeric", month: "short", day: "numeric" })}</span>
        {meeting.project && (
          <>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: meeting.project.color }} />
              {meeting.project.name}
            </span>
          </>
        )}
      </div>

      {/* 태그 — 메모와 동일 (쉼표 구분) */}
      {edit ? (
        <input
          className="block w-full text-[13px] text-slate-400 placeholder-slate-300 bg-transparent border-none outline-none mb-4"
          placeholder="# 태그 입력 (쉼표로 구분, 예: 기획, 아이디어)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          maxLength={200}
        />
      ) : (tags || meeting.tags) ? (
        <div className="flex flex-wrap gap-1 mb-4">
          {((meeting.tags ?? tags) || "").split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
            <span key={t} className="chip-gray text-[11px]">#{t}</span>
          ))}
        </div>
      ) : null}

      {/* 공개 범위 — 편집모드에서만 */}
      {edit && (
        <div className="card mb-4">
          <div className="text-[12px] font-bold mb-2">공개 범위</div>
          <div className="flex gap-2 mb-3">
            <VisBtn active={visibility === "ALL"} onClick={() => setVisibility("ALL")} label="전사" desc="로그인한 모두" />
            <VisBtn active={visibility === "PROJECT"} onClick={() => setVisibility("PROJECT")} label="프로젝트" desc="프로젝트 멤버" />
            <VisBtn active={visibility === "SPECIFIC"} onClick={() => setVisibility("SPECIFIC")} label="특정 인원" desc="지정한 사람들" />
          </div>

          {visibility === "PROJECT" && (
            <div>
              <label className="label">프로젝트 선택</label>
              <Select
                className="input"
                value={projectId ?? ""}
                onChange={(v) => setProjectId(v || null)}
                options={projectOptions}
              />
              {!projectId && <div className="text-[11px] text-danger mt-1">프로젝트를 선택해야 저장됩니다.</div>}
            </div>
          )}

          {visibility === "SPECIFIC" && (
            <ViewerPicker users={users} selected={viewerIds} onToggle={toggleViewer} authorId={meeting.authorId} />
          )}
        </div>
      )}
      {!edit && (
        <div className="mb-4 text-[12px] text-slate-500 inline-flex items-center gap-2">
          공개 범위:
          {visibility === "ALL" && <span className="chip-green">전사</span>}
          {visibility === "PROJECT" && (
            <span className="chip chip-blue">
              프로젝트 — {meeting.project?.name ?? "-"}
            </span>
          )}
          {visibility === "SPECIFIC" && (
            <span className="chip chip-amber">
              특정 {meeting.viewers.length}명 + 작성자
            </span>
          )}
        </div>
      )}

      {/* 본문 에디터 — 청크 로드 동안 부드러운 스켈레톤 */}
      <Suspense fallback={<div className="min-h-[200px] rounded-lg bg-[color:var(--c-surface-3)] animate-pulse" />}>
        <MeetingEditor
          value={content}
          onChange={(json) => setContent(json)}
          editable={edit && canEdit}
          mentionFetcher={mentionFetcher}
        />
      </Suspense>

      {/* 첨부 — 파일/이미지/영상/링크. 본문이 다시 쓰여도 자료는 유지됨. */}
      {meeting && (
        <MeetingAttachments
          meetingId={meeting.id}
          authorId={meeting.authorId}
          attachments={meeting.attachments ?? []}
          onChange={(next) => setMeeting((m) => (m ? { ...m, attachments: next } : m))}
          // 회의록을 읽기만 가능한 사용자(SPECIFIC 열람자 등) 도 첨부는 자유롭게 추가/조회 가능 —
          // 본문 잠금 여부 와 무관. 본인이 올린 것 / 작성자 / ADMIN 만 삭제 가능 (서버 가드).
          readOnly={false}
        />
      )}

      {historyOpen && meeting && (
        <RevisionHistoryModal
          kind="meeting"
          targetId={meeting.id}
          title={meeting.title}
          onClose={() => setHistoryOpen(false)}
          onRestored={() => {
            // 복구 후 본문/제목이 바뀌었을 수 있음 — 페이지 전체를 재조회.
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}

function VisBtn({ active, onClick, label, desc }: { active: boolean; onClick: () => void; label: string; desc: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 text-left p-3 rounded-lg border-2 transition ${active ? "border-brand-500 bg-brand-50 dark:bg-brand-900/30 dark:text-brand-200" : "border-ink-200 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800"}`}
    >
      <div className="text-[13px] font-bold">{label}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{desc}</div>
    </button>
  );
}

function ViewerPicker({
  users,
  selected,
  onToggle,
  authorId,
}: {
  users: UserLite[];
  selected: string[];
  onToggle: (id: string) => void;
  authorId: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return users
      .filter((u) => u.id !== authorId)
      .filter((u) => {
        if (!k) return true;
        return (
          u.name.toLowerCase().includes(k) ||
          u.email.toLowerCase().includes(k) ||
          (u.team ?? "").toLowerCase().includes(k) ||
          (u.position ?? "").toLowerCase().includes(k)
        );
      });
  }, [users, q, authorId]);

  return (
    <div>
      <label className="label">허용할 사람 선택 (작성자는 자동 포함)</label>
      <input
        className="input mb-2"
        placeholder="이름·팀·직급으로 검색"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        maxLength={80}
      />
      <div className="flex flex-wrap gap-1.5 max-h-48 overflow-auto border border-slate-100 rounded-lg p-2">
        {filtered.map((u) => {
          const on = selected.includes(u.id);
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => onToggle(u.id)}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs ${on ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 hover:bg-slate-50 text-slate-600"}`}
            >
              <span
                className="w-5 h-5 rounded-full grid place-items-center text-white text-[10px] font-bold overflow-hidden"
                style={{ background: u.avatarUrl ? "transparent" : u.avatarColor }}
              >
                {u.avatarUrl ? (
                  <img src={imgSrc(u.avatarUrl)} alt={u.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
                ) : (
                  u.name[0]
                )}
              </span>
              <span>{u.name}</span>
              {isDevAccount(u) && <DevBadge iconOnly />}
              <span className="text-[10px] text-slate-400">{u.team ?? ""}</span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-xs text-slate-400 py-2">해당하는 사용자가 없습니다.</div>
        )}
      </div>
      <div className="text-[11px] text-slate-500 mt-1">선택됨 {selected.length}명</div>
    </div>
  );
}
