import { useEffect, useState } from "react";
import { api } from "../../api";
import { confirmAsync } from "../ConfirmHost";
import Portal from "../Portal";
import Select, { type SelectOption } from "../Select";

type Flag = {
  key: string;
  enabled: boolean;
  scope: "GLOBAL" | "ROLE" | "USER" | "TEAM";
  targets: string | null;
  description: string | null;
  updatedAt: string;
  updatedById: string | null;
};

const SCOPES: Flag["scope"][] = ["GLOBAL", "ROLE", "USER", "TEAM"];
const SCOPE_OPTIONS: SelectOption[] = SCOPES.map((s) => ({ value: s, label: s }));
const ENABLED_OPTIONS: SelectOption[] = [
  { value: "0", label: "OFF" },
  { value: "1", label: "ON" },
];

export default function FlagsPanel() {
  const [rows, setRows] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Flag> | null>(null);

  async function load() {
    setLoading(true);
    try { setRows((await api<{ flags: Flag[] }>("/api/admin/feature-flags")).flags); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function save(f: Partial<Flag>) {
    await api("/api/admin/feature-flags", { method: "POST", json: f });
    setEditing(null);
    await load();
  }
  async function toggle(f: Flag) {
    await save({ ...f, enabled: !f.enabled });
  }
  async function remove(key: string) {
    if (!(await confirmAsync({ title: `플래그 "${key}" 삭제?`, description: "되돌릴 수 없음." }))) return;
    await api(`/api/admin/feature-flags/${key}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-3">
        <button className="btn-ghost btn-xs" onClick={load} disabled={loading}>새로고침</button>
        <button className="btn-primary btn-xs ml-auto" onClick={() => setEditing({ key: "", enabled: false, scope: "GLOBAL", targets: "", description: "" })}>+ 새 플래그</button>
      </div>

      <div className="overflow-auto" style={{ maxHeight: "60vh" }}>
        <table className="w-full text-[12px] pro-cards">
          <thead>
            <tr className="text-ink-500 text-left border-b border-ink-150">
              <th className="py-2 pr-2">키</th>
              <th className="py-2 pr-2">활성</th>
              <th className="py-2 pr-2">범위</th>
              <th className="py-2 pr-2">대상</th>
              <th className="py-2 pr-2">설명</th>
              <th className="py-2 pr-2 text-right">액션</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.key} className="border-b border-ink-100">
                <td className="py-2 pr-2 font-mono text-[11.5px] font-bold text-ink-900 cell-primary">{f.key}</td>
                <td className="py-2 pr-2" data-label="활성">
                  <button
                    onClick={() => toggle(f)}
                    style={{
                      width: 36, height: 20, borderRadius: 10,
                      background: f.enabled ? "var(--c-success)" : "var(--c-surface-3)",
                      position: "relative", transition: "background 0.15s",
                    }}
                  >
                    <span style={{
                      position: "absolute", top: 2, left: f.enabled ? 18 : 2,
                      width: 16, height: 16, borderRadius: 8, background: "#fff",
                      transition: "left 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                    }} />
                  </button>
                </td>
                <td className="py-2 pr-2 text-ink-700" data-label="범위">{f.scope}</td>
                <td className="py-2 pr-2 text-ink-500 sm:truncate sm:max-w-[220px]" data-label="대상" title={f.targets ?? ""}>{f.targets || "—"}</td>
                <td className="py-2 pr-2 text-ink-700 sm:truncate sm:max-w-[260px]" data-label="설명">{f.description || "—"}</td>
                <td className="py-2 pr-2 text-right cell-actions">
                  <button className="btn-ghost btn-xs" onClick={() => setEditing(f)}>편집</button>
                  <button className="btn-ghost btn-xs ml-1" style={{ color: "var(--c-danger)" }} onClick={() => remove(f.key)}>삭제</button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="py-12 text-center text-ink-500 cell-full">플래그 없음 — 우상단 \"+ 새 플래그\"</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <Portal>
        <div className="fixed inset-0 bg-ink-900/40 grid place-items-center modal-safe z-50" onClick={() => setEditing(null)}>
          <form
            className="panel w-full max-w-[480px] p-5"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); save(editing); }}
          >
            <div className="text-[14px] font-extrabold text-ink-900 mb-3">{editing.key ? "플래그 편집" : "새 플래그"}</div>
            <div className="space-y-3">
              <div>
                <label className="field-label">키</label>
                <input
                  className="input font-mono"
                  required
                  pattern="^[a-z][a-z0-9._-]{1,60}$"
                  value={editing.key ?? ""}
                  onChange={(e) => setEditing({ ...editing, key: e.target.value })}
                  placeholder="expense.export-csv"
                  disabled={!!rows.find((r) => r.key === editing.key)}
                />
                <div className="text-[10.5px] text-ink-500 mt-1">소문자/숫자/._- 만 (예: chat.threads, expense.export-csv)</div>
              </div>
              <div>
                <label className="field-label">활성</label>
                <Select className="input" value={editing.enabled ? "1" : "0"} onChange={(v) => setEditing({ ...editing, enabled: v === "1" })} options={ENABLED_OPTIONS} />
              </div>
              <div>
                <label className="field-label">범위</label>
                <Select className="input" value={editing.scope ?? "GLOBAL"} onChange={(v) => setEditing({ ...editing, scope: v as Flag["scope"] })} options={SCOPE_OPTIONS} />
              </div>
              {(editing.scope ?? "GLOBAL") !== "GLOBAL" && (
                <div>
                  <label className="field-label">대상 (콤마 구분)</label>
                  <input
                    className="input font-mono"
                    value={editing.targets ?? ""}
                    onChange={(e) => setEditing({ ...editing, targets: e.target.value })}
                    placeholder={editing.scope === "ROLE" ? "ADMIN,MANAGER" : editing.scope === "USER" ? "userId1,userId2" : "디자인팀,개발팀"}
                  />
                </div>
              )}
              <div>
                <label className="field-label">설명</label>
                <input
                  className="input"
                  value={editing.description ?? ""}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="이 플래그가 무엇을 켜는지 한 줄 설명"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>취소</button>
              <button type="submit" className="btn-primary">저장</button>
            </div>
          </form>
        </div>
        </Portal>
      )}
    </div>
  );
}
