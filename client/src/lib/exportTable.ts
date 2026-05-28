/**
 * 테이블 데이터 내보내기 유틸.
 *
 * - CSV: UTF-8 BOM 붙여 엑셀에서 한글 깨짐 방지.
 * - XLSX: SheetJS(xlsx) 로 진짜 .xlsx 파일 생성.
 * - PDF: 브라우저 `window.print()` 를 새 창으로 띄워 "PDF 로 저장" 옵션 제공.
 */

import { downloadBlob } from "./download";

// xlsx-js-style: xlsx(SheetJS CE) 의 drop-in 포크. 셀 스타일(채우기/테두리/폰트) 쓰기 지원.
// 약 470KB — 관리자 페이지 외에선 거의 안 쓰므로 동적 import 로 초기 번들에서 제외.
let _xlsxPromise: Promise<typeof import("xlsx-js-style")> | null = null;
async function loadXLSX() {
  if (!_xlsxPromise) _xlsxPromise = import("xlsx-js-style");
  return _xlsxPromise;
}

export type TableColumn<T> = {
  header: string;
  /** 행에서 값을 추출. undefined/null 은 빈 문자열로. */
  get: (row: T) => string | number | null | undefined;
};

/** 엑셀/CSV 파일을 파싱해 {헤더→값} 객체 배열로 변환. */
export async function parseSheet(file: File): Promise<Record<string, string>[]> {
  const XLSX = await loadXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  // defval 로 빈 셀도 포함, raw:false 로 날짜를 문자열로 내려받음
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "", raw: false });
  return rows.map((r) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) {
      out[String(k).trim()] = v == null ? "" : String(v).trim();
    }
    return out;
  });
}

/**
 * 진짜 .xlsx 파일로 저장. 한글/숫자/날짜 모두 엑셀에서 바로 열림.
 * 스타일링 — 헤더는 굵게+연한 블루 배경+가운데정렬, 본문 전 셀은 얇은 테두리로 격자.
 */
export async function downloadXLSX<T>(
  filename: string,
  rows: T[],
  columns: TableColumn<T>[],
  sheetName = "Sheet1"
) {
  const XLSX = await loadXLSX();
  const aoa: (string | number)[][] = [
    columns.map((c) => c.header),
    ...rows.map((r) =>
      columns.map((c) => {
        const v = c.get(r);
        if (v == null) return "";
        return typeof v === "number" ? v : String(v);
      })
    ),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // 스타일 정의
  const thin = { style: "thin", color: { rgb: "8A8A8A" } } as const;
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  const headerStyle = {
    fill: { patternType: "solid", fgColor: { rgb: "D9E1F2" } }, // 연한 블루
    font: { bold: true, sz: 11, color: { rgb: "1F2937" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: false },
    border: {
      top: { style: "medium", color: { rgb: "4B5563" } },
      bottom: { style: "medium", color: { rgb: "4B5563" } },
      left: thin,
      right: thin,
    },
  };
  const bodyStyle = {
    font: { sz: 10, color: { rgb: "1F2937" } },
    alignment: { vertical: "center", wrapText: false },
    border,
  };

  // 모든 셀에 스타일 적용 — 헤더 행(0)은 headerStyle, 본문은 bodyStyle
  const nRows = aoa.length;
  const nCols = columns.length;
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { t: "s", v: "" };
      ws[addr].s = r === 0 ? headerStyle : bodyStyle;
    }
  }

  // 각 컬럼 너비를 헤더/값 길이 기준으로 자동 조정 — 엑셀 기본보다 보기 편함.
  ws["!cols"] = columns.map((c) => {
    const maxLen = Math.max(
      String(c.header).length,
      ...rows.map((r) => String(c.get(r) ?? "").length)
    );
    // 한글은 폭이 영문의 약 2배이므로 약간 여유 있게.
    return { wch: Math.min(Math.max(maxLen + 3, 10), 40) };
  });
  // 헤더 행 높이 — bold + 중앙정렬이 답답하지 않게.
  ws["!rows"] = [{ hpt: 22 }];
  // 첫 행 고정 — 스크롤해도 헤더가 보이게.
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  (ws as any)["!views"] = [{ state: "frozen", ySplit: 1 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)); // 시트명 31자 제한
  const name = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  XLSX.writeFile(wb, name);
}

function toCsvField(v: unknown): string {
  const s = v == null ? "" : String(v);
  // "," | "\"" | 개행 포함 시 따옴표 감싸고 내부 `"` 두 번.
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadCSV<T>(filename: string, rows: T[], columns: TableColumn<T>[]) {
  const header = columns.map((c) => toCsvField(c.header)).join(",");
  const body = rows
    .map((r) => columns.map((c) => toCsvField(c.get(r))).join(","))
    .join("\r\n");
  // UTF-8 BOM — Excel 이 utf-8 로 읽도록 힌트
  const csv = "\uFEFF" + header + "\r\n" + body;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

/**
 * PDF 저장용 인쇄창 — 서식 있는 HTML 을 새 창에 쓰고 print() 호출.
 * 브라우저의 "대상: PDF 로 저장" 을 쓰면 PDF 파일이 됨.
 */
export function openPrintable<T>(
  title: string,
  rows: T[],
  columns: TableColumn<T>[],
  meta?: { subtitle?: string; generatedAt?: Date }
) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) {
    // 동적 import 로 순환 의존성 피함 (ConfirmHost 는 React 컴포넌트).
    import("../components/ConfirmHost").then(({ alertAsync }) => {
      alertAsync({ title: "팝업 차단", description: "팝업이 차단되었어요. 팝업 허용 후 다시 시도해주세요." });
    });
    return;
  }
  const now = meta?.generatedAt ?? new Date();
  const esc = (s: unknown) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const thead = columns.map((c) => `<th>${esc(c.header)}</th>`).join("");
  const tbody = rows
    .map(
      (r) =>
        `<tr>${columns
          .map((c) => `<td>${esc(c.get(r) ?? "")}</td>`)
          .join("")}</tr>`
    )
    .join("");

  w.document.write(`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Segoe UI", sans-serif; color: #1F2937; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #6B7280; font-size: 11px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #E5E7EB; text-align: left; }
  th { background: #F9FAFB; font-weight: 700; }
  tr:nth-child(even) td { background: #FAFBFC; }
  @media print {
    body { margin: 12mm; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <div class="meta">
    ${meta?.subtitle ? `${esc(meta.subtitle)} · ` : ""}생성: ${now.toLocaleString("ko-KR")} · ${rows.length}건
  </div>
  <table>
    <thead><tr>${thead}</tr></thead>
    <tbody>${tbody}</tbody>
  </table>
  <script>
    window.onload = function () {
      setTimeout(function () { window.focus(); window.print(); }, 100);
    };
  </script>
</body>
</html>`);
  w.document.close();
}
