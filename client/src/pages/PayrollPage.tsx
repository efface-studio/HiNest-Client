import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import PageHeader from "../components/PageHeader";
import PayslipComposer from "../components/PayslipComposer";
import PayslipPreview from "../components/PayslipPreview";
import { confirmAsync, alertAsync } from "../components/ConfirmHost";
import { type Payslip, type EmployeeOption, won } from "../lib/payslip";
import { payslipToPdfBase64 } from "../lib/payslipPdf";

const NOW = new Date();

/**
 * 급여명세서 페이지.
 * - ADMIN: 연/월/직원 필터 + 작성·수정·삭제·미리보기(전체 관리).
 * - 일반 직원: 본인 명세서만 열람(읽기 전용) + 미리보기·PDF.
 * 권한 분기는 화면에서 하되, 실제 데이터 접근 제어는 서버가 강제한다
 * (목록 GET 은 본인 것만, /employees 는 ADMIN 전용).
 */
export default function PayrollPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [list, setList] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(NOW.getFullYear());
  const [month, setMonth] = useState<number | 0>(0); // 0 = 전체
  const [employeeId, setEmployeeId] = useState("");

  const [composing, setComposing] = useState(false);
  const [editTarget, setEditTarget] = useState<Payslip | null>(null);
  const [preview, setPreview] = useState<Payslip | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return; // /employees 는 ADMIN 전용 — 직원은 호출하지 않음(403 방지).
    let alive = true;
    api<{ employees: EmployeeOption[] }>("/api/payslip/employees")
      .then((r) => alive && setEmployees(r.employees))
      .catch(() => {});
    return () => { alive = false; };
  }, [isAdmin]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const q = new URLSearchParams();
    q.set("year", String(year));
    if (month) q.set("month", String(month));
    if (employeeId) q.set("employeeId", employeeId);
    api<{ payslips: Payslip[] }>(`/api/payslip?${q.toString()}`)
      .then((r) => { if (alive) { setList(r.payslips); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [year, month, employeeId]);

  function reload() {
    const q = new URLSearchParams();
    q.set("year", String(year));
    if (month) q.set("month", String(month));
    if (employeeId) q.set("employeeId", employeeId);
    api<{ payslips: Payslip[] }>(`/api/payslip?${q.toString()}`)
      .then((r) => setList(r.payslips))
      .catch(() => {});
  }

  function onSaved(p: Payslip) {
    setComposing(false);
    setEditTarget(null);
    // 현재 필터에 맞으면 목록 갱신.
    reload();
    // 방금 저장한 건 바로 미리보기로 띄워 결과 확인.
    setPreview(p);
  }

  async function remove(p: Payslip) {
    const ok = await confirmAsync({
      title: "급여명세서 삭제",
      description: `${p.employeeName} · ${p.year}년 ${p.month}월 명세서를 삭제할까요?`,
      confirmLabel: "삭제",
      cancelLabel: "취소",
      tone: "danger",
    });
    if (!ok) return;
    setBusyId(p.id);
    try {
      await api(`/api/payslip/${p.id}`, { method: "DELETE" });
      setList((prev) => prev.filter((x) => x.id !== p.id));
    } finally {
      setBusyId(null);
    }
  }

  // 명세서를 PDF 로 만들어 직원 계정 이메일로 발송. 클라에서 PDF 렌더 → 서버가 SES 첨부.
  async function sendMail(p: Payslip) {
    const to = p.employee?.email;
    if (!to) {
      await alertAsync({ title: "발송 불가", description: "직원 계정 이메일이 없어요." });
      return;
    }
    const ok = await confirmAsync({
      title: "급여명세서 메일 발송",
      description: `${p.employeeName} (${to})에게 ${p.year}년 ${p.month}월 명세서를 PDF로 발송할까요?`,
      confirmLabel: "발송",
      cancelLabel: "취소",
    });
    if (!ok) return;
    setSendingId(p.id);
    try {
      const pdfBase64 = await payslipToPdfBase64(p);
      const r = await api<{ payslip: Payslip }>(`/api/payslip/${p.id}/send`, {
        method: "POST",
        json: { pdfBase64 },
      });
      setList((prev) => prev.map((x) => (x.id === p.id ? r.payslip : x)));
      setPreview((prev) => (prev && prev.id === p.id ? r.payslip : prev));
      await alertAsync({ title: "발송 완료", description: `${p.employeeName}님에게 메일을 보냈어요.` });
    } catch (e: any) {
      await alertAsync({
        title: "발송 실패",
        description: e?.data?.error || e?.message || "잠시 후 다시 시도해주세요.",
      });
    } finally {
      setSendingId(null);
    }
  }

  const years = Array.from({ length: 6 }, (_, i) => NOW.getFullYear() - i + 1);

  return (
    <div>
      <PageHeader
        title={isAdmin ? "급여명세서" : "내 급여명세서"}
        description={isAdmin
          ? "직원별 임금명세서를 작성·발송하고 보관합니다."
          : "발급된 임금명세서를 확인하고 PDF로 저장할 수 있어요."}
        right={isAdmin ? (
          <button className="btn-primary" onClick={() => { setEditTarget(null); setComposing(true); }}>
            + 새 명세서
          </button>
        ) : undefined}
      />

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select className="input w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select className="input w-auto" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          <option value={0}>전체 월</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
        </select>
        {isAdmin && (
          <select className="input w-auto" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">전체 직원</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.team ? ` · ${e.team}` : ""}</option>)}
          </select>
        )}
      </div>

      <div className="card p-0 overflow-hidden overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-slate-50 text-slate-500 text-xs">
            <tr>
              <th className="text-left px-4 py-3">직원</th>
              <th className="text-left px-4 py-3">귀속</th>
              <th className="text-right px-4 py-3">지급액</th>
              <th className="text-right px-4 py-3">공제액</th>
              <th className="text-right px-4 py-3">실수령액</th>
              <th className="text-center px-4 py-3">발송</th>
              <th className="text-right px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">불러오는 중…</td></tr>
            )}
            {!loading && list.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                {isAdmin ? "명세서가 없습니다. “+ 새 명세서”로 작성하세요." : "아직 발급된 급여명세서가 없어요."}
              </td></tr>
            )}
            {!loading && list.map((p) => (
              <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                <td className="px-4 py-3">
                  <div className="font-medium text-ink-900">{p.employeeName}</div>
                  {p.department && <div className="text-[11.5px] text-ink-500">{p.department}</div>}
                </td>
                <td className="px-4 py-3 tabular">{p.year}.{String(p.month).padStart(2, "0")}</td>
                <td className="px-4 py-3 text-right tabular">{won(p.totalEarnings)}</td>
                <td className="px-4 py-3 text-right tabular text-rose-600">{won(p.totalDeductions)}</td>
                <td className="px-4 py-3 text-right font-bold tabular">{won(p.netPay)}</td>
                <td className="px-4 py-3 text-center">
                  {p.sentAt
                    ? <span className="chip bg-brand-100 text-brand-700" title={new Date(p.sentAt).toLocaleString("ko-KR")}>발송됨</span>
                    : <span className="chip bg-slate-100 text-slate-500">미발송</span>}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button className="text-[12px] text-brand-600 hover:underline" onClick={() => setPreview(p)}>보기</button>
                  {isAdmin && (
                    <>
                      <button className="text-[12px] text-ink-600 hover:underline ml-3" onClick={() => { setEditTarget(p); setComposing(true); }}>수정</button>
                      <button
                        className="text-[12px] text-brand-600 hover:underline ml-3 disabled:opacity-50"
                        onClick={() => sendMail(p)}
                        disabled={sendingId === p.id}
                      >
                        {sendingId === p.id ? "발송 중…" : (p.sentAt ? "재발송" : "메일 발송")}
                      </button>
                      <button
                        className="text-[12px] text-rose-500 hover:underline ml-3 disabled:opacity-50"
                        onClick={() => remove(p)}
                        disabled={busyId === p.id}
                      >
                        {busyId === p.id ? "삭제 중…" : "삭제"}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && composing && (
        <PayslipComposer
          initial={editTarget}
          employees={employees}
          defaultYear={year}
          defaultMonth={month || NOW.getMonth() + 1}
          onClose={() => { setComposing(false); setEditTarget(null); }}
          onSaved={onSaved}
        />
      )}

      {preview && (
        <PayslipPreview
          payslip={preview}
          onClose={() => setPreview(null)}
          onEdit={isAdmin ? () => { setEditTarget(preview); setPreview(null); setComposing(true); } : undefined}
          onSend={isAdmin ? () => sendMail(preview) : undefined}
        />
      )}
    </div>
  );
}
