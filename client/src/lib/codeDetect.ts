/**
 * 사내톡·회의록 본문에서 코드 영역을 추출 + 언어 추정.
 *
 * 신호 3종:
 *  1) ``` ... ```   — 펜스 블록 (언어 태그 그대로 사용)
 *  2) `code`        — 인라인 백틱
 *  3) 휴리스틱      — 멀티라인이 코드 같으면 통째로 코드 처리, 언어는 토큰으로 추정
 *
 * 한글 평문이 코드로 오인되지 않도록 휴리스틱은 보수적으로:
 *  - 비어있지 않은 줄이 3줄 이상
 *  - 코드 토큰을 포함한 줄이 비어있지 않은 줄의 ⅓ 이상
 *  - 한글 비율이 절반 이하
 */

export type CodeSegment =
  | { kind: "text"; text: string }
  | { kind: "code"; code: string; lang?: string }
  | { kind: "inline-code"; code: string };

const FENCE = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g;
const INLINE = /`([^`\n]+)`/g;

// 평문에 자연스럽게 잘 등장하지 않는 코드 신호 — JS/TS/Swift/Kotlin/Python/Java/Go/Rust/SQL/PHP 폭넓게.
const CODE_TOKEN = new RegExp(
  [
    "=>",
    "::",
    "->",
    ";\\s*$",
    "\\{\\s*$",
    "^\\s*\\}",
    "^\\s*//",
    "^\\s*/\\*",
    "^\\s*#\\s*include",
    "^\\s*@\\w+", // 데코레이터: @Published @Component @Override
    "^\\s*(?:final\\s+|public\\s+|private\\s+|protected\\s+|static\\s+|abstract\\s+|open\\s+|internal\\s+|sealed\\s+)*(?:class|struct|enum|interface|extension|protocol|trait|object)\\b",
    "^\\s*(?:async\\s+)?(?:function|func|fn|fun|def|sub)\\b",
    "^\\s*(?:const|let|var|val|mut)\\s",
    "^\\s*if\\s*[(\\s]",
    "^\\s*for\\s*[(\\s]",
    "^\\s*while\\s*[(\\s]",
    "^\\s*switch\\s*[(\\s]",
    "^\\s*case\\s+(?:let\\s+)?\\.?\\w",
    "^\\s*guard\\s+",
    "^\\s*return\\b",
    "^\\s*throw\\b",
    "^\\s*import\\b",
    "^\\s*from\\s+['\"]",
    "^\\s*export\\b",
    "^\\s*package\\b",
    "^\\s*namespace\\b",
    "^\\s*use\\s+\\w",
    "^\\s*public\\s+",
    "^\\s*private\\s+",
    "^\\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE\\s+TABLE|ALTER\\s+TABLE|DROP\\s+TABLE)\\b",
    "^\\s*<\\?php",
    "^\\s*</?[a-zA-Z][\\w:-]*[\\s/>]",
  ].join("|"),
  "m",
);

const HANGUL = /[ㄱ-힣]/;

function isCodeyLine(ln: string): boolean {
  return CODE_TOKEN.test(ln);
}

function looksLikeCode(text: string): boolean {
  const lines = text.split("\n");
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length < 3) return false;
  const codey = nonEmpty.filter(isCodeyLine).length;
  const hangulLines = nonEmpty.filter((l) => HANGUL.test(l)).length;
  if (hangulLines / nonEmpty.length > 0.5) return false;
  return codey >= Math.max(2, Math.ceil(nonEmpty.length / 3));
}

/**
 * 토큰을 보고 언어 추정. 빠른 휴리스틱 — 정확도보단 "Swift / Python / SQL" 정도의 라벨용.
 * 매치되는 패턴이 가장 많은 언어로 결정. 모두 0이면 undefined.
 */
const LANG_PATTERNS: { lang: string; patterns: RegExp[] }[] = [
  {
    lang: "swift",
    patterns: [
      /\b(func|guard\s+let|@Published|@State|ObservableObject|MoyaProvider|UIView|SwiftUI)\b/,
      /\bcase\s+let\s+\.\w/,
      /\bfinal\s+class\b/,
      /\bweak\s+self\b/,
      /\bprivate\s+let\b/,
    ],
  },
  {
    lang: "kotlin",
    patterns: [/\bfun\s+\w+\s*\(/, /\bval\s+\w+/, /\bcompanion\s+object\b/, /\bsuspend\s+fun\b/],
  },
  {
    lang: "typescript",
    patterns: [/:\s*(string|number|boolean|void|any|unknown|never)\b/, /\binterface\s+\w+\s*\{/, /\btype\s+\w+\s*=/, /\bimport\s+type\b/, /\bas\s+const\b/],
  },
  {
    lang: "javascript",
    patterns: [/\bconst\s+\w+\s*=/, /=>\s*\{?/, /\brequire\s*\(/, /\bexport\s+default\b/, /\bawait\s+/],
  },
  {
    lang: "tsx",
    patterns: [/<\/?[A-Z]\w*[\s/>]/, /className=/, /useState\s*</, /useEffect\(/],
  },
  {
    lang: "python",
    patterns: [/^\s*def\s+\w+\(/m, /^\s*class\s+\w+(?:\(\w+\))?:\s*$/m, /^\s*from\s+\w[\w.]*\s+import\b/m, /\bself\b/, /\bif\s+__name__\s*==\s*['"]__main__['"]/],
  },
  {
    lang: "java",
    patterns: [/\bpublic\s+(?:static\s+)?(?:void|class|int|String)\b/, /\bSystem\.out\.print/, /\bnew\s+\w+<.+>/],
  },
  {
    lang: "go",
    patterns: [/^\s*package\s+\w+/m, /\bfunc\s+\w+\(/, /\bfmt\.\w+/, /\bchan\s+\w+/, /\bgo\s+\w+\(/],
  },
  {
    lang: "rust",
    patterns: [/\bfn\s+\w+\s*\(/, /\blet\s+mut\b/, /::<.+>/, /\bimpl\s+\w+/, /\bSelf\b/],
  },
  {
    lang: "sql",
    patterns: [/^\s*SELECT\s.+\sFROM\s/im, /^\s*INSERT\s+INTO\s/im, /^\s*CREATE\s+TABLE\s/im, /\bWHERE\s+\w+\s*=/i],
  },
  {
    lang: "html",
    patterns: [/<!doctype\s+html>/i, /<html[\s>]/i, /<\/?(div|span|p|h\d|ul|li|a|img)\b/i],
  },
  {
    lang: "css",
    patterns: [/^\s*[.#]?\w[\w-]*\s*\{[^}]*\}/m, /\b(color|background|margin|padding|font-size)\s*:/],
  },
  {
    lang: "json",
    patterns: [/^\s*\{[\s\S]*"\w+"\s*:\s*/m, /^\s*\[\s*\{/m],
  },
  {
    lang: "bash",
    patterns: [/^#!\/bin\/(?:bash|sh)/, /^\s*\$\s+\w/m, /\b(?:apt-get|brew|npm|yarn|pnpm|git)\s+\w+/],
  },
  {
    lang: "php",
    patterns: [/<\?php/, /\$\w+\s*=/, /->\w+\(/],
  },
];

export function detectLanguage(code: string): string | undefined {
  let best: { lang: string; score: number } | null = null;
  for (const { lang, patterns } of LANG_PATTERNS) {
    let score = 0;
    for (const p of patterns) if (p.test(code)) score++;
    if (score > 0 && (!best || score > best.score)) best = { lang, score };
  }
  return best?.lang;
}

/** 본문을 segment 배열로 쪼갬. 펜스 → 인라인 → 휴리스틱 순. */
export function parseCodeSegments(content: string): CodeSegment[] {
  const out: CodeSegment[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  FENCE.lastIndex = 0;
  while ((m = FENCE.exec(content)) !== null) {
    if (m.index > lastIndex) {
      out.push(...splitInlineAndHeuristic(content.slice(lastIndex, m.index)));
    }
    const code = m[2].replace(/\n$/, "");
    // 펜스에 lang 태그가 명시돼 있으면 그 값을 쓰고, 없으면 본문 추정.
    const lang = m[1] || detectLanguage(code);
    out.push({ kind: "code", lang, code });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < content.length) {
    out.push(...splitInlineAndHeuristic(content.slice(lastIndex)));
  }
  return out.filter((s) => !(s.kind === "text" && s.text === ""));
}

function splitInlineAndHeuristic(text: string): CodeSegment[] {
  if (!text.includes("`")) {
    if (looksLikeCode(text)) {
      const trimmed = text.replace(/^\n+|\n+$/g, "");
      const before = text.slice(0, text.indexOf(trimmed));
      const after = text.slice(before.length + trimmed.length);
      const segs: CodeSegment[] = [];
      if (before) segs.push({ kind: "text", text: before });
      segs.push({ kind: "code", code: trimmed, lang: detectLanguage(trimmed) });
      if (after) segs.push({ kind: "text", text: after });
      return segs;
    }
    return [{ kind: "text", text }];
  }
  const out: CodeSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "inline-code", code: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
