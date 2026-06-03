import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, invalidateCache , imgSrc} from "../api";
import { confirmAsync } from "./ConfirmHost";

type Role = "OWNER" | "MANAGER" | "MEMBER";

type Member = {
  id: string;
  userId: string;
  role: Role;
  user: { id: string; name: string; email: string; team: string | null; position: string | null; avatarColor: string; avatarUrl?: string | null };
};

type Project = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  status: "ACTIVE" | "ARCHIVED";
  members: Member[];
};

type UserLite = {
  id: string;
  name: string;
  email: string;
  team: string | null;
  position: string | null;
  avatarColor: string;
  avatarUrl?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  project: Project;
  /** 내 역할 — 수정/삭제/멤버관리 권한 분기에 사용. ADMIN 은 전역 권한. */
  myRole: Role | "ADMIN";
  onUpdated?: (project: Project) => void;
  onDeleted?: () => void;
};

const PALETTE = [
  "#3B5CF0",
  "#7B5CF0",
  "#16A34A",
  "#F59E0B",
  "#EF4444",
  "#06B6D4",
  "#DB2777",
  "#64748B",
];

export default function ProjectSettingsModal({
  open,
  onClose,
  project,
  myRole,
  onUpdated,
  onDeleted,
}: Props) {
  const nav = useNavigate();
  const [tab, setTab] = useState<"info" | "members">("info");

  if (!open) return null;

  const canEdit = myRole === "OWNER" || myRole === "MANAGER" || myRole === "ADMIN";
  const canDelete = myRole === "OWNER" || myRole === "ADMIN";

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-xl max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold">프로젝트 설정</h3>
          <button className="btn-icon" onClick={onClose} aria-label="닫기">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex gap-1 border-b border-slate-100 mb-4">
          <TabBtn active={tab === "info"} onClick={() => setTab("info")}>
            정보
          </TabBtn>
          <TabBtn active={tab === "members"} onClick={() => setTab("members")}>
            멤버
          </TabBtn>
        </div>

        {tab === "info" && (
          <InfoTab
            project={project}
            canEdit={canEdit}
            canDelete={canDelete}
            onUpdated={onUpdated}
            onDeleted={() => {
              onDeleted?.();
              onClose();
              nav("/");
            }}
          />
        )}
        {tab === "members" && (
          <MembersTab
            project={project}
            canManage={canEdit}
            myRole={myRole}
            onUpdated={onUpdated}
          />
        )}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 text-[13px] font-bold border-b-2 -mb-[1px] ${active ? "border-brand-500 text-brand-600" : "border-transparent text-ink-500 hover:text-ink-900"}`}
    >
      {children}
    </button>
  );
}

/* ---------- Info Tab ---------- */

function InfoTab({
  project,
  canEdit,
  canDelete,
  onUpdated,
  onDeleted,
}: {
  project: Project;
  canEdit: boolean;
  canDelete: boolean;
  onUpdated?: (p: Project) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [color, setColor] = useState(project.color);
  const [status, setStatus] = useState<"ACTIVE" | "ARCHIVED">(project.status);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    if (busy) return; // 연속 클릭 방지
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const r = await api<{ project: Project }>(`/api/project/${project.id}`, {
        method: "PATCH",
        json: {
          name: name.trim(),
          description: description.trim() || undefined,
          color,
          status,
        },
      });
      onUpdated?.({ ...project, ...r.project, members: project.members });
      // 사이드바 프로젝트 목록(AppLayout)도 갱신 — 이름/색/보관 변경이 즉시 반영되도록.
      invalidateCache("/api/project");
      window.dispatchEvent(new CustomEvent("projects:reload"));
      setSaved(true);
    } catch (e: any) {
      setErr(e?.message ?? "저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!canDelete) return;
    if (busy) return;
    const ok = await confirmAsync({
      title: "프로젝트 삭제",
      description: `"${project.name}" 프로젝트를 삭제할까요?\n모든 관련 데이터가 함께 삭제되고 되돌릴 수 없어요.`,
      tone: "danger",
      confirmLabel: "삭제",
    });
    if (!ok) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/project/${project.id}`, { method: "DELETE" });
      invalidateCache("/api/project");
      window.dispatchEvent(new CustomEvent("projects:reload"));
      onDeleted();
    } catch (e: any) {
      setErr(e?.message ?? "삭제에 실패했습니다.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div>
        <label className="label">이름</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
          disabled={!canEdit}
        />
      </div>
      <div>
        <label className="label">설명</label>
        <textarea
          className="input"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          disabled={!canEdit}
        />
      </div>
      <div>
        <label className="label">색상</label>
        <div className="flex flex-wrap gap-2">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              disabled={!canEdit}
              className={`w-7 h-7 rounded-full border-2 ${color === c ? "border-slate-900" : "border-transparent"} ${!canEdit ? "opacity-50 cursor-not-allowed" : ""}`}
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>
      </div>
      <div>
        <label className="label">상태</label>
        <select
          className="input"
          value={status}
          onChange={(e) => setStatus(e.target.value as any)}
          disabled={!canEdit}
        >
          <option value="ACTIVE">활성</option>
          <option value="ARCHIVED">보관</option>
        </select>
        <div className="text-[11px] text-slate-500 mt-1">
          보관 상태로 전환하면 사이드바에서 숨겨집니다.
        </div>
      </div>

      {err && <div className="text-xs text-danger">{err}</div>}
      {saved && <div className="text-xs text-brand-600">저장되었습니다.</div>}

      <div className="flex items-center justify-between pt-3 border-t border-slate-100">
        <div>
          {canDelete && (
            <button
              type="button"
              className="btn-ghost text-danger"
              onClick={doDelete}
              disabled={busy}
            >
              프로젝트 삭제
            </button>
          )}
        </div>
        {canEdit && (
          <button className="btn-primary" disabled={busy}>
            {busy ? "저장 중…" : "저장"}
          </button>
        )}
      </div>
    </form>
  );
}

