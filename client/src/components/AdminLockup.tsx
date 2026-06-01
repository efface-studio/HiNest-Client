import { useTheme } from "../theme";

/**
 * AdminLockup — 운영(관리자) 콘솔 전용 로고.
 *
 * 디자이너 export(HiNest-Admin-라이트.svg / -다크.svg)를 컴포넌트화한 것.
 * 원본은 "그라데이션 둥근 타일 아이콘 + 흰 둥지 마크 + HiNest 워드마크 + ADMIN 배지
 * + '관리자 콘솔 · Admin Console' 서브타이틀" 의 가로형 락업이다.
 *
 * 원본 대비 의도적으로 바꾼 점:
 *  - 바깥 배경 사각형(라이트 #F5F3EE / 다크 #0F1226) 제거 → 어느 표면에도 투명하게 얹힘.
 *  - 워드마크·배지·서브타이틀은 (스케일 시 글자가 뭉개지지 않도록) SVG 한 장으로 통째 축소하지 않고
 *    HTML 텍스트로 렌더. 타일 아이콘만 인라인 SVG. → 사이드바(작게)에서도 글자가 또렷.
 *  - gradient/filter id 는 페이지 내 충돌 방지를 위해 `ad-` 프리픽스.
 *
 * 타일 마크 좌표는 원본 폴리곤 그대로 보존(둥지 + 4개 파란 창).
 */

function AdminTile({ size = 28, onDark }: { size?: number; onDark?: boolean }) {
  // 원본 타일: x130 y136 w188 h188 rx44, 마크그룹 translate(224,227.626) scale(0.9495).
  // 여기선 그림자 여유를 둔 220×220 정사각 viewBox 로 옮겨 담는다. 타일 TL=(16,16).
  // 마크그룹 오프셋 = 원본(224-130, 227.626-136)=(94, 91.626) → (16+94, 16+91.626).
  const shadowOpacity = onDark ? 0.55 : 0.3;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 220 220"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="HiNest"
      className="select-none flex-shrink-0"
    >
      <defs>
        <linearGradient id="ad-tile" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#5B8DFF" />
          <stop offset="55%" stopColor="#3B5CF0" />
          <stop offset="100%" stopColor="#1E4FD4" />
        </linearGradient>
        <filter id="ad-tshadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="6" stdDeviation="9" floodColor="#1E37B8" floodOpacity={shadowOpacity} />
        </filter>
      </defs>

      <rect x="16" y="16" width="188" height="188" rx="44" fill="url(#ad-tile)" filter="url(#ad-tshadow)" />
      <rect x="16" y="16" width="188" height="188" rx="44" fill="none" stroke="#FFFFFF" strokeOpacity="0.18" strokeWidth="1.5" />

      <g transform="translate(110,107.626) scale(0.9494949494949495)">
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
  );
}

export default function AdminLockup({
  variant = "compact",
  onDark,
}: {
  variant?: "compact" | "full";
  onDark?: boolean;
}) {
  const { resolved } = useTheme();
  // onDark: 항상 어두운 표면(운영 콘솔 사이드바)일 때 테마와 무관하게 밝은 톤 강제.
  const isDark = onDark ?? resolved === "dark";

  const wordColor = isDark ? "#FFFFFF" : "#0C1020";
  const badge = isDark
    ? { bg: "rgba(110,137,255,.18)", border: "rgba(165,184,255,.45)", fg: "#A5B8FF" }
    : { bg: "rgba(59,92,240,.10)", border: "rgba(59,92,240,.30)", fg: "#1E37B8" };
  const subColor = isDark ? "rgba(255,255,255,.6)" : "#5A6072";
  const wordFont = '"Pretendard Variable", Pretendard, -apple-system, sans-serif';
  const monoFont = '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace';

  if (variant === "full") {
    return (
      <div className="flex items-center gap-4 select-none">
        <AdminTile size={64} onDark={isDark} />
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span
              style={{ fontFamily: wordFont, fontWeight: 800, fontSize: 40, letterSpacing: "-0.045em", color: wordColor, lineHeight: 1 }}
            >
              HiNest
            </span>
            <span
              className="uppercase"
              style={{
                fontFamily: wordFont,
                fontWeight: 700,
                fontSize: 13,
                letterSpacing: "0.06em",
                color: badge.fg,
                background: badge.bg,
                border: `1.5px solid ${badge.border}`,
                borderRadius: 999,
                padding: "4px 12px",
              }}
            >
              Admin
            </span>
          </div>
          <div
            className="mt-1.5"
            style={{ fontFamily: monoFont, fontWeight: 500, fontSize: 13, letterSpacing: "0.08em", color: subColor }}
          >
            관리자 콘솔 · Admin Console
          </div>
        </div>
      </div>
    );
  }

  // compact — 사이드바/모바일 헤더용. 타일 + HiNest + ADMIN 배지 한 줄.
  return (
    <div className="flex items-center gap-2 select-none">
      <AdminTile size={26} onDark={isDark} />
      <span
        style={{ fontFamily: wordFont, fontWeight: 800, fontSize: 17, letterSpacing: "-0.04em", color: wordColor, lineHeight: 1 }}
      >
        HiNest
      </span>
      <span
        className="uppercase"
        style={{
          fontFamily: wordFont,
          fontWeight: 700,
          fontSize: 9.5,
          letterSpacing: "0.06em",
          color: badge.fg,
          background: badge.bg,
          border: `1px solid ${badge.border}`,
          borderRadius: 999,
          padding: "2px 7px",
        }}
      >
        Admin
      </span>
    </div>
  );
}
