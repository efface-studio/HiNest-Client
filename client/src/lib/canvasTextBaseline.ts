/**
 * html2canvas 텍스트 baseline 하향 편차 보정 (#1097).
 *
 * html2canvas 는 브라우저와 다른 폰트 메트릭으로 baseline 을 잡아 텍스트를
 * 세로 중앙보다 아래로 그린다(실측: 이 버그가 있는 환경에서 편차 ≈ a×fontSize + b,
 * 14px 기준 약 7~8px). 정도는 브라우저/폰트/버전에 따라 다르고 아예 없을 수도 있어
 * 상수를 하드코딩하지 않는다 — 캡처 직전에 작은 프로브를 같은 html2canvas 로 찍어
 * 현재 환경의 편차를 실측하고, 캡처 대상의 모든 텍스트 노드를 편차만큼 위로
 * 상대이동(span position:relative; top:-shift)시킨다. 편차가 없으면 보정도 0.
 *
 * 전제: 대상 DOM 은 "캡처 전용"(화면 밖 host) — 보정 span 이 화면 UI 에 남지 않는다.
 */

type Html2Canvas = (el: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement>;

/** 프로브 1회: fontPx 텍스트를 셀 세로중앙에 놓고 캡처해 (위여백-아래여백)/2 = 하향편차 px 를 잰다. */
async function probeShift(h2c: Html2Canvas, fontPx: number, fontFamily: string): Promise<number | null> {
  const W = 220;
  const H = Math.max(48, fontPx * 3);
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${W}px;background:#ffffff;z-index:-1;`;
  const cell = document.createElement("div");
  cell.style.cssText = `width:${W}px;height:${H}px;display:table-cell;vertical-align:middle;text-align:center;font-size:${fontPx}px;line-height:1.4;color:#111111;`;
  // 주의: 폰트명엔 따옴표가 들어있어("Pretendard Variable" 등) style 속성 문자열에 끼우면
  // 마크업이 깨진다 — 반드시 DOM API 로 지정.
  cell.style.fontFamily = fontFamily;
  cell.textContent = "한글측정 Ag";
  host.appendChild(cell);
  document.body.appendChild(host);
  try {
    const canvas = await h2c(host, { scale: 2, backgroundColor: "#ffffff", logging: false });
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const S = 2;
    const inset = 3 * S;
    const img = ctx.getImageData(inset, inset, W * S - 2 * inset, H * S - 2 * inset);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        const lum = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
        if (lum < 120) {
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (minY === Infinity) return null;
    return (minY - (img.height - 1 - maxY)) / (2 * S);
  } catch {
    return null;
  }
}

/**
 * root 안 모든 텍스트 노드를 현 환경의 편차만큼 위로 보정.
 * 편차가 사실상 0(±0.75px)이면 아무것도 하지 않는다. 프로브 실패 시에도 무보정(안전).
 */
export async function compensateCanvasTextBaseline(h2c: Html2Canvas, root: HTMLElement): Promise<void> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (!n.textContent || !n.textContent.trim()) continue;
    // <style>/<script> 안의 텍스트(CSS 코드!)를 span 으로 감싸면 스타일시트가
    // 통째로 무효화돼 서식이 무너진다 — 렌더 텍스트만 대상.
    const tag = n.parentElement?.tagName;
    if (tag === "STYLE" || tag === "SCRIPT") continue;
    texts.push(n as Text);
  }
  if (!texts.length) return;

  // 실제 본문이 쓰는 폰트로 측정해야 정확 — 첫 텍스트 노드의 computed font-family 사용.
  const fontFamily = getComputedStyle(texts[0].parentElement ?? root).fontFamily || "sans-serif";
  // 12px·30px 두 점 실측 → 선형회귀 shift(px) = a×fontSize + b
  const s12 = await probeShift(h2c, 12, fontFamily);
  const s30 = await probeShift(h2c, 30, fontFamily);
  if (s12 == null || s30 == null) return;
  if (Math.abs(s12) < 0.75 && Math.abs(s30) < 0.75) return; // 이 환경엔 버그 없음
  const a = (s30 - s12) / 18;
  const b = s12 - a * 12;
  for (const t of texts) {
    const el = t.parentElement;
    if (!el || !t.parentNode) continue;
    const px = parseFloat(getComputedStyle(el).fontSize) || 14;
    const shift = a * px + b;
    if (!Number.isFinite(shift) || Math.abs(shift) < 0.5) continue;
    // 주의: position:relative 스팬은 html2canvas 가 별도 포지션 레이어로 hoist 해
    // 표 레이아웃이 통째로 무너진다(실측) — transform 은 제자리에서 그리는 위치만
    // 올려 안전. inline-block 이어야 transform 이 적용되고, 여러 줄(pre-wrap)도
    // 블록 안에서 줄바꿈이 유지되며 줄마다 동일하게 보정된다.
    const span = document.createElement("span");
    span.style.display = "inline-block";
    span.style.transform = `translateY(${(-shift).toFixed(2)}px)`;
    t.parentNode.insertBefore(span, t);
    span.appendChild(t);
  }
}
