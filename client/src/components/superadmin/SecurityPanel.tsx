import { useEffect, useState } from "react";
import { api } from "../../api";
import { confirmAsync } from "../ConfirmHost";
import DateTimePicker from "../DateTimePicker";
import Portal from "../Portal";

type Rate = { id: string; routeGlob: string; perMin: number; perHour: number; scope: string; enabled: boolean; note: string | null; createdAt: string };
type Block = { id: string; cidr: string; country: string | null; reason: string | null; enabled: boolean; expiresAt: string | null; createdAt: string };

export default function SecurityPanel() {
  const [tab, setTab] = useState<"rate" | "ip">("rate");
  return (
    <div className="panel p-4">
      <div className="inline-flex rounded-full p-0.5 mb-3" style={{ background: "var(--c-surface-3)" }}>
        {(["rate", "ip"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className="text-[11.5px] font-bold px-3 py-1 rounded-full"
            style={{
              background: tab === k ? "var(--c-surface-1)" : "transparent",
              color: tab === k ? "var(--c-text-1)" : "var(--c-text-3)",
            }}
          >
            {k === "rate" ? "Rate-limit 룰" : "IP / 국가 차단"}
          </button>
        ))}
      </div>
      {tab === "rate" ? <RateRules /> : <IpBlocks />}
    </div>
  );
}

function RateRules() {
  const [rows, setRows] = useState<Rate[]>([]);
  const [editing, setEditing] = useState<Partial<Rate> | null>(null);
  async function load() { setRows((await api<{ rules: Rate[] }>("/api/admin/rate-rules")).rules); }
  useEffect(() => { load(); }, []);
  async function save(r: Partial<Rate>) {
    await api("/api/admin/rate-rules", { method: "POST", json: r });
    setEditing(null);
    await load();
  }
  async function remove(id: string) {
    if (!(await confirmAsync({ title: "룰 삭제?", description: "되돌릴 수 없음." }))) return;
    await api(`/api/admin/rate-rules/${id}`, { method: "DELETE" });
    await load();
  }
  return (
    <>
      <div className="flex items-center mb-2">
        <div className="text-[11px] text-ink-500">{rows.length}개 룰</div>
        <button className="btn-primary btn-xs ml-auto" onClick={() => setEditing({ routeGlob: "/api/auth/*", perMin: 60, perHour: 600, scope: "ip", enabled: true })}>+ 새 룰</button>
      </div>
      <table className="w-full text-[12px] pro-cards">
        <thead>
          <tr className="text-ink-500 text-left border-b border-ink-150">
            <th className="py-2 pr-2">경로</th>
            <th className="py-2 pr-2">/분</th>
            <th className="py-2 pr-2">/시간</th>
            <th className="py-2 pr-2">스코프</th>
            <th className="py-2 pr-2">활성</th>
            <th className="py-2 pr-2 text-right"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-ink-100">
              <td className="cell-primary py-2 pr-2 font-mono text-[11.5px] font-bold text-ink-900">{r.routeGlob}</td>
              <td data-label="분당" className="py-2 pr-2 tabular-nums">{r.perMin}</td>
              <td data-label="시간당" className="py-2 pr-2 tabular-nums">{r.perHour}</td>
              <td data-label="스코프" className="py-2 pr-2">{r.scope}</td>
              <td data-label="활성" className="py-2 pr-2 text-[11px] font-bold" style={{ color: r.enabled ? "var(--c-success)" : "var(--c-text-3)" }}>{r.enabled ? "ON" : "OFF"}</td>
              <td className="cell-actions py-2 pr-2 text-right">
                <button className="btn-ghost btn-xs" onClick={() => setEditing(r)}>편집</button>
                <button className="btn-ghost btn-xs ml-1" style={{ color: "var(--c-danger)" }} onClick={() => remove(r.id)}>삭제</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <Modal onClose={() => setEditing(null)} onSubmit={() => save(editing)}>
          <div className="text-[14px] font-extrabold mb-3">{editing.id ? "룰 편집" : "새 룰"}</div>
          <Field label="경로 (glob: * ? 지원)">
            <input className="input font-mono" required value={editing.routeGlob ?? ""} onChange={(e) => setEditing({ ...editing, routeGlob: e.target.value })} />
          </Field>
          <Field label="/분"><input className="input" type="number" min={1} value={editing.perMin ?? 60} onChange={(e) => setEditing({ ...editing, perMin: +e.target.value })} /></Field>
          <Field label="/시간"><input className="input" type="number" min={1} value={editing.perHour ?? 600} onChange={(e) => setEditing({ ...editing, perHour: +e.target.value })} /></Field>
          <Field label="스코프">
            <select className="input" value={editing.scope ?? "ip"} onChange={(e) => setEditing({ ...editing, scope: e.target.value })}>
              <option value="ip">IP 단위</option>
              <option value="user">사용자 단위</option>
              <option value="global">전역</option>
            </select>
          </Field>
          <Field label="활성">
            <select className="input" value={editing.enabled ? "1" : "0"} onChange={(e) => setEditing({ ...editing, enabled: e.target.value === "1" })}>
              <option value="1">ON</option><option value="0">OFF</option>
            </select>
          </Field>
        </Modal>
      )}
    </>
  );
}

