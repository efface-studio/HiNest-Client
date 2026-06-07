import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api , imgSrc} from "../api";
import { useAuth } from "../auth";
import PageHeader from "../components/PageHeader";
import type { MemoDoc } from "../components/DocMemoModal";

// DocMemoModal 은 TipTap(무거운 번들)을 포함 → 실제 열릴 때만 로드.
const DocMemoModal = lazy(() => import("../components/DocMemoModal"));

// ===== 타입 =====
type DocScope = "ALL" | "TEAM" | "PRIVATE" | "CUSTOM";

type Memo = {
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

type ScopeTab = "all" | "team" | "private";
const SCOPE_TABS: { key: ScopeTab; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "team", label: "팀" },
  { key: "private", label: "나만" },
];

const SCOPE_LABEL: Record<DocScope, string> = {
  ALL: "전체 공개",
  TEAM: "팀 공개",
  PRIVATE: "나만 보기",
  CUSTOM: "사용자지정",
};

// ===== TipTap JSON → 평문 추출 (미리보기용) =====
function extractText(node: any, limit = 200): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (!node.content) return "";
  let result = "";
  for (const child of node.content) {
    result += extractText(child, limit);
    if (result.length >= limit) break;
  }
  return result;
}

// ===== 날짜 포맷 =====
function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

