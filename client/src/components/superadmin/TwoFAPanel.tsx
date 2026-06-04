import { useEffect, useState } from "react";
import { api } from "../../api";

type Policy = { role: "ADMIN" | "MANAGER" | "MEMBER"; requirePasskey: boolean; gracePeriodDays: number; updatedAt: string };
type NonCompliant = { id: string; name: string; email: string; role: string; team: string | null; createdAt: string; daysOverdue: number };

const ROLE_LABEL: Record<string, string> = { ADMIN: "관리자", MANAGER: "매니저", MEMBER: "팀원" };

export default function TwoFAPanel() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [non, setNon] = useState<NonCompliant[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [p, n] = await Promise.all([
        api<{ policies: Policy[] }>("/api/admin/2fa-policy"),
        api<{ users: NonCompliant[] }>("/api/admin/2fa-policy/non-compliant"),
      ]);
      setPolicies(p.policies);
      setNon(n.users);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function save(p: Policy) {
    await api("/api/admin/2fa-policy", { method: "POST", json: p });
    await load();
  }

  return (
    <div className="panel p-4">
      <div className="text-[12.5px] font-extrabold text-ink-900 mb-2">role 별 패스키 정책</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        {policies.map((p) => (
          <div key={p.role} className="rounded-xl p-4 border border-ink-150">
            <div className="text-[14px] font-extrabold text-ink-900 mb-2">{ROLE_LABEL[p.role] ?? p.role}</div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[12px] text-ink-500">패스키 필수</span>
              <button
                onClick={() => save({ ...p, requirePasskey: !p.requirePasskey })}
                style={{
                  width: 36, height: 20, borderRadius: 10,
                  background: p.requirePasskey ? "var(--c-success)" : "var(--c-surface-3)",
                  position: "relative", transition: "background 0.15s",
                }}
              >
                <span style={{
                  position: "absolute", top: 2, left: p.requirePasskey ? 18 : 2,
                  width: 16, height: 16, borderRadius: 8, background: "#fff",
                  transition: "left 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }} />
              </button>
            </div>
            <label className="text-[11px] text-ink-500 block mb-1">유예 기간</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={365}
                className="input !py-1.5 max-w-[80px]"
                value={p.gracePeriodDays}
                onChange={(e) => setPolicies((rows) => rows.map((r) => r.role === p.role ? { ...r, gracePeriodDays: +e.target.value } : r))}
                onBlur={(e) => save({ ...p, gracePeriodDays: +e.target.value })}
              />
              <span className="text-[12px] text-ink-500">일</span>
            </div>
          </div>
        ))}
      </div>

      <div className="text-[12.5px] font-extrabold text-ink-900 mb-2">미충족 사용자 ({non.length})</div>
      <div className="text-[11px] text-ink-500 mb-2">정책으로 패스키가 필수이지만, 유예 기간을 초과했는데도 등록 안 한 사용자입니다.</div>
      <div className="overflow-auto" style={{ maxHeight: "40vh" }}>
        {loading ? (
          <div className="py-8 text-center text-ink-500 text-[12px]">불러오는 중…</div>
        ) : non.length === 0 ? (
          <div className="py-8 text-center text-ink-500 text-[12px]">전원 충족 ✨</div>
        ) : (
          <table className="w-full text-[12px] pro-cards">
            <thead>
              <tr className="text-ink-500 text-left border-b border-ink-150">
                <th className="py-2 pr-2">사용자</th>
                <th className="py-2 pr-2">role</th>
                <th className="py-2 pr-2">팀</th>
                <th className="py-2 pr-2">가입일</th>
                <th className="py-2 pr-2 text-right">초과</th>
              </tr>
            </thead>
            <tbody>
              {non.map((u) => (
                <tr key={u.id} className="border-b border-ink-100">
                  <td className="py-2 pr-2 cell-primary">
                    <div className="font-bold text-ink-900">{u.name}</div>
                    <div className="text-[10.5px] text-ink-500">{u.email}</div>
                  </td>
                  <td className="py-2 pr-2 text-ink-700" data-label="role">{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td className="py-2 pr-2 text-ink-700" data-label="팀">{u.team ?? "—"}</td>
                  <td className="py-2 pr-2 text-ink-700" data-label="가입일">{new Date(u.createdAt).toLocaleDateString("ko-KR")}</td>
                  <td className="py-2 pr-2 text-right font-bold" data-label="초과" style={{ color: "var(--c-danger)" }}>+{u.daysOverdue}일</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="text-[10.5px] text-ink-400 mt-4 leading-relaxed">
        ※ 강제 인터셉트(로그인 차단/등록 화면 강제) 는 후속 작업. 현재는 정책 정의 + 미충족자 명단 조회만.
      </div>
    </div>
  );
}
