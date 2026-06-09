/**
 * 페이지 상단 헤더 — 제목/설명 + 우측 액션 영역.
 *
 * onRefresh (2026-06-09 추가): 넘기면 우측 액션 맨 앞에 '새로고침' 버튼이 자동으로 붙는다.
 *   - 데스크탑 전용(md:inline-flex) — 모바일·태블릿은 AppLayout 의 당겨서 새로고침(PTR)이
 *     전역으로 이미 동작하므로 버튼 중복을 피한다. (이 프로젝트의 md 기준 = 1024px)
 *   - refreshing=true 면 회전 애니메이션 + 비활성. 페이지의 load() 를 다시 호출하는 용도.
 */
export default function PageHeader({
  title,
  description,
  right,
  eyebrow,
  onRefresh,
  refreshing,
}: {
  title: string;
  description?: string;
  right?: React.ReactNode;
  eyebrow?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <div className="page-header flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-5">
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[11px] font-bold text-ink-500 uppercase tracking-[0.08em] mb-1.5">
            {eyebrow}
          </div>
        )}
        <h1 className="h-display">{title}</h1>
        {description && <p className="t-caption mt-1 page-header-desc">{description}</p>}
      </div>
      {(right || onRefresh) && (
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap sm:flex-shrink-0">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="btn-icon hidden md:inline-flex flex-shrink-0 disabled:opacity-50"
              title="새로고침"
              aria-label="새로고침"
              data-haptic="selection"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={refreshing ? "hinest-spin" : ""}
                aria-hidden
              >
                <path d="M3 12a9 9 0 0 1 9-9c2.39 0 4.68.94 6.4 2.6L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9c-2.39 0-4.68-.94-6.4-2.6L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
            </button>
          )}
          {right}
        </div>
      )}
    </div>
  );
}
