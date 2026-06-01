/**
 * 급여명세서 → PDF(base64) 변환 — 클라이언트 사이드.
 *
 * payslipInnerHTML(p) 로 만든 .psheet 마크업을 화면 밖 컨테이너에 주입하고,
 * html2canvas 로 캔버스화 → jsPDF(A4) 에 이미지로 얹어 base64 로 돌려준다.
 * 서버로 보내 SES 첨부 메일로 발송하는 데 쓴다.
 *
 * 왜 클라에서 PDF 를 만드나:
 *   서버(Fargate)에 Chromium/한글 폰트를 올리지 않으려고. 미리보기와 동일한
 *   payslipInnerHTML 을 그대로 재사용하므로 "화면 = PDF" 가 보장된다.
 *
 * 주의: html2canvas 는 oklch/CSS 변수 등 최신 색상 함수를 못 읽어 깨진다.
 *   그래서 SHEET_CSS 는 전부 hex 색상 + 시스템 폰트만 쓴다(payslip.ts 참고).
 *
 * jspdf·html2canvas 는 무거우므로 동적 import — 이 함수를 호출할 때만 로드된다.
 */
import type { Payslip } from "./payslip";
import { payslipInnerHTML } from "./payslip";

/** 화면 밖 렌더 컨테이너 폭(px). .psheet .doc 의 max-width(720) + 좌우 여유. */
const RENDER_WIDTH = 760;

/**
 * 명세서를 A4 PDF 로 만들어 순수 base64(데이터 URI 접두어 없음) 로 반환.
 * 내용이 한 페이지를 넘으면 자동으로 페이지를 나눈다.
 */
export async function payslipToPdfBase64(p: Payslip): Promise<string> {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ]);

  // 화면 밖(왼쪽 -10000px)에 컨테이너를 띄워 캡처 — 사용자에겐 안 보인다.
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${RENDER_WIDTH}px;background:#ffffff;z-index:-1;`;
  host.innerHTML = payslipInnerHTML(p);
  document.body.appendChild(host);

  try {
    const canvas = await html2canvas(host, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
    });
    if (!canvas.width || !canvas.height) {
      throw new Error("명세서 캡처에 실패했어요");
    }

    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = pdf.internal.pageSize.getWidth(); // 210
    const pageH = pdf.internal.pageSize.getHeight(); // 297
    const imgW = pageW; // 가로 꽉 — .psheet 자체 패딩이 있어 가장자리에 붙지 않는다.
    const imgH = (canvas.height * imgW) / canvas.width;
    const imgData = canvas.toDataURL("image/jpeg", 0.92);

    // 페이지 높이만큼 슬라이스 — 같은 이미지를 y 를 위로 밀며 페이지마다 얹는다.
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

    // output('datauristring') → "data:application/pdf;filename=...;base64,XXXX".
    // 순수 base64 만 잘라낸다.
    const dataUri = pdf.output("datauristring");
    const marker = "base64,";
    const at = dataUri.indexOf(marker);
    return at >= 0 ? dataUri.slice(at + marker.length) : dataUri;
  } finally {
    document.body.removeChild(host);
  }
}
