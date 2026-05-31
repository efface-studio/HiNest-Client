import { useTheme } from "../theme";

/**
 * BrandLockup — 새 HiNest 로고 (기하 마크 + "HiNest." 워드마크) 인라인 SVG.
 *
 * 디자이너가 준 light/dark export(HiNest-logo-light.svg / -dark.svg)를 인라인화한 것.
 * 두 파일의 차이는 ① 배경 사각형 색 ② 워드마크 글자/점 색뿐이라, 한 컴포넌트에서
 * 테마(resolved)로 색만 전환한다.
 *
 * export 원본 대비 의도적으로 바꾼 점:
 *  - 배경 사각형 제거 → 사이드바에 투명하게 얹힘 (원본의 bg rect 는 export 미리보기용)
 *  - 워드마크가 원본에선 미정의 `.wm` 클래스에 의존해 깨지므로 브랜드 폰트(Pretendard)로 렌더
 *    (원본 파일 desc 의 "outline the text before production" 지침을 코드 렌더로 대체)
 *  - gradient id 는 페이지 내 충돌 방지를 위해 `hn-` 프리픽스
 *
 * 마크 폴리곤 좌표는 원본 그대로 보존.
 */
export default function BrandLockup({ height = 30, onDark }: { height?: number; onDark?: boolean }) {
  const { resolved } = useTheme();
  // onDark: 항상 어두운 표면(예: 운영 콘솔 사이드바)에 얹힐 때 테마와 무관하게 밝은 워드마크 강제.
  const isDark = onDark ?? resolved === "dark";
  const textColor = isDark ? "#FFFFFF" : "#0C1020";
  const dotColor = isDark ? "#A5B8FF" : "#3B5CF0";

  // 원본 viewBox 1080×320 에서 상하 여백만 잘라 헤더에 꽉 차게. 가로는 워드마크
  // 클리핑 방지를 위해 그대로 유지.
  const vbX = 0;
  const vbY = 56;
  const vbW = 1080;
  const vbH = 236;
  const width = (height * vbW) / vbH;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="HiNest"
      className="select-none"
    >
      <defs>
        <linearGradient id="hn-bl1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4A7FFF" />
          <stop offset="100%" stopColor="#1E4FD4" />
        </linearGradient>
        <linearGradient id="hn-bl2" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#5B8DFF" />
          <stop offset="100%" stopColor="#2A5DE8" />
        </linearGradient>
        <linearGradient id="hn-bl-light" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8FB3FF" />
          <stop offset="100%" stopColor="#5B8DFF" />
        </linearGradient>
        <linearGradient id="hn-bl-dark" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2A5DE8" />
          <stop offset="100%" stopColor="#1A3FB5" />
        </linearGradient>
      </defs>

      {/* ── 기하 마크 (원본 좌표 보존) ── */}
      <g transform="translate(40,40)">
        <g transform="translate(120,120) scale(2.0)">
          <polygon points="-58,-18 -38,-33 -38,52 -58,62" fill="url(#hn-bl-dark)" />
          <polygon points="-38,-33 -12,-33 -12,52 -38,52" fill="url(#hn-bl2)" />
          <polygon points="-58,-18 -38,-33 -12,-33 -32,-18" fill="url(#hn-bl-light)" />
          <polygon points="-38,-33 -25,-47 0,-47 -12,-33" fill="url(#hn-bl1)" />
          <polygon points="-32,-18 -12,-33 0,-47 -20,-33" fill="url(#hn-bl-dark)" />
          <polygon points="-12,10 12,5 12,24 -12,29" fill="url(#hn-bl-light)" />
          <polygon points="-12,10 12,5 12,24 -12,29" fill="url(#hn-bl2)" opacity="0.55" />
          <polygon points="38,-33 58,-18 58,62 38,52" fill="url(#hn-bl-dark)" />
          <polygon points="12,-33 38,-33 38,52 12,52" fill="url(#hn-bl2)" />
          <polygon points="38,-33 58,-18 32,-18 12,-33" fill="url(#hn-bl-light)" />
          <polygon points="12,-33 38,-33 25,-47 0,-47" fill="url(#hn-bl1)" />
          <polygon points="38,-33 58,-18 45,-33 25,-47" fill="url(#hn-bl-dark)" />
          <rect x="-32" y="-13" width="11" height="11" fill="#FFFFFF" rx="1.5" />
          <rect x="-32" y="15" width="11" height="11" fill="#FFFFFF" rx="1.5" />
          <rect x="21" y="-13" width="11" height="11" fill="#FFFFFF" rx="1.5" />
          <rect x="21" y="15" width="11" height="11" fill="#FFFFFF" rx="1.5" />
        </g>
      </g>

      {/* ── 워드마크 (브랜드 폰트로 렌더) ── */}
      <text
        x="320"
        y="220"
        fontFamily='"Pretendard Variable", Pretendard, -apple-system, sans-serif'
        fontWeight={800}
        fontSize={196}
        letterSpacing="-0.04em"
      >
        <tspan fill={textColor}>HiNest</tspan>
        <tspan fill={dotColor}>.</tspan>
      </text>
    </svg>
  );
}
