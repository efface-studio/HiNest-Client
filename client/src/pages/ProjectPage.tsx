import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { apiSWR } from "../api";
import { useAuth } from "../auth";
import PageHeader from "../components/PageHeader";
import ProjectCalendar from "../components/ProjectCalendar";
import ProjectWebhooks from "../components/ProjectWebhooks";
import ProjectQaList from "../components/ProjectQaList";
import ProjectSettingsModal from "../components/ProjectSettingsModal";
import DocumentsPage from "./DocumentsPage";

type Member = {
  id: string;
  userId: string;
  role: "OWNER" | "MANAGER" | "MEMBER";
  user: { id: string; name: string; email: string; team: string | null; position: string | null; avatarColor: string; avatarUrl?: string | null };
};

type Project = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  status: "ACTIVE" | "ARCHIVED";
  createdBy: { id: string; name: string };
  createdAt: string;
  members: Member[];
};

/**
 * 프로젝트 상세 — 일단 뼈대만.
 * 이후 게시판/업무/파일/일정 탭이 이 위에 얹힐 예정.
 */
export default function ProjectPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    // stale-while-revalidate — 이전에 방문했던 프로젝트라면 캐시된 응답으로 즉시 렌더.
    // 동시에 백그라운드로 네트워크 호출이 돌아 최신값이 오면 교체.
    apiSWR<{ project: Project }>(`/api/project/${id}`, {
      onCached: (r) => {
        if (!alive) return;
        setProject(r.project);
        setErr(null);
        // 캐시 히트면 "불러오는 중" 타이틀 바로 내린다. 네트워크는 계속 돌고 있음.
        setLoading(false);
      },
      onFresh: (r) => {
        if (!alive) return;
        setProject(r.project);
        setErr(null);
        setLoading(false);
      },
      onError: (e) => {
        if (!alive) return;
        setErr(e?.message ?? "불러오지 못했습니다.");
        setLoading(false);
      },
    });
    return () => {
      alive = false;
    };
  }, [id]);

  // project 로딩이 끝나기 전에도 id 만 있으면 자식들이 fetch 를 시작하도록
  // 껍데기를 먼저 렌더한다. 이렇게 해야 /api/project/:id + events + webhook 3개가
  // 직렬이 아니라 동시에 나간다 (요청이 직렬로 쌓이면 체감 3~5초, 병렬이면 ~1초).
  if (err && !project) {
    return (
      <div className="text-center py-16 text-slate-400">
        <div>프로젝트를 찾을 수 없습니다.</div>
        <Link to="/" className="text-brand-500 text-sm mt-2 inline-block">← 홈으로</Link>
      </div>
    );
  }
  if (!id) return null;

  const members = project?.members ?? [];
  const myMember = members.find((m) => m.userId === user?.id);
  const myRole: "OWNER" | "MANAGER" | "MEMBER" | "ADMIN" | null = user?.role === "ADMIN"
    ? "ADMIN"
    : (myMember?.role ?? null);
  const canOpenSettings = myRole === "OWNER" || myRole === "MANAGER" || myRole === "ADMIN";

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <PageHeader
            title={
              project
                ? project.name + (project.status === "ARCHIVED" ? " (보관됨)" : "")
                : loading
                  ? "불러오는 중…"
                  : "프로젝트"
            }
            description={project?.description || (loading ? "" : "아직 설명이 없습니다.")}
          />
        </div>
        {project && canOpenSettings && (
          <button
            type="button"
            className="btn-icon mt-2"
            title="프로젝트 설정"
            aria-label="프로젝트 설정"
            onClick={() => setSettingsOpen(true)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
        )}
      </div>

      {/* 캘린더를 전체 폭으로 사용하고, 멤버 리스트는 아래로. */}
      <div className="space-y-6">
        <div className="card">
          <ProjectCalendar
            projectId={id}
            members={members.map((m) => ({
              id: m.user.id,
              name: m.user.name,
              avatarColor: m.user.avatarColor,
              avatarUrl: m.user.avatarUrl ?? null,
              position: m.user.position,
              team: m.user.team,
            }))}
          />
        </div>

        <div className="card">
          <ProjectQaList
            projectId={id}
            currentUserId={user?.id ?? null}
            members={members.map((m) => ({
              id: m.user.id,
              name: m.user.name,
              avatarColor: m.user.avatarColor,
              avatarUrl: m.user.avatarUrl ?? null,
            }))}
          />
        </div>

        <div className="card">
          <ProjectWebhooks projectId={id} />
        </div>

        {/* 프로젝트 전용 문서함 — 전체 DocumentsPage 를 projectId 고정 + embed 모드로 임베드.
            카테고리 칩/공개 범위 탭은 숨기고 해당 프로젝트 네임스페이스 안에서만 돌아간다.
            프로젝트 멤버가 아닌 사용자는 API 에서 403 을 받으므로 데이터가 보이지 않음. */}
        <div className="card">
          <div className="section-head">
            <div className="title">문서함</div>
            <div className="text-[12px] text-ink-500">이 프로젝트 멤버만 보고/편집할 수 있습니다.</div>
          </div>
          <div className="p-4">
            <DocumentsPage projectId={id} embedded />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-bold">
              멤버 <span className="text-slate-400 font-normal">({members.length})</span>
            </div>
            {canOpenSettings && (
              <button
                type="button"
                className="text-[12px] text-brand-600 hover:underline"
                onClick={() => setSettingsOpen(true)}
              >
                멤버 관리
              </button>
            )}
          </div>
          {/* 가로 그리드 — 넓은 영역을 활용해 카드 형태로 나열 */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-2.5 border border-slate-100 rounded-lg px-3 py-2">
                <div
                  className="avatar avatar-sm overflow-hidden"
                  style={{ background: m.user.avatarUrl ? "transparent" : m.user.avatarColor }}
                  title={m.user.name}
                >
                  {m.user.avatarUrl ? (
                    <img src={m.user.avatarUrl} alt={m.user.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
                  ) : (
                    m.user.name[0]
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold truncate">{m.user.name}</div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {m.user.team ?? "-"} · {m.user.position ?? "-"}
                  </div>
                </div>
                {m.role !== "MEMBER" && (
                  <span className="chip bg-brand-50 text-brand-600 text-[10px]">
                    {m.role === "OWNER" ? "오너" : "매니저"}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {project && myRole && (
        <ProjectSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          project={project}
          myRole={myRole}
          onUpdated={(p) => setProject((prev) => (prev ? { ...prev, ...p, members: p.members ?? prev.members } : prev))}
          onDeleted={() => setProject(null)}
        />
      )}
    </div>
  );
}
