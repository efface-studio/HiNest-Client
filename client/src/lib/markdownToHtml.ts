/**
 * 경량 마크다운 → HTML 변환기 — 메모/회의록 에디터 붙여넣기용.
 *
 * 외부 의존성 없이 실무에서 흔히 붙여넣는 마크다운을 처리한다(헤딩·강조·코드·리스트·인용·링크·구분선).
 * 완전한 CommonMark 구현은 아니지만, 사용자가 노션/깃헙/슬랙 등에서 복사한 텍스트를 단순 텍스트가
 * 아니라 서식으로 살리는 것이 목적. 변환 결과는 TipTap(ProseMirror) 가 HTML 로 파싱해 노드화한다.
 *
 * 보안: 코드/텍스트는 모두 escape 후 우리가 만든 화이트리스트 태그만 출력 → XSS 위험 없음.
 * 링크 href 는 http/https/mailto 만 허용.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^(https?:|mailto:)/i.test(u)) return u;
  if (u.startsWith("/")) return u; // 앱 내부 경로 허용
  return null;
}

/** 인라인 변환 — 이미 escape 된 문자열을 받아 강조/코드/링크/취소선만 태그화. */
function inline(escaped: string): string {
  let s = escaped;
  // 인라인 코드 `code` — 먼저 처리(내부 마크다운 무시).
  s = s.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  // 링크 [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t, url) => {
    const href = safeHref(url);
    return href ? `<a href="${href}">${t}</a>` : `${t}`;
  });
  // 굵게 **text** 또는 __text__
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  // 기울임 *text* 또는 _text_
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  // 취소선 ~~text~~
  s = s.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  return s;
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  // 리스트/인용 누적 버퍼 flush 헬퍼.
  type ListKind = "ul" | "ol" | "task" | null;
  let listKind: ListKind = null;
  const listItems: string[] = [];
  function flushList() {
    if (!listKind || !listItems.length) {
      listKind = null;
      listItems.length = 0;
      return;
    }
    if (listKind === "ol") {
      out.push(`<ol>${listItems.map((it) => `<li>${it}</li>`).join("")}</ol>`);
    } else if (listKind === "task") {
      // TipTap TaskList — data-checked 로 체크 상태.
      out.push(
        `<ul data-type="taskList">${listItems
          .map((it) => it)
          .join("")}</ul>`,
      );
    } else {
      out.push(`<ul>${listItems.map((it) => `<li>${it}</li>`).join("")}</ul>`);
    }
    listKind = null;
    listItems.length = 0;
  }

  while (i < lines.length) {
    const line = lines[i];

    // 코드 펜스 ``` ... ```
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      flushList();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // 닫는 ``` 소비
      out.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    // 빈 줄 — 리스트 종료 + 단락 구분.
    if (/^\s*$/.test(line)) {
      flushList();
      i++;
      continue;
    }

    // 헤딩 # ~ ###
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(escapeHtml(h[2].trim()))}</h${level}>`);
      i++;
      continue;
    }

    // 수평선 --- *** ___
    if (/^\s*([-*_])\1\1+\s*$/.test(line)) {
      flushList();
      out.push("<hr>");
      i++;
      continue;
    }

    // 인용 > ...
    const bq = /^>\s?(.*)$/.exec(line);
    if (bq) {
      flushList();
      const quoteLines: string[] = [bq[1]];
      i++;
      while (i < lines.length && /^>\s?(.*)$/.test(lines[i])) {
        quoteLines.push(/^>\s?(.*)$/.exec(lines[i])![1]);
        i++;
      }
      out.push(`<blockquote><p>${inline(escapeHtml(quoteLines.join(" ")))}</p></blockquote>`);
      continue;
    }

    // 체크리스트 - [ ] / - [x]
    const task = /^[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (task) {
      if (listKind !== "task") { flushList(); listKind = "task"; }
      const checked = task[1].toLowerCase() === "x";
      listItems.push(
        `<li data-type="taskItem" data-checked="${checked}">${inline(escapeHtml(task[2]))}</li>`,
      );
      i++;
      continue;
    }

    // 순서 없는 리스트 - / * / +
    const ul = /^[-*+]\s+(.*)$/.exec(line);
    if (ul) {
      if (listKind !== "ul") { flushList(); listKind = "ul"; }
      listItems.push(inline(escapeHtml(ul[1])));
      i++;
      continue;
    }

    // 순서 있는 리스트 1. 2. ...
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      if (listKind !== "ol") { flushList(); listKind = "ol"; }
      listItems.push(inline(escapeHtml(ol[1])));
      i++;
      continue;
    }

    // 일반 단락 — 연속된 비어있지 않은 줄을 하나의 <p> 로 합침(soft break 는 <br>).
    flushList();
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,3}\s|>\s?|```|[-*+]\s|\d+\.\s)/.test(lines[i]) &&
      !/^\s*([-*_])\1\1+\s*$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(escapeHtml(para.join("\n"))).replace(/\n/g, "<br>")}</p>`);
  }
  flushList();
  return out.join("");
}

/**
 * 텍스트가 마크다운 서식을 담고 있는지 휴리스틱 판정.
 * 너무 공격적이면 일반 텍스트가 변형되니, '명백한' 마커가 있을 때만 true.
 */
export function looksLikeMarkdown(text: string): boolean {
  if (!text || text.length < 3) return false;
  const lines = text.split(/\r?\n/);
  let signals = 0;
  for (const ln of lines) {
    if (/^#{1,3}\s+\S/.test(ln)) signals += 2;          // 헤딩
    if (/^>\s+\S/.test(ln)) signals += 1;                // 인용
    if (/^[-*+]\s+\S/.test(ln)) signals += 1;            // 리스트
    if (/^\d+\.\s+\S/.test(ln)) signals += 1;            // 순서 리스트
    if (/^[-*+]\s+\[[ xX]\]\s/.test(ln)) signals += 2;   // 체크리스트
    if (/^```/.test(ln)) signals += 2;                   // 코드펜스
  }
  // 인라인 마커(굵게/링크/인라인코드)는 약한 신호.
  if (/\*\*[^*]+\*\*/.test(text)) signals += 1;
  if (/\[[^\]]+\]\([^)\s]+\)/.test(text)) signals += 1;
  if (/`[^`]+`/.test(text)) signals += 1;
  return signals >= 2;
}
