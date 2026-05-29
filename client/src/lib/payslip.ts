/**
 * 급여(임금)명세서 공용 타입·유틸.
 *
 * - 서버 모델(Payslip)과 1:1로 맞춘 클라 타입.
 * - 합계 계산·금액 포맷·회사 양식 기본 항목(라벨만!) 상수.
 * - 인쇄/PDF 용 standalone HTML 생성기 — 미리보기·발송에서 공용.
 *
 * 주의: 회사 양식의 "실제 급여액"은 절대 코드에 넣지 않는다. 항목 라벨 골격만 제공하고
 * 금액은 항상 관리자가 입력한 값/서버 저장값을 쓴다.
 */

export type LineItem = { label: string; amount: number };

export type Attendance = {
  workDays?: number;
  totalHours?: number;
  overtimeHours?: number;
  nightHours?: number;
  holidayHours?: number;
  hourlyWage?: number;
  familyCount?: number;
};

export type CalcRow = { item: string; formula: string; amount: number };

export type Payslip = {
  id: string;
  year: number;
  month: number;
  employeeId: string;
  companyName: string;
  employeeName: string;
  department?: string | null;
  position?: string | null;
  joinDate?: string | null;
  payDate?: string | null;
  idNumber?: string | null;
  earnings: LineItem[];
  deductions: LineItem[];
  attendance?: Attendance | null;
  calcRows?: CalcRow[] | null;
  memo?: string | null;
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
  sentAt?: string | null;
  sentTo?: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  employee?: {
    id: string;
    name: string;
    email: string;
    team?: string | null;
    position?: string | null;
  };
};

export type EmployeeOption = {
  id: string;
  name: string;
  email: string;
  position?: string | null;
  team?: string | null;
  department?: string | null;
  employeeNo?: string | null;
  hireDate?: string | null;
  birthDate?: string | null;
};

export const DEFAULT_COMPANY = "주식회사 하이비츠";
export const DEFAULT_MEMO = "귀하의 노고에 감사드립니다.";

// 회사 양식 기본 지급/공제 항목 — 라벨(골격)만. 금액은 전부 0으로 시작.
export const DEFAULT_EARNING_LABELS = [
  "기본급",
  "상여",
  "직책수당",
  "월차수당",
  "식대",
  "자가운전보조금",
  "야간근로수당",
  "연장근로수당",
];
export const DEFAULT_DEDUCTION_LABELS = [
  "국민연금",
  "건강보험",
  "장기요양보험",
  "고용보험",
  "건강보험정산",
  "장기요양보험정산",
  "소득세",
  "지방소득세",
  "농특세",
];

export function blankEarnings(): LineItem[] {
  return DEFAULT_EARNING_LABELS.map((label) => ({ label, amount: 0 }));
}
export function blankDeductions(): LineItem[] {
  return DEFAULT_DEDUCTION_LABELS.map((label) => ({ label, amount: 0 }));
}

export function sumAmount(items: LineItem[] | undefined | null): number {
  if (!items) return 0;
  return items.reduce((s, x) => s + (Number(x.amount) || 0), 0);
}

/** 1,234,567원 */
export function won(n: number | undefined | null): string {
  return `${(Number(n) || 0).toLocaleString("ko-KR")}원`;
}

const ATTENDANCE_LABELS: { key: keyof Attendance; label: string; unit: string }[] = [
  { key: "workDays", label: "근로일수", unit: "일" },
  { key: "totalHours", label: "총 근로시간", unit: "시간" },
  { key: "overtimeHours", label: "연장 근로시간", unit: "시간" },
  { key: "nightHours", label: "야간 근로시간", unit: "시간" },
  { key: "holidayHours", label: "휴일 근로시간", unit: "시간" },
  { key: "hourlyWage", label: "통상시급", unit: "원" },
  { key: "familyCount", label: "부양가족수", unit: "명" },
];

