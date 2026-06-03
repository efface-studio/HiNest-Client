import { useEffect, useMemo, useRef, useState } from "react";
import { api, apiSWR, apiFetch , imgSrc} from "../api";
import { alertAsync, confirmAsync } from "./ConfirmHost";
import DatePicker from "./DatePicker";
import { safeAttachmentUrl } from "../lib/safeUrl";
import { isCapacitorNative } from "../lib/platform";
import { Browser } from "@capacitor/browser";

type Status = "BUG" | "IN_PROGRESS" | "NEEDS_FIX" | "NEEDS_TEST" | "DONE" | "ON_HOLD";
type Priority = "LOW" | "NORMAL" | "HIGH";
type Platform = "WEB" | "IOS" | "ANDROID" | "MAC_APP" | "WINDOWS_APP" | "OTHER";
type AttachmentKind = "IMAGE" | "VIDEO" | "FILE";

type QaUser = { id: string; name: string; avatarColor: string; avatarUrl?: string | null };

type Attachment = {
  id: string;
  qaItemId: string;
  url: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: AttachmentKind;
  createdAt: string;
};

type QaItem = {
  id: string;
  projectId: string;
  title: string;
  note: string | null;
  screen: string | null;
  platform: Platform | null;
  assigneeId: string | null;
  status: Status;
  priority: Priority;
  sortOrder: number;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  createdBy: QaUser | null;
  resolvedBy: QaUser | null;
  assignee: QaUser | null;
  attachments: Attachment[];
};

type Member = { id: string; name: string; avatarColor: string; avatarUrl?: string | null };

// 상태 순서 — 필터 탭/드롭다운에서 좌→우, 위→아래 순.
// BUG(리포트) → IN_PROGRESS(수정 중) → DONE(완료) / ON_HOLD(보류).
const STATUS_ORDER: Status[] = ["BUG", "IN_PROGRESS", "NEEDS_FIX", "NEEDS_TEST", "DONE", "ON_HOLD"];
const STATUS_LABEL: Record<Status, string> = {
  BUG: "오류",
  IN_PROGRESS: "수정 중",
  NEEDS_FIX: "수정필요",
  NEEDS_TEST: "테스트 요망",
  DONE: "완료",
  ON_HOLD: "보류",
};

// Notion 태그 스타일의 파스텔 톤 — styles.css 의 chip-* 토큰 재활용로
// 라이트/다크 모두 대비 자동 보정.
const STATUS_CHIP: Record<Status, string> = {
  BUG: "chip chip-red",
  IN_PROGRESS: "chip chip-blue",
  NEEDS_FIX: "chip chip-orange",
  NEEDS_TEST: "chip chip-violet",
  DONE: "chip chip-green",
  ON_HOLD: "chip chip-amber",
};

// 행 좌측 마커 점 — 상태를 한눈에 인지할 수 있도록.
const STATUS_DOT: Record<Status, string> = {
  BUG: "#EF4444",
  IN_PROGRESS: "#3B82F6",
  NEEDS_FIX: "#F97316",
  NEEDS_TEST: "#8B5CF6",
  DONE: "#10B981",
  ON_HOLD: "#F59E0B",
};

const PRIORITY_ORDER: Priority[] = ["LOW", "NORMAL", "HIGH"];
const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: "낮음",
  NORMAL: "보통",
  HIGH: "높음",
};
const PRIORITY_CHIP: Record<Priority, string> = {
  LOW: "chip chip-gray",
  NORMAL: "chip chip-blue",
  HIGH: "chip chip-red",
};

const PLATFORM_ORDER: Platform[] = ["WEB", "IOS", "ANDROID", "MAC_APP", "WINDOWS_APP", "OTHER"];
const PLATFORM_LABEL: Record<Platform, string> = {
  WEB: "Web",
  IOS: "iOS",
  ANDROID: "Android",
  MAC_APP: "macOS 앱",
  WINDOWS_APP: "Windows 앱",
  OTHER: "기타",
};
const PLATFORM_ICON: Record<Platform, string> = {
  WEB: "🌐",
  IOS: "",
  ANDROID: "🤖",
  MAC_APP: "🖥",
  WINDOWS_APP: "🪟",
  OTHER: "📦",
};

type Filter = "ALL" | Status;

/** "방금 전 / N분 전 / N시간 전 / N일 전 / YYYY-MM-DD" — 행 좁은 공간용 */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!then) return "";
  const diff = Date.now() - then;
  if (diff < 0) return "방금";
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  const dt = new Date(then);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/**
 * 마감기한 뱃지 — 오늘/내일/N일 남음 또는 N일 지남 형태로 표시.
 * DONE 상태면 색상 강조를 빼서 이미 처리된 항목이 시선을 끌지 않게.
 */
function DueDateBadge({ dueDate, done }: { dueDate: string; done: boolean }) {
  const d = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  let label: string;
  if (diffDays === 0) label = "오늘";
  else if (diffDays === 1) label = "내일";
  else if (diffDays > 0) label = `${diffDays}일 남음`;
  else label = `${Math.abs(diffDays)}일 지남`;
  const overdue = diffDays < 0 && !done;
  const today0 = diffDays === 0 && !done;
  return (
    <span
      className={[
        "shrink-0 inline-flex items-center gap-0.5",
        overdue ? "text-red-600 font-semibold" : today0 ? "text-orange-600 font-semibold" : "text-ink-400",
      ].join(" ")}
      title={`마감: ${d.toLocaleDateString("ko-KR")}`}
    >
      <span aria-hidden>📅</span>
      <span>{label}</span>
    </span>
  );
}

