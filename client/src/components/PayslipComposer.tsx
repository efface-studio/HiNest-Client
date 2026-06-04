import { useMemo, useState } from "react";
import { api } from "../api";
import { useModalDismiss } from "../lib/useModalDismiss";
import {
  type Payslip,
  type LineItem,
  type EmployeeOption,
  type Attendance,
  type CalcRow,
  blankEarnings,
  blankDeductions,
  sumAmount,
  won,
  DEFAULT_COMPANY,
  DEFAULT_MEMO,
} from "../lib/payslip";

type AttForm = Record<keyof Attendance, string>;
const EMPTY_ATT: AttForm = {
  workDays: "",
  totalHours: "",
  overtimeHours: "",
  nightHours: "",
  holidayHours: "",
  hourlyWage: "",
  familyCount: "",
};
const ATT_FIELDS: { key: keyof Attendance; label: string; unit: string }[] = [
  { key: "workDays", label: "근로일수", unit: "일" },
  { key: "totalHours", label: "총 근로시간", unit: "시간" },
  { key: "overtimeHours", label: "연장 근로시간", unit: "시간" },
  { key: "nightHours", label: "야간 근로시간", unit: "시간" },
  { key: "holidayHours", label: "휴일 근로시간", unit: "시간" },
  { key: "hourlyWage", label: "통상시급", unit: "원" },
  { key: "familyCount", label: "부양가족수", unit: "명" },
];

function attToForm(a?: Attendance | null): AttForm {
  if (!a) return { ...EMPTY_ATT };
  const out = { ...EMPTY_ATT };
  for (const { key } of ATT_FIELDS) {
    const v = a[key];
    out[key] = v === undefined || v === null ? "" : String(v);
  }
  return out;
}

/**
 * 급여명세서 작성·수정 모달 (ADMIN 전용 화면에서 사용).
 * - 직원 선택 시 HR 정보 자동 채움(이름/부서/직위/입사일/생년월일).
 * - 지급/공제 항목 행 추가·삭제, 합계·실수령액 실시간 계산.
 * - 근태·계산방법은 선택 입력. 저장 시 서버가 합계를 재계산해 신뢰값 저장.
 */
