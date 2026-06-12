import { useEffect, useState } from "react";
import { api } from "../../api";
import { confirmAsync, alertAsync } from "../ConfirmHost";
import { relTime } from "./relTime";
import { useConsoleCompany } from "./companyFilter";

type Session = {
  id: string;
  userId: string;
  ua: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  user: { id: string; name: string; email: string };
};

/** 활성 로그인 세션 목록 + 강제 로그아웃. 사고 대응(계정 탈취 의심) 시 핵심 도구. */
export default function SessionsPanel() {
  const [rows, setRows] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  // 회사 선택 드롭다운 값 — 있으면 해당 회사 소속 유저의 세션만 받는다.
  const { companyId } = useConsoleCompany();

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "300" });
      if (companyId) params.set("companyId", companyId);
      const r = await api<{ sessions: Session[] }>(`/api/admin/sessions?${params}`);
      setRows(r.sessions);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId]);

  async function revokeOne(id: string, name: string) {
    if (!(await confirmAsync({ title: "이 세션 강제 로그아웃?", description: `${name} 의 디바이스 1개에서 즉시 로그아웃됩니다.` }))) return;
    setBusy(true);
    try {
      await api(`/api/admin/sessions/${id}`, { method: "DELETE" });
      await load();
    } finally { setBusy(false); }
  }
  async function revokeUser(userId: string, name: string) {
    if (!(await confirmAsync({ title: `${name} 의 모든 세션 종료?`, description: "비밀번호 변경/계정 탈취 의심 시 사용. 모든 디바이스에서 즉시 로그아웃." }))) return;
    setBusy(true);
    try {
      const r = await api<{ count: number }>(`/api/admin/sessions/revoke-user/${userId}`, { method: "POST" });
      await alertAsync({ title: "완료", description: `${r.count}개 세션 종료됨` });
      await load();
    } finally { setBusy(false); }
  }
  async function revokeAll() {
    if (!(await confirmAsync({
      title: "전사 강제 로그아웃 (위험)",
      description: "모든 사용자가 즉시 로그아웃됩니다. 시크릿 로테이트·데이터 유출 의심 시에만 사용하세요. 본인도 다음 요청부터 풀려나갑니다.",
    }))) return;
    if (!(await confirmAsync({ title: "정말로?", description: "되돌릴 수 없습니다. 한 번 더 확인합니다." }))) return;
    setBusy(true);
    try {
      const r = await api<{ count: number }>("/api/admin/sessions/revoke-all", { method: "POST" });
      await alertAsync({ title: "전사 로그아웃 완료", description: `${r.count}개 세션 종료됨` });
      await load();
    } finally { setBusy(false); }
  }

  const filtered = rows.filter((s) => {
    const k = q.trim().toLowerCase();
    if (!k) return true;
    return s.user.name.toLowerCase().includes(k) || s.user.email.toLowerCase().includes(k) || (s.ip ?? "").includes(k);
  });

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input className="input flex-1 min-w-[200px]" placeholder="이름·이메일·IP 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-ghost btn-xs" onClick={load} disabled={loading || busy}>{loading ? "불러오는 중…" : "새로고침"}</button>
        <button className="btn-ghost btn-xs" style={{ color: "var(--c-danger)" }} onClick={revokeAll} disabled={busy}>전사 강제 로그아웃</button>
      </div>
      <div className="text-[11px] text-ink-500 mb-2">총 {filtered.length}개 활성 세션</div>
      <div className="overflow-auto" style={{ maxHeight: "60vh" }}>
        <table className="w-full text-[12px] pro-cards">
          <thead>
            <tr className="text-ink-500 text-left border-b border-ink-150">
              <th className="py-2 pr-2">사용자</th>
              <th className="py-2 pr-2">디바이스</th>
              <th className="py-2 pr-2">IP</th>
              <th className="py-2 pr-2">최근 활동</th>
              <th className="py-2 pr-2 text-right">액션</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} className="border-b border-ink-100">
                <td className="py-2 pr-2 cell-primary">
                  <div className="font-bold text-ink-900">{s.user.name}</div>
                  <div className="text-[10.5px] text-ink-500">{s.user.email}</div>
                </td>
                <td className="py-2 pr-2 text-ink-700 sm:truncate sm:max-w-[280px]" data-label="디바이스" title={s.ua ?? ""}>{shortenUA(s.ua)}</td>
                <td className="py-2 pr-2 text-ink-700 font-mono text-[11px]" data-label="IP">{s.ip ?? "—"}</td>
                <td className="py-2 pr-2 text-ink-700" data-label="최근 활동">{relTime(new Date(s.lastSeenAt).getTime())}</td>
                <td className="py-2 pr-2 text-right cell-actions">
                  <button className="btn-ghost btn-xs" onClick={() => revokeOne(s.id, s.user.name)} disabled={busy}>이 세션 종료</button>
                  <button className="btn-ghost btn-xs ml-1" onClick={() => revokeUser(s.userId, s.user.name)} disabled={busy}>전 디바이스</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && (
          <div className="py-8 text-center text-ink-500 text-[12px]">활성 세션 없음</div>
        )}
      </div>
    </div>
  );
}

function shortenUA(ua: string | null): string {
  if (!ua) return "—";
  // 흔한 패턴만 짧게 추려서 보여줌. 정확한 풀 UA 는 title 로 노출.
  const m = ua.match(/(Chrome|Safari|Firefox|Edge|Opera)\/([\d.]+)/);
  const os = ua.match(/\(([^)]+)\)/);
  return [m ? `${m[1]} ${m[2].split(".")[0]}` : "Browser", os ? os[1].split(";")[0] : ""].filter(Boolean).join(" · ");
}

