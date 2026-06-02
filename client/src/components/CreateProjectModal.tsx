import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api , imgSrc} from "../api";

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
  /** 생성 후 사이드바 프로젝트 목록을 다시 가져오도록 호출됨. */
  onCreated?: () => void;
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

export default function CreateProjectModal({ open, onClose, onCreated }: Props) {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // 열릴 때마다 상태 초기화.
    setName("");
    setDescription("");
    setColor(PALETTE[0]);
    setMemberIds([]);
    setQ("");
    setErr(null);
    // /api/users (복수) — 이전에 /api/user 로 되어 있어 404 나며 멤버 후보 목록이
    // 비어 있던 버그. 서버 라우터 마운트는 app.use("/api/users", ...).
    let alive = true;
    api<{ users: UserLite[] }>("/api/users")
      .then((r) => { if (alive) setUsers(r.users); })
      .catch((e: any) => {
        if (!alive) return;
        // 멤버 후보 로드 실패는 프로젝트 생성 자체를 막지 않지만, 사용자에게 왜 목록이 비었는지는 알려야 함
        setErr(e?.message ?? "멤버 목록을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.");
      });
    return () => { alive = false; };
  }, [open]);

  if (!open) return null;

  const filtered = users.filter((u) => {
    const k = q.trim().toLowerCase();
    if (!k) return true;
    return (
      u.name.toLowerCase().includes(k) ||
      u.email.toLowerCase().includes(k) ||
      (u.team ?? "").toLowerCase().includes(k) ||
      (u.position ?? "").toLowerCase().includes(k)
    );
  });

  function toggleMember(id: string) {
    setMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ project: { id: string } }>("/api/project", {
        method: "POST",
        json: {
          name: name.trim(),
          description: description.trim() || undefined,
          color,
          memberIds,
        },
      });
      onCreated?.();
      onClose();
      // 만든 직후 바로 해당 프로젝트로 이동.
      nav(`/projects/${r.project.id}`);
    } catch (e: any) {
      setErr(e?.message ?? "프로젝트 생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  // 모달은 document.body 에 포털로 띄움. 사이드바(aside) 가 transition-transform 으로
      // 자체 containing block 을 만들면서, 그 안에서 fixed 가 뷰포트가 아닌 사이드바(232px)
      // 에 고정되어 모바일에서 모달이 사이드바 폭 안으로 찌그러지는 버그가 있었음.
  return createPortal(
    <div
      className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-[100]"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold mb-4">새 프로젝트</h3>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label">이름</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
              autoFocus
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
                  className={`w-7 h-7 rounded-full border-2 ${color === c ? "border-slate-900" : "border-transparent"}`}
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
          </div>
          <div>
            <label className="label">멤버</label>
            <input
              className="input mb-2"
              placeholder="이름·팀·직급으로 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={80}
            />
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-auto border border-slate-100 rounded-lg p-2">
              {filtered.map((u) => {
                const on = memberIds.includes(u.id);
                return (
                  <button
                    type="button"
                    key={u.id}
                    onClick={() => toggleMember(u.id)}
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
                    <span className="text-[10px] text-slate-400">
                      {u.team ?? ""}
                    </span>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="text-xs text-slate-400 py-2">
                  해당하는 사용자가 없습니다.
                </div>
              )}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              선택된 멤버 {memberIds.length}명 — 생성자는 자동으로 오너로 포함됩니다.
            </div>
          </div>
          {err && <div className="text-xs text-danger">{err}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
              취소
            </button>
            <button className="btn-primary" disabled={busy}>
              {busy ? "생성 중…" : "만들기"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