function humanSize(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * 프로젝트 QA 체크리스트 — Notion 데이터베이스 뷰를 참고한 디자인.
 *
 * 구조
 *  - 상단 바: 제목 + 필터 탭(ALL/대기/통과/실패/생략) + 새 항목 추가 버튼
 *  - 테이블 헤더: 컬럼 라벨 (제목/상태/플랫폼/화면/담당자/우선순위)
 *  - 행: 클릭 시 아래로 펼쳐서 메모·첨부·상세 속성 편집
 *  - 맨 아래 "+ 새 QA 항목" 인라인 행
 *
 * 모바일(<= sm) 에서는 컬럼 대신 카드 스타일로 쌓여 렌더됨.
 */
export default function ProjectQaList({
  projectId,
  currentUserId,
  members,
}: {
  projectId: string;
  currentUserId?: string | null;
  members: Member[];
}) {
  const [items, setItems] = useState<QaItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [mineOnly, setMineOnly] = useState(false);
  // 검색어 — 제목/화면/메모/담당자 이름에 대해 대소문자 무시 부분일치.
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const quickInputRef = useRef<HTMLInputElement | null>(null);
  // 전체 섹션 접기/펼치기 — 로컬스토리지로 프로젝트별 상태 유지.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(`qa-collapsed:${projectId}`) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(`qa-collapsed:${projectId}`, collapsed ? "1" : "0"); } catch {}
  }, [collapsed, projectId]);
  // ⌘K / Ctrl+K — QA 섹션이 펼쳐진 상태일 때만 검색창에 포커스.
  // 채팅/문서 에디터 등 다른 입력에서의 단축키 충돌을 막기 위해
  // 활성 포커스가 textarea/contenteditable 일 땐 무시한다.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.key === "k" || e.key === "K")) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (collapsed) return;
      const t = document.activeElement as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed]);
  const [creating, setCreating] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  // 동시 PATCH 레이스 방어 — 같은 항목에 여러 필드를 연속 클릭 시
  // 응답이 뒤섞여 UI 가 이전 값으로 되돌아가는 것을 막는다.
  const pendingPatchTokens = useRef(new Map<string, number>());
  // 검색창 ref — ⌘/Ctrl+K 전역 포커스 단축키.
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const memberMap = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members],
  );

  // stale response 방어 — 프로젝트 전환/재로드 시.
  const tokenRef = useRef(0);

  async function load() {
    const my = ++tokenRef.current;
    await apiSWR<{ items: QaItem[] }>(`/api/project/${projectId}/qa`, {
      onCached: (r) => {
        if (my !== tokenRef.current) return;
        setItems(r.items);
        setLoaded(true);
      },
      onFresh: (r) => {
        if (my !== tokenRef.current) return;
        setItems(r.items);
        setLoaded(true);
      },
      onError: () => {
        if (my !== tokenRef.current) return;
        setLoaded(true);
      },
    });
  }

  useEffect(() => {
    tokenRef.current++;
    setItems([]);
    setLoaded(false);
    setExpandedId(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ---------- 업로드 ----------
  async function uploadToServer(file: File): Promise<{
    url: string; name: string; mimeType: string; sizeBytes: number;
    kind: AttachmentKind;
  }> {
    const fd = new FormData();
    fd.append("file", file);
    const r = await apiFetch("/api/upload", { method: "POST", body: fd });
    if (!r.ok) {
      let msg = "업로드 실패";
      try {
        const d = await r.json();
        if (d?.error) msg = d.error;
      } catch {}
      throw new Error(msg);
    }
    const d = (await r.json()) as {
      url: string; name: string; type: string; size: number;
      kind: "IMAGE" | "VIDEO" | "FILE";
    };
    return { url: d.url, name: d.name, mimeType: d.type, sizeBytes: d.size, kind: d.kind };
  }

  // ---------- CRUD ----------
  async function quickCreate(e?: React.FormEvent) {
    e?.preventDefault();
    const t = quickTitle.trim();
    if (!t || creating) return;
    setCreating(true);
    try {
      const r = await api<{ item: QaItem }>(`/api/project/${projectId}/qa`, {
        method: "POST",
        json: { title: t },
      });
      const newItem: QaItem = {
        ...r.item,
        createdBy: null,
        resolvedBy: null,
        assignee: r.item.assigneeId ? memberMap.get(r.item.assigneeId) ?? null : null,
        attachments: r.item.attachments ?? [],
      };
      setItems((prev) => [...prev, newItem]);
      setQuickTitle("");
      // 엔터로 추가하면 방금 만든 항목을 자동 확장하고 제목 입력창으로 포커스를 옮긴다.
      setExpandedId(newItem.id);
      // 다음 렌더 타이밍에 DOM 이 붙으면 data-qa-title-input 을 찾아 포커스.
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLInputElement>(
          `input[data-qa-title-input="${newItem.id}"]`,
        );
        el?.focus();
        el?.select();
      });
    } catch (err: any) {
      await alertAsync({ title: "추가 실패", description: err?.message ?? "추가에 실패했어요" });
    } finally {
      setCreating(false);
    }
  }

  async function patchItem(
    id: string,
    patch: Partial<Pick<QaItem, "status" | "priority" | "title" | "note" | "screen" | "platform" | "assigneeId" | "dueDate">>,
  ) {
    const snapshot = items;
    // 항목별 요청 토큰 — 마지막으로 발행한 요청만 응답 반영을 허용.
    // 예: 상태를 BUG→IN_PROGRESS→DONE 으로 빠르게 클릭하면 1·2번 요청 응답이
    // 늦게 도착해도 최종 상태를 덮어쓰지 않는다.
    const token = (pendingPatchTokens.current.get(id) ?? 0) + 1;
    pendingPatchTokens.current.set(id, token);
    // 낙관적 반영 (assignee join 은 memberMap 으로 즉시 구성)
    setItems((prev) =>
      prev.map((x) =>
        x.id === id
          ? {
              ...x,
              ...patch,
              assignee:
                "assigneeId" in patch
                  ? patch.assigneeId
                    ? memberMap.get(patch.assigneeId) ?? null
                    : null
                  : x.assignee,
            }
          : x,
      ),
    );
    try {
      const r = await api<{ item: QaItem }>(`/api/project/${projectId}/qa/${id}`, {
        method: "PATCH",
        json: patch,
      });
      if (pendingPatchTokens.current.get(id) !== token) return; // 후속 요청이 있으면 무시
      setItems((prev) =>
        prev.map((x) =>
          x.id === id
            ? {
                ...x,
                ...r.item,
                createdBy: x.createdBy,
                resolvedBy: x.resolvedBy,
                assignee: r.item.assigneeId ? memberMap.get(r.item.assigneeId) ?? null : null,
                attachments: r.item.attachments ?? x.attachments,
              }
            : x,
        ),
      );
    } catch (err: any) {
      if (pendingPatchTokens.current.get(id) !== token) return;
      setItems(snapshot);
      await alertAsync({ title: "수정 실패", description: err?.message ?? "수정에 실패했어요" });
    }
  }

  async function removeItem(id: string, title: string) {
    const ok = await confirmAsync({
      title: "QA 항목 삭제",
      description: `"${title}" 항목을 삭제할까요?`,
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    const snapshot = items;
    setItems((prev) => prev.filter((x) => x.id !== id));
    if (expandedId === id) setExpandedId(null);
    try {
      await api(`/api/project/${projectId}/qa/${id}`, { method: "DELETE" });
    } catch (err: any) {
      setItems(snapshot);
      await alertAsync({ title: "삭제 실패", description: err?.message ?? "삭제에 실패했어요" });
    }
  }

  async function addAttachment(itemId: string, files: FileList | null) {
    if (!files || !files.length) return;
    setUploadingFor(itemId);
    try {
      for (const f of Array.from(files)) {
        try {
          const meta = await uploadToServer(f);
          const r = await api<{ attachment: Attachment }>(
            `/api/project/${projectId}/qa/${itemId}/attachment`,
            { method: "POST", json: meta },
          );
          setItems((prev) =>
            prev.map((x) =>
              x.id === itemId
                ? { ...x, attachments: [...x.attachments, r.attachment] }
                : x,
            ),
          );
        } catch (e: any) {
          await alertAsync({ title: "첨부 추가 실패", description: e?.message ?? "첨부 추가 실패" });
        }
      }
    } finally {
      setUploadingFor(null);
    }
  }

  async function removeAttachment(itemId: string, attachmentId: string) {
    const snapshot = items;
    setItems((prev) =>
      prev.map((x) =>
        x.id === itemId
          ? { ...x, attachments: x.attachments.filter((a) => a.id !== attachmentId) }
          : x,
      ),
    );
    try {
      await api(`/api/project/${projectId}/qa/${itemId}/attachment/${attachmentId}`, {
        method: "DELETE",
      });
    } catch (err: any) {
      setItems(snapshot);
      await alertAsync({ title: "첨부 삭제 실패", description: err?.message ?? "첨부 삭제 실패" });
    }
  }

  // ESC — 펼쳐진 상세 패널 닫기 단축키.
  useEffect(() => {
    if (!expandedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 입력 포커스 중 ESC 는 input 자체의 blur/cancel 동작을 우선.
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      setExpandedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedId]);

  // ---------- 뷰 ----------
  // 상태 필터 + "내 담당" 토글을 조합.
  // 정렬: ALL 뷰에서는 해결되지 않은(= BUG/IN_PROGRESS) 항목을 위로 띄워서
  //       작업 중인 것에 시선이 먼저 가도록. 같은 그룹 안에서는 서버가 준 순서 유지.
  const q = query.trim().toLowerCase();
  const filtered = items.filter((i) => {
    if (filter !== "ALL" && i.status !== filter) return false;
    if (mineOnly && currentUserId && i.assigneeId !== currentUserId) return false;
    if (q) {
      const hay = [
        i.title,
        i.screen ?? "",
        i.note ?? "",
        i.assignee?.name ?? "",
        i.createdBy?.name ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  // ALL 뷰 정렬: 작성 순서 유지하되 완료(DONE) 항목만 맨 아래로.
  // 서버가 이미 sortOrder→createdAt 으로 정렬해서 내려주므로 안정 정렬로 DONE 가중치만 더한다.
  const visible =
    filter === "ALL"
      ? [...filtered].sort((a, b) => (a.status === "DONE" ? 1 : 0) - (b.status === "DONE" ? 1 : 0))
      : filtered;
  const mineCount = currentUserId
    ? items.filter((i) => i.assigneeId === currentUserId).length
    : 0;
  const counts = {
    ALL: items.length,
    BUG: items.filter((i) => i.status === "BUG").length,
    IN_PROGRESS: items.filter((i) => i.status === "IN_PROGRESS").length,
    NEEDS_FIX: items.filter((i) => i.status === "NEEDS_FIX").length,
    NEEDS_TEST: items.filter((i) => i.status === "NEEDS_TEST").length,
    DONE: items.filter((i) => i.status === "DONE").length,
    ON_HOLD: items.filter((i) => i.status === "ON_HOLD").length,
  } as const;

  return (
    <div className="qa-board">
      {/* ===== 헤더: 제목 + 설명 + 필터 탭 ===== */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="flex items-center gap-2 text-left hover:bg-ink-50 rounded px-1 -ml-1 transition-colors"
            aria-expanded={!collapsed}
            title={collapsed ? "펼치기" : "접기"}
          >
            <span
              aria-hidden
              className="text-ink-400 text-[11px] transition-transform inline-block"
              style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
            >
              ▼
            </span>
            <span className="text-[15px] font-bold text-ink-900">QA 체크리스트</span>
            <span className="text-[12px] text-ink-400">
              {q ? `${filtered.length} / ${counts.ALL}` : `${counts.ALL}개`}
            </span>
          </button>
          {/* 검색 — 제목/화면/메모/담당자 이름에 대해 부분일치.
              모바일에서도 헤더에 자연스럽게 붙도록 flex-wrap 고려.
              접힌 상태에서는 검색 UI 숨김. */}
          {!collapsed && (
          <div className="relative">
            <span
              aria-hidden
              className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-400 text-[13px] pointer-events-none"
            >
              🔍
            </span>
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  e.preventDefault();
                  setQuery("");
                }
              }}
              placeholder="제목·화면·담당자 검색  (⌘K)"
              className="input !h-8 !pl-7 !pr-7 !text-[12.5px] w-[220px] max-w-full"
              aria-label="QA 검색"
              spellCheck={false}
              autoComplete="off"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(""); searchInputRef.current?.focus(); }}
                className="absolute right-0.5 top-1/2 -translate-y-1/2 w-7 h-7 grid place-items-center rounded-full text-ink-400 hover:text-ink-700 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[13px]"
                aria-label="검색어 지우기"
                title="검색어 지우기 (Esc)"
              >
                ✕
              </button>
            )}
          </div>
          )}
        </div>
        {!collapsed && (
        <div className="text-[12px] text-ink-500">
          테스트 항목·버그 제보를 기록하고 담당자·화면·플랫폼까지 한곳에서 관리합니다.
        </div>
        )}

        {/* 필터 탭 — Notion "그룹 보기" 느낌의 탭 스타일 */}
        {!collapsed && (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 mt-1 border-b border-ink-100 relative">
          {(["ALL", ...STATUS_ORDER] as const).map((k) => {
            const active = filter === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={[
                  "relative px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                  active
                    ? "text-ink-900"
                    : "text-ink-500 hover:text-ink-700",
                ].join(" ")}
                style={{
                  // active 인 탭 아래쪽에 밑줄 — Notion 데이터베이스 뷰 탭과 유사.
                  borderBottom: active ? "2px solid var(--c-brand, #3B5CF0)" : "2px solid transparent",
                  marginBottom: -1,
                }}
              >
                {k === "ALL" ? "전체" : STATUS_LABEL[k]}
                <span
                  className={active ? "ml-1 text-ink-500" : "ml-1 text-ink-400"}
                  style={{ fontSize: 11 }}
                >
                  {counts[k]}
                </span>
              </button>
            );
          })}
          {/* "내 담당" 토글 — 현재 로그인 사용자가 assignee 로 지정된 항목만.
              로그인 정보가 없거나 멤버 수 0 이면 의미 없음 → 숨김. */}
          {currentUserId && (
            <button
              type="button"
              onClick={() => setMineOnly((v) => !v)}
              className={[
                "ml-auto mb-[-1px] px-2.5 py-1.5 text-[12.5px] font-medium rounded-md transition-colors",
                mineOnly
                  ? "bg-brand-50 text-brand-700"
                  : "text-ink-500 hover:text-ink-700 hover:bg-ink-50",
              ].join(" ")}
              title="내가 담당자로 지정된 항목만 보기"
              aria-pressed={mineOnly}
            >
              👤 내 담당
              <span className="ml-1 text-ink-400" style={{ fontSize: 11 }}>
                {mineCount}
              </span>
            </button>
          )}
        </div>
        )}
      </div>

      {!collapsed && (
      <>
      {/* ===== 테이블 헤더 (sm 이상에서만) ===== */}
      <div
        className="hidden sm:grid items-center gap-2 px-2 py-1.5 mt-2 text-[11px] font-medium uppercase tracking-wider text-ink-400"
        style={{
          gridTemplateColumns: "16px minmax(0, 2.2fr) 88px 1fr 150px 110px 56px",
        }}
      >
        {/* chip 내부 padding(0 10px) 만큼 헤더 라벨을 안쪽으로 들여써서
            라벨 텍스트와 chip 안 텍스트의 좌측 시작 위치를 맞춤. */}
        <span />
        <span className="pl-1">제목</span>
        <span className="pl-2.5">우선순위</span>
        <span className="pl-2.5">화면 · 플랫폼</span>
        <span className="pl-2.5">담당자</span>
        <span className="pl-2.5">상태</span>
        <span />
      </div>

      {/* ===== 행 목록 ===== */}
      {!loaded ? (
        <div className="text-center text-ink-400 text-sm py-6">불러오는 중…</div>
      ) : (
        <div className="flex flex-col">
          {visible.length === 0 ? (
            <div className="text-center text-ink-400 text-sm py-8 px-4">
              {q ? (
                <>
                  <div className="mb-2">"<span className="text-ink-600 font-medium">{query}</span>" 검색 결과가 없어요.</div>
                  <button
                    type="button"
                    onClick={() => { setQuery(""); searchInputRef.current?.focus(); }}
                    className="chip chip-gray"
                  >
                    검색 초기화
                  </button>
                </>
              ) : filter !== "ALL" ? (
                <>
                  <div className="mb-2">해당 상태의 항목이 없어요.</div>
                  <button
                    type="button"
                    onClick={() => setFilter("ALL")}
                    className="chip chip-gray"
                  >
                    전체 보기
                  </button>
                </>
              ) : mineOnly ? (
                <>
                  <div className="mb-2">내가 담당자인 QA 항목이 없어요.</div>
                  <button
                    type="button"
                    onClick={() => setMineOnly(false)}
                    className="chip chip-gray"
                  >
                    전체 담당자 보기
                  </button>
                </>
              ) : (
                <>
                  <div className="mb-2">아직 기록된 QA 항목이 없어요.</div>
                  <div className="text-[12px] text-ink-400">아래 "+ 새 QA 항목 추가"에 제목을 입력하고 Enter</div>
                </>
              )}
            </div>
          ) : (
            visible.map((i) => (
              <QaRow
                key={i.id}
                item={i}
                members={members}
                expanded={expandedId === i.id}
                onToggleExpand={() =>
                  setExpandedId((prev) => (prev === i.id ? null : i.id))
                }
                onPatch={(p) => patchItem(i.id, p)}
                onDelete={() => removeItem(i.id, i.title)}
                onAddAttachment={(files) => addAttachment(i.id, files)}
                onRemoveAttachment={(attId) => removeAttachment(i.id, attId)}
                uploading={uploadingFor === i.id}
              />
            ))
          )}

          {/* ===== 퀵 추가 행 — Notion 의 "+ 새로 만들기" 모방 ===== */}
          <form
            onSubmit={quickCreate}
            className="flex items-center gap-2 px-2 py-2 border-t border-ink-100 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors"
          >
            <span className="text-ink-400" style={{ fontSize: 16, width: 16 }}>
              +
            </span>
            <input
              ref={quickInputRef}
              type="text"
              className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-ink-400 text-ink-900"
              placeholder="새 QA 항목 추가 — 제목을 입력하고 Enter"
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              maxLength={200}
              disabled={creating}
            />
            {quickTitle.trim() && (
              <button
                type="submit"
                className="chip chip-brand"
                disabled={creating}
              >
                {creating ? "추가 중…" : "추가"}
              </button>
            )}
          </form>
        </div>
      )}
      </>
      )}
    </div>
  );
}