export function attendanceEntries(a?: Attendance | null): { label: string; value: string }[] {
  if (!a) return [];
  const out: { label: string; value: string }[] = [];
  for (const { key, label, unit } of ATTENDANCE_LABELS) {
    const v = a[key];
    if (v === undefined || v === null || (typeof v === "number" && Number.isNaN(v))) continue;
    const val = unit === "원" ? (Number(v) || 0).toLocaleString("ko-KR") : String(v);
    out.push({ label, value: `${val}${unit}` });
  }
  return out;
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 명세서 양식 CSS — 전부 .psheet 로 스코프. 일반 hex 색상 + 시스템 폰트만 사용해
// html2canvas(PDF 변환) 가 modern color(oklch 등) 파싱에서 깨지지 않도록 한다.
const SHEET_CSS = `
.psheet, .psheet * { box-sizing: border-box; }
.psheet { font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Segoe UI", sans-serif; color: #1F2937; background: #FFFFFF; padding: 24px; }
.psheet .doc { max-width: 720px; margin: 0 auto; }
.psheet h1 { font-size: 20px; text-align: center; margin: 0 0 4px; letter-spacing: -0.01em; }
.psheet .sub { text-align: center; color: #6B7280; font-size: 12px; margin-bottom: 18px; }
.psheet table { width: 100%; border-collapse: collapse; }
.psheet .grid td, .psheet .grid th { border: 1px solid #C9CDD2; padding: 7px 10px; font-size: 12.5px; }
.psheet .grid th { background: #EEF2F7; font-weight: 700; text-align: center; }
.psheet .lbl { background: #F8FAFC; font-weight: 600; }
.psheet .amt { text-align: right; }
.psheet .c { text-align: center; }
.psheet .mt { margin-top: 14px; }
.psheet .total td { font-weight: 800; background: #EEF2F7; }
.psheet .net { margin-top: 12px; border: 2px solid #4B5563; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; border-radius: 4px; }
.psheet .net .k { font-size: 14px; font-weight: 800; }
.psheet .net .v { font-size: 20px; font-weight: 800; }
.psheet .memo { margin-top: 18px; text-align: center; font-size: 13px; color: #374151; }
.psheet .foot { margin-top: 22px; text-align: center; font-size: 13px; font-weight: 700; }
`;

/** 명세서 본문 마크업(.psheet 래퍼). <style> 없이 DOM 조각만. */
function payslipSheetMarkup(p: Payslip): string {
  const rows = Math.max(p.earnings.length, p.deductions.length);
  const itemRows: string[] = [];
  for (let i = 0; i < rows; i++) {
    const e = p.earnings[i];
    const d = p.deductions[i];
    itemRows.push(
      `<tr><td class="lbl">${e ? esc(e.label) : ""}</td><td class="amt">${e ? won(e.amount) : ""}</td><td class="lbl">${d ? esc(d.label) : ""}</td><td class="amt">${d ? won(d.amount) : ""}</td></tr>`,
    );
  }

  const att = attendanceEntries(p.attendance);
  const attBlock = att.length
    ? `<table class="grid mt">
        <tr><th colspan="${att.length}">근태 정보</th></tr>
        <tr>${att.map((a) => `<td class="lbl c">${esc(a.label)}</td>`).join("")}</tr>
        <tr>${att.map((a) => `<td class="amt c">${esc(a.value)}</td>`).join("")}</tr>
      </table>`
    : "";

  const calc = p.calcRows ?? [];
  const calcBlock = calc.length
    ? `<table class="grid mt">
        <tr><th colspan="3">계산 방법</th></tr>
        <tr><td class="lbl c" style="width:28%">항목</td><td class="lbl c">산출식</td><td class="amt c" style="width:24%">금액</td></tr>
        ${calc
          .map(
            (c) =>
              `<tr><td class="lbl">${esc(c.item)}</td><td class="lbl">${esc(c.formula)}</td><td class="amt">${won(c.amount)}</td></tr>`,
          )
          .join("")}
      </table>`
    : "";

  return `<div class="psheet"><div class="doc">
    <h1>${esc(p.year)}년 ${String(p.month).padStart(2, "0")}월분 임금명세서</h1>
    <div class="sub">${esc(p.companyName || DEFAULT_COMPANY)}</div>
    <table class="grid">
      <tr>
        <td class="lbl" style="width:18%">성명</td><td style="width:32%">${esc(p.employeeName)}</td>
        <td class="lbl" style="width:18%">생년월일(사번)</td><td style="width:32%">${esc(p.idNumber || "-")}</td>
      </tr>
      <tr>
        <td class="lbl">부서</td><td>${esc(p.department || "-")}</td>
        <td class="lbl">직위</td><td>${esc(p.position || "-")}</td>
      </tr>
      <tr>
        <td class="lbl">입사일</td><td>${esc(p.joinDate || "-")}</td>
        <td class="lbl">지급일</td><td>${esc(p.payDate || "-")}</td>
      </tr>
    </table>
    <table class="grid mt">
      <tr><th colspan="2">지급</th><th colspan="2">공제</th></tr>
      <tr>
        <td class="lbl c" style="width:25%">임금항목</td><td class="lbl c" style="width:25%">지급금액</td>
        <td class="lbl c" style="width:25%">공제항목</td><td class="lbl c" style="width:25%">공제금액</td>
      </tr>
      ${itemRows.join("")}
      <tr class="total">
        <td>지급액 계</td><td class="amt">${won(p.totalEarnings)}</td>
        <td>공제액 계</td><td class="amt">${won(p.totalDeductions)}</td>
      </tr>
    </table>
    <div class="net"><span class="k">실수령액</span><span class="v">${won(p.netPay)}</span></div>
    ${attBlock}
    ${calcBlock}
    ${p.memo ? `<div class="memo">${esc(p.memo)}</div>` : ""}
    <div class="foot">${esc(p.companyName || DEFAULT_COMPANY)}</div>
  </div></div>`;
}

/** <style> + 본문 마크업. 오프스크린 컨테이너(PDF 변환) 에 그대로 주입 가능. */
export function payslipInnerHTML(p: Payslip): string {
  return `<style>${SHEET_CSS}</style>${payslipSheetMarkup(p)}`;
}

/**
 * 인쇄/PDF 저장용 standalone HTML 문서. 한국 임금명세서 양식을 충실히 렌더.
 * 브라우저 "대상: PDF 로 저장" 으로 PDF 화.
 */
export function payslipPrintHTML(p: Payslip): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${esc(p.year)}년 ${esc(p.month)}월 임금명세서 - ${esc(p.employeeName)}</title>
<style>html,body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;}@media print{.psheet{padding:12mm;}.psheet .doc{max-width:none;}}</style>
</head>
<body>
  ${payslipInnerHTML(p)}
  <script>window.onload=function(){setTimeout(function(){window.focus();window.print();},120);};</script>
</body>
</html>`;
}

/** 새 창에 인쇄용 HTML 을 띄우고 print() 호출 — 브라우저 PDF 저장으로 PDF 화. */
export function openPayslipPrint(p: Payslip): void {
  const w = window.open("", "_blank", "width=820,height=900");
  if (!w) {
    import("../components/ConfirmHost").then(({ alertAsync }) => {
      alertAsync({ title: "팝업 차단", description: "팝업이 차단되었어요. 팝업 허용 후 다시 시도해주세요." });
    });
    return;
  }
  w.document.write(payslipPrintHTML(p));
  w.document.close();
}