// ===== 메모 카드 =====
function MemoCard({ memo, onClick }: { memo: Memo; onClick: () => void }) {
  const preview = extractText(memo.content);
  const tags = (memo.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);

  const badge = memo.scope !== "ALL" && (
    <span className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-[2px] rounded ${
      memo.scope === "PRIVATE"
        ? "bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
        : memo.scope === "TEAM"
        ? "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"
        : "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
    }`}>
      {SCOPE_LABEL[memo.scope]}{memo.scope === "TEAM" && memo.scopeTeam ? ` · ${memo.scopeTeam}` : ""}
    </span>
  );

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full text-left rounded-2xl border border-ink-100 bg-white dark:bg-ink-900 dark:border-ink-800
                 p-5 flex flex-col min-h-[210px] hover:border-brand-300 hover:shadow-md transition-all duration-150
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      {/* 배지 + 제목 — 같은 줄(배지 인라인) */}
      <div className="flex items-start gap-1.5">
        {badge}
        <h3 className="text-[14px] font-bold text-ink-900 dark:text-ink-50 line-clamp-2 group-hover:text-brand-700 dark:group-hover:text-brand-400 transition-colors">
          {memo.title || "(제목 없음)"}
        </h3>
      </div>

      {/* 본문 미리보기 */}
      {preview && (
        <p className="text-[12px] text-ink-500 dark:text-ink-400 line-clamp-4 leading-relaxed mt-2.5">
          {preview}
        </p>
      )}

      {/* 태그 */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2.5">
          {tags.slice(0, 4).map((t) => (
            <span key={t} className="text-[10px] font-medium px-1.5 py-[1px] rounded bg-ink-100 dark:bg-ink-800 text-ink-500 dark:text-ink-400">
              #{t}
            </span>
          ))}
        </div>
      )}

      {/* 하단 — 구분선 위, 작성자(좌) + 날짜(우) */}
      <div className="flex items-center gap-2 mt-auto pt-3 border-t border-ink-100 dark:border-ink-800/70">
        <div
          className="w-6 h-6 rounded-full grid place-items-center text-white text-[10px] font-bold flex-shrink-0 overflow-hidden"
          style={{ background: memo.author?.avatarUrl ? "transparent" : (memo.author?.avatarColor ?? "#6B7280") }}
        >
          {memo.author?.avatarUrl ? (
            <img src={imgSrc(memo.author.avatarUrl)} alt={memo.author.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
          ) : (
            memo.author?.name?.[0] ?? "?"
          )}
        </div>
        <span className="text-[12px] font-medium text-ink-600 dark:text-ink-300 truncate flex-1">{memo.author?.name ?? "알 수 없음"}</span>
        <span className="text-[11px] text-ink-400 dark:text-ink-500 flex-shrink-0">{relativeDate(memo.updatedAt)}</span>
      </div>
    </button>
  );
}

// ===== 빈 상태 =====
function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-5 text-center">
      <div className="w-20 h-20 rounded-3xl bg-violet-50 dark:bg-violet-900/30 grid place-items-center">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round" className="text-violet-500">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      </div>
      <div>
        <p className="text-[15px] font-bold text-ink-800 dark:text-ink-100">아직 메모가 없어요</p>
        <p className="text-[13px] text-ink-400 mt-1">자유롭게 생각을 기록해 보세요.</p>
      </div>
      <button type="button" className="btn-primary" onClick={onNew}>
        첫 메모 작성하기
      </button>
    </div>
  );
}

// ===== 스켈레톤 카드 =====
function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-ink-100 dark:border-ink-800 bg-white dark:bg-ink-900 p-5 flex flex-col gap-3 animate-pulse">
      <div className="h-3.5 bg-ink-100 dark:bg-ink-800 rounded w-3/4" />
      <div className="h-3 bg-ink-100 dark:bg-ink-800 rounded w-full" />
      <div className="h-3 bg-ink-100 dark:bg-ink-800 rounded w-5/6" />
      <div className="h-3 bg-ink-100 dark:bg-ink-800 rounded w-2/3" />
      <div className="flex items-center gap-2 pt-2">
        <div className="w-5 h-5 rounded-full bg-ink-100 dark:bg-ink-800" />
        <div className="h-3 bg-ink-100 dark:bg-ink-800 rounded w-16" />
      </div>
    </div>
  );
}

// ===== 메인 페이지 =====
export default function MemosPage() {
  const { user } = useAuth();
  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  const [scopeTab, setScopeTab] = useState<ScopeTab>("all");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [memoTarget, setMemoTarget] = useState<Memo | "new" | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // q 디바운스 300ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ type: "memo" });
    if (scopeTab === "team") params.set("scope", "team");
    else if (scopeTab === "private") params.set("scope", "private");
    if (debouncedQ) params.set("q", debouncedQ);
    api<{ documents: Memo[] }>(`/api/document?${params}`)
      .then((r) => setMemos(r.documents))
      .catch(() => setMemos([]))
      .finally(() => setLoading(false));
  }, [scopeTab, debouncedQ]);

  useEffect(() => {
    load();
  }, [load]);

  // Cmd/Ctrl+K → 검색 포커스
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const handleSaved = (saved: MemoDoc) => {
    setMemoTarget(saved as unknown as Memo);
    setMemos((prev) => {
      const idx = prev.findIndex((m) => m.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...saved };
        return next;
      }
      return [saved as unknown as Memo, ...prev];
    });
  };

  const handleDeleted = (id: string) => {
    setMemoTarget(null);
    setMemos((prev) => prev.filter((m) => m.id !== id));
  };

  const initialScope =
    scopeTab === "team" ? "TEAM" : scopeTab === "private" ? "PRIVATE" : "ALL";

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        eyebrow="자료"
        title="메모"
        description="생각과 아이디어를 자유롭게 기록합니다."
        right={
          <button type="button" className="btn-primary" onClick={() => setMemoTarget("new")}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" className="inline-block mr-1.5">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            새 메모
          </button>
        }
      />

      {/* 검색 + 스코프 탭 */}
      <div className="flex flex-wrap items-center gap-3">
        {/* 스코프 탭 */}
        <div className="flex items-center bg-ink-100 dark:bg-ink-800 rounded-xl p-1 gap-0.5">
          {SCOPE_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setScopeTab(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                scopeTab === tab.key
                  ? "bg-white dark:bg-ink-700 text-ink-900 dark:text-ink-50 shadow-sm"
                  : "text-ink-500 dark:text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 검색 */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" width="13" height="13"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            placeholder="메모 검색…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={80}
            className="w-full pl-9 pr-3 py-2 text-[13px] rounded-xl border border-ink-200 dark:border-ink-700
                       bg-white dark:bg-ink-900 text-ink-900 dark:text-ink-50 placeholder-ink-400
                       focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* 건수 */}
        {!loading && (
          <span className="text-[12px] text-ink-400 dark:text-ink-500 ml-auto">
            {memos.length}개
          </span>
        )}
      </div>

      {/* 카드 그리드 */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : memos.length === 0 ? (
        <EmptyState onNew={() => setMemoTarget("new")} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {memos.map((m) => (
            <MemoCard key={m.id} memo={m} onClick={() => setMemoTarget(m)} />
          ))}
        </div>
      )}

      {/* 메모 편집/열람 모달 */}
      {memoTarget !== null && (
        <Suspense fallback={null}>
          <DocMemoModal
            doc={memoTarget === "new" ? null : (memoTarget as MemoDoc)}
            initialScope={memoTarget === "new" ? initialScope : undefined}
            projectId={null}
            onClose={() => setMemoTarget(null)}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
          />
        </Suspense>
      )}
    </div>
  );
}
