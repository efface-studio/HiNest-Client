import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { confirmAsync } from "../ConfirmHost";

type Role = "ADMIN" | "MANAGER" | "MEMBER";
type Catalog = {
  key: string;
  label: string;
  group: string;
  defaults: Record<Role, boolean>;
};
type Matrix = Record<Role, Record<string, boolean>>;

const ROLES: { key: Role; label: string }[] = [
  { key: "ADMIN", label: "관리자" },
  { key: "MANAGER", label: "매니저" },
  { key: "MEMBER", label: "팀원" },
];

/**
 * 역할별 권한 매트릭스 — 그룹별로 묶고, 토글 = 즉시 저장.
 * 기본값과 다르면 \"기본값 다름\" 표시. 우측 \"기본값 복원\" 버튼으로 catalog default 로 되돌림.
 */
export default function RolePermissionsPanel() {
  const [catalog, setCatalog] = useState<Catalog[]>([]);
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await api<{ catalog: Catalog[]; matrix: Matrix }>("/api/admin/role-permissions");
      setCatalog(r.catalog);
      setMatrix(r.matrix);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function toggle(role: Role, key: string, next: boolean) {
    if (!matrix) return;
    setBusy(true);
    setMatrix({ ...matrix, [role]: { ...matrix[role], [key]: next } });
    try {
      await api("/api/admin/role-permissions", { method: "POST", json: { role, permKey: key, enabled: next } });
    } catch {
      await load(); // 실패 시 서버 상태로 재정합
    } finally { setBusy(false); }
  }

  async function resetToDefault(role: Role, key: string) {
    setBusy(true);
    try {
      await api(`/api/admin/role-permissions/${role}/${encodeURIComponent(key)}`, { method: "DELETE" });
      await load();
    } finally { setBusy(false); }
  }

  async function resetAll() {
    if (!(await confirmAsync({ title: "모든 권한을 기본값으로?", description: "현재 변경사항이 모두 사라지고 코드 기본값으로 복원됩니다." }))) return;
    setBusy(true);
    try {
      // 순회 — 변경된 row 만 지움.
      if (!matrix) return;
      const ops: Promise<unknown>[] = [];
      for (const c of catalog) {
        for (const r of ROLES) {
          const eff = matrix[r.key][c.key];
          const def = c.defaults[r.key];
          if (eff !== def) ops.push(api(`/api/admin/role-permissions/${r.key}/${encodeURIComponent(c.key)}`, { method: "DELETE" }));
        }
      }
      await Promise.all(ops);
      await load();
    } finally { setBusy(false); }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, Catalog[]>();
    for (const c of catalog) {
      if (!map.has(c.group)) map.set(c.group, []);
      map.get(c.group)!.push(c);
    }
    return Array.from(map.entries());
  }, [catalog]);

  return (
    <div className="panel p-4">
      <div className="flex items-center mb-3">
        <div className="text-[12.5px] text-ink-500">
          역할별로 기능 권한을 토글합니다. 코드 기본값과 다르면 칸 좌측 상단에 점이 표시됩니다.
        </div>
        <button className="btn-ghost btn-xs ml-auto" onClick={resetAll} disabled={busy || !matrix}>모두 기본값으로</button>
      </div>

      <div className="overflow-auto" style={{ maxHeight: "65vh" }}>
        <table className="w-full text-[12.5px]" style={{ minWidth: 520 }}>
          <thead>
            <tr className="text-ink-500 text-left border-b border-ink-150">
              <th className="py-2 pr-3 w-[42%]">권한</th>
              {ROLES.map((r) => (
                <th key={r.key} className="py-2 px-3 text-center w-[18%]">{r.label}</th>
              ))}
              <th className="py-2 pl-3 w-[4%]"></th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(([group, items]) => (
              <>
                <tr key={`g-${group}`}>
                  <td colSpan={5} className="pt-4 pb-1 text-[10.5px] font-extrabold tracking-[0.06em] uppercase text-ink-500">
                    {group}
                  </td>
                </tr>
                {items.map((c) => (
                  <tr key={c.key} className="border-b border-ink-100">
                    <td className="py-2 pr-3">
                      <div className="font-bold text-ink-900">{c.label}</div>
                      <div className="text-[10.5px] text-ink-400 font-mono">{c.key}</div>
                    </td>
                    {ROLES.map((r) => {
                      const eff = matrix?.[r.key]?.[c.key] ?? c.defaults[r.key];
                      const def = c.defaults[r.key];
                      const overridden = eff !== def;
                      return (
                        <td key={r.key} className="py-2 px-3 text-center align-middle">
                          <div className="inline-flex items-center justify-center relative">
                            {overridden && (
                              <span
                                className="absolute -top-0.5 -left-0.5 w-1.5 h-1.5 rounded-full"
                                style={{ background: "var(--c-warning)" }}
                                title="기본값과 다름"
                              />
                            )}
                            <button
                              onClick={() => toggle(r.key, c.key, !eff)}
                              disabled={busy}
                              style={{
                                width: 36,
                                height: 20,
                                borderRadius: 10,
                                background: eff ? "var(--c-success)" : "var(--c-surface-3)",
                                position: "relative",
                                transition: "background 0.15s",
                              }}
                              title={eff ? "허용 — 클릭하면 차단" : "차단 — 클릭하면 허용"}
                            >
                              <span
                                style={{
                                  position: "absolute",
                                  top: 2,
                                  left: eff ? 18 : 2,
                                  width: 16,
                                  height: 16,
                                  borderRadius: 8,
                                  background: "#fff",
                                  transition: "left 0.15s",
                                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                                }}
                              />
                            </button>
                          </div>
                        </td>
                      );
                    })}
                    <td className="py-2 pl-3 text-right">
                      {/* 어느 role 이든 기본값과 다르면 row 단위 reset 버튼 */}
                      {ROLES.some((r) => (matrix?.[r.key]?.[c.key] ?? c.defaults[r.key]) !== c.defaults[r.key]) && (
                        <button
                          className="text-[10.5px] text-ink-500 hover:text-ink-800"
                          onClick={() => Promise.all(ROLES.map((r) => resetToDefault(r.key, c.key)))}
                          disabled={busy}
                          title="이 권한 행 전체를 기본값으로"
                        >
                          ↺
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
        {loading && <div className="py-8 text-center text-[12px] text-ink-500">불러오는 중…</div>}
      </div>

      <div className="text-[10.5px] text-ink-400 mt-3 leading-relaxed">
        ※ 권한 카탈로그는 코드(<span className="font-mono">server/src/lib/permissions.ts</span>) 에 정의됩니다.
        새 권한 키 추가 시 카탈로그에 한 줄 추가하면 자동으로 이 화면에 노출됩니다.
        실제 enforcement 는 라우트별 <span className="font-mono">hasPermission()</span> 호출이 필요해요.
      </div>
    </div>
  );
}
