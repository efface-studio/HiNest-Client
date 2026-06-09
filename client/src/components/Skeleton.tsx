/**
 * Skeleton UI — 데이터 로딩 중 깜빡임을 막고 다가올 콘텐츠의 형태를 미리 보여준다.
 *
 * 사용 예:
 *   const { data, loading } = useFetch(...);
 *   if (loading) return <SkeletonList rows={5} />;
 *   return <Real data={data} />;
 *
 * 또는 부분적으로:
 *   <Skeleton w={120} h={20} />
 *   <SkeletonText lines={3} />
 *
 * 디자인 토큰:
 *   - 배경: var(--c-surface-3) (다크/라이트 자동)
 *   - 시머 그라데이션: 상위에 글라스 같은 부드러운 wave (styles.css 의 @keyframes hinest-skeleton)
 *   - 모서리: 8px 기본(둥근 사각형). 아바타·원형 placeholder 는 borderRadius="999px".
 *
 * 성능: pure CSS animation(transform/opacity 만). 백그라운드 탭에서도 GPU 합성 그대로.
 */
import { CSSProperties } from "react";

type SkeletonProps = {
  /** 너비. number → px, string → 그대로. 미지정 시 100% */
  w?: number | string;
  /** 높이. 미지정 시 1em(글자 한 줄 높이) */
  h?: number | string;
  /** 모서리 둥글기. number → px, string → 그대로. 기본 8 */
  radius?: number | string;
  /** 원형(아바타 등). true 면 radius=999. */
  circle?: boolean;
  /** 추가 className(margin 등). 색·애니메이션은 건드리지 말 것. */
  className?: string;
  /** 인라인 style override. */
  style?: CSSProperties;
};

export function Skeleton({ w, h = "1em", radius = 8, circle, className = "", style }: SkeletonProps) {
  const toCss = (v: number | string | undefined): string | undefined =>
    v === undefined ? undefined : typeof v === "number" ? `${v}px` : v;
  return (
    <span
      className={`hinest-skeleton inline-block align-middle ${className}`}
      aria-hidden
      style={{
        width: toCss(w) ?? "100%",
        height: toCss(h),
        borderRadius: circle ? 999 : toCss(radius),
        ...style,
      }}
    />
  );
}

/** 여러 줄 문장 placeholder. 마지막 줄은 80% 폭으로 자연스러운 종결. */
export function SkeletonText({ lines = 3, gap = 8 }: { lines?: number; gap?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} w={i === lines - 1 ? "80%" : "100%"} h={12} radius={6} />
      ))}
    </div>
  );
}

/** 카드 한 장. 큰 영역 + 제목 + 부제 + 메타라인. 대시보드·리스트 항목 공통. */
export function SkeletonCard({ height = 96 }: { height?: number }) {
  return (
    <div className="panel p-4 flex items-center gap-3">
      <Skeleton circle w={40} h={40} />
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <Skeleton w="55%" h={14} />
        <Skeleton w="40%" h={11} />
      </div>
      <Skeleton w={56} h={28} radius={8} />
      {void height /* 호출부 일관성 위해 prop 유지(향후 가변 카드용) */}
    </div>
  );
}

/** 리스트 형태. rows 만큼 SkeletonCard 반복. */
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/** 통계 그리드(StatCard 4개) placeholder. */
export function SkeletonStatGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="panel p-4 flex flex-col gap-2">
          <Skeleton w="55%" h={11} />
          <Skeleton w="40%" h={22} />
          <Skeleton w="70%" h={10} />
        </div>
      ))}
    </div>
  );
}
