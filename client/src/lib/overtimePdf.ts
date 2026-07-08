/**
 * 야간근무(추가근무) 신청서 → PDF 다운로드 — 클라이언트 사이드.
 *
 * 결재(서명)용 오프라인 서식. payslipPdf.ts 와 동일 파이프라인:
 * 서식 HTML 을 화면 밖 컨테이너에 주입 → html2canvas 캔버스화 → jsPDF(A4) 저장.
 * 서버(Fargate)에 Chromium/한글 폰트를 올리지 않고 "화면 = PDF" 를 보장한다.
 *
 * 서식은 한국식 전자결재 출력물 표준 문법을 따른다:
 * 우상단 결재 3단 박스(신청/담당/승인 + 일자 행) · 제목 이중 괘선 ·
 * 외곽 2px/내부 1px 선 위계 · 하단 관용 문구·신청일·서명 밑줄·회사명.
 *
 * 주의: html2canvas 는 oklch/CSS 변수를 못 읽으므로 서식 CSS 는 전부 hex + 시스템 폰트.
 * 레이아웃은 table 기반(가장 캡처 안전) — flex/float/!important 사용 금지.
 * jspdf·html2canvas 는 무거우므로 동적 import — 버튼을 누를 때만 로드된다.
 */

import { downloadBlob } from "./download";
import { isCapacitorNative } from "./platform";
import { compensateCanvasTextBaseline } from "./canvasTextBaseline";

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
  /** 회사명 (멀티테넌트 — 목록 API 가 내려줌, 없으면 하단 사명 줄 생략) */
  companyName?: string | null;
  /** 함께 근무자 이름 목록 (선택) */
  companions?: string[] | null;
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

/** YYYY-MM-DD → "YYYY-MM-DD (요일)" — 서식 가독용 요일 부기 */
function fmtDateWithWeekday(ymd: string): string {
  ymd = (ymd || "").slice(0, 10); // 풀 ISO 가 와도 서식·파일명에 원시 노출 방지
  const d = new Date(ymd + "T00:00:00");
  if (Number.isNaN(d.getTime())) return ymd;
  return `${ymd} (${"일월화수목금토"[d.getDay()]})`;
}

/**
 * A4 @96dpi. 루트는 min-height 로 잡는다 — 계획내용이 아주 길면 시트가 늘어나
 * 2페이지로 흘러가고(내용 잘림 방지), 평소엔 정확히 1123px = A4 한 장.
 */
const A4_W = 794;
const A4_H = 1123;