/* ================================================================
   개별 행 — 접혀있을 때는 Notion 테이블 한 줄, 펼치면 상세 편집 패널.
================================================================ */
function QaRow({
  item,
  members,
  expanded,
  onToggleExpand,
  onPatch,
  onDelete,
  onAddAttachment,
  onRemoveAttachment,
  uploading,
}: {
  item: QaItem;
  members: Member[];
  expanded: boolean;
  onToggleExpand: () => void;
  onPatch: (patch: Partial<Pick<QaItem, "status" | "priority" | "title" | "note" | "screen" | "platform" | "assigneeId" | "dueDate">>) => void;
  onDelete: () => void;
  onAddAttachment: (files: FileList | null) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  uploading: boolean;
}) {
  // 제목/화면 등 텍스트 필드는 onBlur 에서만 서버에 반영해 키스트로크마다 네트워크를 때리지 않도록.
  const [titleDraft, setTitleDraft] = useState(item.title);
  const [screenDraft, setScreenDraft] = useState(item.screen ?? "");
  const [noteDraft, setNoteDraft] = useState(item.note ?? "");

  useEffect(() => setTitleDraft(item.title), [item.title]);
  useEffect(() => setScreenDraft(item.screen ?? ""), [item.screen]);
  useEffect(() => setNoteDraft(item.note ?? ""), [item.note]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 해결된 항목(완료/보류) 은 전체 행을 시각적으로 희미하게 처리해 현재 작업중인 것과 구분.
  const resolved = item.status === "DONE" || item.status === "ON_HOLD";

  return (
    <div className={["group border-t border-ink-100", resolved ? "opacity-70" : ""].join(" ")}>
      {/* ---------- 접힌 행 ---------- */}
      {/* 모바일: 제목줄만 grid 3칼럼 (dot | 제목 | 삭제), 속성은 아래에 flex-wrap */}
      {/* 데스크톱: 풀 Notion 테이블 레이아웃 */}
      <div
        className="qa-row-grid items-center gap-2 px-2 py-2 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors cursor-pointer"
        onClick={(e) => {
          // 내부 인터랙티브 요소 클릭 시 토글이 덮어쓰지 않도록.
          const t = e.target as HTMLElement;
          if (t.closest("button,select,input,textarea,a,label")) return;
          onToggleExpand();
        }}
      >
        {/* status dot */}
        <span
          title={STATUS_LABEL[item.status]}
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: STATUS_DOT[item.status],
            display: "inline-block",
          }}
        />

        {/* 제목 — 인라인 편집 + 작성자·작성시간 메타 */}
        <div className="min-w-0 flex flex-col">
          <div className="flex items-center gap-2">
            <input
              className={[
                "flex-1 min-w-0 bg-transparent outline-none text-[13.5px] font-medium text-ink-900 truncate rounded px-1 py-0.5 hover:bg-black/[0.04] focus:bg-black/[0.04] dark:hover:bg-white/[0.06] dark:focus:bg-white/[0.06]",
                item.status === "DONE" ? "line-through decoration-ink-400" : "",
              ].join(" ")}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                const v = titleDraft.trim();
                if (v && v !== item.title) onPatch({ title: v });
                else if (!v) setTitleDraft(item.title);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                else if (e.key === "Escape") {
                  setTitleDraft(item.title);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              maxLength={200}
              onClick={(e) => e.stopPropagation()}
              /* 한글 제목에 빨간 점선 맞춤법 밑줄이 뜨지 않도록 브라우저
                 자동완성/맞춤법 검사 전부 끈다. 자동 대문자 변환도 제목엔 불필요. */
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              /* 새로 만든 항목을 엔터 직후 자동 포커스/선택하기 위한 훅 */
              data-qa-title-input={item.id}
            />
            {/* 메모/첨부 개수 뱃지 — 있으면 행에서 바로 보이게.
                OS 네이티브 📝/📎 이모지는 컬러풀해서 미니멀 UI 와 톤이 안 맞아
                작고 회색인 인라인 SVG 로 대체. */}
            {(item.note || item.attachments.length > 0) && (
              <span className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink-400">
                {item.note && (
                  <span title="메모 있음" className="inline-flex items-center">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 4h12l4 4v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
                      <path d="M14 4v6h6" />
                      <path d="M7 13h8" />
                      <path d="M7 17h5" />
                    </svg>
                  </span>
                )}
                {item.attachments.length > 0 && (
                  <span title={`첨부 ${item.attachments.length}개`} className="inline-flex items-center gap-0.5">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                    <span className="tabular">{item.attachments.length}</span>
                  </span>
                )}
              </span>
            )}
          </div>
          {/* 작성자 · 작성 시간 — 본문 한 줄 아래에 작게 보조 정보로 노출.
              접힌 행에서도 작성 맥락이 바로 보이도록 (펼친 상세 패널에도 동일 정보 있음). */}
          {(item.createdBy || item.createdAt) && (
            <div className="px-1 mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-400 truncate">
              {item.createdBy && (
                <span className="inline-flex items-center gap-1 truncate">
                  <span
                    className="inline-flex items-center justify-center rounded-full text-white shrink-0 overflow-hidden"
                    style={{
                      background: item.createdBy.avatarUrl ? "transparent" : item.createdBy.avatarColor,
                      width: 12, height: 12, fontSize: 8,
                    }}
                  >
                    {item.createdBy.avatarUrl ? (
                      <img src={imgSrc(item.createdBy.avatarUrl)} alt={item.createdBy.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" decoding="async"/>
                    ) : (
                      item.createdBy.name[0]
                    )}
                  </span>
                  <span className="truncate">{item.createdBy.name}</span>
                </span>
              )}
              {item.createdBy && item.createdAt && <span>·</span>}
              {item.createdAt && (
                <span className="shrink-0" title={new Date(item.createdAt).toLocaleString("ko-KR")}>
                  {formatRelative(item.createdAt)}
                </span>
              )}
              {item.dueDate && (
                <>
                  <span>·</span>
                  {/* 마감기한 — 오늘 이후면 회색, 지났거나 오늘이면 빨간색 강조. */}
                  <DueDateBadge dueDate={item.dueDate} done={item.status === "DONE"} />
                </>
              )}
            </div>
          )}
        </div>

        {/* 우선순위 — 모바일에서는 아래 카드 형태로 내려감 */}
        <div className="hidden sm:block">
          <PrioritySelect value={item.priority} onChange={(v) => onPatch({ priority: v })} />
        </div>

        {/* 화면 · 플랫폼 — 헤더 라벨 순서와 동일하게 화면 먼저, 플랫폼 나중에 */}
        <div className="hidden sm:flex items-center gap-1.5 min-w-0">
          {item.screen ? (
            <span className="chip chip-gray truncate" title={item.screen}>
              📍 {item.screen}
            </span>
          ) : null}
          {item.platform && (
            <span className="chip chip-blue">
              {PLATFORM_ICON[item.platform]} {PLATFORM_LABEL[item.platform]}
            </span>
          )}
          {!item.screen && !item.platform && (
            <span className="text-[12px] text-ink-400">—</span>
          )}
        </div>

        {/* 담당자 */}
        <div className="hidden sm:block">
          <AssigneeSelect
            value={item.assigneeId}
            members={members}
            onChange={(v) => onPatch({ assigneeId: v })}
          />
        </div>

        {/* 상태 */}
        <div className="hidden sm:block">
          <StatusSelect value={item.status} onChange={(v) => onPatch({ status: v })} />
        </div>

        {/* 퀵 액션 — 행 hover 시 완료/되돌리기 + 삭제 */}
        <div
          className="flex justify-end items-center gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          {item.status !== "DONE" ? (
            <button
              type="button"
              className="btn-icon touch-reveal text-ink-400 hover:text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity"
              title="완료로 표시"
              aria-label="완료로 표시"
              onClick={() => onPatch({ status: "DONE" })}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className="btn-icon touch-reveal text-ink-400 hover:text-amber-600 opacity-0 group-hover:opacity-100 transition-opacity"
              title="다시 열기 (BUG 로 되돌림)"
              aria-label="다시 열기"
              onClick={() => onPatch({ status: "BUG" })}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <path d="M3 4v5h5" />
              </svg>
            </button>
          )}
          <button
            type="button"
            className="btn-icon touch-reveal text-ink-400 hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-opacity"
            title="삭제"
            aria-label="삭제"
            onClick={onDelete}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            </svg>
          </button>
        </div>
      </div>

      {/* 모바일에서는 칩 줄이 밑으로 내려감 (보기용) */}
      <div
        className="sm:hidden flex flex-wrap items-center gap-1.5 px-2 pb-2"
        onClick={(e) => {
          const t = e.target as HTMLElement;
          if (t.closest("button,select,input,textarea,a,label")) return;
          onToggleExpand();
        }}
      >
        <PrioritySelect value={item.priority} onChange={(v) => onPatch({ priority: v })} />
        <StatusSelect value={item.status} onChange={(v) => onPatch({ status: v })} />
        {item.screen && (
          <span className="chip chip-gray truncate" title={item.screen}>
            📍 {item.screen}
          </span>
        )}
        {item.platform && (
          <span className="chip chip-blue">
            {PLATFORM_ICON[item.platform]} {PLATFORM_LABEL[item.platform]}
          </span>
        )}
        {item.assignee && (
          <span className="chip chip-gray flex items-center gap-1">
            <span
              className="inline-flex items-center justify-center rounded-full text-white overflow-hidden"
              style={{
                background: item.assignee.avatarUrl ? "transparent" : item.assignee.avatarColor,
                width: 14, height: 14, fontSize: 9,
              }}
            >
              {item.assignee.avatarUrl ? (
                <img src={imgSrc(item.assignee.avatarUrl)} alt={item.assignee.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" decoding="async"/>
              ) : (
                item.assignee.name[0]
              )}
            </span>
            {item.assignee.name}
          </span>
        )}
      </div>

      {/* ---------- 펼친 상세 편집 ---------- */}
      {expanded && (
        <div className="px-3 sm:px-4 pb-4 pt-1 bg-black/[0.02] dark:bg-white/[0.03] border-t border-ink-100 flex flex-col gap-3">
          {/* 속성 그리드 — Notion 페이지 상단 Properties 영역 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 pt-3">
            <PropertyRow label="우선순위">
              <PrioritySelect value={item.priority} onChange={(v) => onPatch({ priority: v })} />
            </PropertyRow>
            <PropertyRow label="상태">
              <StatusSelect value={item.status} onChange={(v) => onPatch({ status: v })} />
            </PropertyRow>
            <PropertyRow label="플랫폼">
              <select
                className="input w-full text-[13px] py-1"
                value={item.platform ?? ""}
                onChange={(e) =>
                  onPatch({ platform: (e.target.value || null) as Platform | null })
                }
              >
                <option value="">미지정</option>
                {PLATFORM_ORDER.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_ICON[p]} {PLATFORM_LABEL[p]}
                  </option>
                ))}
              </select>
            </PropertyRow>
            <PropertyRow label="담당자">
              <AssigneeSelect
                value={item.assigneeId}
                members={members}
                onChange={(v) => onPatch({ assigneeId: v })}
              />
            </PropertyRow>
            <PropertyRow label="마감기한">
              {/* 프로젝트 공통 DatePicker 사용 — 값은 "YYYY-MM-DD" 로 주고받고,
                  서버 전송 시 자정 UTC ISO 로 변환. 빈 값은 null 로 보내 해지. */}
              <DatePicker
                variant="input"
                value={item.dueDate ? item.dueDate.slice(0, 10) : ""}
                placeholder="마감기한 선택"
                onChange={(v) => {
                  onPatch({ dueDate: v ? new Date(v + "T00:00:00.000Z").toISOString() : null });
                }}
              />
            </PropertyRow>
            <PropertyRow label="화면" wide>
              <input
                className="input w-full text-[13px] py-1"
                placeholder="예: 설정 > 프로필 편집"
                value={screenDraft}
                onChange={(e) => setScreenDraft(e.target.value)}
                onBlur={() => {
                  const v = screenDraft.trim();
                  if ((v || null) !== item.screen) onPatch({ screen: v || null });
                }}
                maxLength={200}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
              />
            </PropertyRow>
          </div>

          {/* 메모 — Notion 페이지 본문 영역 */}
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-ink-400 mb-1">
              메모
            </div>
            <textarea
              className="input w-full min-h-[90px] resize-y text-[13px]"
              placeholder="재현 스텝 · 기대 결과 · 비고"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={() => {
                if ((noteDraft || null) !== item.note) onPatch({ note: noteDraft || null });
              }}
              maxLength={4000}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>

          {/* 첨부 — 이미지/영상 프리뷰 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] font-medium uppercase tracking-wider text-ink-400">
                첨부 {item.attachments.length > 0 && <span>({item.attachments.length})</span>}
              </div>
              <label className="chip chip-gray cursor-pointer">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => {
                    onAddAttachment(e.target.files);
                    e.target.value = "";
                  }}
                />
                {uploading ? "업로드 중…" : "📎 추가"}
              </label>
            </div>
            {item.attachments.length === 0 ? (
              <div className="text-[12px] text-ink-400 border border-dashed border-ink-100 rounded-lg py-4 text-center">
                이미지/영상을 드래그하거나 "첨부 추가"로 올려주세요.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {item.attachments.map((a) => (
                  <AttachmentThumb
                    key={a.id}
                    att={a}
                    onRemove={() => onRemoveAttachment(a.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 작성/해결 이력 */}
          <div className="text-[11px] text-ink-400 flex flex-wrap gap-x-3 pt-2 border-t border-ink-100">
            {item.createdBy && (
              <span>
                작성 · {item.createdBy.name} ·{" "}
                {new Date(item.createdAt).toLocaleString("ko-KR", {
                  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
                })}
              </span>
            )}
            {item.resolvedBy && item.resolvedAt && item.status !== "BUG" && (
              <span>
                {STATUS_LABEL[item.status]} · {item.resolvedBy.name} ·{" "}
                {new Date(item.resolvedAt).toLocaleString("ko-KR", {
                  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
                })}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   공용 서브 컴포넌트
================================================================ */

function PropertyRow({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={["flex items-center gap-3", wide ? "sm:col-span-2" : ""].join(" ")}>
      <div className="w-16 shrink-0 text-[12px] text-ink-500">{label}</div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function StatusSelect({
  value,
  onChange,
}: {
  value: Status;
  onChange: (v: Status) => void;
}) {
  return (
    <label className={[STATUS_CHIP[value], "cursor-pointer relative"].join(" ")}>
      <span className="inline-flex items-center gap-1">
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: STATUS_DOT[value],
            display: "inline-block",
          }}
        />
        {STATUS_LABEL[value]}
      </span>
      <select
        className="absolute inset-0 opacity-0 cursor-pointer"
        value={value}
        onChange={(e) => onChange(e.target.value as Status)}
      >
        {STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
    </label>
  );
}

function PrioritySelect({
  value,
  onChange,
}: {
  value: Priority;
  onChange: (v: Priority) => void;
}) {
  return (
    <label className={[PRIORITY_CHIP[value], "cursor-pointer relative"].join(" ")}>
      <span>{PRIORITY_LABEL[value]}</span>
      <select
        className="absolute inset-0 opacity-0 cursor-pointer"
        value={value}
        onChange={(e) => onChange(e.target.value as Priority)}
      >
        {PRIORITY_ORDER.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABEL[p]}
          </option>
        ))}
      </select>
    </label>
  );
}

function AssigneeSelect({
  value,
  members,
  onChange,
}: {
  value: string | null;
  members: Member[];
  onChange: (v: string | null) => void;
}) {
  const current = value ? members.find((m) => m.id === value) : null;
  return (
    <label className="chip chip-gray cursor-pointer relative inline-flex items-center gap-1.5 min-w-0">
      {current ? (
        <>
          <span
            className="inline-flex items-center justify-center rounded-full text-white shrink-0 overflow-hidden"
            style={{
              background: current.avatarUrl ? "transparent" : current.avatarColor,
              width: 14, height: 14, fontSize: 9,
            }}
          >
            {current.avatarUrl ? (
              <img src={imgSrc(current.avatarUrl)} alt={current.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" decoding="async"/>
            ) : (
              current.name[0]
            )}
          </span>
          <span className="truncate">{current.name}</span>
        </>
      ) : (
        <span className="text-ink-500">담당자 없음</span>
      )}
      <select
        className="absolute inset-0 opacity-0 cursor-pointer"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">담당자 없음</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function AttachmentThumb({
  att,
  onRemove,
}: {
  att: Attachment;
  onRemove?: () => void;
}) {
  const box = "relative group/thumb rounded-lg overflow-hidden border border-ink-100 bg-ink-25";
  // 첨부 url 은 서버 스키마에서 /uploads/… 만 허용하지만, 과거 데이터/혹시 모를 우회에 대비해
  // 렌더 직전에 다시 한 번 검증. 검증 실패 시 href/src 를 안 박는다.
  const safeHref = safeAttachmentUrl(att.url, att.kind);
  if (att.kind === "IMAGE") {
    if (!safeHref) {
      return (
        <div className={box} style={{ width: 112, height: 112 }} title="유효하지 않은 첨부">
          <div className="w-full h-full grid place-items-center text-ink-400 text-[11px]">⚠️ invalid</div>
          {onRemove && <RemoveDot onRemove={onRemove} />}
        </div>
      );
    }
    return (
      <div className={box} style={{ width: 112, height: 112 }}>
        <a
          href={safeHref}
          target="_blank"
          rel="noreferrer"
          title={att.name}
          onClick={(e) => { if (isCapacitorNative()) { e.preventDefault(); const u = imgSrc(safeHref); if (u) void Browser.open({ url: u }); } }}
        >
          <img
            src={imgSrc(safeHref)}
            alt={att.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </a>
        {onRemove && <RemoveDot onRemove={onRemove} />}
      </div>
    );
  }
  if (att.kind === "VIDEO") {
    if (!safeHref) {
      return (
        <div className={box} style={{ width: 180, height: 112 }} title="유효하지 않은 첨부">
          <div className="w-full h-full grid place-items-center text-ink-400 text-[11px]">⚠️ invalid</div>
          {onRemove && <RemoveDot onRemove={onRemove} />}
        </div>
      );
    }
    return (
      <div className={box} style={{ width: 180, height: 112 }}>
        <video
          src={imgSrc(safeHref)}
          className="w-full h-full object-cover"
          controls
          preload="metadata"
        />
        {onRemove && <RemoveDot onRemove={onRemove} />}
      </div>
    );
  }
  return (
    <div
      className={[box, "flex items-center gap-2 px-2 py-1.5 text-[12px]"].join(" ")}
      style={{ maxWidth: 240 }}
    >
      <span>📎</span>
      {safeHref ? (
        <a
          href={safeHref}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => { if (isCapacitorNative()) { e.preventDefault(); const u = imgSrc(safeHref); if (u) void Browser.open({ url: u }); } }}
          className="truncate text-ink-700 hover:underline"
          title={att.name}
        >
          {att.name}
        </a>
      ) : (
        <span className="truncate text-ink-400" title="유효하지 않은 첨부 URL">{att.name}</span>
      )}
      <span className="text-ink-400">{humanSize(att.sizeBytes)}</span>
      {onRemove && <RemoveDot onRemove={onRemove} />}
    </div>
  );
}

function RemoveDot({ onRemove }: { onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      // 모바일에서도 누르기 편하도록 터치 타겟을 28px 로 확대,
      // 터치 디바이스에선 항상 보이게 (hover 로는 안 떠서 누를 수가 없음).
      className="touch-reveal absolute top-1 right-1 w-7 h-7 rounded-full bg-black/60 text-white text-[13px] leading-none flex items-center justify-center md:opacity-0 md:group-hover/thumb:opacity-100 transition-opacity shadow"
      aria-label="첨부 제거"
      title="제거"
    >
      ×
    </button>
  );
}
