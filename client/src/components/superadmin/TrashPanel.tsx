import { useEffect, useState } from "react";
import { api } from "../../api";
import { confirmAsync, alertAsync } from "../ConfirmHost";
import { useConsoleCompany } from "./companyFilter";

type Item = { id: string; title: string; deletedAt: string; deletedById: string | null; authorId: string; author: { name: string } | null };
type Trash = { meeting: Item[]; document: Item[]; journal: Item[]; notice: Item[] };

const TYPES: { key: keyof Trash; label: string }[] = [
  { key: "meeting", label: "회의록" },
  { key: "document", label: "문서" },
  { key: "journal", label: "업무일지" },
  { key: "notice", label: "공지" },
];

/** 휴지통 — 소프트 삭제된 항목 복구 / 영구 삭제. 30일 초과분 일괄 비우기. */
export default function TrashPanel() {
  const [data, setData] = useState<Trash | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<keyof Trash>("meeting");
  // 회사 선택 드롭다운 값 — 있으면 해당 회사의 휴지통만 받는다.
  const { companyId } = useConsoleCompany();

  async function load() {
    setLoading(true);
    try {
      const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
      setData(await api<Trash>(`/api/admin/trash${qs}`));
    }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId]);

  async function restore(type: keyof Trash, id: string, title: string) {
    if (!(await confirmAsync({ title: `"${title}" 복구?`, description: "원래 위치로 되돌립니다." }))) return;
    setBusy(true);
    try {
      await api(`/api/admin/trash/${type}/${id}/restore`, { method: "POST" });
      await load();
    } finally { setBusy(false); }
  }
  async function purge(type: keyof Trash, id: string, title: string) {
    if (!(await confirmAsync({ title: `"${title}" 영구 삭제?`, description: "되돌릴 수 없습니다." }))) return;
    setBusy(true);
    try {
      await api(`/api/admin/trash/${type}/${id}`, { method: "DELETE" });
      await load();
    } finally { setBusy(false); }
  }
  async function purgeOld() {
    if (!(await confirmAsync({ title: "30일 초과 항목 모두 영구 삭제?", description: "되돌릴 수 없습니다." }))) return;
    setBusy(true);
    try {
      const r = await api<{ counts: any }>("/api/admin/trash/purge-old", { method: "POST" });
      await alertAsync({ title: "정리 완료", description: JSON.stringify(r.counts) });
      await load();
    } finally { setBusy(false); }
  }

  const items = data?.[tab] ?? [];

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="inline-flex rounded-full p-0.5" style={{ background: "var(--c-surface-3)" }}>
          {TYPES.map((t) => {
            const active = tab === t.key;
            const count = data?.[t.key]?.length ?? 0;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className="text-[11.5px] font-bold px-2.5 py-1 rounded-full"
                style={{
                  background: active ? "var(--c-surface-1)" : "transparent",
                  color: active ? "var(--c-text-1)" : "var(--c-text-3)",
                }}
              >
                {t.label} {count > 0 && <span className="ml-1 text-ink-500">{count}</span>}
              </button>
            );
          })}
        </div>
        <button className="btn-ghost btn-xs" onClick={load} disabled={loading || busy}>새로고침</button>
        <button className="btn-ghost btn-xs ml-auto" style={{ color: "var(--c-danger)" }} onClick={purgeOld} disabled={busy}>30일 초과 정리</button>
      </div>
      <div className="overflow-auto" style={{ maxHeight: "60vh" }}>
        {loading ? (
          <div className="py-12 text-center text-ink-500 text-[12px]">불러오는 중…</div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-ink-500 text-[12px]">비어 있음 ✨</div>
        ) : (
          <table className="w-full text-[12px] pro-cards">
            <thead>
              <tr className="text-ink-500 text-left border-b border-ink-150">
                <th className="py-2 pr-2">제목</th>
                <th className="py-2 pr-2">작성자</th>
                <th className="py-2 pr-2">삭제 시각</th>
                <th className="py-2 pr-2 text-right">액션</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const days = Math.floor((Date.now() - new Date(it.deletedAt).getTime()) / 86_400_000);
                const willPurgeIn = Math.max(0, 30 - days);
                return (
                  <tr key={it.id} className="border-b border-ink-100">
                    <td className="cell-primary py-2 pr-2 font-bold text-ink-900 sm:truncate sm:max-w-[420px]">{it.title || "(제목 없음)"}</td>
                    <td data-label="작성자" className="py-2 pr-2 text-ink-700">{it.author?.name ?? "—"}</td>
                    <td data-label="삭제 시각" className="py-2 pr-2 text-ink-700">
                      {new Date(it.deletedAt).toLocaleString("ko-KR")}
                      <span className="text-[10px] text-ink-400 ml-1">· {willPurgeIn}일 후 영구</span>
                    </td>
                    <td className="cell-actions py-2 pr-2 text-right">
                      <button className="btn-ghost btn-xs" onClick={() => restore(tab, it.id, it.title)} disabled={busy}>복구</button>
                      <button className="btn-ghost btn-xs ml-1" style={{ color: "var(--c-danger)" }} onClick={() => purge(tab, it.id, it.title)} disabled={busy}>영구 삭제</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