/** 서식 CSS — hex 색상 + 시스템 폰트 + table 레이아웃만 (html2canvas 안전 패턴). */
const SHEET_CSS = `
.otsheet{box-sizing:border-box;width:${A4_W}px;min-height:${A4_H}px;background:#FFFFFF;padding:46px 54px 38px 54px;font-family:-apple-system,BlinkMacSystemFont,"Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#1F2329;}
.otsheet *{box-sizing:border-box;margin:0;padding:0;}
.otsheet table{border-collapse:collapse;width:100%;table-layout:fixed;}
.otsheet .ot-head td{vertical-align:top;}
.otsheet .ot-meta{font-size:11.5px;color:#8B9098;line-height:1.9;letter-spacing:0.5px;padding-top:2px;padding-right:20px;}
.otsheet .ot-meta .ot-meta-code{color:#6B7178;font-weight:600;}
.otsheet .ot-approve{width:300px;border:2px solid #1F1F1F;}
.otsheet .ot-approve th,.otsheet .ot-approve td{border:1px solid #9AA0A8;text-align:center;vertical-align:middle;}
.otsheet .ot-ap-side{width:32px;background:#F5F6F8;font-size:13px;font-weight:700;color:#3A3F46;line-height:2.1;letter-spacing:1px;}
.otsheet .ot-ap-title{height:30px;background:#F5F6F8;font-size:12.5px;font-weight:600;color:#3A3F46;letter-spacing:3px;text-indent:3px;}
.otsheet .ot-ap-sign{height:64px;font-size:11.5px;color:#C9CDD3;letter-spacing:1px;}
.otsheet .ot-ap-date{height:28px;font-size:10px;color:#B4B9C0;letter-spacing:1px;}
.otsheet .ot-title{margin-top:32px;text-align:center;font-size:30px;font-weight:700;letter-spacing:10px;text-indent:10px;color:#151719;line-height:44px;}
.otsheet .ot-rule-thick{margin-top:16px;border-top:3px solid #1F1F1F;height:0;}
.otsheet .ot-rule-thin{margin-top:3px;border-top:1px solid #1F1F1F;height:0;}
.otsheet .ot-info{margin-top:24px;border:2px solid #1F1F1F;}
.otsheet .ot-info th,.otsheet .ot-info td{border:1px solid #9AA0A8;height:46px;font-size:14px;vertical-align:middle;}
.otsheet .ot-info th{background:#F5F6F8;font-weight:600;color:#3A3F46;font-size:13px;letter-spacing:2px;text-align:center;}
.otsheet .ot-info td{padding:0 14px;color:#1F2329;letter-spacing:0.3px;}
.otsheet .ot-dim{color:#6B7178;font-weight:400;}
.otsheet .ot-strong{font-weight:700;}
.otsheet .ot-reason{margin-top:16px;border:2px solid #1F1F1F;}
.otsheet .ot-reason th,.otsheet .ot-reason td{border:1px solid #9AA0A8;}
.otsheet .ot-reason .ot-rh{height:40px;background:#F5F6F8;font-size:13.5px;font-weight:600;color:#3A3F46;letter-spacing:3px;text-align:left;padding:0 16px;vertical-align:middle;}
.otsheet .ot-reason .ot-rhint{background:#F5F6F8;font-size:11px;font-weight:400;color:#A6ADB6;letter-spacing:0.5px;text-align:right;padding:0 16px;vertical-align:middle;width:200px;}
.otsheet .ot-reason .ot-rb{height:304px;vertical-align:top;padding:18px 20px;font-size:14.5px;line-height:1.8;color:#1F2329;white-space:pre-wrap;word-break:break-word;}
.otsheet .ot-notes{margin-top:12px;font-size:11px;color:#6B7178;line-height:1.8;letter-spacing:0.2px;}
.otsheet .ot-closing{margin-top:26px;text-align:center;font-size:15.5px;letter-spacing:1px;color:#1F2329;line-height:26px;}
.otsheet .ot-date{margin-top:18px;text-align:center;font-size:14.5px;letter-spacing:2px;color:#1F2329;line-height:26px;}
.otsheet .ot-date .ot-dlabel{font-size:12.5px;color:#6B7178;letter-spacing:3px;margin-right:12px;}
.otsheet .ot-signer{margin-top:20px;text-align:right;padding-right:14px;font-size:15px;color:#1F2329;line-height:32px;}
.otsheet .ot-signer .ot-signer-name{display:inline-block;min-width:120px;text-align:center;font-weight:600;letter-spacing:2px;border-bottom:1px solid #1F2329;padding:0 10px 2px 10px;margin:0 8px;}
.otsheet .ot-signer .ot-signer-note{font-size:12.5px;color:#6B7178;}
.otsheet .ot-footer{margin-top:22px;border-top:1px solid #D8DBE0;padding-top:16px;text-align:center;}
.otsheet .ot-company{font-size:19px;font-weight:700;letter-spacing:8px;text-indent:8px;color:#3A3F46;min-height:28px;line-height:28px;}
`;

/* ===== 계획내용 줄 수 제한 =====
 * PDF 계획 박스(.ot-rb: 높이 330px 고정·A4 1페이지 유지)에 실제로 들어가는 줄 수만큼만
 * 입력을 허용하기 위한 실측 유틸. 하드코딩 대신 서식을 한 번 offscreen 렌더해
 * 박스의 내용 폭·행높이·수용 줄 수를 계산해 캐시하고(치수는 CSS 에서만 결정되므로 1회면 충분),
 * 이후엔 같은 폰트·폭의 측정 div 로 "자동 줄바꿈 포함" 실제 줄 수를 잰다. */
