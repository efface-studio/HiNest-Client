import { useEffect, useState } from "react";

/**
 * highlight.js 지연 로딩 훅/컴포넌트.
 *
 * syntaxHighlight.ts(highlight.js 코어 + 언어 16종, ~30–90KB)를 정적 import 하면
 * 채팅 청크에 항상 포함되어, 코드 블록이 하나도 없는 대화를 열 때도 같이 로드된다.
 * 여기서 동적 import 로 감싸 "첫 코드 블록 렌더 시"에만 하이라이터를 불러오고,
 * 그 전까지는 이스케이프된 plain 코드를 보여준다(로드되면 색칠로 업그레이드).
 * payslipPdf.ts / xlsx 등 다른 무거운 의존성의 lazy-import 패턴과 동일.
 */

// hljs 로드 전/실패 시 동기 폴백 — syntaxHighlight 의 escapeHtml 과 동일 규칙.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 모듈 프라미스를 메모해 하이라이터 청크를 단 한 번만 내려받는다.
let modPromise: Promise<typeof import("./syntaxHighlight")> | null = null;
function loadHighlighter() {
  if (!modPromise) modPromise = import("./syntaxHighlight");
  return modPromise;
}

/** code → 하이라이트된 HTML. 로드 전에는 이스케이프 plain, 로드되면 색칠로 교체. */
export function useHighlightedCode(code: string, lang?: string): string {
  const [html, setHtml] = useState<string>(() => escapeHtml(code));
  useEffect(() => {
    let alive = true;
    // 입력이 바뀌면 우선 안전한 폴백부터 보여주고, 하이라이터가 준비되면 업그레이드.
    setHtml(escapeHtml(code));
    loadHighlighter()
      .then((m) => {
        if (alive) setHtml(m.highlightCode(code, lang));
      })
      .catch(() => {
        /* 로드 실패 시 이스케이프 폴백 유지 */
      });
    return () => {
      alive = false;
    };
  }, [code, lang]);
  return html;
}

/** `<code class="hljs">` 렌더까지 감싼 헬퍼 — 기존 인라인 highlightCode 호출부 대체용. */
export function HljsCode({
  code,
  lang,
  style,
}: {
  code: string;
  lang?: string;
  style?: React.CSSProperties;
}) {
  const html = useHighlightedCode(code, lang);
  // hljs.highlight 출력은 토큰별 span 으로 감싸되 텍스트는 이스케이프되어 안전 —
  // (그리고 로드 전 폴백은 escapeHtml) 별도 sanitization 불필요.
  return <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} style={style} />;
}
