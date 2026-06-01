import { useTheme } from "../theme";

/**
 * BrandLockup — 회사(사용자) 앱 브랜드 로고.
 *
 * 디자이너가 준 원본 브랜드 SVG(HiNest-01-reference 라이트/다크)에서 export 미리보기
 * 배경(누끼)만 제거하고 viewBox 를 콘텐츠에 맞게 타이트하게 잘라
 * client/public/brand-logo/ 에 두고 <img> 로 렌더한다. 운영(관리자) 콘솔의
 * AdminLockup 과 완전히 동일한 방식·동일한 타일 락업이라, 회사 앱과 운영 콘솔의
 * 로고 톤(둥근 블루 타일 + 마크 + 워드마크)이 정확히 일치한다.
 * 다크/라이트는 onDark(또는 테마)로 선택.
 *
 * 주의: <img> 로 SVG 를 렌더하면 페이지 웹폰트(Pretendard)가 적용되지 않아 워드마크는
 * 시스템 산세리프로 폴백된다. (AdminLockup 과 동일한 절충 — SVG 안에 폰트 폴백을 박아둠)
 */
export default function BrandLockup({ height = 34, onDark }: { height?: number; onDark?: boolean }) {
  const { resolved } = useTheme();
  // onDark: 항상 어두운 표면에 얹힐 때 테마와 무관하게 다크 변형 강제.
  const isDark = onDark ?? resolved === "dark";
  const src = isDark ? "/brand-logo/dark.svg" : "/brand-logo/light.svg";

  return (
    <img
      src={src}
      alt="HiNest"
      height={height}
      style={{ height, width: "auto", maxWidth: "100%" }}
      className="select-none flex-shrink-0"
      draggable={false}
    />
  );
}