export default function PayslipComposer({
  initial,
  employees,
  defaultYear,
  defaultMonth,
  onClose,
  onSaved,
}: {
  initial?: Payslip | null;
  employees: EmployeeOption[];
  defaultYear: number;
  defaultMonth: number;
  onClose: () => void;
  onSaved: (p: Payslip) => void;
}) {
  const editing = !!initial;
  const [employeeId, setEmployeeId] = useState(initial?.employeeId ?? "");
  const [year, setYear] = useState(initial?.year ?? defaultYear);
  const [month, setMonth] = useState(initial?.month ?? defaultMonth);
  const [companyName, setCompanyName] = useState(initial?.companyName ?? DEFAULT_COMPANY);
  const [employeeName, setEmployeeName] = useState(initial?.employeeName ?? "");
  const [department, setDepartment] = useState(initial?.department ?? "");
  const [position, setPosition] = useState(initial?.position ?? "");
  const [joinDate, setJoinDate] = useState(initial?.joinDate ?? "");
  const [payDate, setPayDate] = useState(initial?.payDate ?? "");
  const [idNumber, setIdNumber] = useState(initial?.idNumber ?? "");
  const [earnings, setEarnings] = useState<LineItem[]>(initial?.earnings ?? blankEarnings());
  const [deductions, setDeductions] = useState<LineItem[]>(initial?.deductions ?? blankDeductions());
  const [att, setAtt] = useState<AttForm>(attToForm(initial?.attendance));
  const [calcRows, setCalcRows] = useState<CalcRow[]>(initial?.calcRows ?? []);
  const [memo, setMemo] = useState(initial?.memo ?? DEFAULT_MEMO);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useModalDismiss(!saving, onClose);

  const totalEarnings = useMemo(() => sumAmount(earnings), [earnings]);
  const totalDeductions = useMemo(() => sumAmount(deductions), [deductions]);
  const netPay = totalEarnings - totalDeductions;

  function onPickEmployee(id: string) {
    setEmployeeId(id);
    const emp = employees.find((e) => e.id === id);
    if (!emp) return;
    // 신규 작성 시에만 인적사항 자동 채움. 수정 모드에선 기존 스냅샷 유지.
    if (editing) return;
    setEmployeeName(emp.name);
    setDepartment(emp.department || emp.team || "");
    setPosition(emp.position || "");
    setJoinDate(emp.hireDate || "");
    setIdNumber(emp.birthDate || "");
  }

  async function save() {
    if (!employeeId) {
      setErr("직원을 선택하세요");
      return;
    }
    setSaving(true);
    setErr(null);

    const cleanItems = (items: LineItem[]) =>
      items
        .map((x) => ({ label: x.label.trim(), amount: Math.round(Number(x.amount) || 0) }))
        .filter((x) => x.label.length > 0);

    const attObj: Attendance = {};
    let hasAtt = false;
    for (const { key } of ATT_FIELDS) {
      const raw = att[key].trim();
      if (raw === "") continue;
      const n = Number(raw);
      if (Number.isNaN(n)) continue;
      attObj[key] = n;
      hasAtt = true;
    }

    const cleanCalc = calcRows
      .map((c) => ({ item: c.item.trim(), formula: c.formula.trim(), amount: Math.round(Number(c.amount) || 0) }))
      .filter((c) => c.item || c.formula);

    const payload: Record<string, unknown> = {
      employeeId,
      year,
      month,
      companyName: companyName.trim() || undefined,
      employeeName: employeeName.trim() || undefined,
      department: department.trim() || null,
      position: position.trim() || null,
      joinDate: joinDate.trim() || null,
      payDate: payDate.trim() || null,
      idNumber: idNumber.trim() || null,
      earnings: cleanItems(earnings),
      deductions: cleanItems(deductions),
      attendance: hasAtt ? attObj : null,
      calcRows: cleanCalc.length ? cleanCalc : null,
      memo: memo.trim() || null,
    };

    try {
      const res = editing
        ? await api<{ payslip: Payslip }>(`/api/payslip/${initial!.id}`, { method: "PATCH", json: payload })
        : await api<{ payslip: Payslip }>(`/api/payslip`, { method: "POST", json: payload });
      onSaved(res.payslip);
    } catch (e: any) {
      if (e?.status === 409 && e?.code === "DUPLICATE") {
        setErr("이미 해당 직원의 그 달 명세서가 있어요. 목록에서 기존 명세서를 수정해주세요.");
      } else {
        setErr(e?.message ?? "저장에 실패했어요");
      }
      setSaving(false);
    }
  }

  const years = Array.from({ length: 6 }, (_, i) => defaultYear - i + 1);

  return (
    <div className="fixed inset-0 bg-slate-900/45 grid place-items-center modal-safe z-50" onClick={onClose}>
      <div
        className="card w-full max-w-3xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">{editing ? "급여명세서 수정" : "새 급여명세서"}</h3>
          <button className="btn-ghost text-[13px]" onClick={onClose} disabled={saving}>닫기</button>
        </div>

        {/* 기본 정보 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-1">
            <label className="label">직원</label>
            <select
              className="input"
              value={employeeId}
              onChange={(e) => onPickEmployee(e.target.value)}
              disabled={editing}
            >
              <option value="">선택…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}{e.team ? ` · ${e.team}` : ""}
                </option>
              ))}
            </select>
            {editing && <p className="t-caption mt-1">직원·연월은 수정할 수 없어요</p>}
          </div>
          <div>
            <label className="label">연도</label>
            <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))} disabled={editing}>
              {years.map((y) => <option key={y} value={y}>{y}년</option>)}
            </select>
          </div>
          <div>
            <label className="label">월</label>
            <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))} disabled={editing}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <Field label="성명" value={employeeName} onChange={setEmployeeName} max={60} />
          <Field label="생년월일(사번)" value={idNumber} onChange={setIdNumber} max={40} />
          <Field label="부서" value={department} onChange={setDepartment} max={60} />
          <Field label="직위" value={position} onChange={setPosition} max={60} />
          <Field label="입사일" value={joinDate} onChange={setJoinDate} max={10} placeholder="2025-01-01" mask={maskDate} inputMode="numeric" />
          <Field label="지급일" value={payDate} onChange={setPayDate} max={10} placeholder="2026-05-25" mask={maskDate} inputMode="numeric" />
          <div className="sm:col-span-2">
            <Field label="회사명" value={companyName} onChange={setCompanyName} max={100} />
          </div>
        </div>

        {/* 지급/공제 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
          <ItemEditor title="지급 항목" accent="brand" items={earnings} setItems={setEarnings} total={totalEarnings} />
          <ItemEditor title="공제 항목" accent="rose" items={deductions} setItems={setDeductions} total={totalDeductions} />
        </div>

        {/* 실수령액 */}
        <div className="mt-4 flex items-center justify-between rounded-xl bg-ink-100 px-4 py-3">
          <span className="text-[13px] font-bold text-ink-700">실수령액 (지급 − 공제)</span>
          <span className={`text-[20px] font-extrabold tabular ${netPay < 0 ? "text-rose-600" : "text-ink-900"}`}>
            {won(netPay)}
          </span>
        </div>

        {/* 근태 (선택) */}
        <details className="mt-5 group">
          <summary className="cursor-pointer text-[13px] font-bold text-ink-700 select-none">근태 정보 (선택)</summary>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3">
            {ATT_FIELDS.map(({ key, label, unit }) => (
              <div key={key}>
                <label className="label text-[11px]">{label} ({unit})</label>
                <input
                  type="number"
                  className="input"
                  value={att[key]}
                  onChange={(e) => setAtt((p) => ({ ...p, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </details>

        {/* 계산방법 (선택) */}
        <details className="mt-4">
          <summary className="cursor-pointer text-[13px] font-bold text-ink-700 select-none">계산 방법 (선택)</summary>
          <div className="space-y-2 mt-3">
            {calcRows.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_1.5fr_1fr_auto] gap-2 items-center">
                <input className="input" placeholder="항목" value={c.item} maxLength={60}
                  onChange={(e) => setCalcRows((p) => p.map((x, j) => j === i ? { ...x, item: e.target.value } : x))} />
                <input className="input" placeholder="산출식" value={c.formula} maxLength={300}
                  onChange={(e) => setCalcRows((p) => p.map((x, j) => j === i ? { ...x, formula: e.target.value } : x))} />
                <input className="input text-right" type="number" placeholder="금액" value={c.amount}
                  onChange={(e) => setCalcRows((p) => p.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) } : x))} />
                <button type="button" className="text-rose-500 text-lg px-1" onClick={() => setCalcRows((p) => p.filter((_, j) => j !== i))} title="삭제">×</button>
              </div>
            ))}
            <button type="button" className="btn-ghost text-[12px]" onClick={() => setCalcRows((p) => [...p, { item: "", formula: "", amount: 0 }])}>
              + 계산 행 추가
            </button>
          </div>
        </details>

        {/* 메모 */}
        <div className="mt-4">
          <label className="label">하단 문구</label>
          <input className="input" value={memo} maxLength={500} onChange={(e) => setMemo(e.target.value)} />
        </div>

        {err && <div className="mt-3 text-[12.5px] text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-4">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>취소</button>
          <button className="btn-primary" onClick={save} disabled={saving || !employeeId}>
            {saving ? "저장 중…" : editing ? "수정 저장" : "작성"}
          </button>
        </div>
      </div>
    </div>
  );
}

// 숫자만 받아 YYYY-MM-DD 로 자동 하이픈. 8자리 초과는 버리고, 월/일은 2자리 완성 시 상한 보정(12월·31일).
function maskDate(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  const y = d.slice(0, 4);
  let mo = d.slice(4, 6);
  let da = d.slice(6, 8);
  if (mo.length === 2 && Number(mo) > 12) mo = "12";
  if (da.length === 2 && Number(da) > 31) da = "31";
  let out = y;
  if (d.length > 4) out += "-" + mo;
  if (d.length > 6) out += "-" + da;
  return out;
}

function Field({
  label, value, onChange, max, placeholder, mask, inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max?: number;
  placeholder?: string;
  /** 입력값 변환기(예: 날짜 자동 하이픈). 주면 onChange 직전에 적용. */
  mask?: (v: string) => string;
  inputMode?: "text" | "numeric";
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="input"
        value={value}
        maxLength={max}
        placeholder={placeholder}
        inputMode={inputMode}
        onChange={(e) => onChange(mask ? mask(e.target.value) : e.target.value)}
      />
    </div>
  );
}

function ItemEditor({
  title, accent, items, setItems, total,
}: {
  title: string;
  accent: "brand" | "rose";
  items: LineItem[];
  setItems: React.Dispatch<React.SetStateAction<LineItem[]>>;
  total: number;
}) {
  const totalColor = accent === "rose" ? "text-rose-600" : "text-brand-700";
  return (
    <div className="border border-ink-150 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-bold text-ink-800">{title}</span>
        <span className={`text-[13px] font-extrabold tabular ${totalColor}`}>{won(total)}</span>
      </div>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1.5 items-center">
            <input
              className="input py-1.5 text-[12.5px]"
              placeholder="항목명"
              value={it.label}
              maxLength={60}
              onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            />
            <input
              className="input py-1.5 text-[12.5px] text-right"
              type="number"
              placeholder="0"
              value={it.amount}
              onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))}
            />
            <button
              type="button"
              className="text-rose-500 text-lg px-1 leading-none"
              onClick={() => setItems((p) => p.filter((_, j) => j !== i))}
              title="삭제"
            >×</button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn-ghost text-[12px] mt-2"
        onClick={() => setItems((p) => [...p, { label: "", amount: 0 }])}
      >
        + 항목 추가
      </button>
    </div>
  );
}