function IpBlocks() {
  const [rows, setRows] = useState<Block[]>([]);
  const [editing, setEditing] = useState<Partial<Block> | null>(null);
  async function load() { setRows((await api<{ blocks: Block[] }>("/api/admin/ip-blocks")).blocks); }
  useEffect(() => { load(); }, []);
  async function save(b: Partial<Block>) {
    await api("/api/admin/ip-blocks", { method: "POST", json: b });
    setEditing(null);
    await load();
  }
  async function remove(id: string) {
    if (!(await confirmAsync({ title: "차단 해제?", description: "이 룰이 더 이상 적용되지 않습니다." }))) return;
    await api(`/api/admin/ip-blocks/${id}`, { method: "DELETE" });
    await load();
  }
  return (
    <>
      <div className="flex items-center mb-2">
        <div className="text-[11px] text-ink-500">{rows.length}개 차단 룰</div>
        <button className="btn-primary btn-xs ml-auto" onClick={() => setEditing({ cidr: "", country: "", enabled: true })}>+ 차단 추가</button>
      </div>
      <table className="w-full text-[12px] pro-cards">
        <thead>
          <tr className="text-ink-500 text-left border-b border-ink-150">
            <th className="py-2 pr-2">대상</th>
            <th className="py-2 pr-2">사유</th>
            <th className="py-2 pr-2">만료</th>
            <th className="py-2 pr-2">활성</th>
            <th className="py-2 pr-2 text-right"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id} className="border-b border-ink-100">
              <td className="cell-primary py-2 pr-2 font-mono text-[11.5px] text-ink-900">{b.country ? `🌍 ${b.country}` : b.cidr}</td>
              <td data-label="사유" className="py-2 pr-2 text-ink-700 sm:truncate sm:max-w-[260px]">{b.reason ?? "—"}</td>
              <td data-label="만료" className="py-2 pr-2 text-ink-700">{b.expiresAt ? new Date(b.expiresAt).toLocaleDateString("ko-KR") : "—"}</td>
              <td data-label="활성" className="py-2 pr-2 text-[11px] font-bold" style={{ color: b.enabled ? "var(--c-danger)" : "var(--c-text-3)" }}>{b.enabled ? "차단 중" : "OFF"}</td>
              <td className="cell-actions py-2 pr-2 text-right">
                <button className="btn-ghost btn-xs" onClick={() => setEditing(b)}>편집</button>
                <button className="btn-ghost btn-xs ml-1" style={{ color: "var(--c-danger)" }} onClick={() => remove(b.id)}>해제</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <Modal onClose={() => setEditing(null)} onSubmit={() => save(editing)}>
          <div className="text-[14px] font-extrabold mb-3">{editing.id ? "차단 편집" : "새 차단"}</div>
          <Field label="CIDR (IPv4 — 예: 1.2.3.4/32, 10.0.0.0/8)">
            <input className="input font-mono" value={editing.cidr ?? ""} onChange={(e) => setEditing({ ...editing, cidr: e.target.value, country: "" })} placeholder="비워두고 country 만 사용 가능" />
          </Field>
          <Field label="또는 국가 코드 (Cloudflare cf-ipcountry 헤더 매칭)">
            <input className="input font-mono" maxLength={2} value={editing.country ?? ""} onChange={(e) => setEditing({ ...editing, country: e.target.value.toUpperCase(), cidr: "" })} placeholder="예: CN, RU" />
          </Field>
          <Field label="사유"><input className="input" value={editing.reason ?? ""} onChange={(e) => setEditing({ ...editing, reason: e.target.value })} /></Field>
          <Field label="만료 (선택)"><DateTimePicker value={editing.expiresAt ?? ""} onChange={(v) => setEditing({ ...editing, expiresAt: v })} /></Field>
          <Field label="활성">
            <select className="input" value={editing.enabled ? "1" : "0"} onChange={(e) => setEditing({ ...editing, enabled: e.target.value === "1" })}>
              <option value="1">차단 중</option><option value="0">OFF</option>
            </select>
          </Field>
        </Modal>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2.5">
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}

function Modal({ onClose, onSubmit, children }: { onClose: () => void; onSubmit: () => void; children: React.ReactNode }) {
  return (
    <Portal>
    <div className="fixed inset-0 bg-ink-900/40 grid place-items-center modal-safe z-50" onClick={onClose}>
      <form
        className="panel w-full max-w-[460px] p-5 max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      >
        {children}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost" onClick={onClose}>취소</button>
          <button type="submit" className="btn-primary">저장</button>
        </div>
      </form>
    </div>
    </Portal>
  );
}
