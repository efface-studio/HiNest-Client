import { useEffect, useState } from "react";
import { api } from "../../api";
import { confirmAsync, alertAsync } from "../ConfirmHost";
import DateTimePicker from "../DateTimePicker";

type Token = {
  id: string;
  name: string;
  prefix: string;
  scopes: string | null;
  createdById: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

export default function TokensPanel() {
  const [rows, setRows] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState("read:users,read:meetings");
  const [expiresAt, setExpiresAt] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try { setRows((await api<{ tokens: Token[] }>("/api/admin/api-tokens")).tokens); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const r = await api<{ token: Token; plaintext: string }>("/api/admin/api-tokens", {
        method: "POST",
        json: {
          name,
          scopes: scopes.trim() || null,
          expiresAt: expiresAt || null,
        },
      });
      setIssuedToken(r.plaintext);
      setName("");
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function revoke(t: Token) {
    if (!(await confirmAsync({ title: `토큰 "${t.name}" 회수?`, description: "이 토큰으로 들어오는 모든 요청이 즉시 거부됩니다." }))) return;
    await api(`/api/admin/api-tokens/${t.id}`, { method: "DELETE" });
    await load();
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text);
    alertAsync({ title: "복사됨", description: "이 값은 다시 볼 수 없습니다 — 안전한 곳에 저장하세요." });
  }

  return (
    <div className="panel p-4">
      <form className="flex items-end gap-2 mb-4 flex-wrap" onSubmit={create}>
        <div className="flex-1 min-w-[160px]">
          <label className="field-label">이름</label>
          <input className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Slack bot · n8n · GitHub Actions ..." />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="field-label">스코프 (콤마 구분)</label>
          <input className="input font-mono text-[11.5px]" value={scopes} onChange={(e) => setScopes(e.target.value)} placeholder="read:users,write:notice" />
        </div>
        <div className="min-w-[160px]">
          <label className="field-label">만료 (선택)</label>
          <DateTimePicker value={expiresAt} onChange={setExpiresAt} />
        </div>
        <button type="submit" className="btn-primary" disabled={creating}>{creating ? "발급 중…" : "+ 발급"}</button>
      </form>

      {issuedToken && (
        <div className="rounded-lg p-3 mb-4" style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)" }}>
          <div className="text-[12px] font-bold text-amber-700 mb-1.5">⚠️ 이 토큰은 다시 볼 수 없습니다 — 지금 복사해서 안전하게 보관하세요.</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-[11.5px] p-2 rounded break-all" style={{ background: "var(--c-surface-3)" }}>{issuedToken}</code>
            <button className="btn-ghost btn-xs" onClick={() => copy(issuedToken)}>복사</button>
            <button className="btn-ghost btn-xs" onClick={() => setIssuedToken(null)}>닫기</button>
          </div>
        </div>
      )}

      <div className="overflow-auto" style={{ maxHeight: "55vh" }}>
        <table className="w-full text-[12px] pro-cards">
          <thead>
            <tr className="text-ink-500 text-left border-b border-ink-150">
              <th className="py-2 pr-2">이름</th>
              <th className="py-2 pr-2">prefix</th>
              <th className="py-2 pr-2">스코프</th>
              <th className="py-2 pr-2">최근 사용</th>
              <th className="py-2 pr-2">만료</th>
              <th className="py-2 pr-2">상태</th>
              <th className="py-2 pr-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-b border-ink-100" style={{ opacity: t.revokedAt ? 0.5 : 1 }}>
                <td className="py-2 pr-2 font-bold text-ink-900 cell-primary">{t.name}</td>
                <td className="py-2 pr-2 font-mono text-[11px] text-ink-700" data-label="prefix">{t.prefix}…</td>
                <td className="py-2 pr-2 font-mono text-[10.5px] text-ink-700 sm:truncate sm:max-w-[200px]" data-label="스코프" title={t.scopes ?? ""}>{t.scopes || "—"}</td>
                <td className="py-2 pr-2 text-ink-700" data-label="최근 사용">{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString("ko-KR") : "사용 안 됨"}</td>
                <td className="py-2 pr-2 text-ink-700" data-label="만료">{t.expiresAt ? new Date(t.expiresAt).toLocaleDateString("ko-KR") : "—"}</td>
                <td className="py-2 pr-2 text-[11px] font-bold" data-label="상태">
                  {t.revokedAt ? <span style={{ color: "var(--c-danger)" }}>회수됨</span> : <span style={{ color: "var(--c-success)" }}>활성</span>}
                </td>
                <td className="py-2 pr-2 text-right cell-actions">
                  {!t.revokedAt && (
                    <button className="btn-ghost btn-xs" style={{ color: "var(--c-danger)" }} onClick={() => revoke(t)}>회수</button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="py-12 text-center text-ink-500 cell-full">발급된 토큰이 없어요</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
