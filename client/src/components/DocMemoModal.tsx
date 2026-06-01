/**
 * DocMemoModal — 문서함 리치텍스트 메모 작성·열람 패널.
 *
 * 레이아웃 전략:
 *   - createPortal(…, document.body) 로 DOM 트리 최상단에 붙임
 *   - top 오프셋: <header> 실측으로 macOS 드래그바·safe-area·배너 자동 반영
 *   - 디자인: Notion 스타일 — 대제목은 본문에, 헤더는 닫기+액션만
 */
import { createPortal } from "react-dom";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { confirmAsync } from "./ConfirmHost";

const MeetingEditor = lazy(() => import("./MeetingEditor"));

// ===== 타입 =====
type DocScope = "ALL" | "TEAM" | "PRIVATE" | "CUSTOM";
export type MemoDoc = {
  id: string;
  title: string;
  content: any;
  scope: DocScope;
  scopeTeam?: string | null;
  scopeUserIds?: string | null;
  folderId?: string | null;
  tags?: string | null;
  authorId?: string;
  author?: { name: string; avatarColor: string; avatarUrl?: string | null };
  createdAt: string;
  updatedAt: string;
};

type DirUser = { id: string; name: string; team?: string | null; avatarColor?: string; avatarUrl?: string | null };

type Props = {
  doc: MemoDoc | null;
  initialFolderId?: string | null;
  initialScope?: DocScope;
  projectId?: string | null;
  onClose: () => void;
  onSaved: (doc: MemoDoc) => void;
  onDeleted?: (id: string) => void;
};

const SCOPE_LABEL: Record<DocScope, string> = {
  ALL: "전체 공개",
  TEAM: "팀 공개",
  PRIVATE: "나만 보기",
  CUSTOM: "사용자지정",
};

const SCOPE_DESC: Record<DocScope, string> = {
  ALL: "회사 구성원 누구나 열람",
  TEAM: "내 팀 구성원만 열람",
  PRIVATE: "나만 열람",
  CUSTOM: "지정한 구성원만 열람",
};

function measureHeaderBottom(): number {
  const h = document.querySelector("header");
  return h ? Math.round(h.getBoundingClientRect().bottom) : 48;
}

