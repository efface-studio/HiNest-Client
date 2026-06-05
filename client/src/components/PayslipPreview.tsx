import { useState } from "react";
import { useModalDismiss } from "../lib/useModalDismiss";
import Portal from "./Portal";
import {
  type Payslip,
  attendanceEntries,
  won,
  openPayslipPrint,
  DEFAULT_COMPANY,
} from "../lib/payslip";

/**
 * 급여명세서 미리보기(읽기 전용) 모달 — 회사 양식 그대로 렌더.
 * 관리자/직원 공용. onEdit 가 있으면 "수정" 버튼 노출(관리자 전용).
 * "PDF/인쇄" 는 동일 마크업의 standalone HTML 을 새 창에 띄워 브라우저 인쇄로 PDF 화.
 */
export default function PayslipPreview({
  payslip,
  onClose,
  onEdit,
  onSend,
}: {
  payslip: Payslip;
  onClose: () => void;
  onEdit?: () => void;
  /** 관리자 전용 — 직원 계정 이메일로 PDF 발송. await 동안 버튼이 "발송 중…". */
  onSend?: () => Promise<void> | void;
}) {
  useModalDismiss(true, onClose);
  const [sending, setSending] = useState(false);
  const p = payslip;

  async function handleSend() {
    if (!onSend || sending) return;
    setSending(true);
    try {
      await onSend();
    } finally {
      setSending(false);
    }
  }
  const rows = Math.max(p.earnings.length, p.deductions.length);
  const att = attendanceEntries(p.attendance);
  const calc = p.calcRows ?? [];

  return (
    <Portal>
    <div
      className="fixed inset-0 bg-slate-900/50 grid place-items-center modal-safe z-50"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">급여명세서 미리보기</h3>
          <div className="flex items-center gap-2">
            {onEdit && (
              <button className="btn-ghost text-[13px]" onClick={onEdit}>
                수정
              </button>
            )}
            {onSend && (
              <button
                className="btn-ghost text-[13px] text-brand-600 disabled:opacity-50"
                onClick={handleSend}
                disabled={sending}
              >
                {sending ? "발송 중…" : (p.sentAt ? "재발송" : "메일 발송")}
              </button>
            )}
            <button className="btn-ghost text-[13px]" onClick={() => openPayslipPrint(p)}>
              PDF · 인쇄
            </button>
            <button className="btn-ghost text-[13px]" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>

        {/* 양식 본문 */}
        <div className="border border-ink-200 rounded-xl p-5 bg-white text-ink-900">
          <h2 className="text-center text-[17px] font-extrabold tracking-tight">
            {p.year}년 {String(p.month).padStart(2, "0")}월분 임금명세서
          </h2>
          <div className="text-center text-[12px] text-ink-500 mb-4">
            {p.companyName || DEFAULT_COMPANY}
          </div>

          {/* 인적사항 */}
          <table className="w-full border-collapse text-[12.5px]">
            <tbody>
              <Row
                cells={[
                  ["성명", p.employeeName],
                  ["생년월일(사번)", p.idNumber || "-"],
                ]}
              />
              <Row
                cells={[
                  ["부서", p.department || "-"],
                  ["직위", p.position || "-"],
                ]}
              />
              <Row
                cells={[
                  ["입사일", p.joinDate || "-"],
                  ["지급일", p.payDate || "-"],
                ]}
              />
            </tbody>
          </table>

          {/* 지급/공제 */}
          <table className="w-full border-collapse text-[12.5px] mt-3">
            <thead>
              <tr>
                <th className="border border-ink-200 bg-ink-100 py-1.5" colSpan={2}>지급</th>
                <th className="border border-ink-200 bg-ink-100 py-1.5" colSpan={2}>공제</th>
              </tr>
              <tr className="text-center">
                <th className="border border-ink-200 bg-slate-50 py-1.5 font-semibold w-1/4">임금항목</th>
                <th className="border border-ink-200 bg-slate-50 py-1.5 font-semibold w-1/4">지급금액</th>
                <th className="border border-ink-200 bg-slate-50 py-1.5 font-semibold w-1/4">공제항목</th>
                <th className="border border-ink-200 bg-slate-50 py-1.5 font-semibold w-1/4">공제금액</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }).map((_, i) => {
                const e = p.earnings[i];
                const d = p.deductions[i];
                return (
                  <tr key={i}>
                    <td className="border border-ink-200 bg-slate-50/60 px-2.5 py-1.5 font-medium">{e?.label ?? ""}</td>
                    <td className="border border-ink-200 px-2.5 py-1.5 text-right tabular">{e ? won(e.amount) : ""}</td>
                    <td className="border border-ink-200 bg-slate-50/60 px-2.5 py-1.5 font-medium">{d?.label ?? ""}</td>
                    <td className="border border-ink-200 px-2.5 py-1.5 text-right tabular">{d ? won(d.amount) : ""}</td>
                  </tr>
                );
              })}
              <tr className="font-extrabold">
                <td className="border border-ink-200 bg-ink-100 px-2.5 py-1.5">지급액 계</td>
                <td className="border border-ink-200 bg-ink-100 px-2.5 py-1.5 text-right tabular">{won(p.totalEarnings)}</td>
                <td className="border border-ink-200 bg-ink-100 px-2.5 py-1.5">공제액 계</td>
                <td className="border border-ink-200 bg-ink-100 px-2.5 py-1.5 text-right tabular">{won(p.totalDeductions)}</td>
              </tr>
            </tbody>
          </table>

          {/* 실수령액 */}
          <div className="mt-3 flex items-center justify-between border-2 border-ink-600 rounded-lg px-4 py-3">
            <span className="text-[14px] font-extrabold">실수령액</span>
            <span className="text-[20px] font-extrabold tabular">{won(p.netPay)}</span>
          </div>

          {/* 근태 */}
          {att.length > 0 && (
            <table className="w-full border-collapse text-[12px] mt-3.5">
              <thead>
                <tr>
                  <th className="border border-ink-200 bg-ink-100 py-1.5" colSpan={att.length}>근태 정보</th>
                </tr>
                <tr className="text-center">
                  {att.map((a) => (
                    <td key={a.label} className="border border-ink-200 bg-slate-50 py-1.5 font-semibold">{a.label}</td>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="text-center">
                  {att.map((a) => (
                    <td key={a.label} className="border border-ink-200 py-1.5 tabular">{a.value}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          )}

          {/* 계산방법 */}
          {calc.length > 0 && (
            <table className="w-full border-collapse text-[12px] mt-3.5">
              <thead>
                <tr>
                  <th className="border border-ink-200 bg-ink-100 py-1.5" colSpan={3}>계산 방법</th>
                </tr>
                <tr className="text-center">
                  <td className="border border-ink-200 bg-slate-50 py-1.5 font-semibold w-[28%]">항목</td>
                  <td className="border border-ink-200 bg-slate-50 py-1.5 font-semibold">산출식</td>
                  <td className="border border-ink-200 bg-slate-50 py-1.5 font-semibold w-[24%]">금액</td>
                </tr>
              </thead>
              <tbody>
                {calc.map((c, i) => (
                  <tr key={i}>
                    <td className="border border-ink-200 bg-slate-50/60 px-2.5 py-1.5 font-medium">{c.item}</td>
                    <td className="border border-ink-200 px-2.5 py-1.5">{c.formula}</td>
                    <td className="border border-ink-200 px-2.5 py-1.5 text-right tabular">{won(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {p.memo && <div className="text-center text-[13px] text-ink-700 mt-4">{p.memo}</div>}
          <div className="text-center text-[13px] font-bold mt-5">{p.companyName || DEFAULT_COMPANY}</div>
        </div>

        {p.sentAt && (
          <div className="text-[11.5px] text-ink-500 mt-3 text-right">
            발송됨 · {new Date(p.sentAt).toLocaleString("ko-KR")}
            {p.sentTo ? ` · ${p.sentTo}` : ""}
          </div>
        )}
      </div>
    </div>
    </Portal>
  );
}

/** 인적사항 2열(라벨+값) 행. */
function Row({ cells }: { cells: [string, string][] }) {
  return (
    <tr>
      {cells.map(([k, v], i) => (
        <Cell key={i} k={k} v={v} />
      ))}
    </tr>
  );
}
function Cell({ k, v }: { k: string; v: string }) {
  return (
    <>
      <td className="border border-ink-200 bg-slate-50 px-2.5 py-1.5 font-semibold w-[18%]">{k}</td>
      <td className="border border-ink-200 px-2.5 py-1.5 w-[32%]">{v}</td>
    </>
  );
}
