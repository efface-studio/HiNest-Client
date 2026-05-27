/**
 * 언어 라벨 옆에 띄울 미니 로고. devicon CDN 의 SVG 를 그대로 <img> 로.
 *
 * 언어명 → devicon 슬러그 매핑. (devicon 은 GitHub Actions 같은 일부 명칭이 다름.)
 * 매핑이 없으면 null 반환 → 아이콘 없이 텍스트만 표시.
 */

const SLUGS: Record<string, string> = {
  swift: "swift/swift-original",
  typescript: "typescript/typescript-original",
  ts: "typescript/typescript-original",
  tsx: "typescript/typescript-original",
  javascript: "javascript/javascript-original",
  js: "javascript/javascript-original",
  jsx: "javascript/javascript-original",
  python: "python/python-original",
  py: "python/python-original",
  java: "java/java-original",
  kotlin: "kotlin/kotlin-original",
  kt: "kotlin/kotlin-original",
  go: "go/go-original",
  golang: "go/go-original",
  rust: "rust/rust-original",
  rs: "rust/rust-original",
  // SQL 은 devicon 에 단독 슬러그 없음 — 일반 DB 로고로 대체.
  sql: "mysql/mysql-original",
  mysql: "mysql/mysql-original",
  postgresql: "postgresql/postgresql-original",
  postgres: "postgresql/postgresql-original",
  html: "html5/html5-original",
  xml: "html5/html5-original",
  css: "css3/css3-original",
  scss: "sass/sass-original",
  sass: "sass/sass-original",
  bash: "bash/bash-original",
  sh: "bash/bash-original",
  shell: "bash/bash-original",
  php: "php/php-original",
  ruby: "ruby/ruby-original",
  rb: "ruby/ruby-original",
  c: "c/c-original",
  cpp: "cplusplus/cplusplus-original",
  "c++": "cplusplus/cplusplus-original",
  csharp: "csharp/csharp-original",
  cs: "csharp/csharp-original",
  dart: "dart/dart-original",
  // markdown / json / yaml 은 devicon 정식 로고가 없거나 빈약 — 일부러 매핑 안 함.
};

export function langIconUrl(lang?: string): string | null {
  if (!lang) return null;
  const slug = SLUGS[lang.toLowerCase()];
  if (!slug) return null;
  // jsdelivr 가 GitHub raw 보다 캐시 / 가용성이 좋음.
  return `https://cdn.jsdelivr.net/gh/devicons/devicon/icons/${slug}.svg`;
}

export function LangIcon({ lang, size = 14 }: { lang?: string; size?: number }) {
  const url = langIconUrl(lang);
  if (!url) return null;
  return (
    <img
      src={url}
      alt={lang ?? ""}
      aria-hidden
      width={size}
      height={size}
      // SVG 라 작은 사이즈에서도 또렷. 로드 실패하면 alt 가 잠깐 보이지만 즉시 숨겨서 깔끔.
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = "none";
      }}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        flexShrink: 0,
        verticalAlign: "text-bottom",
      }} loading="lazy" decoding="async"/>
  );
}