type PlanMetrics = { contentWidth: number; lineHeightPx: number; maxLines: number; font: string; letterSpacing: string };
let _planMetrics: PlanMetrics | null = null;

function getPlanMetrics(): PlanMetrics {
  if (_planMetrics) return _planMetrics;
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${A4_W}px;background:#ffffff;z-index:-1;`;
  host.innerHTML = overtimeSheetHTML({ name: "측정", date: "2026-01-01", extendedEnd: "2026-01-01T21:00:00+09:00", createdAt: "2026-01-01T09:00:00+09:00" });
  document.body.appendChild(host);
  const rb = host.querySelector<HTMLElement>(".ot-rb")!;
  const cs = getComputedStyle(rb);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const lineHeightPx = parseFloat(cs.lineHeight); // 14.5 × 1.8 = 26.1
  // clientHeight/clientWidth = 패딩 포함·보더 제외 → 내용 영역만 남긴다.
  const contentWidth = rb.clientWidth - padX;
  const maxLines = Math.max(1, Math.floor((rb.clientHeight - padY) / lineHeightPx));
  const m: PlanMetrics = { contentWidth, lineHeightPx, maxLines, font: cs.font, letterSpacing: cs.letterSpacing };
  host.remove();
  _planMetrics = m;
  return m;
}

