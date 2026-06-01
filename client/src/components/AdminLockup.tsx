import { useTheme } from "../theme";

/**
 * AdminLockup — 운영(관리자) 콘솔 전용 로고.
 *
 * 디자이너가 준 원본 SVG(HiNest-Admin-라이트/다크)에서 바깥 배경(누끼)만 제거하고
 * 로고 마크·워드마크·배지·서브타이틀 벡터는 원본 그대로 둔 파일을
 * client/public/admin-logo/ 에 두고 <img> 로 렌더한다. viewBox 는 콘텐츠에 맞게
 * 타이트하게 잘라(여백 제거) 작은 사이드바에서도 마크·글자가 보이도록 했다.
 * 다크/라이트는 onDark(또는 테마)로 선택.
 *
 * 주의: <img> 로 SVG 를 렌더하면 페이지 웹폰트(Pretendard)가 적용되지 않아
 * 글자는 시스템 폰트로 폴백된다. (한글 서브타이틀은 원본도 폴백이었음)
 */
export default function AdminLockup({
  variant = "compact",
  onDark,
}: {
  variant?: "compact" | "full";
  onDark?: boolean;
}) {
  const { resolved } = useTheme();
  const isDark = onDark ?? resolved === "dark";
  const src = isDark ? "/admin-logo/dark.svg" : "/admin-logo/light.svg";
  const height = variant === "full" ? 104 : 40;

  return (
    <img
      src={src}
      alt="HiNest Admin Console"
      height={height}
      style={{ height, width: "auto", maxWidth: "100%" }}
      className="select-none flex-shrink-0"
      draggable={false}
    />
  );
}
