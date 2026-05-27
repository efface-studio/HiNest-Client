/**
 * DocMemoModal — 문서함 내 리치텍스트 메모 작성·열람 모달.
 *
 * 사용 케이스:
 *   1. 새 메모 작성  : doc=null, initialFolderId 전달 → 저장 후 onSaved(doc) 호출
 *   2. 기존 메모 열람 : doc 전달 → 본인/ADMIN 이면 편집 가능 (수정 후 onSaved 호출)
 *   3. 타인 메모 열람 : doc 전달, 본인 아님 → 읽기 전용 렌더링
 *
 * UI 구조:
 *   - 헤더: 제목 입력 + 공개범위 칩 + 저장/취소
 *   - 본문: MeetingEditor (TipTap, 기존 회의록과 동일 컴포넌트)
 *   - 풀스크린 오버레이 (z-50)
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";

// TipTap 에디터는 무거운 번들 → 모달이 열릴 때 lazy 로드.
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
  author: { name: string; avatarColor: string; avatarUrl?: string | null };
  createdAt: string;
  updatedAt: string;
};

type DirUser = { id: string; name: string; team?: string | null; avatarColor?: string; avatarUrl?: string | null };

type Props = {
  /** 기존 메모 열람/수정. null 이면 새로 만들기. */
  doc: MemoDoc | null;
  /** 새 메모 생성 시 배치할 폴더 (null = 루트) */
  initialFolderId?: string | null;
  /** 새 메모 생성 시 기본 스코프 */
  initialScope?: DocScope;
  /** 새 메모 생성 시 프로젝트 연결 */
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

  // 읽기 전용 여부 — 본인 글이거나 ADMIN 이면 편집 가능
  const isMine = !doc || doc.authorId === user?.id || user?.role === "ADMIN";
  // 새 메모면 처음부터 편집 모드
  const [editMode, setEditMode] = useState(!doc);

  const [title, setTitle] = useState(doc?.title ?? "");
  const [content, setContent] = useState<any>(
    doc?.content ?? { type: "doc", content: [{ type: "paragraph" }] }
  );
  const [scope, setScope] = useState<DocScope>(doc?.scope ?? initialScope);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [tags, setTags] = useState(doc?.tags ?? "");

  // CUSTOM 전용 유저 선택
  const [scopeUserIds, setScopeUserIds] = useState<string[]>(
    doc?.scopeUserIds
      ? doc.scopeUserIds.split(",").map((s) => s.trim()).filter(Boolean)
      : []
  );
  const [allUsers, setAllUsers] = useState<DirUser[]>([]);
  const [userSearch, setUserSearch] = useState("");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 저장 후 "저장됨" 토스트
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // CUSTOM 선택 시 유저 로드
  useEffect(() => {
    if (scope !== "CUSTOM" || allUsers.length > 0) return;
    let alive = true;
    api<{ users: DirUser[] }>("/api/users")
      .then((r) => { if (alive) setAllUsers(r.users); })
      .catch(() => {});
    return () => { alive = false; };
  }, [scope, allUsers.length]);

  // mentionFetcher — CUSTOM 메모에선 지정 유저만 멘션 가능. 간단히 ALL 기준 사용.
  const mentionFetcher = useCallback(async (q: string) => {
    try {
      const r = await api<{ users: any[] }>(
        `/api/meeting/mentionable?visibility=ALL&q=${encodeURIComponent(q)}`
      );
      return r.users ?? [];
    } catch {
      return [];
    }
  }, []);

  const titleRef = useRef<HTMLInputElement>(null);
  // 새 메모면 제목 자동 포커스
  useEffect(() => {
    if (!doc) {
      titleRef.current?.focus();
    }
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
        const r = await api<{ document: MemoDoc }>(`/api/document/${doc.id}`, {
          method: "PATCH",
          json: body,
        });
        saved = r.document;
      } else {
        const r = await api<{ document: MemoDoc }>("/api/document", {
          method: "POST",
          json: body,
        });
        saved = r.document;
      }
      setSavedAt(Date.now());
      setEditMode(false);
      onSaved(saved);
    } catch (e: any) {
      setErr(e?.message ?? "저장에 실패했어요");
    } finally {
      setSaving(false);
    }
  }

  const handleContentChange = useCallback((json: any) => {
    setContent(json);
  }, []);

  // 필터된 유저 목록 (CUSTOM 검색)
  const filteredUsers = userSearch.trim()
    ? allUsers.filter((u) =>
        u.name.includes(userSearch) ||
        (u.team ?? "").includes(userSearch)
      )
    : allUsers;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[color:var(--c-bg)]"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* ===== 헤더 바 ===== */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 md:px-6 h-14 border-b border-ink-150 bg-[color:var(--c-surface)]">
        {/* 닫기 */}
        <button
          onClick={onClose}
          className="btn-icon flex-shrink-0"
          aria-label="닫기"
          title="닫기"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        {/* 제목 */}
        {editMode ? (
          <input
            ref={titleRef}
            className="flex-1 min-w-0 text-[15px] font-bold bg-transparent border-none outline-none text-ink-900 placeholder:text-ink-400"
            placeholder="메모 제목"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
          />
        ) : (
          <h1 className="flex-1 min-w-0 text-[15px] font-bold text-ink-900 truncate">
            {title || "제목 없음"}
          </h1>
        )}

        {/* 공개 범위 칩 (편집 모드에만 토글 드롭다운) */}
        {!projectId && (
          <div className="relative flex-shrink-0">
            <button
              type="button"
              disabled={!editMode}
              onClick={() => editMode && setScopeOpen((o) => !o)}
              className={`flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[11px] font-bold border transition ${
                scope === "PRIVATE"
                  ? "bg-rose-50 border-rose-200 text-rose-700"
                  : scope === "TEAM"
                  ? "bg-sky-50 border-sky-200 text-sky-700"
                  : scope === "CUSTOM"
                  ? "bg-violet-50 border-violet-200 text-violet-700"
                  : "bg-green-50 border-green-200 text-green-700"
              } ${editMode ? "hover:opacity-80 cursor-pointer" : "cursor-default"}`}
              title={editMode ? "공개 범위 변경" : SCOPE_DESC[scope]}
            >
              <ScopeIcon scope={scope} />
              {SCOPE_LABEL[scope]}
              {editMode && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              )}
            </button>

            {scopeOpen && (
              <div className="absolute right-0 top-full mt-1 w-[240px] bg-[color:var(--c-surface)] border border-ink-200 rounded-xl shadow-xl z-10 overflow-hidden">
                {(["ALL", "TEAM", "PRIVATE", "CUSTOM"] as DocScope[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => { setScope(s); setScopeOpen(false); }}
                    className={`w-full flex items-start gap-3 px-4 py-2.5 hover:bg-ink-50 transition ${
                      scope === s ? "bg-brand-50" : ""
                    }`}
                  >
                    <ScopeIcon scope={s} className="mt-0.5 flex-shrink-0 text-ink-500" />
                    <div className="text-left">
                      <div className={`text-[12px] font-bold ${scope === s ? "text-brand-700" : "text-ink-800"}`}>
                        {SCOPE_LABEL[s]}
                      </div>
                      <div className="text-[11px] text-ink-500">{SCOPE_DESC[s]}</div>
                    </div>
                    {scope === s && (
                      <svg className="ml-auto flex-shrink-0 text-brand-600" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 오른쪽 액션 */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {savedAt !== null && !editMode && (
            <span className="text-[11px] text-ink-400 tabular hidden sm:block">
              저장됨
            </span>
          )}
          {editMode ? (
            <>
              <button
                className="btn-ghost btn-sm"
                onClick={() => {
                  if (!doc) { onClose(); return; }
                  // 기존 메모 편집 취소 → 원본으로 복원
                  setTitle(doc.title);
                  setContent(doc.content ?? { type: "doc", content: [{ type: "paragraph" }] });
                  setScope(doc.scope);
                  setScopeUserIds(
                    doc.scopeUserIds
                      ? doc.scopeUserIds.split(",").map((s) => s.trim()).filter(Boolean)
                      : []
                  );
                  setTags(doc.tags ?? "");
                  setErr(null);
                  setEditMode(false);
                }}
                disabled={saving}
              >
                취소
              </button>
              <button
                className="btn-primary btn-sm"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "저장 중…" : doc ? "저장" : "메모 만들기"}
              </button>
            </>
          ) : (
            isMine && (
              <button
                className="btn-ghost btn-sm"
                onClick={() => setEditMode(true)}
              >
                편집
              </button>
            )
          )}
        </div>
      </div>

      {/* ===== CUSTOM 유저 선택 패널 (편집 모드 + CUSTOM scope) ===== */}
      {editMode && scope === "CUSTOM" && (
        <div className="flex-shrink-0 border-b border-ink-150 bg-violet-50 px-4 md:px-6 py-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold text-violet-700">열람 가능:</span>
          {scopeUserIds.map((uid) => {
            const u = allUsers.find((x) => x.id === uid);
            return (
              <span key={uid} className="flex items-center gap-1 bg-white border border-violet-200 rounded-full px-2 py-0.5 text-[11px] font-bold text-violet-800">
                {u?.name ?? uid.slice(0, 8)}
                <button
                  type="button"
                  onClick={() => setScopeUserIds((p) => p.filter((x) => x !== uid))}
                  className="text-violet-400 hover:text-violet-700"
                  aria-label={`${u?.name ?? uid} 제거`}
                >
                  ×
                </button>
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
              <div className="absolute left-0 top-full mt-1 w-[200px] bg-white border border-ink-200 rounded-xl shadow-lg z-20 max-h-[180px] overflow-y-auto">
                {filteredUsers.length === 0 ? (
                  <div className="px-3 py-2 text-[12px] text-ink-500">없음</div>
                ) : (
                  filteredUsers
                    .filter((u) => !scopeUserIds.includes(u.id))
                    .map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          setScopeUserIds((p) => [...p, u.id]);
                          setUserSearch("");
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-ink-50 text-left"
                      >
                        <div className="w-5 h-5 rounded grid place-items-center text-white text-[9px] font-bold flex-shrink-0 overflow-hidden" style={{ background: u.avatarUrl ? "transparent" : (u.avatarColor ?? "#6B7280") }}>
                          {u.avatarUrl ? <img src={u.avatarUrl} alt={u.name} className="w-full h-full object-cover" /> : u.name[0]}
                        </div>
                        <div className="text-[12px] text-ink-800 font-semibold">{u.name}
                          {u.team && <span className="text-ink-400 font-normal ml-1">· {u.team}</span>}
                        </div>
                      </button>
                    ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 오류 메시지 */}
      {err && (
        <div className="flex-shrink-0 mx-4 md:mx-6 mt-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-[12px] text-rose-700">
          {err}
        </div>
      )}

      {/* ===== 에디터 본문 ===== */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[860px] mx-auto px-4 md:px-10 py-6">
          {/* 메타 정보 (열람 모드) */}
          {!editMode && doc && (
            <div className="flex items-center gap-2 mb-4 text-[11px] text-ink-400">
              <div className="w-5 h-5 rounded grid place-items-center text-white text-[9px] font-bold flex-shrink-0 overflow-hidden" style={{ background: doc.author.avatarUrl ? "transparent" : (doc.author.avatarColor ?? "#6B7280") }}>
                {doc.author.avatarUrl ? <img src={doc.author.avatarUrl} alt={doc.author.name} className="w-full h-full object-cover" /> : doc.author.name[0]}
              </div>
              <span className="font-semibold text-ink-600">{doc.author.name}</span>
              <span>·</span>
              <span>{new Date(doc.updatedAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })}</span>
            </div>
          )}

          {/* 태그 (편집 모드) */}
          {editMode && (
            <div className="mb-3">
              <input
                className="w-full bg-transparent text-[12px] text-ink-500 placeholder:text-ink-300 border-none outline-none"
                placeholder="태그 입력 (쉼표로 구분, 예: 기획, 아이디어)"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                maxLength={200}
              />
            </div>
          )}

          {/* 태그 표시 (열람 모드) */}
          {!editMode && (tags || doc?.tags) && (
            <div className="flex flex-wrap gap-1 mb-4">
              {((tags || doc?.tags) ?? "").split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
                <span key={t} className="chip-gray text-[11px]">#{t}</span>
              ))}
            </div>
          )}

          {/* TipTap 에디터 */}
          <Suspense fallback={
            <div className="h-40 flex items-center justify-center text-[12px] text-ink-400">
              에디터 불러오는 중…
            </div>
          }>
            <MeetingEditor
              value={content}
              onChange={editMode ? handleContentChange : undefined}
              editable={editMode}
              placeholder="여기에 메모를 작성하세요. '/' 로 블록을 삽입할 수 있어요."
              mentionFetcher={editMode ? mentionFetcher : undefined}
            />
          </Suspense>

          {/* 편집 모드 하단 저장 버튼 (긴 문서에서 스크롤 내려야 저장 버튼이 안 보이는 문제 방지) */}
          {editMode && (
            <div className="mt-8 flex items-center justify-between gap-3 pt-4 border-t border-ink-150">
              {err ? (
                <span className="text-[12px] text-rose-600">{err}</span>
              ) : (
                <span className="text-[11px] text-ink-400">변경사항은 저장 버튼을 눌러야 반영돼요.</span>
              )}
              <div className="flex gap-2">
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    if (!doc) { onClose(); return; }
                    setTitle(doc.title);
                    setContent(doc.content ?? { type: "doc", content: [{ type: "paragraph" }] });
                    setScope(doc.scope);
                    setScopeUserIds(doc.scopeUserIds ? doc.scopeUserIds.split(",").map((s) => s.trim()).filter(Boolean) : []);
                    setTags(doc.tags ?? "");
                    setErr(null);
                    setEditMode(false);
                  }}
                  disabled={saving}
                >
                  취소
                </button>
                <button className="btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                  {saving ? "저장 중…" : doc ? "저장" : "메모 만들기"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 드롭다운 외부 클릭 닫기 */}
      {scopeOpen && (
        <div className="fixed inset-0 z-[9]" onClick={() => setScopeOpen(false)} />
      )}
    </div>
  );
}

// ===== 아이콘 =====
function ScopeIcon({ scope, className = "" }: { scope: DocScope; className?: string }) {
  if (scope === "PRIVATE") return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
  if (scope === "TEAM") return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
  if (scope === "CUSTOM") return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 8 12 12 14 14" />
    </svg>
  );
  // ALL
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
