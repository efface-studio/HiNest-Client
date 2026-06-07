import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, apiFetch , imgSrc} from "../api";
import { useAuth } from "../auth";
import PageHeader from "../components/PageHeader";
import Portal from "../components/Portal";
import { confirmAsync, alertAsync, promptAsync } from "../components/ConfirmHost";
import ShareLinkModal from "../components/ShareLinkModal";
import RevisionHistoryModal from "../components/RevisionHistoryModal";
import type { MemoDoc } from "../components/DocMemoModal";
import { safeUploadUrl } from "../lib/safeUrl";
import { downloadFromUrl, downloadBlob } from "../lib/download";
import { isCapacitorNative } from "../lib/platform";
import { Browser } from "@capacitor/browser";

// DocMemoModal 은 TipTap(무거운 번들)을 포함 → 실제 열릴 때만 로드.
const DocMemoModal = lazy(() => import("../components/DocMemoModal"));

type Folder = {
  id: string;
  name: string;
  parentId?: string | null;
  createdAt: string;
  scope?: DocScope;
  scopeTeam?: string | null;
  scopeUserIds?: string | null;
};
type DocScope = "ALL" | "TEAM" | "PRIVATE" | "CUSTOM";
type Doc = {
  id: string;
  title: string;
  description?: string;
  folderId?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  fileSize?: number | null;
  tags?: string | null;
  /** TipTap JSON — 값이 있으면 메모 타입 문서. */
  content?: any;
  scope?: DocScope;
  scopeTeam?: string | null;
  scopeUserIds?: string | null;
  authorId?: string;
  createdAt: string;
  updatedAt: string;
  author: { name: string; avatarColor: string; avatarUrl?: string | null };
  folder?: { name: string } | null;
};

type ScopeTab = "all" | "public" | "team" | "private" | "custom";
const SCOPE_TABS: { key: ScopeTab; label: string }[] = [
  { key: "all",     label: "전체" },
  { key: "team",    label: "팀" },
  { key: "private", label: "개인" },
  { key: "custom",  label: "사용자지정" },
];
const SCOPE_LABEL: Record<DocScope, string> = {
  ALL: "전체 공개",
  TEAM: "팀 공개",
  PRIVATE: "개인",
  CUSTOM: "사용자지정",
};
type DirUser = { id: string; name: string; team?: string | null; avatarColor?: string; avatarUrl?: string | null };
type ProjectChip = { id: string; name: string; color: string };

type Props = {
  /** 프로젝트 상세 페이지에서 embed 하는 경우 */
  projectId?: string;
  /** embed 모드 — 페이지 헤더/카테고리 칩을 숨기고 상위 컨테이너가 래핑하는 전제 */
  embedded?: boolean;
};