export default function DocMemoModal({
  doc,
  initialFolderId,
  initialScope = "ALL",
  projectId,
  onClose,
  onSaved,
  onDeleted,
}: Props) {
  const { user } = useAuth();

  // 편집·삭제 가능 여부: 작성자 본인 또는 전사 ADMIN. (서버 DELETE 권한과 동일)
  const isMine = !doc || doc.authorId === user?.id || user?.role === "ADMIN";
  const [editMode, setEditMode] = useState(!doc);

  const [title, setTitle] = useState(doc?.title ?? "");
  const [content, setContent] = useState<any>(
    doc?.content ?? { type: "doc", content: [{ type: "paragraph" }] }
  );
  const [scope, setScope] = useState<DocScope>(doc?.scope ?? initialScope);
  const [tags, setTags] = useState(doc?.tags ?? "");

  const [scopeUserIds, setScopeUserIds] = useState<string[]>(
    doc?.scopeUserIds
      ? doc.scopeUserIds.split(",").map((s) => s.trim()).filter(Boolean)
      : []
  );
  const [allUsers, setAllUsers] = useState<DirUser[]>([]);
  const [userSearch, setUserSearch] = useState("");

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ===== TopBar 하단 오프셋 실측 =====
  const [topOffset, setTopOffset] = useState<number>(measureHeaderBottom);
  useLayoutEffect(() => {
    function measure() { setTopOffset(measureHeaderBottom()); }
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    const header = document.querySelector("header");
    if (ro && header) ro.observe(header);
    window.addEventListener("resize", measure);
    return () => { ro?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  useEffect(() => {
    if (scope !== "CUSTOM" || allUsers.length > 0) return;
    let alive = true;
    api<{ users: DirUser[] }>("/api/users")
      .then((r) => { if (alive) setAllUsers(r.users); })
      .catch(() => {});
    return () => { alive = false; };
  }, [scope, allUsers.length]);

  const mentionFetcher = useCallback(async (q: string) => {
    try {
      const r = await api<{ users: any[] }>(
        `/api/meeting/mentionable?visibility=ALL&q=${encodeURIComponent(q)}`
      );
      return r.users ?? [];
    } catch { return []; }
  }, []);

  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!doc) setTimeout(() => titleRef.current?.focus(), 80);
  }, [doc]);

  // ===== 저장 =====
  async function handleSave() {
    if (!title.trim()) {
      setErr("제목을 입력해주세요");
      titleRef.current?.focus();
      return;
    }
    if (scope === "CUSTOM" && scopeUserIds.length === 0) {
      setErr("사용자지정 범위에선 최소 한 명을 선택해주세요");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const body: any = {
        title: title.trim(),
        content,
        scope: projectId ? undefined : scope,
        scopeUserIds: !projectId && scope === "CUSTOM" ? scopeUserIds : undefined,
        tags: tags.trim() || undefined,
        folderId: doc?.folderId ?? initialFolderId ?? null,
        projectId: projectId ?? null,
      };
      let saved: MemoDoc;
      if (doc) {
        const r = await api<{ document: MemoDoc }>(`/api/document/${doc.id}`, { method: "PATCH", json: body });
        saved = r.document;
      } else {
        const r = await api<{ document: MemoDoc }>("/api/document", { method: "POST", json: body });
        saved = r.document;
      }
      setEditMode(false);
      onSaved(saved);
    } catch (e: any) {
      setErr(e?.message ?? "저장에 실패했어요");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (!doc) { onClose(); return; }
    setTitle(doc.title);
    setContent(doc.content ?? { type: "doc", content: [{ type: "paragraph" }] });
    setScope(doc.scope);
    setScopeUserIds(doc.scopeUserIds ? doc.scopeUserIds.split(",").map((s) => s.trim()).filter(Boolean) : []);
    setTags(doc.tags ?? "");
    setErr(null);
    setEditMode(false);
  }

  // ===== 삭제 ===== (작성자/ADMIN 만 버튼 노출 + 서버에서 한 번 더 검증)
  async function handleDelete() {
    if (!doc || deleting) return;
    const ok = await confirmAsync({
      title: "메모 삭제",
      description: `"${doc.title || "제목 없음"}" 메모를 삭제할까요? 삭제하면 목록에서 사라져요.`,
      confirmLabel: "삭제",
      cancelLabel: "취소",
      tone: "danger",
    });
    if (!ok) return;
    setDeleting(true);
    setErr(null);
    try {
      await api(`/api/document/${doc.id}`, { method: "DELETE" });
      onDeleted?.(doc.id);
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "삭제에 실패했어요");
      setDeleting(false);
    }
  }

  const handleContentChange = useCallback((json: any) => setContent(json), []);

  const filteredUsers = userSearch.trim()
    ? allUsers.filter((u) => u.name.includes(userSearch) || (u.team ?? "").includes(userSearch))
    : allUsers;

  const dateStr = doc
    ? new Date(doc.updatedAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })
    : "";

  return createPortal(
    <>
      <div
        className="fixed left-0 right-0 bottom-0 z-[60] flex flex-col bg-[color:var(--c-bg)]"
        style={{ top: topOffset }}
      >
        {/* ===== 헤더 — 닫기 + 경로 표시 + 우측 액션 ===== */}
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 h-12 border-b border-ink-150 bg-[color:var(--c-surface)]">
          {/* 왼쪽: 닫기 + 경로 */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={onClose}
              className="btn-icon flex-shrink-0"
              aria-label="닫기"
              title="닫기 (Esc)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
            <div className="flex items-center gap-1.5 text-[12px] text-ink-400 min-w-0">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
              </svg>
              <span className="truncate font-medium">
                {editMode && !title ? "새 메모" : (title || "제목 없음")}
              </span>
            </div>
          </div>

          {/* 오른쪽: 액션 (공개 범위는 본문 카드에서 선택) */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {editMode ? (
              <>
                <button className="btn-ghost btn-sm" onClick={handleCancel} disabled={saving}>
                  취소
                </button>
                <button className="btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                  {saving ? "저장 중…" : doc ? "저장" : "만들기"}
                </button>
              </>
            ) : (
              isMine && (
                <>
                  {doc && (
                    <button
                      className="btn-ghost btn-sm text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30"
                      onClick={handleDelete}
                      disabled={deleting}
                      title="메모 삭제"
                    >
                      {deleting ? "삭제 중…" : "삭제"}
                    </button>
                  )}
                  <button className="btn-ghost btn-sm" onClick={() => setEditMode(true)} disabled={deleting}>
                    편집
                  </button>
                </>
              )
            )}
          </div>
        </div>

        {/* 오류 띠 */}
        {err && (
          <div className="flex-shrink-0 flex items-center gap-2 px-5 py-2 bg-rose-50 border-b border-rose-200 text-[12px] text-rose-700">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {err}
          </div>
        )}

        {/* ===== 본문 ===== */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-[740px] mx-auto px-6 md:px-10 pt-10 pb-16">

            {/* ── 대제목 ── */}
            {editMode ? (
              <input
                ref={titleRef}
                className="w-full text-[26px] md:text-[30px] font-extrabold text-ink-900 bg-transparent border-none outline-none placeholder:text-ink-300 leading-tight mb-3"
                placeholder="제목 없음"
                value={title}
                onChange={(e) => { setTitle(e.target.value); if (err) setErr(null); }}
                maxLength={200}
                onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
              />
            ) : (
              <h1 className="text-[26px] md:text-[30px] font-extrabold text-ink-900 leading-tight mb-3">
                {title || <span className="text-ink-300">제목 없음</span>}
              </h1>
            )}

            {/* ── 메타 (열람 모드) ── */}
            {!editMode && doc && (
              <div className="flex items-center gap-2 mb-4 text-[12px] text-ink-400">
                <div
                  className="w-5 h-5 rounded grid place-items-center text-white text-[9px] font-bold flex-shrink-0 overflow-hidden"
                  style={{ background: doc.author?.avatarUrl ? "transparent" : (doc.author?.avatarColor ?? "#6B7280") }}
                >
                  {doc.author?.avatarUrl
                    ? <img src={doc.author.avatarUrl} alt={doc.author.name} className="w-full h-full object-cover" />
                    : (doc.author?.name?.[0] ?? "?")
                  }
                </div>
                <span className="font-semibold text-ink-600">{doc.author?.name ?? "알 수 없음"}</span>
                <span className="text-ink-200">·</span>
                <span>{dateStr}</span>
                {!projectId && (
                  <>
                    <span className="text-ink-200">·</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                      scope === "PRIVATE" ? "bg-rose-50 text-rose-700"
                      : scope === "TEAM" ? "bg-sky-50 text-sky-700"
                      : scope === "CUSTOM" ? "bg-violet-50 text-violet-700"
                      : "bg-emerald-50 text-emerald-700"
                    }`}>
                      <ScopeIcon scope={scope} />
                      {SCOPE_LABEL[scope]}
                    </span>
                  </>
                )}
              </div>
            )}

            {/* ── 태그 ── */}
            {editMode ? (
              <input
                className="block w-full text-[12px] text-ink-400 placeholder:text-ink-300 bg-transparent border-none outline-none mb-1"
                placeholder="# 태그 입력 (쉼표로 구분, 예: 기획, 아이디어)"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                maxLength={200}
              />
            ) : (tags || doc?.tags) ? (
              <div className="flex flex-wrap gap-1 mb-1">
                {((doc?.tags ?? tags) || "").split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
                  <span key={t} className="chip-gray text-[11px]">#{t}</span>
                ))}
              </div>
            ) : null}

            {/* ── 공개 범위 (편집 모드 · 전역 메모) — 회의록과 동일한 카드형 선택 ── */}
            {editMode && !projectId && (
              <div className="mt-5 rounded-2xl border border-ink-150 bg-[color:var(--c-surface)] p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-400">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
                  </svg>
                  <span className="text-[12px] font-bold text-ink-700">공개 범위</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(["ALL", "TEAM", "PRIVATE", "CUSTOM"] as DocScope[]).map((s) => {
                    const active = scope === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setScope(s)}
                        className={`text-left p-3 rounded-xl border-2 transition ${
                          active ? "border-brand-500 bg-brand-50" : "border-ink-150 hover:bg-ink-50"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <ScopeIcon scope={s} size={13} className={active ? "text-brand-600" : "text-ink-400"} />
                          <span className={`text-[12.5px] font-bold ${active ? "text-brand-700" : "text-ink-800"}`}>{SCOPE_LABEL[s]}</span>
                        </div>
                        <div className="text-[11px] text-ink-500 leading-snug">{SCOPE_DESC[s]}</div>
                      </button>
                    );
                  })}
                </div>

                {/* CUSTOM — 열람자 지정 */}
                {scope === "CUSTOM" && (
                  <div className="mt-3 pt-3 border-t border-ink-100 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-bold text-violet-700">열람 가능:</span>
                    {scopeUserIds.length === 0 && (
                      <span className="text-[11px] text-ink-400">아직 선택된 구성원이 없어요</span>
                    )}
                    {scopeUserIds.map((uid) => {
                      const u = allUsers.find((x) => x.id === uid);
                      return (
                        <span key={uid} className="flex items-center gap-1 bg-white border border-violet-200 rounded-full px-2 py-0.5 text-[11px] font-bold text-violet-800">
                          {u?.name ?? uid.slice(0, 8)}
                          <button type="button" onClick={() => setScopeUserIds((p) => p.filter((x) => x !== uid))} className="text-violet-400 hover:text-violet-700">×</button>
                        </span>
                      );
                    })}
                    <div className="relative">
                      <input
                        className="h-6 px-2 text-[11px] border border-violet-200 rounded-full focus:outline-none focus:ring-1 focus:ring-violet-400 w-28 bg-white"
                        placeholder="이름 검색"
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                      />
                      {userSearch && (
                        <div className="absolute left-0 top-full mt-1 w-[200px] bg-white border border-ink-200 rounded-xl shadow-lg z-[70] max-h-[180px] overflow-y-auto">
                          {filteredUsers.filter((u) => !scopeUserIds.includes(u.id)).length === 0 ? (
                            <div className="px-3 py-2 text-[12px] text-ink-500">없음</div>
                          ) : filteredUsers.filter((u) => !scopeUserIds.includes(u.id)).map((u) => (
                            <button key={u.id} type="button"
                              onClick={() => { setScopeUserIds((p) => [...p, u.id]); setUserSearch(""); }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-ink-50 text-left"
                            >
                              <div className="w-5 h-5 rounded grid place-items-center text-white text-[9px] font-bold flex-shrink-0 overflow-hidden"
                                style={{ background: u.avatarUrl ? "transparent" : (u.avatarColor ?? "#6B7280") }}>
                                {u.avatarUrl ? <img src={u.avatarUrl} alt={u.name} className="w-full h-full object-cover" /> : u.name[0]}
                              </div>
                              <span className="text-[12px] text-ink-800 font-semibold">
                                {u.name}
                                {u.team && <span className="text-ink-400 font-normal ml-1">· {u.team}</span>}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── 구분선 ── */}
            <div className="border-t border-ink-100 mt-5 mb-6" />

            {/* ── TipTap 에디터 ── */}
            <Suspense fallback={
              <div className="py-12 flex items-center justify-center gap-2 text-[12px] text-ink-400">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin">
                  <path d="M21 12a9 9 0 1 1-6.2-8.6" />
                </svg>
                에디터 불러오는 중…
              </div>
            }>
              <MeetingEditor
                value={content}
                onChange={editMode ? handleContentChange : undefined}
                editable={editMode}
                placeholder="여기에 내용을 작성하세요…"
                mentionFetcher={editMode ? mentionFetcher : undefined}
              />
            </Suspense>

          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

function ScopeIcon({ scope, className = "", size = 10 }: { scope: DocScope; className?: string; size?: number }) {
  if (scope === "PRIVATE") return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
  if (scope === "TEAM") return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
  if (scope === "CUSTOM") return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 8 12 12 14 14" />
    </svg>
  );
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
