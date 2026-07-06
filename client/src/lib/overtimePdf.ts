/**
 * 야간근무(추가근무) 신청서 → PDF 다운로드 — 클라이언트 사이드.
 *
 * 결재(서명)용 오프라인 서식. payslipPdf.ts 와 동일 파이프라인:
 * 서식 HTML 을 화면 밖 컨테이너에 주입 → html2canvas 캔버스화 → jsPDF(A4) 저장.
 * 서버(Fargate)에 Chromium/한글 폰트를 올리지 않고 "화면 = PDF" 를 보장한다.
 *
 * 주의: html2canvas 는 oklch/CSS 변수를 못 읽으므로 서식 CSS 는 전부 hex + 시스템 폰트.
 * jspdf·html2canvas 는 무거우므로 동적 import — 버튼을 누를 때만 로드된다.
 */

import { downloadBlob } from "./download";
import { isCapacitorNative } from "./platform";

export type OvertimeSheetData = {
  /** 신청자명 */
  name: string;
  /** 신청자 부서 (없으면 "-") */
  team?: string | null;
  /** 신청자 직급 (없으면 "-") */
  position?: string | null;
  /** 야근 날짜 YYYY-MM-DD */
  date: string;
  /** 연장 종료시각 ISO */
  extendedEnd: string;
  /** 계획내용(사유) */
  reason?: string | null;
  /** 신청일 ISO (createdAt) */
  createdAt: string;
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtKoreanDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}년 ${String(d.getMonth() + 1).padStart(2, "0")}월 ${String(d.getDate()).padStart(2, "0")}일`;
}

function fmtTimeHM(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** 서식 CSS — hex 색상 + 시스템 폰트만(html2canvas 호환). 급여명세서 .psheet 톤 미러. */
const SHEET_CSS = `
.otsheet { font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Segoe UI", sans-serif; color: #1F2937; background: #FFFFFF; padding: 48px 44px; box-sizing: border-box; }
.otsheet * { box-sizing: border-box; }
.otsheet h1 { font-size: 24px; text-align: center; margin: 0 0 34px; letter-spacing: 0.35em; font-weight: 800; }
.otsheet table.form { width: 100%; border-collapse: collapse; table-layout: fixed; }
.otsheet table.form th, .otsheet table.form td { border: 1.5px solid #374151; padding: 12px 14px; font-size: 13.5px; vertical-align: top; }
.otsheet table.form th { background: #F3F4F6; font-weight: 700; text-align: center; width: 128px; letter-spacing: 0.06em; }
.otsheet table.form td { text-align: left; }
.otsheet td.plan { height: 240px; line-height: 1.75; white-space: pre-wrap; word-break: break-word; }
.otsheet .footer { margin-top: 44px; text-align: center; }
.otsheet .footer .date { font-size: 14px; font-weight: 600; margin-bottom: 40px; letter-spacing: 0.08em; }
.otsheet .signs { display: flex; justify-content: flex-end; gap: 56px; padding-right: 8px; }
.otsheet .sign { font-size: 13.5px; font-weight: 600; }
.otsheet .sign .line { display: inline-block; width: 130px; border-bottom: 1.5px solid #374151; margin: 0 8px; height: 18px; vertical-align: bottom; text-align: center; font-weight: 500; }
`;

/** 신청서 마크업 — 상단 타이틀 · 본문 표 · 하단 날짜/서명란. */
export function overtimeSheetHTML(d: OvertimeSheetData): string {
  const hours = `${d.date} · 퇴근시각 이후 ~ ${fmtTimeHM(d.extendedEnd)} 까지`;
  return `
<style>${SHEET_CSS}</style>
<div class="otsheet">
  <h1>야간근무(추가근무) 신청서</h1>
  <table class="form">
    <tr>
      <th>신 청 자 명</th><td>${esc(d.name)}</td>
      <th>부&nbsp;&nbsp;&nbsp;&nbsp;서</th><td>${esc(d.team || "-")}</td>
    </tr>
    <tr>
      <th>직&nbsp;&nbsp;&nbsp;&nbsp;급</th><td>${esc(d.position || "-")}</td>
      <th>추가근무 시간</th><td>${esc(hours)}</td>
    </tr>
    <tr>
      <th>계 획 내 용</th>
      <td class="plan" colspan="3">${esc(d.reason || "")}</td>
    </tr>
  </table>
  <div class="footer">
    <div class="date">${fmtKoreanDate(d.createdAt)}</div>
    <div class="signs">
      <div class="sign">신청자 : <span class="line">${esc(d.name)}</span> (서명)</div>
      <div class="sign">담당자 : <span class="line"></span> (서명)</div>
    </div>
  </div>
</div>`;
}

/** 화면 밖 렌더 폭(px) — A4 비율 기준. */
const RENDER_WIDTH = 794;

/** 신청서를 A4 PDF 로 만들어 즉시 다운로드. 파일명: 야간근무신청서_이름_날짜.pdf */
export async function downloadOvertimePdf(d: OvertimeSheetData): Promise<void> {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ]);

  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${RENDER_WIDTH}px;background:#ffffff;z-index:-1;`;
  host.innerHTML = overtimeSheetHTML(d);
  document.body.appendChild(host);

  try {
    const canvas = await html2canvas(host, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
    });
    if (!canvas.width || !canvas.height) throw new Error("신청서 캡처에 실패했어요");

    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = pdf.internal.pageSize.getWidth(); // 210
    const pageH = pdf.internal.pageSize.getHeight(); // 297
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;
    const imgData = canvas.toDataURL("image/jpeg", 0.92);

    // 서식은 보통 1페이지지만, 계획내용이 길어지면 페이지를 나눈다(payslipPdf 동일 슬라이스).
    let heightLeft = imgH;
    let position = 0;
    pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH);
    heightLeft -= pageH;
    while (heightLeft > 0) {
      pdf.addPage();
      position -= pageH;
      pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH);
      heightLeft -= pageH;
    }

    const filename = `야간근무신청서_${d.name}_${d.date}.pdf`;
    const blob: Blob = pdf.output("blob");

    // 네이티브(WKWebView)는 <a download>/blob: URL 저장이 안 됨 → iOS 공유 시트로 전달
    // (파일 저장·인쇄·메신저 전송 모두 가능). 웹/데스크탑은 일반 다운로드.
    if (isCapacitorNative() && typeof navigator.share === "function") {
      const file = new File([blob], filename, { type: "application/pdf" });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
        } catch {
          /* 사용자가 공유 시트를 닫은 경우 — 정상 종료 */
        }
        return;
      }
    }
    downloadBlob(blob, filename);
  } finally {
    document.body.removeChild(host);
  }
}
