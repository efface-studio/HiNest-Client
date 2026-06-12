import { useEffect, useMemo, useState } from "react";
import { useRefresh } from "../lib/useRefresh";
import { api } from "../api";
import { useAuth } from "../auth";
import PageHeader from "../components/PageHeader";
import Select, { type SelectOption } from "../components/Select";
import { Skeleton } from "../components/Skeleton";
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
  const { refreshing, refresh } = useRefresh(() => reload());
  const [year, setYear] = useState(NOW.getFullYear());
  const [month, setMonth] = useState<number | 0>(0); // 0 = 전체
  const [employeeId, setEmployeeId] = useState("");

  const [composing, setComposing] = useState(false);
  const [editTarget, setEditTarget] = useState<Payslip | null>(null);
  const [preview, setPreview] = useState<Payslip | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (!isAdmin) return; // /employees 는 ADMIN 전용 — 직원은 호출하지 않음(403 방지).
    let alive = true;
    api<{ employees: EmployeeOption[] }>("/api/payslip/employees")
      .then((r) => alive && setEmployees(Array.isArray(r?.employees) ? r.employees : []))
      .catch(() => {});
    return () => { alive = false; };
  }, [isAdmin]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setSelected(new Set()); // 필터가 바뀌면 선택 초기화 — 안 보이는 행이 선택된 채 발송되는 일 방지.
    const q = new URLSearchParams();
    q.set("year", String(year));
    if (month) q.set("month", String(month));
    if (employeeId) q.set("employeeId", employeeId);
    api<{ payslips: Payslip[] }>(`/api/payslip?${q.toString()}`)
      .then((r) => { if (alive) { setList(Array.isArray(r?.payslips) ? r.payslips : []); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [year, month, employeeId]);

  function reload() {
    const q = new URLSearchParams();
    q.set("year", String(year));
    if (month) q.set("month", String(month));
    if (employeeId) q.set("employeeId", employeeId);
    return api<{ payslips: Payslip[] }>(`/api/payslip?${q.toString()}`)
      .then((r) => setList(Array.isArray(r?.payslips) ? r.payslips : []))
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

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === list.length ? new Set() : new Set(list.map((p) => p.id))));
  }

  function selectUnsent() {
    setSelected(new Set(list.filter((p) => !p.sentAt).map((p) => p.id)));
  }

  // 선택한 명세서를 순차 발송. 각 건 클라에서 PDF 렌더 → 서버 SES 첨부.
  // 순차로 도는 이유: 첨부 PDF 가 건당 최대 6MB라 동시 다발 POST 는 메모리·SES 레이트 부담.
  async function sendBulk() {
    const sel = list.filter((p) => selected.has(p.id));
    if (sel.length === 0) return;
    const resendCount = sel.filter((p) => p.sentAt).length;
    const noEmailCount = sel.filter((p) => !p.employee?.email).length;
    const ok = await confirmAsync({
      title: "급여명세서 일괄 발송",
      description:
        `선택한 ${sel.length}건을 PDF로 발송할까요?` +
        (resendCount > 0 ? `\n· 이미 발송된 ${resendCount}건 재발송 포함` : "") +
        (noEmailCount > 0 ? `\n· 이메일 없는 ${noEmailCount}건은 건너뜁니다` : ""),
      confirmLabel: "발송",
      cancelLabel: "취소",
    });
    if (!ok) return;

    const failed: { p: Payslip; reason: string }[] = [];
    setBulk({ done: 0, total: sel.length });
    for (let i = 0; i < sel.length; i++) {
      const p = sel[i];
      try {
        const to = p.employee?.email;
        if (!to) throw new Error("직원 계정 이메일이 없어요.");
        const pdfBase64 = await payslipToPdfBase64(p);
        const r = await api<{ payslip: Payslip }>(`/api/payslip/${p.id}/send`, {
          method: "POST",
          json: { pdfBase64 },
        });
        setList((prev) => prev.map((x) => (x.id === p.id ? r.payslip : x)));
        setPreview((prev) => (prev && prev.id === p.id ? r.payslip : prev));
      } catch (e: any) {
        failed.push({ p, reason: e?.data?.error || e?.message || "알 수 없는 오류" });
      }
      setBulk({ done: i + 1, total: sel.length });
    }
    setBulk(null);
    // 실패 건만 선택 유지 → 그대로 “선택 발송”을 다시 누르면 재시도.
    setSelected(new Set(failed.map((f) => f.p.id)));

    const okCount = sel.length - failed.length;
    if (failed.length === 0) {
      await alertAsync({ title: "일괄 발송 완료", description: `${okCount}건을 모두 발송했어요.` });
    } else {
      const lines = failed.slice(0, 5).map((f) => `· ${f.p.employeeName}: ${f.reason}`).join("\n");
      const more = failed.length > 5 ? `\n외 ${failed.length - 5}건` : "";
      await alertAsync({
        title: "일괄 발송 결과",
        description: `성공 ${okCount}건 · 실패 ${failed.length}건\n\n${lines}${more}\n\n실패 건은 선택된 상태로 남아 있어요. 다시 “선택 발송”을 누르면 재시도합니다.`,
      });
    }
  }

  const years = Array.from({ length: 6 }, (_, i) => NOW.getFullYear() - i + 1);
  const yearOptions: SelectOption[] = useMemo(
    () => years.map((y) => ({ value: String(y), label: `${y}년` })),
    [years],
  );
  const monthOptions: SelectOption[] = useMemo(
    () => [
      { value: "0", label: "전체 월" },
      ...Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({ value: String(m), label: `${m}월` })),
    ],
    [],
  );
  const employeeOptions: SelectOption[] = useMemo(
    () => [
      { value: "", label: "전체 직원" },
      ...employees.map((e) => ({
        value: e.id,
        label: `${e.name}${e.team ? ` · ${e.team}` : ""}`,
        searchText: `${e.name} ${e.team ?? ""}`,
      })),
    ],
    [employees],
  );
  const sentCount = list.filter((p) => p.sentAt).length;
  const unsentCount = list.length - sentCount;
  const allSelected = list.length > 0 && selected.size === list.length;

  return (
    <div>
      <PageHeader
        title={isAdmin ? "급여명세서" : "내 급여명세서"}
        description={isAdmin
          ? "직원별 임금명세서를 작성·발송하고 보관합니다."
          : "발급된 임금명세서를 확인하고 PDF로 저장할 수 있어요."}
        onRefresh={refresh}
        refreshing={refreshing}
        right={isAdmin ? (
          <button className="btn-primary" onClick={() => { setEditTarget(null); setComposing(true); }}>
            + 새 명세서
          </button>
        ) : undefined}
      />

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Select className="input w-auto" value={String(year)} disabled={bulk !== null} onChange={(v) => setYear(Number(v))} options={yearOptions} ariaLabel="연도" />
        <Select className="input w-auto" value={String(month)} disabled={bulk !== null} onChange={(v) => setMonth(Number(v))} options={monthOptions} ariaLabel="월" />
        {isAdmin && (
          <Select className="input w-auto" value={employeeId} disabled={bulk !== null} onChange={(v) => setEmployeeId(v)} options={employeeOptions} ariaLabel="직원" />
        )}
      </div>

      {/* 발송 현황 + 일괄 발송 (ADMIN) */}
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-[12.5px] text-ink-500">
            총 {list.length}건 · 발송 <b className="text-brand-700">{sentCount}</b> · 미발송 <b className="text-ink-700">{unsentCount}</b>
            {selected.size > 0 && <> · 선택 <b className="text-ink-900">{selected.size}</b></>}
          </span>
          <div className="flex-1" />
          <button className="btn-ghost btn-xs" onClick={selectUnsent} disabled={bulk !== null || unsentCount === 0}>
            미발송만 선택
          </button>
          <button className="btn-primary btn-xs" onClick={sendBulk} disabled={bulk !== null || selected.size === 0}>
            {bulk ? `발송 중… ${bulk.done}/${bulk.total}` : `선택 발송${selected.size ? ` (${selected.size})` : ""}`}
          </button>
        </div>
      )}

      <div className="card p-0 overflow-hidden overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
        <table className="pro-cards w-full text-sm min-w-[760px]">
          <thead className="bg-slate-50 text-slate-500 text-xs">
            <tr>
              {isAdmin && (
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    className="accent-brand-600 w-4 h-4 align-middle"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = selected.size > 0 && !allSelected; }}
                    onChange={toggleAll}
                    disabled={bulk !== null || list.length === 0}
                    aria-label="전체 선택"
                  />
                </th>
              )}
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
            {loading && list.length === 0 && (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t border-slate-100">
                  {isAdmin && (
                    <td className="px-4 py-3"><Skeleton w={16} h={16} radius={4} /></td>
                  )}
                  <td className="px-4 py-3">
                    <Skeleton w="55%" h={13} />
                    <div className="mt-1"><Skeleton w="35%" h={10} /></div>
                  </td>
                  <td className="px-4 py-3"><Skeleton w={52} h={12} /></td>
                  <td className="px-4 py-3 text-right"><Skeleton w="70%" h={12} /></td>
                  <td className="px-4 py-3 text-right"><Skeleton w="70%" h={12} /></td>
                  <td className="px-4 py-3 text-right"><Skeleton w="80%" h={12} /></td>
                  <td className="px-4 py-3 text-center"><Skeleton w={48} h={20} radius={999} /></td>
                  <td className="px-4 py-3 text-right"><Skeleton w={40} h={12} /></td>
                </tr>
              ))
            )}
            {!loading && list.length === 0 && (
              <tr><td colSpan={isAdmin ? 8 : 7} className="cell-full px-4 py-10 text-center text-slate-400">
                {isAdmin ? "명세서가 없습니다. “+ 새 명세서”로 작성하세요." : "아직 발급된 급여명세서가 없어요."}
              </td></tr>
            )}
            {list.map((p) => (
              <tr key={p.id} className={`border-t border-slate-100 hover:bg-slate-50/50 ${isAdmin && selected.has(p.id) ? "bg-brand-50/40" : ""}`}>
                {isAdmin && (
                  <td data-label="선택" className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="accent-brand-600 w-4 h-4 align-middle"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                      disabled={bulk !== null}
                      aria-label={`${p.employeeName} 선택`}
                    />
                  </td>
                )}
                <td className="cell-primary px-4 py-3">
                  <div className="font-medium text-ink-900">{p.employeeName}</div>
                  {p.department && <div className="text-[11.5px] text-ink-500">{p.department}</div>}
                </td>
                <td data-label="귀속" className="px-4 py-3 tabular">{p.year}.{String(p.month).padStart(2, "0")}</td>
                <td data-label="지급액" className="px-4 py-3 text-right tabular">{won(p.totalEarnings)}</td>
                <td data-label="공제액" className="px-4 py-3 text-right tabular text-rose-600">{won(p.totalDeductions)}</td>
                <td data-label="실수령액" className="px-4 py-3 text-right font-bold tabular">{won(p.netPay)}</td>
                <td data-label="발송" className="px-4 py-3 text-center">
                  {p.sentAt
                    ? <span className="chip bg-brand-100 text-brand-700" title={new Date(p.sentAt).toLocaleString("ko-KR")}>발송됨</span>
                    : <span className="chip bg-slate-100 text-slate-500">미발송</span>}
                </td>
                <td className="cell-actions px-4 py-3 text-right whitespace-nowrap">
                  <button className="text-[12px] text-brand-600 hover:underline" onClick={() => setPreview(p)}>보기</button>
                  {isAdmin && (
                    <>
                      <button className="text-[12px] text-ink-600 hover:underline ml-3" onClick={() => { setEditTarget(p); setComposing(true); }}>수정</button>
                      <button
                        className="text-[12px] text-brand-600 hover:underline ml-3 disabled:opacity-50"
                        onClick={() => sendMail(p)}
                        disabled={sendingId === p.id || bulk !== null}
                      >
                        {sendingId === p.id ? "발송 중…" : (p.sentAt ? "재발송" : "메일 발송")}
                      </button>
                      <button
                        className="text-[12px] text-rose-500 hover:underline ml-3 disabled:opacity-50"
                        onClick={() => remove(p)}
                        disabled={busyId === p.id || bulk !== null}
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