export default function DocumentsPage({ projectId: fixedProjectId, embedded = false }: Props = {}) {
  const { user } = useAuth();
  // 팀 스코프 탭 라벨은 내 팀 이름으로. 팀이 없으면 그냥 "팀".
  const teamLabel = user?.team?.trim() || "팀";
  const SCOPE_TABS: { key: ScopeTab; label: string }[] = [
    { key: "all", label: "전체" },
    { key: "team", label: teamLabel },
    { key: "private", label: "개인" },
    { key: "custom", label: "사용자지정" },
  ];
  const [folders, setFolders] = useState<Folder[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  // 문서/폴더 목록 조회 실패 시 상단에 표시 — empty state 로 오인되는 걸 방지
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState<null | "folder" | "doc">(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalErr, setModalErr] = useState<string | null>(null);
  const [busyFolderId, setBusyFolderId] = useState<string | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  // 새로고침/링크 공유 대비해 탭·프로젝트·현재 폴더를 URL 쿼리로 동기화.
  // embed 모드에선 상위 페이지(예: 프로젝트 상세)의 쿼리와 충돌할 수 있어 scope/project 는 비활성화.
  const [sp, setSp] = useSearchParams();
  const SCOPE_SET = new Set<ScopeTab>(["all", "public", "team", "private", "custom"]);
  const scopeTab: ScopeTab = embedded
    ? "all"
    : (SCOPE_SET.has((sp.get("scope") ?? "") as ScopeTab) ? (sp.get("scope") as ScopeTab) : "all");
  const currentFolder: string | "root" = (sp.get("folder") || "root") as string | "root";
  const selectedProjectId: string | null = embedded
    ? (fixedProjectId ?? null)
    : (fixedProjectId ?? sp.get("project") ?? null);

  const updateSp = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(sp);
    mutate(next);
    setSp(next, { replace: true });
  };
  const setScopeTab = (s: ScopeTab) => {
    if (embedded) return;
    updateSp((n) => {
      if (s === "all") n.delete("scope");
      else n.set("scope", s);
      // scope 바뀌면 폴더 컨텍스트도 리셋 — 잔여 ?folder= 때문에 "없는 폴더" 조회 사고 방지.
      n.delete("folder");
    });
  };
  const setCurrentFolder = (id: string | "root") => {
    updateSp((n) => {
      if (!id || id === "root") n.delete("folder");
      else n.set("folder", id);
    });
  };
  const setSelectedProjectId = (pid: string | null) => {
    if (embedded || fixedProjectId) return;
    updateSp((n) => {
      if (!pid) n.delete("project");
      else n.set("project", pid);
      // 프로젝트 전환 시 남은 folder/scope 도 정리.
      n.delete("folder");
      if (pid) n.delete("scope");
    });
  };
  const [allUsers, setAllUsers] = useState<DirUser[]>([]);
  // 내가 접근 가능한 프로젝트 칩 목록. fixedProjectId 로 고정된 모드에선 안 쓴다.
  const [projects, setProjects] = useState<ProjectChip[]>([]);
  const activeProjectId = fixedProjectId ?? selectedProjectId;
  const inProject = !!activeProjectId;
  const [folderForm, setFolderForm] = useState<{
    name: string;
    scope: DocScope;
    scopeUserIds: string[];
  }>({ name: "", scope: "ALL", scopeUserIds: [] });
  const [sharingDoc, setSharingDoc] = useState<Doc | null>(null);
  const [sharingFolder, setSharingFolder] = useState<Folder | null>(null);
  const [historyDoc, setHistoryDoc] = useState<Doc | null>(null);
  /** 현재 열린 메모 편집/열람 모달 (null = 닫힘 | "new" = 새 메모 | Doc = 기존 메모) */
  const [memoTarget, setMemoTarget] = useState<Doc | "new" | null>(null);
  const [docForm, setDocForm] = useState<{
    title: string; description: string; tags: string;
    fileUrl: string; fileName: string; fileType: string; fileSize: number;
    scope: DocScope; scopeTeam: string; scopeUserIds: string[];
  }>({ title: "", description: "", tags: "", fileUrl: "", fileName: "", fileType: "", fileSize: 0, scope: "ALL", scopeTeam: "", scopeUserIds: [] });
  const fileRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  // "폴더 업로드" 진행 상황 — 현재 파일 n/total 이랑 현재 경로를 표시한다.
  const [folderUpload, setFolderUpload] = useState<{ done: number; total: number; label: string } | null>(null);

  // 업로드 중 새로고침/탭 닫기 방어.
  //   - 업로드는 브라우저 JS 루프에 의존하므로 탭이 끊기면 남은 파일은 그대로 날아감
  //     (서버 쪽 resume 이 없어서 실제로 완전 복구가 어려움).
  //   - 그래서 최소한 "정말 떠날래?" 경고라도 띄워서 실수로 F5 / ⌘W / 뒤로가기 누르는 걸 막는다.
  //   - 브라우저가 returnValue 의 문자열을 그대로 보여주진 않지만(모질라/크롬 모두 무시),
  //     값을 세팅해야 모달이 뜬다. 업로드 안 하면 이 훅은 no-op.
  const isUploadingSomething = uploading || !!folderUpload;
  useEffect(() => {
    if (!isUploadingSomething) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "업로드가 아직 진행 중이에요. 지금 떠나면 남은 파일은 업로드되지 않아요.";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isUploadingSomething]);

  async function load(aliveRef?: { current: boolean }) {
    // 프로젝트 선택 시엔 projectId 필터. scope 필터는 프로젝트 내에선 의미 없음(멤버십이 권한).
    const pid = activeProjectId;
    // 전역 문서함은 파일 문서만 — 메모는 별도 /memos 페이지로 분리됨.
    // 프로젝트 문서함은 메모·파일 모두 표시(프로젝트 메모는 프로젝트에 귀속).
    const qs = (extra: string) =>
      pid
        ? `projectId=${encodeURIComponent(pid)}&${extra}`
        : `scope=${scopeTab}&type=file&${extra}`;
    try {
      const [f, d] = await Promise.all([
        api<{ folders: Folder[] }>(
          pid
            ? `/api/document/folders?projectId=${encodeURIComponent(pid)}`
            : `/api/document/folders?scope=${scopeTab}`,
        ),
        api<{ documents: Doc[] }>(
          `/api/document?${qs(`folderId=${encodeURIComponent(currentFolder)}${q ? `&q=${encodeURIComponent(q)}` : ""}`)}`,
        ),
      ]);
      if (aliveRef && !aliveRef.current) return;
      setFolders(f.folders);
      setDocs(d.documents);
      setLoadErr(null);
    } catch (e: any) {
      if (aliveRef && !aliveRef.current) return;
      // 기존에는 uncaught 로 조용히 empty state 처럼 보였음 — 상단에 사유 노출
      setLoadErr(e?.message ?? "문서 목록을 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
    }
  }

  // 프로젝트 칩 목록 로드 — 임베드 모드 아니고 고정 프로젝트가 없을 때만 필요.
  useEffect(() => {
    if (embedded || fixedProjectId) return;
    let alive = true;
    api<{ projects: ProjectChip[] }>("/api/document/projects")
      .then((r) => { if (alive) setProjects(r.projects); })
      .catch((e: any) => {
        if (!alive) return;
        // 프로젝트 칩은 보조 UI — 실패해도 페이지는 쓸 수 있으니 콘솔에만 남겨서 디버깅 가능하게
        console.warn("[documents] 프로젝트 칩 로드 실패:", e?.message ?? e);
      });
    return () => { alive = false; };
  }, [embedded, fixedProjectId]);

  useEffect(() => {
    const aliveRef = { current: true };
    load(aliveRef);
    return () => { aliveRef.current = false; };
    // eslint-disable-next-line
  }, [currentFolder, q, scopeTab, activeProjectId]);

  // 프로젝트/탭 전환 시 폴더 루트로 되돌림 (다른 네임스페이스의 폴더 id 가 stale 한 채 남지 않게).
  // 단, 첫 마운트에선 URL 의 ?folder= 를 지키기 위해 skip.
  const firstProjectRef = useRef(true);
  useEffect(() => {
    if (firstProjectRef.current) {
      firstProjectRef.current = false;
      return;
    }
    setCurrentFolder("root");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  // 사용자지정 범위 선택 시 유저 목록 로드 (문서 / 폴더 모달 공용)
  useEffect(() => {
    if ((creating !== "doc" && creating !== "folder") || allUsers.length > 0) return;
    let alive = true;
    api<{ users: DirUser[] }>("/api/users")
      .then((r) => { if (alive) setAllUsers(r.users); })
      .catch((e: any) => {
        if (!alive) return;
        // 모달의 CUSTOM 범위 선택용 — 실패 시 모달 내 에러 영역에 노출
        setModalErr(e?.message ?? "사용자 목록을 불러오지 못했어요.");
      });
    return () => { alive = false; };
  }, [creating, allUsers.length]);

  function openFolderModal() {
    // 현재 보고 있는 scope 탭을 기본값으로 제안 — UX 상 "팀" 탭에서 + 누르면 대개 팀 폴더를 만듦.
    const preset: DocScope =
      scopeTab === "team" ? "TEAM"
      : scopeTab === "private" ? "PRIVATE"
      : scopeTab === "custom" ? "CUSTOM"
      : "ALL";
    setFolderForm({ name: "", scope: preset, scopeUserIds: [] });
    setModalErr(null);
    setCreating("folder");
  }

  async function createFolder(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!folderForm.name.trim()) return;
    if (folderForm.scope === "CUSTOM" && folderForm.scopeUserIds.length === 0) {
      setModalErr("사용자지정 범위에선 최소 한 명 이상을 선택해주세요");
      return;
    }
    setSubmitting(true);
    setModalErr(null);
    try {
      await api("/api/document/folders", {
        method: "POST",
        json: {
          name: folderForm.name.trim(),
          parentId: currentFolder === "root" ? null : currentFolder,
          // 프로젝트 문서함에선 scope/scopeUserIds 무시 — 서버가 ALL 로 고정.
          scope: inProject ? undefined : folderForm.scope,
          scopeUserIds: !inProject && folderForm.scope === "CUSTOM" ? folderForm.scopeUserIds : undefined,
          projectId: activeProjectId ?? undefined,
        },
      });
      setCreating(null);
      setFolderForm({ name: "", scope: "ALL", scopeUserIds: [] });
      await load();
    } catch (e: any) {
      setModalErr(e?.message ?? "폴더 생성에 실패했어요");
    } finally {
      setSubmitting(false);
    }
  }

  async function renameFolder(f: Folder) {
    if (busyFolderId) return;
    const name = await promptAsync({
      title: "폴더 이름 변경",
      placeholder: "새 폴더 이름",
      defaultValue: f.name,
      confirmLabel: "변경",
    });
    if (!name?.trim() || name === f.name) return;
    setBusyFolderId(f.id);
    try {
      await api(`/api/document/folders/${f.id}`, { method: "PATCH", json: { name: name.trim() } });
      await load();
    } catch (e: any) {
      alertAsync({ title: "변경 실패", description: e?.message ?? "이름 변경에 실패했어요" });
    } finally {
      setBusyFolderId(null);
    }
  }

  async function deleteFolder(f: Folder) {
    if (busyFolderId) return;
    // 3지선다: 전체 삭제(기본) / 문서는 보존하고 폴더만 삭제 / 취소.
    const choice = await confirmAsync({
      title: "폴더 삭제",
      description: `'${f.name}' 폴더를 삭제할까요?\n기본은 하위 폴더·문서까지 전부 삭제예요.\n"문서는 보관" 을 누르면 안에 있던 문서는 상위 폴더로 옮기고 빈 폴더만 삭제해요.`,
      tone: "danger",
      confirmLabel: "전체 삭제",
      secondaryLabel: "문서는 보관",
    });
    if (!choice) return; // false / null 취소.
    const mode = choice === "secondary" ? "keep" : "cascade";
    setBusyFolderId(f.id);
    try {
      await api(`/api/document/folders/${f.id}?mode=${mode}`, { method: "DELETE" });
      if (currentFolder === f.id) setCurrentFolder("root");
      else await load();
    } catch (e: any) {
      alertAsync({ title: "삭제 실패", description: e?.message ?? "폴더 삭제에 실패했어요" });
    } finally {
      setBusyFolderId(null);
    }
  }

  async function uploadFile(file: File) {
    if (file.size > 500 * 1024 * 1024) {
      await alertAsync({ title: "파일 크기 초과", description: "파일은 500MB 이하만 업로드 가능해요" });
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      // 문서함 전용 엔드포인트 — 서버에서 500MB 까지 허용.
      const res = await apiFetch("/api/upload/document", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json()).error);
      const json = await res.json();
      setDocForm((p) => ({
        ...p,
        title: p.title || file.name.replace(/\.[^.]+$/, ""),
        fileUrl: json.url,
        fileName: json.name,
        fileType: json.type,
        fileSize: json.size,
      }));
    } catch (e: any) {
      alertAsync({ title: "업로드 실패", description: e.message });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /**
   * 드래그 앤 드롭으로 떨어진 파일을 곧장 업로드하고 문서로 등록한다.
   * 모달을 여는 업로드 버튼 흐름과 달리 제목·설명·태그 없이 파일명 그대로 생성.
   * scope 는 현재 보고 있는 공개범위 탭을 따르고(ALL/TEAM/PRIVATE), CUSTOM 은
   * 사용자 선택이 필요하므로 드롭 업로드에선 ALL 로 내린다.
   */
  async function uploadAndCreate(file: File) {
    if (file.size > 500 * 1024 * 1024) {
      await alertAsync({ title: "파일 크기 초과", description: "파일은 500MB 이하만 업로드 가능해요" });
      return;
    }
    const form = new FormData();
    form.append("file", file);
    const res = await apiFetch("/api/upload/document", { method: "POST", body: form });
    if (!res.ok) throw new Error((await res.json()).error);
    const up = await res.json();
    const fallbackScope: DocScope =
      scopeTab === "team" ? "TEAM" : scopeTab === "private" ? "PRIVATE" : "ALL";
    await api("/api/document", {
      method: "POST",
      json: {
        title: file.name.replace(/\.[^.]+$/, ""),
        description: "",
        tags: "",
        fileUrl: up.url,
        fileName: up.name,
        fileType: up.type,
        fileSize: up.size,
        folderId: currentFolder === "root" ? null : currentFolder,
        scope: inProject ? undefined : fallbackScope,
        projectId: activeProjectId ?? undefined,
      },
    });
  }

  /**
   * 폴더(디렉터리) 통째 업로드.
   * <input webkitdirectory> 로 들어온 파일들은 각 File 에 `webkitRelativePath` 가 채워진다.
   *   예: 기획문서/2025Q2/기획안.docx
   * 이 경로를 분해해서 필요한 폴더들을 서버에 먼저 생성(중복은 스킵)하고,
   * 각 파일을 해당 folderId 밑에 업로드한다. 빈 폴더도 보존.
   */
  async function handleFolderUpload(files: FileList) {
    if (!files.length) return;
    const list = Array.from(files);
    // 상대경로 누락된 파일(크롬/사파리 외) 은 webkitdirectory 가 없을 때 — 그냥 루트로 업로드.
    const anyHasPath = list.some((f) => (f as any).webkitRelativePath);
    if (!anyHasPath) {
      await handleFilesDropped(files);
      return;
    }

    setFolderUpload({ done: 0, total: list.length, label: "폴더 분석 중…" });
    try {
      // 1) 모든 파일 경로에서 필요한 폴더 경로를 추출 (중복 제거).
      //    "a/b/c/file.png" → ["a", "a/b", "a/b/c"]
      const needed = new Set<string>();
      for (const f of list) {
        const rel: string = (f as any).webkitRelativePath || f.name;
        const parts = rel.split("/").slice(0, -1);
        for (let i = 1; i <= parts.length; i++) {
          needed.add(parts.slice(0, i).join("/"));
        }
      }
      // 얕은 폴더부터 정렬(부모 먼저 생성되도록).
      const orderedPaths = Array.from(needed).sort((a, b) => a.split("/").length - b.split("/").length);

      // 2) 경로 → folderId 맵. 루트는 현재 폴더.
      const pathToId = new Map<string, string | null>();
      pathToId.set("", currentFolder === "root" ? null : currentFolder);

      const fallbackScope: DocScope =
        scopeTab === "team" ? "TEAM" : scopeTab === "private" ? "PRIVATE" : "ALL";

      for (const path of orderedPaths) {
        const parts = path.split("/");
        const name = parts[parts.length - 1];
        const parentPath = parts.slice(0, -1).join("/");
        const parentId = pathToId.get(parentPath) ?? null;
        setFolderUpload((s) => s ? { ...s, label: `폴더 생성: ${path}` } : s);
        const res = await api<{ folder: { id: string } }>("/api/document/folders", {
          method: "POST",
          json: {
            name,
            parentId,
            scope: inProject ? undefined : fallbackScope,
            projectId: activeProjectId ?? undefined,
          },
        });
        pathToId.set(path, res.folder.id);
      }

      // 3) 파일 업로드 — 병렬로 (pool 패턴). 직렬로 하면 느려서 200개 업로드에 수 분.
      //    동시 6개로 제한해 브라우저 connection limit(도메인 당 보통 6) 과 서버 메모리 둘 다 부담 적음.
      //    에러는 그때그때 alert 로 띄우지 않고 모았다가 끝나고 사유별로 한 번에 보여준다.
      let done = 0;
      const failures: { rel: string; reason: string }[] = [];
      await runInPool(list, 6, async (f) => {
        const rel: string = (f as any).webkitRelativePath || f.name;
        const parts = rel.split("/");
        const folderPath = parts.slice(0, -1).join("/");
        const targetFolderId = pathToId.get(folderPath) ?? null;
        try {
          if (f.size > 500 * 1024 * 1024) {
            failures.push({ rel, reason: "500MB 초과" });
          } else {
            const form = new FormData();
            form.append("file", f);
            const res = await apiFetch("/api/upload/document", { method: "POST", body: form });
            if (!res.ok) throw new Error((await res.json()).error);
            const up = await res.json();
            await api("/api/document", {
              method: "POST",
              json: {
                title: f.name.replace(/\.[^.]+$/, ""),
                description: "",
                tags: "",
                fileUrl: up.url,
                fileName: up.name,
                fileType: up.type,
                fileSize: up.size,
                folderId: targetFolderId,
                scope: inProject ? undefined : fallbackScope,
                projectId: activeProjectId ?? undefined,
              },
            });
          }
        } catch (e: any) {
          failures.push({ rel, reason: e?.message ?? "알 수 없는 오류" });
        }
        done += 1;
        setFolderUpload({ done, total: list.length, label: rel });
      });
      await load();
      if (failures.length) await reportUploadFailures(failures);
    } finally {
      setFolderUpload(null);
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  }

  /**
   * 업로드 실패 여러 건을 사유별로 묶어 한 번에 알림.
   *   - 같은 사유가 여러 건: "파일A 외 3개: 사유" 형식으로 한 줄
   *   - 사유가 다양하면 줄바꿈으로 섹션 나눠 표시
   * 파일 50개 중 30개가 SVG 차단에 걸려도 "확인" 한 번이면 끝난다.
   */
  async function reportUploadFailures(failures: { rel: string; reason: string }[]) {
    if (!failures.length) return;
    const byReason = new Map<string, string[]>();
    for (const f of failures) {
      const key = f.reason || "알 수 없는 오류";
      const arr = byReason.get(key) ?? [];
      arr.push(f.rel);
      byReason.set(key, arr);
    }
    const lines: string[] = [];
    for (const [reason, files] of byReason) {
      const head = files[0];
      const rest = files.length - 1;
      const label = rest > 0 ? `${head} 외 ${rest}개` : head;
      lines.push(`• ${label}: ${reason}`);
    }
    await alertAsync({
      title: `업로드 실패 ${failures.length}건`,
      description: lines.join("\n"),
    });
  }

  /**
   * 간단한 동시성 제한 풀.
   *   - items 를 worker 동시 실행해서 concurrency 이하로 유지
   *   - 각 worker 는 독립 (실패해도 다른 건 계속). 에러는 worker 에서 직접 처리.
   *   - 순서는 보장하지 않음 (업로드 순서는 UX 상 중요하지 않음).
   * 외부 라이브러리 안 넣고 12줄로 끝남 — p-limit 안 쓴 이유.
   */
  async function runInPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
    let idx = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const i = idx++;
        if (i >= items.length) return;
        await worker(items[i]);
      }
    });
    await Promise.all(runners);
  }

  const [dropActive, setDropActive] = useState(false);

  /**
   * 드롭된 DataTransfer 에서 파일과 "디렉터리 포함 여부" 를 같이 추출.
   *   - 일반 파일 드롭: files 만 채워진다.
   *   - 폴더 드롭(Chrome/Electron): items[].webkitGetAsEntry() 로 재귀 탐색.
   *     각 File 에 webkitRelativePath 를 붙여서 handleFolderUpload 가 이해하게 만든다.
   *
   * DataTransfer 는 비동기 루프 안에서 items 가 비어버리는 버그가 있어서 진입 직후에
   * entry 배열을 먼저 뽑아놓고 나서 walker 를 돌린다.
   */
  async function extractFromDataTransfer(dt: DataTransfer): Promise<{ files: File[]; hasDir: boolean }> {
    const items = Array.from(dt.items || []);
    const entries: any[] = [];
    for (const it of items) {
      if (it.kind !== "file") continue;
      const anyIt = it as any;
      const entry = anyIt.webkitGetAsEntry ? anyIt.webkitGetAsEntry() : null;
      if (entry) entries.push(entry);
    }
    // 폴더 entry 가 하나도 없고 단순 파일 드롭이면 fast path.
    const hasDir = entries.some((e) => e?.isDirectory);
    if (!hasDir) return { files: Array.from(dt.files || []), hasDir: false };

    const out: File[] = [];
    async function readDir(dirEntry: any, pathPrefix: string) {
      const reader = dirEntry.createReader();
      // readEntries 는 한 번에 최대 100 개만 돌려주므로 빌 때까지 반복.
      while (true) {
        const batch: any[] = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const entry of batch) {
          if (entry.isFile) {
            const file: File = await new Promise((res, rej) => entry.file(res, rej));
            const rel = `${pathPrefix}${entry.name}`;
            try { Object.defineProperty(file, "webkitRelativePath", { value: rel, configurable: true }); } catch {}
            out.push(file);
          } else if (entry.isDirectory) {
            await readDir(entry, `${pathPrefix}${entry.name}/`);
          }
        }
      }
    }
    for (const entry of entries) {
      if (entry.isFile) {
        const file: File = await new Promise((res, rej) => entry.file(res, rej));
        // 최상위 파일은 상대경로 없이 루트 취급.
        out.push(file);
      } else if (entry.isDirectory) {
        await readDir(entry, `${entry.name}/`);
      }
    }
    return { files: out, hasDir: true };
  }

  async function handleDrop(dt: DataTransfer) {
    const { files, hasDir } = await extractFromDataTransfer(dt);
    if (!files.length) return;
    if (hasDir) {
      // FileList 흉내: handleFolderUpload 는 FileList 시그니처지만 내부에서 Array.from 만 써서 배열도 OK.
      await handleFolderUpload(files as unknown as FileList);
    } else {
      await handleFilesDropped(files);
    }
  }

  async function handleFilesDropped(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setUploading(true);
    try {
      // 대량일 때도 진행률 UI 가 보이도록 folderUpload 상태를 재사용.
      // (기존 uploading 플래그는 스피너만 돌릴 뿐 몇 개중 몇 개인지 안 보였음.)
      setFolderUpload({ done: 0, total: list.length, label: "" });
      let done = 0;
      const failures: { rel: string; reason: string }[] = [];
      await runInPool(list, 6, async (f) => {
        try { await uploadAndCreate(f); }
        catch (e: any) { failures.push({ rel: f.name, reason: e?.message ?? "알 수 없는 오류" }); }
        done += 1;
        setFolderUpload({ done, total: list.length, label: f.name });
      });
      await load();
      if (failures.length) await reportUploadFailures(failures);
    } finally {
      setUploading(false);
      setFolderUpload(null);
    }
  }

  async function createDoc(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!docForm.title.trim()) {
      setModalErr("제목을 입력해주세요");
      return;
    }
    if (docForm.scope === "CUSTOM" && docForm.scopeUserIds.length === 0) {
      setModalErr("사용자지정 범위에선 최소 한 명 이상을 선택해주세요");
      return;
    }
    setSubmitting(true);
    setModalErr(null);
    try {
      await api("/api/document", {
        method: "POST",
        json: {
          title: docForm.title,
          description: docForm.description,
          tags: docForm.tags,
          fileUrl: docForm.fileUrl,
          fileName: docForm.fileName,
          fileType: docForm.fileType,
          fileSize: docForm.fileSize,
          folderId: currentFolder === "root" ? null : currentFolder,
          // 프로젝트 문서함에선 scope 필드가 무의미 — 서버가 ALL 로 고정.
          scope: inProject ? undefined : docForm.scope,
          scopeTeam: null,
          scopeUserIds: !inProject && docForm.scope === "CUSTOM" ? docForm.scopeUserIds : undefined,
          projectId: activeProjectId ?? undefined,
        },
      });
      setCreating(null);
      setDocForm({ title: "", description: "", tags: "", fileUrl: "", fileName: "", fileType: "", fileSize: 0, scope: "ALL", scopeTeam: "", scopeUserIds: [] });
      await load();
    } catch (e: any) {
      setModalErr(e?.message ?? "문서 등록에 실패했어요");
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteDoc(d: Doc) {
    if (busyDocId) return;
    const ok = await confirmAsync({
      title: "문서 삭제",
      description: `'${d.title}' 을(를) 삭제할까요? 되돌릴 수 없어요.`,
      tone: "danger",
      confirmLabel: "삭제",
    });
    if (!ok) return;
    setBusyDocId(d.id);
    // 낙관적 제거.
    const prev = docs;
    setDocs((xs) => xs.filter((x) => x.id !== d.id));
    try {
      await api(`/api/document/${d.id}`, { method: "DELETE" });
    } catch (e: any) {
      setDocs(prev);
      alertAsync({ title: "삭제 실패", description: e?.message ?? "삭제에 실패했어요" });
    } finally {
      setBusyDocId(null);
    }
  }

  // ===== 다운로드 =====
  // 개별 문서 — /uploads/<key>?download=1&name=<원본이름> 으로 강제 첨부 헤더 받기.
  // 이미지·영상처럼 기본이 인라인인 타입도 확실히 "저장" 대화상자를 띄우게 함.
  function downloadDoc(d: Doc) {
    if (!d.fileUrl) return;
    const url = new URL(d.fileUrl, window.location.origin);
    url.searchParams.set("download", "1");
    if (d.fileName) url.searchParams.set("name", d.fileName);
    downloadFromUrl(url.toString(), d.fileName ?? "");
  }

  // 폴더 전체 — 서버에서 ZIP 스트림으로 내려옴. 큰 폴더는 시간이 꽤 걸릴 수 있음.
  // 기존엔 <a target="_blank"> 로 새 탭 열어 attachment 헤더로 다운로드 유도했는데
  // 서버가 404/500 을 내면 새 탭에 JSON/빈페이지가 뜨고 사용자는 왜 안되는지 알 수 없었음.
  // fetch 로 받아 Blob 으로 내려받으면: 에러 시 JSON 본문을 파싱해 alertAsync 로 안내 가능.
  async function downloadFolder(f: Folder) {
    try {
      const res = await apiFetch(`/api/document/folders/${f.id}/download`);
      if (!res.ok) {
        let msg = `다운로드 실패 (HTTP ${res.status})`;
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {}
        await alertAsync({ title: "폴더 다운로드 실패", description: msg });
        return;
      }
      const blob = await res.blob();
      if (blob.size === 0) {
        await alertAsync({ title: "폴더 다운로드 실패", description: "서버가 빈 파일을 반환했어요." });
        return;
      }
      const cd = res.headers.get("Content-Disposition") || "";
      const mName = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
      const fname = mName ? decodeURIComponent(mName[1]) : `${f.name}.zip`;
      downloadBlob(blob, fname);
    } catch (err: any) {
      await alertAsync({ title: "폴더 다운로드 실패", description: err?.message ?? String(err) });
    }
  }

  // ===== 문서 드래그앤드롭 이동 =====
  // 행을 폴더 카드(또는 브레드크럼) 위에 떨어뜨려 folderId 만 PATCH.
  // 서버는 작성자 본인 or ADMIN 에게만 PATCH 를 허용하므로 권한 없는 이동은 403.
  const [draggingDocId, setDraggingDocId] = useState<string | null>(null);
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null); // "folder:<id>" | "root" | "crumb:<id>" | "chip:<pid>" | "chip:all" | "scope:<key>"

  /**
   * 폴더를 상단 카테고리(프로젝트 칩) 나 공개범위 탭으로 드래그해 옮긴다.
   *   - target.project="__all__" : 전역 문서함으로. 이 때 target.scope 미지정이면 서버 기본 ALL.
   *   - target.project=<pid>      : 해당 프로젝트로 (scope 는 서버에서 ALL 고정).
   *   - target.scope=<'ALL'|'TEAM'|'PRIVATE'> : 전역 문서함 내에서 스코프만 변경.
   * 실패하면 alert 로 알리고 그대로 롤백(서버 상태만 변하면 되므로 load 만 다시).
   */
  async function moveFolderTo(folderId: string, target: { project?: string | null; scope?: "ALL" | "TEAM" | "PRIVATE" }) {
    try {
      const body: any = {};
      if (target.project !== undefined) body.projectId = target.project;
      if (target.scope !== undefined) body.scope = target.scope;
      await api(`/api/document/folders/${folderId}`, { method: "PATCH", json: body });
      await load();
    } catch (e: any) {
      await alertAsync({ title: "폴더 이동 실패", description: e?.message ?? "옮기지 못했어요" });
    }
  }

  async function moveDocToFolder(docId: string, folderId: string | null) {
    const doc = docs.find((x) => x.id === docId);
    if (!doc) return;
    // 같은 폴더로 드롭하면 no-op
    const same =
      (folderId === null && (doc.folderId === null || doc.folderId === undefined)) ||
      (folderId !== null && doc.folderId === folderId);
    if (same) return;
    // 낙관적 업데이트 — 현재 폴더 뷰에서는 즉시 사라짐
    setDocs((prev) => prev.filter((x) => x.id !== docId));
    try {
      await api(`/api/document/${docId}`, { method: "PATCH", json: { folderId } });
    } catch (e: any) {
      alertAsync({ title: "이동 실패", description: e?.message ?? "이동에 실패했어요" });
      load(); // 실패 시 상태 복구
    }
  }

  // 현재 폴더의 하위 폴더
  const currentChildren = useMemo(() => {
    if (currentFolder === "root") return folders.filter((f) => !f.parentId);
    return folders.filter((f) => f.parentId === currentFolder);
  }, [folders, currentFolder]);

  // 브레드크럼 경로
  const crumbs = useMemo(() => {
    const arr: Folder[] = [];
    let id: string | null = currentFolder === "root" ? null : currentFolder;
    while (id) {
      const f = folders.find((x) => x.id === id);
      if (!f) break;
      arr.unshift(f);
      id = f.parentId ?? null;
    }
    return arr;
  }, [folders, currentFolder]);

  return (
    <div>
      {/* 폴더 통째 업로드 입력 — 헤더 버튼이 항상 트리거할 수 있어야 하므로 페이지 루트에 고정. */}
      {/* @ts-expect-error webkitdirectory 는 React 타입에 없지만 크롬/사파리에서 동작 */}
      <input ref={folderInputRef} type="file" webkitdirectory="" directory="" multiple onChange={(e) => { if (e.target.files) handleFolderUpload(e.target.files); }} className="hidden" />
      {!embedded && (
        <PageHeader
          eyebrow="자료"
          title="문서함"
          description="회사 규정·양식·매뉴얼 등을 보관하고 공유합니다."
          right={
            <>
              <button className="btn-ghost" onClick={openFolderModal}>+ 새 폴더</button>
              <button
                className="btn-ghost"
                onClick={() => folderInputRef.current?.click()}
                disabled={!!folderUpload}
                title="폴더를 통째로 업로드 (하위 폴더 구조 유지)"
              >
                {folderUpload ? `업로드 중… ${folderUpload.done}/${folderUpload.total}` : "+ 폴더 업로드"}
              </button>
              <button className="btn-primary" onClick={() => { setModalErr(null); setCreating("doc"); }}>+ 문서 업로드</button>
            </>
          }
        />
      )}

      {/* 카테고리 칩 — 전체 문서함 + 내가 속한 프로젝트들. fixed/embedded 모드에선 숨김. */}
      {!embedded && !fixedProjectId && (projects.length > 0 || selectedProjectId) && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setSelectedProjectId(null)}
            onDragOver={(e) => {
              if (!draggingFolderId && !draggingDocId) return;
              e.preventDefault();
              setDragOverKey("chip:all");
            }}
            onDragLeave={() => setDragOverKey((k) => (k === "chip:all" ? null : k))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverKey(null);
              if (draggingFolderId) {
                const fid = draggingFolderId;
                setDraggingFolderId(null);
                void moveFolderTo(fid, { project: null });
              } else if (draggingDocId) {
                const did = draggingDocId;
                setDraggingDocId(null);
                // 전역 문서함(ALL) 으로 — 프로젝트 해제.
                void api(`/api/document/${did}`, { method: "PATCH", json: { scope: "ALL" } })
                  .then(load)
                  .catch((err: any) => alertAsync({ title: "이동 실패", description: err?.message ?? "" }));
              }
            }}
            className={`px-3 h-8 rounded-full text-[12px] font-bold border transition ${
              dragOverKey === "chip:all" ? "ring-2 ring-brand-400 " : ""
            }${
              selectedProjectId === null
                ? "bg-brand-500 text-white border-brand-500"
                : "bg-[color:var(--c-surface)] text-ink-600 border-ink-200 hover:border-ink-300"
            }`}
          >
            전체 문서함
          </button>
          {projects.map((p) => {
            const on = selectedProjectId === p.id;
            const chipKey = `chip:${p.id}`;
            return (
              <button
                key={p.id}
                onClick={() => setSelectedProjectId(p.id)}
                onDragOver={(e) => {
                  if (!draggingFolderId && !draggingDocId) return;
                  e.preventDefault();
                  setDragOverKey(chipKey);
                }}
                onDragLeave={() => setDragOverKey((k) => (k === chipKey ? null : k))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverKey(null);
                  if (draggingFolderId) {
                    const fid = draggingFolderId;
                    setDraggingFolderId(null);
                    void moveFolderTo(fid, { project: p.id });
                  } else if (draggingDocId) {
                    const did = draggingDocId;
                    setDraggingDocId(null);
                    void api(`/api/document/${did}`, { method: "PATCH", json: { projectId: p.id } })
                      .then(load)
                      .catch((err: any) => alertAsync({ title: "이동 실패", description: err?.message ?? "" }));
                  }
                }}
                className={`px-3 h-8 rounded-full text-[12px] font-bold border transition flex items-center gap-1.5 ${
                  dragOverKey === chipKey ? "ring-2 ring-brand-400 " : ""
                }${
                  on
                    ? "text-white border-transparent"
                    : "bg-[color:var(--c-surface)] text-ink-700 border-ink-200 hover:border-ink-300"
                }`}
                style={on ? { background: p.color } : undefined}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: on ? "#fff" : p.color }} />
                {p.name}
              </button>
            );
          })}
        </div>
      )}

      {/* 임베드 모드용 미니 툴바 — 헤더가 없는 대신 우측 업로드 버튼을 여기 넣는다.
          모바일에선 버튼이 화면폭을 넘기므로 flex-wrap 으로 줄바꿈해 잘림 방지. */}
      {embedded && (
        <div className="flex flex-wrap items-center justify-end gap-2 mb-3">
          <button className="btn-ghost btn-xs" onClick={openFolderModal}>+ 새 폴더</button>
          <button
            className="btn-ghost btn-xs"
            onClick={() => folderInputRef.current?.click()}
            disabled={!!folderUpload}
          >
            {folderUpload ? `업로드 중… ${folderUpload.done}/${folderUpload.total}` : "+ 폴더 업로드"}
          </button>
          <button className="btn-ghost btn-xs" onClick={() => setMemoTarget("new")}>메모 작성</button>
          <button className="btn-primary btn-xs" onClick={() => { setModalErr(null); setCreating("doc"); }}>+ 문서 업로드</button>
        </div>
      )}

      {/* 공개 범위 탭 — 프로젝트 문서함에선 의미 없으므로 숨김. */}
      {!inProject && (
        <div className="flex items-center gap-1 mb-3 border-b border-ink-150 overflow-x-auto no-scrollbar">
          {SCOPE_TABS.map((t) => {
            // 드래그로 스코프 이동 가능한 탭.
            //  - 폴더: ALL/TEAM/PRIVATE 로만. CUSTOM 은 대상 유저를 정해야 해서 폴더 드롭은 미지원.
            //  - 문서: ALL/TEAM/PRIVATE 는 바로. CUSTOM 은 기존에 scopeUserIds 가 있으면 그 값을 재사용,
            //          없으면 편집 모달에서 대상 지정하라고 안내.
            // "전체"(all) 는 가시성 필터 OR 합집합이라 스코프값이 없어 → ALL 로 매핑.
            const scopeTarget: "ALL" | "TEAM" | "PRIVATE" | "CUSTOM" | null =
              t.key === "all" || t.key === "public" ? "ALL"
              : t.key === "team" ? "TEAM"
              : t.key === "private" ? "PRIVATE"
              : t.key === "custom" ? "CUSTOM"
              : null;
            const tabKey = `scope:${t.key}`;
            const folderCanDrop = !!draggingFolderId && scopeTarget !== null && scopeTarget !== "CUSTOM" && !inProject;
            const docCanDrop = !!draggingDocId && scopeTarget !== null && !inProject;
            const canDrop = folderCanDrop || docCanDrop;
            return (
              <button
                key={t.key}
                onClick={() => setScopeTab(t.key)}
                onDragOver={(e) => {
                  if (!canDrop) return;
                  e.preventDefault();
                  setDragOverKey(tabKey);
                }}
                onDragLeave={() => setDragOverKey((k) => (k === tabKey ? null : k))}
                onDrop={(e) => {
                  if (!canDrop || !scopeTarget) return;
                  e.preventDefault();
                  setDragOverKey(null);
                  if (draggingFolderId && scopeTarget !== "CUSTOM") {
                    const fid = draggingFolderId;
                    setDraggingFolderId(null);
                    void moveFolderTo(fid, { project: null, scope: scopeTarget as "ALL" | "TEAM" | "PRIVATE" });
                  } else if (draggingDocId) {
                    const did = draggingDocId;
                    const doc = docs.find((x) => x.id === did);
                    setDraggingDocId(null);
                    if (scopeTarget === "CUSTOM") {
                      // 기존 사용자 지정 목록이 없으면 편집 모달에서 지정하라고 안내.
                      const existing = (doc?.scopeUserIds ?? "").split(",").map((s) => s.trim()).filter(Boolean);
                      if (existing.length === 0) {
                        void alertAsync({
                          title: "사용자지정으로 옮기려면 대상이 필요해요",
                          description: "문서를 편집해 사용자지정 범위에서 공유할 구성원을 선택해주세요.",
                        });
                        return;
                      }
                      void api(`/api/document/${did}`, {
                        method: "PATCH",
                        json: { scope: "CUSTOM", scopeUserIds: existing },
                      })
                        .then(load)
                        .catch((err: any) => alertAsync({ title: "이동 실패", description: err?.message ?? "" }));
                    } else {
                      void api(`/api/document/${did}`, { method: "PATCH", json: { scope: scopeTarget } })
                        .then(load)
                        .catch((err: any) => alertAsync({ title: "이동 실패", description: err?.message ?? "" }));
                    }
                  }
                }}
                className={`inline-flex items-center justify-center flex-shrink-0 whitespace-nowrap px-3 h-9 text-[13px] font-bold border-b-2 transition ${
                  dragOverKey === tabKey ? "bg-brand-50 " : ""
                }${
                  scopeTab === t.key
                    ? "border-brand-500 text-ink-900"
                    : "border-transparent text-ink-500 hover:text-ink-700"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {/* 툴바 — 좁은 화면에서는 breadcrumb / 검색 을 세로로 쌓아 겹침 방지 */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
        <div className="flex flex-wrap items-center gap-1 text-[13px] flex-1 min-w-0">
          <button
            className={`px-2 py-1 rounded transition ${
              dragOverKey === "root" ? "bg-brand-100 ring-2 ring-brand-400" : "hover:bg-ink-100"
            } ${currentFolder === "root" ? "font-bold text-ink-900" : "text-ink-600"}`}
            onClick={() => setCurrentFolder("root")}
            onDragOver={(e) => {
              if (!draggingDocId && !draggingFolderId) return;
              e.preventDefault();
              setDragOverKey("root");
            }}
            onDragLeave={() => setDragOverKey((k) => (k === "root" ? null : k))}
            onDrop={(e) => {
              if (!draggingDocId && !draggingFolderId) return;
              e.preventDefault();
              if (draggingFolderId) {
                const fid = draggingFolderId;
                setDragOverKey(null);
                setDraggingFolderId(null);
                void api(`/api/document/folders/${fid}`, {
                  method: "PATCH",
                  json: { parentId: null },
                }).then(load).catch((err: any) => {
                  alertAsync({ title: "폴더 이동 실패", description: err?.message ?? "" });
                });
                return;
              }
              if (draggingDocId) moveDocToFolder(draggingDocId, null);
              setDragOverKey(null);
              setDraggingDocId(null);
            }}
          >
            📁 루트
          </button>
          {crumbs.map((f) => {
            const key = `crumb:${f.id}`;
            return (
              <span key={f.id} className="flex items-center gap-1">
                <span className="text-ink-300">/</span>
                <button
                  className={`px-2 py-1 rounded transition ${
                    dragOverKey === key ? "bg-brand-100 ring-2 ring-brand-400" : "hover:bg-ink-100"
                  } ${f.id === currentFolder ? "font-bold text-ink-900" : "text-ink-600"}`}
                  onClick={() => setCurrentFolder(f.id)}
                  onDragOver={(e) => {
                    if (!draggingDocId && !draggingFolderId) return;
                    if (draggingFolderId === f.id) return;
                    e.preventDefault();
                    setDragOverKey(key);
                  }}
                  onDragLeave={() => setDragOverKey((k) => (k === key ? null : k))}
                  onDrop={(e) => {
                    if (draggingDocId) {
                      e.preventDefault();
                      moveDocToFolder(draggingDocId, f.id);
                      setDragOverKey(null);
                      setDraggingDocId(null);
                    } else if (draggingFolderId && draggingFolderId !== f.id) {
                      e.preventDefault();
                      const fid = draggingFolderId;
                      setDragOverKey(null);
                      setDraggingFolderId(null);
                      void api(`/api/document/folders/${fid}`, {
                        method: "PATCH",
                        json: { parentId: f.id },
                      }).then(load).catch((err: any) => {
                        alertAsync({ title: "폴더 이동 실패", description: err?.message ?? "" });
                      });
                    }
                  }}
                >
                  {f.name}
                </button>
              </span>
            );
          })}
        </div>
        <div className="relative w-full sm:w-[220px]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8E959E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            className="input pl-9"
            placeholder="문서 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={80}
          />
        </div>
      </div>

      {/*
        폴더 + 문서 공용 드롭존 — 파일을 떨어뜨리면 문서로, 폴더를 떨어뜨리면 폴더+내부 문서로 업로드.
        두 섹션을 하나로 감싸서 사용자가 폴더 카드 주변에 놔도 인식되게 함.
      */}
      <div
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!dropActive) setDropActive(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDropActive(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDropActive(false);
          const dt = e.dataTransfer;
          void handleDrop(dt);
        }}
        className={`relative rounded-2xl transition ${dropActive ? "ring-2 ring-brand-400 ring-offset-2 ring-offset-[color:var(--c-bg)]" : ""}`}
      >
        {dropActive && (
          <div className="pointer-events-none absolute inset-0 z-10 rounded-2xl bg-brand-500/10 border-2 border-dashed border-brand-400 grid place-items-center">
            <div className="text-center">
              <div className="text-[13px] font-bold text-brand-700">여기에 놓으면 업로드돼요</div>
              <div className="text-[11px] text-brand-600 mt-0.5">파일 → 문서 · 폴더 → 폴더로 업로드</div>
            </div>
          </div>
        )}

      {/* 폴더 그리드 */}
      {currentChildren.length > 0 && (
        <div className="mb-5">
          <div className="text-[11px] font-extrabold text-ink-500 uppercase tracking-[0.08em] mb-2">폴더 <span className="text-ink-400 tabular">{currentChildren.length}</span></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {currentChildren.map((f) => {
              const dropKey = `folder:${f.id}`;
              const isDropTarget = dragOverKey === dropKey;
              return (
              <div
                key={f.id}
                draggable
                onDragStart={(e) => {
                  setDraggingFolderId(f.id);
                  e.dataTransfer.setData("text/plain", `folder:${f.id}`);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => { setDraggingFolderId(null); setDragOverKey(null); }}
                onDoubleClick={() => setCurrentFolder(f.id)}
                className={`panel p-4 flex items-center gap-3 cursor-pointer group transition relative ${
                  isDropTarget
                    ? "border-brand-500 bg-brand-50 ring-2 ring-brand-400"
                    : "hover:border-ink-300"
                } ${draggingFolderId === f.id ? "opacity-50" : ""}`}
                onClick={() => setCurrentFolder(f.id)}
                onDragOver={(e) => {
                  // 문서 드래그거나 폴더 드래그 둘 다 수락 — 단, 자기 자신 위로는 안 됨.
                  if (!draggingDocId && !draggingFolderId) return;
                  if (draggingFolderId === f.id) return;
                  e.preventDefault();
                  setDragOverKey(dropKey);
                }}
                onDragLeave={() => setDragOverKey((k) => (k === dropKey ? null : k))}
                onDrop={(e) => {
                  if (draggingDocId) {
                    e.preventDefault();
                    moveDocToFolder(draggingDocId, f.id);
                    setDragOverKey(null);
                    setDraggingDocId(null);
                  } else if (draggingFolderId && draggingFolderId !== f.id) {
                    e.preventDefault();
                    const fid = draggingFolderId;
                    setDragOverKey(null);
                    setDraggingFolderId(null);
                    // 서버가 자기 하위 폴더 체크하므로 이상 입력은 거절됨.
                    void api(`/api/document/folders/${fid}`, {
                      method: "PATCH",
                      json: { parentId: f.id },
                    }).then(load).catch((err: any) => {
                      alertAsync({ title: "폴더 이동 실패", description: err?.message ?? "옮기지 못했어요" });
                    });
                  }
                }}
              >
                <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 grid place-items-center flex-shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-ink-900 truncate">{f.name}</div>
                  <div className="text-[11px] text-ink-500 tabular">{new Date(f.createdAt).toLocaleDateString("ko-KR")}</div>
                </div>
                {/* 모바일: 폴더 열기 셰브론 (데스크톱은 우상단 호버 액션) */}
                <svg className="md:hidden text-ink-300 flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                {/* 호버 액션은 absolute 오버레이 — 평소엔 레이아웃을 먹지 않아 이름·날짜 영역이 잘리지 않음. */}
                <div className="touch-reveal-flex absolute top-2 right-2 hidden group-hover:flex items-center gap-0.5 bg-[color:var(--c-surface)]/95 backdrop-blur-sm rounded-lg px-1 py-0.5 shadow-sm border border-ink-100">
                  <button className="btn-icon" onClick={(e) => { e.stopPropagation(); downloadFolder(f); }} title="폴더 전체 다운로드 (ZIP)">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
                  </button>
                  <button className="btn-icon" onClick={(e) => { e.stopPropagation(); setSharingFolder(f); }} title="외부 공유 링크">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></svg>
                  </button>
                  <button className="btn-icon" onClick={(e) => { e.stopPropagation(); renameFolder(f); }} title="이름 변경">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                  </button>
                  <button className="btn-icon" onClick={(e) => { e.stopPropagation(); deleteFolder(f); }} title="삭제">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                  </button>
                </div>
              </div>
            );
            })}
          </div>
        </div>
      )}

      {/* 문서 리스트 */}
      <div className="mb-2 text-[11px] font-extrabold text-ink-500 uppercase tracking-[0.08em]">문서 <span className="text-ink-400 tabular">{docs.length}</span></div>
      {loadErr && (
        <div className="mb-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-[12px] text-rose-700 flex items-center justify-between gap-2">
          <span>{loadErr}</span>
          <button
            className="btn-ghost !px-2 !py-1 text-[11px]"
            onClick={() => { const ref = { current: true }; load(ref); }}
          >
            다시 시도
          </button>
        </div>
      )}
      {docs.length === 0 ? (
        <div className="panel py-14 px-6 text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-ink-100 grid place-items-center mb-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8E959E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
            </svg>
          </div>
          <div className="text-[13px] font-bold text-ink-800">문서가 없어요</div>
          <div className="text-[12px] text-ink-500 mt-1 max-w-[300px] mx-auto leading-relaxed">우측 상단 "문서 업로드" 버튼을 누르거나 파일을 이 영역으로 끌어다 놓아보세요.</div>
        </div>
      ) : (
        <>
        {/* 데스크톱(md+): 인라인 테이블. iPad portrait 는 이 너비를 못 받쳐 모바일 카드로 보낸다. */}
        <div className="panel p-0 overflow-hidden overflow-x-auto hidden md:block">
          <table className="pro min-w-[760px]">
            <thead>
              <tr>
                <th>제목</th>
                <th>태그</th>
                <th>파일</th>
                <th>작성자</th>
                <th>수정</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr
                  key={d.id}
                  draggable
                  onDragStart={(e) => {
                    setDraggingDocId(d.id);
                    // 일부 브라우저는 dataTransfer 에 무언가 실려있지 않으면 드래그를 취소함
                    e.dataTransfer.setData("text/plain", d.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    setDraggingDocId(null);
                    setDragOverKey(null);
                  }}
                  style={{
                    cursor: "grab",
                    opacity: draggingDocId === d.id ? 0.5 : 1,
                  }}
                >
                  <td className="cell-primary">
                    <div
                      className={`flex items-start gap-2.5 ${d.content != null ? "cursor-pointer" : ""}`}
                      onClick={d.content != null ? () => setMemoTarget(d) : undefined}
                      title={d.content != null ? "메모 열기" : undefined}
                    >
                      {/* 메모 vs 파일 문서 아이콘 구분 */}
                      {d.content != null ? (
                        <div className="w-8 h-8 rounded-lg bg-violet-50 text-violet-700 grid place-items-center flex-shrink-0">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
                          </svg>
                        </div>
                      ) : (() => {
                        const ext = (d.fileName?.split(".").pop() || "").toLowerCase();
                        const M: Record<string, [string, string]> = {
                          pdf: ["PDF", "bg-rose-50 text-rose-700"],
                          doc: ["DOC", "bg-sky-50 text-sky-700"], docx: ["DOC", "bg-sky-50 text-sky-700"],
                          xls: ["XLS", "bg-emerald-50 text-emerald-700"], xlsx: ["XLS", "bg-emerald-50 text-emerald-700"], csv: ["CSV", "bg-emerald-50 text-emerald-700"],
                          ppt: ["PPT", "bg-orange-50 text-orange-700"], pptx: ["PPT", "bg-orange-50 text-orange-700"],
                          png: ["IMG", "bg-violet-50 text-violet-700"], jpg: ["IMG", "bg-violet-50 text-violet-700"], jpeg: ["IMG", "bg-violet-50 text-violet-700"], gif: ["IMG", "bg-violet-50 text-violet-700"],
                          zip: ["ZIP", "bg-amber-50 text-amber-700"],
                        };
                        const hit = M[ext] || [ext ? ext.slice(0, 3).toUpperCase() : "FILE", "bg-ink-100 text-ink-600"];
                        return (
                          <div className={`w-8 h-8 rounded-lg grid place-items-center flex-shrink-0 text-[9px] font-extrabold tracking-tight ${hit[1]}`}>{hit[0]}</div>
                        );
                      })()}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div
                            className={`cell-title text-[13px] font-bold text-ink-900 truncate max-w-[160px] sm:max-w-[280px] lg:max-w-[400px] ${d.content != null ? "hover:text-brand-700" : ""}`}
                            title={d.title}
                          >
                            {d.title}
                          </div>
                          {d.content != null && (
                            <span className="text-[10px] font-bold px-1.5 py-[1px] rounded bg-violet-50 text-violet-700 flex-shrink-0">메모</span>
                          )}
                          {d.scope && d.scope !== "ALL" && (
                            <span className={`text-[10px] font-bold px-1.5 py-[1px] rounded flex-shrink-0 ${
                              d.scope === "PRIVATE" ? "bg-rose-50 text-rose-700"
                              : d.scope === "TEAM" ? "bg-sky-50 text-sky-700"
                              : "bg-violet-50 text-violet-700"
                            }`}>
                              {SCOPE_LABEL[d.scope]}
                              {d.scope === "TEAM" && d.scopeTeam ? ` · ${d.scopeTeam}` : ""}
                            </span>
                          )}
                        </div>
                        {d.description && <div className="text-[11px] text-ink-500 line-clamp-1">{d.description}</div>}
                      </div>
                    </div>
                  </td>
                  <td data-label="태그" className={(d.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean).length ? "" : "cell-hide-m"}>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {(d.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
                        <span key={t} className="chip-gray">#{t}</span>
                      ))}
                    </div>
                  </td>
                  <td data-label="파일">
                    {(() => {
                      // 과거 데이터에 javascript:/외부 URL 이 남아있을 수 있어 렌더 직전에 한 번 더 검증.
                      const safe = safeUploadUrl(d.fileUrl);
                      if (!d.fileUrl) return <span className="text-ink-400 text-[12px]">—</span>;
                      if (!safe) return (
                        <span className="text-[12px] text-ink-400" title="유효하지 않은 파일 URL">
                          {d.fileName} <span className="text-ink-300">(invalid)</span>
                        </span>
                      );
                      return (
                        <a href={safe} target="_blank" rel="noreferrer" title={d.fileName ?? undefined}
                          onClick={(e) => { if (isCapacitorNative()) { e.preventDefault(); const u = imgSrc(safe); if (u) void Browser.open({ url: u }); } }}
                          className="inline-flex items-center gap-1 max-w-[180px] sm:max-w-[260px] align-middle text-[12px] font-bold text-brand-600 hover:underline tabular">
                          <span className="truncate">{d.fileName}</span>
                          <span className="text-ink-400 flex-shrink-0">({humanSize(d.fileSize ?? 0)})</span>
                        </a>
                      );
                    })()}
                  </td>
                  <td data-label="작성자">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded grid place-items-center text-white text-[10px] font-bold overflow-hidden" style={{ background: d.author.avatarUrl ? "transparent" : (d.author.avatarColor ?? "#6B7280") }}>
                        {d.author.avatarUrl ? (
                          <img src={imgSrc(d.author.avatarUrl)} alt={d.author.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
                        ) : (
                          d.author.name[0]
                        )}
                      </div>
                      <div className="text-[12px]">{d.author.name}</div>
                    </div>
                  </td>
                  <td data-label="수정" className="tabular text-[11px] text-ink-500">{new Date(d.updatedAt).toLocaleDateString("ko-KR")}</td>
                  <td className="cell-actions" style={{ textAlign: "right" }}>
                    <div className="flex items-center justify-end gap-1">
                      {/* 메모 타입 */}
                      {d.content != null ? (
                        <>
                          <button className="btn-icon" onClick={() => setMemoTarget(d)} title="메모 열기">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
                            </svg>
                          </button>
                          <button className="btn-icon" onClick={() => setHistoryDoc(d)} title="버전 히스토리">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg>
                          </button>
                          <button className="btn-icon" onClick={() => deleteDoc(d)} title="삭제">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                          </button>
                        </>
                      ) : (
                        /* 파일 문서 타입 */
                        <>
                          {d.fileUrl && (
                            <button className="btn-icon" onClick={() => downloadDoc(d)} title="다운로드">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
                            </button>
                          )}
                          {d.fileUrl && (
                            <button className="btn-icon" onClick={() => setSharingDoc(d)} title="외부 공유 링크">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></svg>
                            </button>
                          )}
                          <button className="btn-icon" onClick={() => setHistoryDoc(d)} title="버전 히스토리">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg>
                          </button>
                          <button className="btn-icon" onClick={() => deleteDoc(d)} title="삭제">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* 모바일·iPad(<md): 깔끔한 문서 행 (탭하면 열기) */}
        <div className="md:hidden flex flex-col gap-2">
          {docs.map((d) => {
            const isMemo = d.content != null;
            const ext = (d.fileName?.split(".").pop() || "").toLowerCase();
            const TM: Record<string, [string, string]> = {
              pdf: ["PDF", "bg-rose-50 text-rose-700"],
              doc: ["DOC", "bg-sky-50 text-sky-700"], docx: ["DOC", "bg-sky-50 text-sky-700"],
              xls: ["XLS", "bg-emerald-50 text-emerald-700"], xlsx: ["XLS", "bg-emerald-50 text-emerald-700"], csv: ["CSV", "bg-emerald-50 text-emerald-700"],
              ppt: ["PPT", "bg-orange-50 text-orange-700"], pptx: ["PPT", "bg-orange-50 text-orange-700"],
              png: ["IMG", "bg-violet-50 text-violet-700"], jpg: ["IMG", "bg-violet-50 text-violet-700"], jpeg: ["IMG", "bg-violet-50 text-violet-700"], gif: ["IMG", "bg-violet-50 text-violet-700"],
              zip: ["ZIP", "bg-amber-50 text-amber-700"],
            };
            const ft: [string, string] = isMemo
              ? ["MEMO", "bg-violet-50 text-violet-700"]
              : (TM[ext] ?? [ext ? ext.slice(0, 3).toUpperCase() : "FILE", "bg-ink-100 text-ink-600"]);
            const meta = isMemo ? "메모" : `${(ext || "file").toUpperCase()} · ${humanSize(d.fileSize ?? 0)}`;
            const openDoc = () => {
              if (isMemo) { setMemoTarget(d); return; }
              const safe = safeUploadUrl(d.fileUrl);
              if (!safe) return;
              if (isCapacitorNative()) { const u = imgSrc(safe); if (u) void Browser.open({ url: u }); }
              else window.open(safe, "_blank", "noopener");
            };
            return (
              <div key={d.id} className="flex items-center gap-3 rounded-2xl border border-ink-150 bg-[var(--c-surface)] px-3 py-2.5">
                <button onClick={openDoc} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                  <div className={`w-9 h-9 rounded-lg grid place-items-center flex-shrink-0 text-[9px] font-extrabold tracking-tight ${ft[1]}`}>{ft[0]}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-bold text-ink-900 truncate">{d.title || "제목 없음"}</div>
                    <div className="text-[11.5px] text-ink-500 truncate">{meta} · {d.author.name}</div>
                  </div>
                </button>
                <button className="btn-icon flex-shrink-0" onClick={() => deleteDoc(d)} title="삭제">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                </button>
              </div>
            );
          })}
        </div>
        </>
      )}
      </div>
      {/* /폴더+문서 공용 드롭존 */}

      {creating === "folder" && (
        <Portal>
        <div className="fixed inset-0 bg-ink-900/40 grid place-items-center modal-safe z-50" onClick={() => setCreating(null)}>
          <div className="panel w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="section-head">
              <div className="title">새 폴더</div>
              <button className="btn-icon" onClick={() => setCreating(null)} aria-label="닫기">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={createFolder} className="p-5 space-y-3">
              <div>
                <label className="field-label">폴더 이름</label>
                <input
                  className="input"
                  autoFocus
                  value={folderForm.name}
                  onChange={(e) => setFolderForm({ ...folderForm, name: e.target.value })}
                  placeholder="예: 회사규정, 양식모음"
                  required
                />
              </div>
              <div>
                <label className="field-label">공개 범위</label>
                {inProject ? (
                  (() => {
                    const proj = projects.find((p) => p.id === activeProjectId);
                    return (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-ink-200 bg-[color:var(--c-surface-2)]">
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: proj?.color ?? "#6B7280" }}
                        />
                        <div className="text-[12px] text-ink-700">
                          <span className="font-bold">{proj?.name ?? "프로젝트"}</span>
                          <span className="text-ink-500"> 프로젝트 폴더 · 멤버만 열람 가능</span>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(["ALL", "TEAM", "PRIVATE", "CUSTOM"] as DocScope[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setFolderForm((p) => ({ ...p, scope: s }))}
                      className={`h-9 rounded-lg border text-[12px] font-bold transition ${
                        folderForm.scope === s
                          ? "border-brand-500 bg-brand-50 text-brand-700"
                          : "border-ink-200 bg-[color:var(--c-surface)] text-ink-600 hover:border-ink-300"
                      }`}
                    >
                      {SCOPE_LABEL[s]}
                    </button>
                  ))}
                </div>
                {folderForm.scope === "TEAM" && (
                  <div className="mt-2 text-[11px] text-ink-500">내가 속한 팀으로 자동 지정돼요.</div>
                )}
                {folderForm.scope === "CUSTOM" && (
                  <div className="mt-2 border border-ink-200 rounded-lg max-h-[180px] overflow-y-auto p-2 space-y-1">
                    {allUsers.length === 0 ? (
                      <div className="text-[12px] text-ink-500 p-2">사용자를 불러오는 중…</div>
                    ) : (
                      allUsers.map((u) => {
                        const checked = folderForm.scopeUserIds.includes(u.id);
                        return (
                          <label key={u.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-ink-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setFolderForm((p) => ({
                                ...p,
                                scopeUserIds: checked
                                  ? p.scopeUserIds.filter((x) => x !== u.id)
                                  : [...p.scopeUserIds, u.id],
                              }))}
                            />
                            <div className="w-6 h-6 rounded grid place-items-center text-white text-[10px] font-bold overflow-hidden" style={{ background: u.avatarUrl ? "transparent" : (u.avatarColor ?? "#6B7280") }}>
                              {u.avatarUrl ? (
                                <img src={imgSrc(u.avatarUrl)} alt={u.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
                              ) : (
                                u.name[0]
                              )}
                            </div>
                            <div className="text-[12px] flex-1">{u.name}{u.team ? <span className="text-ink-400 ml-1">· {u.team}</span> : null}</div>
                          </label>
                        );
                      })
                    )}
                  </div>
                )}
                </>
                )}
              </div>
              {modalErr && (
                <div className="text-[12px] text-danger bg-rose-50 border border-rose-200 rounded px-3 py-2">
                  {modalErr}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="btn-ghost" onClick={() => setCreating(null)} disabled={submitting}>취소</button>
                <button className="btn-primary" disabled={submitting}>{submitting ? "생성 중…" : "생성"}</button>
              </div>
            </form>
          </div>
        </div>
        </Portal>
      )}

      {creating === "doc" && (
        <Portal>
        <div className="fixed inset-0 bg-ink-900/40 grid place-items-center modal-safe z-50" onClick={() => setCreating(null)}>
          <div className="panel w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="section-head">
              <div className="title">문서 업로드</div>
              <button className="btn-icon" onClick={() => setCreating(null)} aria-label="닫기">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={createDoc} className="p-5 space-y-3">
              <input
                ref={fileRef}
                type="file"
                multiple
                onChange={(e) => {
                  const fs = e.target.files;
                  if (!fs || !fs.length) return;
                  // 1개만 고르면 기존 플로우 — 제목/설명/태그 같이 입력하는 모달.
                  // 2개 이상이면 모달 닫고 드롭 업로드 플로우로 일괄 처리(파일명 그대로 저장).
                  if (fs.length === 1) {
                    void uploadFile(fs[0]);
                  } else {
                    const arr = Array.from(fs);
                    setCreating(null);
                    void handleFilesDropped(arr);
                  }
                  // 동일 파일 재선택 허용.
                  if (fileRef.current) fileRef.current.value = "";
                }}
                className="hidden"
              />
              <button type="button" className="w-full h-[100px] rounded-xl border-2 border-dashed border-ink-200 hover:border-brand-400 hover:bg-brand-50/30 transition flex flex-col items-center justify-center gap-1" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? (
                  <span className="text-[13px] text-ink-500">업로드 중…</span>
                ) : docForm.fileUrl ? (
                  <>
                    <div className="text-[13px] font-bold text-brand-600">✓ {docForm.fileName}</div>
                    <div className="text-[11px] text-ink-500 tabular">{humanSize(docForm.fileSize)} · 클릭해서 변경</div>
                  </>
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 8 5-5 5 5" /><path d="M20 21H4" /></svg>
                    <div className="text-[13px] font-bold text-ink-800">파일 선택 (최대 500MB)</div>
                    <div className="text-[11px] text-ink-500">여러 개 선택 가능 · 링크만 있는 문서도 OK</div>
                  </>
                )}
              </button>
              <div>
                <label className="field-label">제목</label>
                <input className="input" value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} required />
              </div>
              <div>
                <label className="field-label">설명</label>
                <textarea className="input" rows={2} value={docForm.description} onChange={(e) => setDocForm({ ...docForm, description: e.target.value })} />
              </div>
              <div>
                <label className="field-label">태그 (쉼표로 구분)</label>
                <input className="input" value={docForm.tags} onChange={(e) => setDocForm({ ...docForm, tags: e.target.value })} placeholder="예: 규정, 인사, 양식" />
              </div>
              <div>
                <label className="field-label">공개 범위</label>
                {inProject ? (
                  // 프로젝트가 선택된 상태에서 업로드하면 scope 는 의미가 없다.
                  // 프로젝트 멤버십이 권한을 결정하므로 선택 UI 대신 어디로 올라가는지만 알림.
                  (() => {
                    const proj = projects.find((p) => p.id === activeProjectId);
                    return (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-ink-200 bg-[color:var(--c-surface-2)]">
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: proj?.color ?? "#6B7280" }}
                        />
                        <div className="text-[12px] text-ink-700">
                          <span className="font-bold">{proj?.name ?? "프로젝트"}</span>
                          <span className="text-ink-500"> 프로젝트에 업로드 · 멤버만 열람 가능</span>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(["ALL", "TEAM", "PRIVATE", "CUSTOM"] as DocScope[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setDocForm((p) => ({ ...p, scope: s }))}
                      className={`h-9 rounded-lg border text-[12px] font-bold transition ${
                        docForm.scope === s
                          ? "border-brand-500 bg-brand-50 text-brand-700"
                          : "border-ink-200 bg-white text-ink-600 hover:border-ink-300"
                      }`}
                    >
                      {SCOPE_LABEL[s]}
                    </button>
                  ))}
                </div>
                {docForm.scope === "TEAM" && (
                  <div className="mt-2 text-[11px] text-ink-500">
                    내가 속한 팀으로 자동 지정돼요.
                  </div>
                )}
                {docForm.scope === "CUSTOM" && (
                  <div className="mt-2 border border-ink-200 rounded-lg max-h-[180px] overflow-y-auto p-2 space-y-1">
                    {allUsers.length === 0 ? (
                      <div className="text-[12px] text-ink-500 p-2">사용자를 불러오는 중…</div>
                    ) : (
                      allUsers.map((u) => {
                        const checked = docForm.scopeUserIds.includes(u.id);
                        return (
                          <label key={u.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-ink-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setDocForm((p) => ({
                                ...p,
                                scopeUserIds: checked
                                  ? p.scopeUserIds.filter((x) => x !== u.id)
                                  : [...p.scopeUserIds, u.id],
                              }))}
                            />
                            <div className="w-6 h-6 rounded grid place-items-center text-white text-[10px] font-bold overflow-hidden" style={{ background: u.avatarUrl ? "transparent" : (u.avatarColor ?? "#6B7280") }}>
                              {u.avatarUrl ? (
                                <img src={imgSrc(u.avatarUrl)} alt={u.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
                              ) : (
                                u.name[0]
                              )}
                            </div>
                            <div className="text-[12px] flex-1">{u.name}{u.team ? <span className="text-ink-400 ml-1">· {u.team}</span> : null}</div>
                          </label>
                        );
                      })
                    )}
                  </div>
                )}
                </>
                )}
              </div>
              {modalErr && (
                <div className="text-[12px] text-danger bg-rose-50 border border-rose-200 rounded px-3 py-2">
                  {modalErr}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="btn-ghost" onClick={() => setCreating(null)} disabled={submitting}>취소</button>
                <button className="btn-primary" disabled={submitting || uploading}>{submitting ? "등록 중…" : "등록"}</button>
              </div>
            </form>
          </div>
        </div>
        </Portal>
      )}

      {sharingDoc && (
        <ShareLinkModal
          documentId={sharingDoc.id}
          documentTitle={sharingDoc.title}
          onClose={() => setSharingDoc(null)}
        />
      )}

      {sharingFolder && (
        <ShareLinkModal
          folderId={sharingFolder.id}
          documentTitle={sharingFolder.name}
          onClose={() => setSharingFolder(null)}
        />
      )}

      {historyDoc && (
        <RevisionHistoryModal
          kind="document"
          targetId={historyDoc.id}
          title={historyDoc.title}
          onClose={() => setHistoryDoc(null)}
          onRestored={() => load()}
        />
      )}

      {/* ===== 메모 편집/열람 모달 ===== */}
      {/* fallback=null: DocMemoModal 이 createPortal(document.body) 를 사용하므로
          Suspense fallback 에도 동일 컨테이너 portal 을 쓰면 React reconciler 가 crash.
          초기 로드는 100ms 내외라 null 로 충분. */}
      {memoTarget !== null && (
        <Suspense fallback={null}>
          <DocMemoModal
            doc={memoTarget === "new" ? null : (memoTarget as MemoDoc)}
            initialFolderId={memoTarget === "new" ? (currentFolder === "root" ? null : currentFolder) : undefined}
            initialScope={
              memoTarget === "new"
                ? (scopeTab === "team" ? "TEAM" : scopeTab === "private" ? "PRIVATE" : "ALL")
                : undefined
            }
            projectId={activeProjectId ?? null}
            onClose={() => setMemoTarget(null)}
            onSaved={(saved) => {
              setMemoTarget(saved as unknown as Doc);
              // 목록 갱신 — 새 메모면 리스트에 추가, 수정이면 제자리 업데이트
              setDocs((prev) => {
                const idx = prev.findIndex((d) => d.id === saved.id);
                if (idx >= 0) {
                  const next = [...prev];
                  next[idx] = { ...next[idx], ...saved };
                  return next;
                }
                return [saved as unknown as Doc, ...prev];
              });
            }}
            onDeleted={(id) => {
              setMemoTarget(null);
              setDocs((prev) => prev.filter((d) => d.id !== id));
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

function humanSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