/** 계획내용이 PDF 박스에서 차지할 실제 줄 수(자동 줄바꿈 포함)와 허용 최대 줄 수. */
export function measurePlanLines(text: string): { lines: number; maxLines: number } {
  const m = getPlanMetrics();
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;left:-10000px;top:0;width:${m.contentWidth}px;white-space:pre-wrap;word-break:break-word;visibility:hidden;`;
  probe.style.font = m.font;
  probe.style.letterSpacing = m.letterSpacing;
  probe.style.lineHeight = `${m.lineHeightPx}px`;
  probe.textContent = text || " ";
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return { lines: Math.max(1, Math.round(h / m.lineHeightPx)), maxLines: m.maxLines };
}

/** maxLines 를 넘는 입력을 "들어가는 만큼"으로 자름 — 이진 탐색으로 가장 긴 접두사. */
export function clampPlanText(text: string): string {
  const { maxLines } = measurePlanLines("");
  if (measurePlanLines(text).lines <= maxLines) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if (measurePlanLines(text.slice(0, mid)).lines <= maxLines) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo);
}

/** 신청서 마크업 — 결재란·제목 이중 괘선·정보표·계획내용·각주·서명·회사명. */
export function overtimeSheetHTML(d: OvertimeSheetData): string {
  return `
<style>${SHEET_CSS}</style>
<div class="otsheet">
  <table class="ot-head">
    <tr>
      <td>
        <div class="ot-meta">
          <span class="ot-meta-code">근태 서식 · HR-OT-01</span><br>
          ※ 본 서식은 소정근로시간 종료 이후의 야간·추가근무 사전 신청 서식입니다.<br>
          ※ 승인권자의 결재 완료 후 근무를 개시하여 주시기 바랍니다.
        </div>
      </td>
      <td style="width:300px;">
        <table class="ot-approve">
          <tr><td class="ot-ap-side" rowspan="3">결<br>재</td><th class="ot-ap-title">신 청</th><th class="ot-ap-title">대 표</th></tr>
          <tr><td class="ot-ap-sign">(인)</td><td class="ot-ap-sign">(인)</td></tr>
          <tr><td class="ot-ap-date">&nbsp;.&nbsp;&nbsp;.&nbsp;</td><td class="ot-ap-date">&nbsp;.&nbsp;&nbsp;.&nbsp;</td></tr>
        </table>
      </td>
    </tr>
  </table>

  <div class="ot-title">야간근무(추가근무) 신청서</div>
  <div class="ot-rule-thick"></div>
  <div class="ot-rule-thin"></div>

  <table class="ot-info">
    <colgroup><col style="width:86px"><col><col style="width:86px"><col><col style="width:86px"><col></colgroup>
    <tr>
      <th>성&nbsp;&nbsp;명</th><td>${esc(d.name)}</td>
      <th>부&nbsp;&nbsp;서</th><td>${esc(d.team || "-")}</td>
      <th>직&nbsp;&nbsp;급</th><td>${esc(d.position || "-")}</td>
    </tr>
    <tr>
      <th>근무 일자</th><td>${esc(fmtDateWithWeekday(d.date))}</td>
      <th>함께 근무</th><td colspan="3">${d.companions && d.companions.length ? esc(d.companions.join(", ")) : '<span class="ot-dim">—</span>'}</td>
    </tr>
    <tr>
      <th>근무 시간</th><td colspan="5"><span class="ot-dim">소정근로시간 종료 후 ~</span> <span class="ot-strong">${esc(fmtTimeHM(d.extendedEnd))}</span> <span class="ot-dim">까지 (휴게시간 제외)</span></td>
    </tr>
  </table>

  <table class="ot-reason">
    <tr><th class="ot-rh">계획 내용 (업무 내용)</th><th class="ot-rhint">수행 업무를 구체적으로 기재</th></tr>
    <tr><td class="ot-rb" colspan="2">${esc(d.reason || "")}</td></tr>
  </table>

  <div class="ot-notes">
    ※ 야간근무(추가근무) 시간은 소정근로시간 종료 후부터 산정합니다.<br>
    ※ 본 신청서는 승인권자의 결재 완료 후 효력이 발생하며, 결재 완료된 서식은 인사 담당 부서에서 보관합니다.
  </div>

  <div class="ot-closing">위와 같이 야간근무(추가근무)를 신청하오니 승인하여 주시기 바랍니다.</div>
  <div class="ot-date"><span class="ot-dlabel">신 청 일</span>${esc(fmtKoreanDate(d.createdAt))}</div>
  <div class="ot-signer">신청자 :<span class="ot-signer-name">${esc(d.name)}</span><span class="ot-signer-note">(서명 또는 인)</span></div>

  ${d.companyName ? `<div class="ot-footer"><div class="ot-company">${esc(d.companyName)}</div></div>` : ""}
</div>`;
}

/** 신청서를 A4 PDF 로 만들어 저장/공유. 파일명: 야간근무신청서_이름_날짜.pdf */
export async function downloadOvertimePdf(d: OvertimeSheetData): Promise<void> {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ]);

  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${A4_W}px;background:#ffffff;z-index:-1;`;
  host.innerHTML = overtimeSheetHTML(d);
  document.body.appendChild(host);

  try {
    // 기기 폰트 메트릭 차이로 시트가 A4(1123px)에서 몇 px 넘치면 자투리 페이지가
    // 생긴다 — 캡처 전에 높이를 A4 정수 배로 스냅해 항상 "정확히 N장"을 보장.
    // (8px 이하 초과는 하단 여백 몇 px 을 접는 것이라 내용 손실 없음)
    const sheet = host.querySelector<HTMLElement>(".otsheet");
    if (sheet) {
      const pages = Math.max(1, Math.ceil((sheet.scrollHeight - 8) / A4_H));
      sheet.style.minHeight = "0";
      sheet.style.height = `${pages * A4_H}px`;
      sheet.style.overflow = "hidden";
    }

    // html2canvas 는 텍스트 baseline 을 아래로 그려 셀 글자가 처져 보인다(#1097) —
    // 현 환경 편차를 프로브로 실측해 텍스트 노드별로 역보정(편차 없으면 no-op).
    await (document as any).fonts?.ready?.catch?.(() => {});
    await compensateCanvasTextBaseline(html2canvas as any, host);

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

    // 794:1123 은 210:297 과 소수점 오차가 있어(≈0.02mm) 순수 >0 비교면
    // 내용 없는 빈 2페이지가 생긴다 — 2mm 이하 잔여는 같은 페이지로 취급.
    const EPS = 2;
    let heightLeft = imgH;
    let position = 0;
    pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH);
    heightLeft -= pageH;
    while (heightLeft > EPS) {
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