/* ---------- Members Tab ---------- */

function MembersTab({
  project,
  canManage,
  myRole,
  onUpdated,
}: {
  project: Project;
  canManage: boolean;
  myRole: Role | "ADMIN";
  onUpdated?: (p: Project) => void;
}) {
  const [members, setMembers] = useState<Member[]>(project.members);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    // /api/users (복수). 이전에 /api/user 로 404 나며 후보 목록이 안 떠서 멤버 추가 불가.
    let alive = true;
    api<{ users: UserLite[] }>("/api/users")
      .then((r) => { if (alive) setUsers(r.users); })
      .catch(() => {});
    return () => { alive = false; };
  }, [canManage]);

  async function refresh() {
    try {
      const r = await api<{ project: Project }>(`/api/project/${project.id}`);
      setMembers(r.project.members);
      onUpdated?.(r.project);
    } catch {}
  }

  async function addMember(userId: string, role: Role = "MEMBER") {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/project/${project.id}/member`, {
        method: "POST",
        json: { userId, role },
      });
      // 사이드바·리스트 등 다른 화면의 project 캐시도 stale — 다음 방문 시 갱신되도록 invalidate.
      invalidateCache(`/api/project/${project.id}`);
      invalidateCache("/api/project");
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "멤버 추가에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(userId: string) {
    if (busy) return;
    const ok = await confirmAsync({
      title: "멤버 제거",
      description: "이 멤버를 프로젝트에서 제거할까요?",
      tone: "danger",
      confirmLabel: "제거",
    });
    if (!ok) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/project/${project.id}/member/${userId}`, {
        method: "DELETE",
      });
      invalidateCache(`/api/project/${project.id}`);
      invalidateCache("/api/project");
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "멤버 제거에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(userId: string, role: Role) {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/project/${project.id}/member`, {
        method: "POST",
        json: { userId, role },
      });
      invalidateCache(`/api/project/${project.id}`);
      invalidateCache("/api/project");
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "역할 변경에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const memberIds = new Set(members.map((m) => m.userId));
  const candidates = users.filter((u) => {
    if (memberIds.has(u.id)) return false;
    const k = q.trim().toLowerCase();
    if (!k) return true;
    return (
      u.name.toLowerCase().includes(k) ||
      u.email.toLowerCase().includes(k) ||
      (u.team ?? "").toLowerCase().includes(k) ||
      (u.position ?? "").toLowerCase().includes(k)
    );
  });

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[12px] font-bold text-ink-700 mb-2">
          현재 멤버 <span className="text-slate-400 font-normal">({members.length})</span>
        </div>
        <div className="space-y-1.5 max-h-64 overflow-auto">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-2.5 border border-slate-100 rounded-lg px-3 py-2"
            >
              <div
                className="avatar avatar-sm overflow-hidden"
                style={{ background: m.user.avatarUrl ? "transparent" : m.user.avatarColor }}
              >
                {m.user.avatarUrl ? (
                  <img src={imgSrc(m.user.avatarUrl)} alt={m.user.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
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
              {canManage ? (
                <select
                  className="ghost-select text-[12px]"
                  value={m.role}
                  disabled={busy}
                  onChange={(e) => changeRole(m.userId, e.target.value as Role)}
                >
                  <option value="OWNER">오너</option>
                  <option value="MANAGER">매니저</option>
                  <option value="MEMBER">멤버</option>
                </select>
              ) : (
                <span className="chip bg-brand-50 text-brand-600 text-[10px]">
                  {m.role === "OWNER" ? "오너" : m.role === "MANAGER" ? "매니저" : "멤버"}
                </span>
              )}
              {canManage && (
                <button
                  type="button"
                  className="btn-icon text-danger"
                  onClick={() => removeMember(m.userId)}
                  title="멤버 제거"
                  disabled={busy}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                </button>
              )}
            </div>
          ))}
          {members.length === 0 && (
            <div className="text-xs text-slate-400 py-2">멤버가 없습니다.</div>
          )}
        </div>
      </div>

      {canManage && (
        <div>
          <div className="text-[12px] font-bold text-ink-700 mb-2">멤버 추가</div>
          <input
            className="input mb-2"
            placeholder="이름·팀·직급으로 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="space-y-1 max-h-48 overflow-auto border border-slate-100 rounded-lg p-2">
            {candidates.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => addMember(u.id, "MEMBER")}
                disabled={busy}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 text-left"
              >
                <span
                  className="w-6 h-6 rounded-full grid place-items-center text-white text-[11px] font-bold overflow-hidden"
                  style={{ background: u.avatarUrl ? "transparent" : u.avatarColor }}
                >
                  {u.avatarUrl ? (
                    <img src={imgSrc(u.avatarUrl)} alt={u.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
                  ) : (
                    u.name[0]
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold truncate">{u.name}</div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {u.team ?? "-"} · {u.position ?? "-"}
                  </div>
                </div>
                <span className="text-[11px] text-brand-600">+ 추가</span>
              </button>
            ))}
            {candidates.length === 0 && (
              <div className="text-xs text-slate-400 py-2 text-center">
                추가할 사용자가 없습니다.
              </div>
            )}
          </div>
        </div>
      )}

      {err && <div className="text-xs text-danger">{err}</div>}
      {!canManage && (
        <div className="text-[11px] text-slate-500">
          멤버 관리는 오너·매니저·관리자만 가능합니다.
        </div>
      )}
      {myRole === "ADMIN" && (
        <div className="text-[11px] text-slate-400">
          관리자로 접근 중 — 모든 프로젝트를 관리할 수 있습니다.
        </div>
      )}
    </div>
  );
}
