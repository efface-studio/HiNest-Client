import { useTheme } from "../theme";

/**
 * BrandLockup — HiNest 로고 (블루 타일 마크 + "HiNest" 워드마크 + "Workplace Platform" 서브).
 *
 * 디자이너가 준 light/dark export(HiNest-라이트.svg / HiNest-다크.svg)를 인라인화한 것.
 * 두 파일의 차이는 ① 배경 사각형 색 ② 워드마크/서브 글자색뿐이라, 한 컴포넌트에서
 * 색만 전환한다.
 *
 * export 원본 대비 의도적으로 바꾼 점:
 *  - 배경 사각형 제거 → 사이드바에 투명하게 얹힘 (원본 bg rect 는 export 미리보기용)
 *  - 워드마크/서브가 원본에선 미정의 `.wm`/`.mono` 클래스에 의존해 깨지므로 브랜드 폰트
 *    (Pretendard / JetBrains Mono)로 HTML 텍스트로 렌더 — SVG <text> 폭 추정 없이 안전
 *  - gradient/filter id 는 페이지 충돌 방지로 `hn-` 프리픽스
 *  - 타일·마크 폴리곤 좌표는 원본 그대로 보존
 *
 * tone: 색 강제. 콘솔처럼 테마와 무관하게 항상 어두운 표면 위에 얹힐 땐 tone="dark".
 *       미지정 시 현재 테마(resolved)를 따른다.
 */
export default function BrandLockup({
  height = 30,
  tone,
  subtitle = true,
}: {
  height?: number;
  tone?: "light" | "dark";
  subtitle?: boolean;
}) {
  const { resolved } = useTheme();
  const onDark = tone ? tone === "dark" : resolved === "dark";
  const textColor = onDark ? "#FFFFFF" : "#0C1020";
  const subColor = onDark ? "rgba(255,255,255,0.6)" : "#5A6072";

  // 타일(188) 기준 비율을 원본(워드마크 104 / 서브 35 / 타일 188)에 맞춰 환산.
  const wordSize = Math.round(height * 0.55);
  const subSize = Math.max(7, Math.round(height * 0.2));
  const gap = Math.round(height * 0.34);

  return (
    <div className="inline-flex items-center select-none" style={{ gap }} aria-label="HiNest">
      {/* ── 블루 타일 + 흰 마크 (원본 좌표 보존, 상하좌우 여백만 크롭) ── */}
      <svg
        width={height}
        height={height}
        viewBox="112 122 224 224"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-hidden
        style={{ flexShrink: 0 }}
      >
        <defs>
          <linearGradient id="hn-tile" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#5B8DFF" />
            <stop offset="55%" stopColor="#3B5CF0" />
            <stop offset="100%" stopColor="#1E4FD4" />
          </linearGradient>
          <filter id="hn-tshadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="9" stdDeviation="14" floodColor="#1E37B8" floodOpacity="0.42" />
          </filter>
        </defs>

        <rect x="130" y="136" width="188" height="188" rx="44" fill="url(#hn-tile)" filter="url(#hn-tshadow)" />
        <rect x="130" y="136" width="188" height="188" rx="44" fill="none" stroke="#FFFFFF" strokeOpacity="0.18" strokeWidth="1.5" />

        <g transform="translate(224,227.6262626) scale(0.94949494)">
          <polygon points="-58,-18 -38,-33 -38,52 -58,62" fill="#FFFFFF" opacity="0.55" />
          <polygon points="-38,-33 -12,-33 -12,52 -38,52" fill="#FFFFFF" opacity="0.82" />
          <polygon points="-58,-18 -38,-33 -12,-33 -32,-18" fill="#FFFFFF" />
          <polygon points="-38,-33 -25,-47 0,-47 -12,-33" fill="#FFFFFF" opacity="0.92" />
          <polygon points="-32,-18 -12,-33 0,-47 -20,-33" fill="#FFFFFF" opacity="0.55" />
          <polygon points="-12,10 12,5 12,24 -12,29" fill="#FFFFFF" />
          <polygon points="-12,10 12,5 12,24 -12,29" fill="#FFFFFF" opacity="0.4" />
          <polygon points="38,-33 58,-18 58,62 38,52" fill="#FFFFFF" opacity="0.55" />
          <polygon points="12,-33 38,-33 38,52 12,52" fill="#FFFFFF" opacity="0.82" />
          <polygon points="38,-33 58,-18 32,-18 12,-33" fill="#FFFFFF" />
          <polygon points="12,-33 38,-33 25,-47 0,-47" fill="#FFFFFF" opacity="0.92" />
          <polygon points="38,-33 58,-18 45,-33 25,-47" fill="#FFFFFF" opacity="0.55" />
          <rect x="-32" y="-13" width="11" height="11" fill="#3B5CF0" rx="1.5" />
          <rect x="-32" y="15" width="11" height="11" fill="#3B5CF0" rx="1.5" />
          <rect x="21" y="-13" width="11" height="11" fill="#3B5CF0" rx="1.5" />
          <rect x="21" y="15" width="11" height="11" fill="#3B5CF0" rx="1.5" />
        </g>
      </svg>

      {/* ── 워드마크 + 서브 (브랜드 폰트로 렌더) ── */}
      <span className="flex flex-col" style={{ lineHeight: 1 }}>
        <span
          style={{
            fontFamily: '"Pretendard Variable", Pretendard, -apple-system, sans-serif',
            fontWeight: 800,
            fontSize: wordSize,
            letterSpacing: "-0.03em",
            color: textColor,
          }}
        >
          HiNest
        </span>
        {subtitle && (
          <span
            style={{
              fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
              fontSize: subSize,
              letterSpacing: "0.12em",
              color: subColor,
              marginTop: Math.round(height * 0.12),
              whiteSpace: "nowrap",
            }}
          >
            Workplace Platform
          </span>
        )}
      </span>
    </div>
  );
}
