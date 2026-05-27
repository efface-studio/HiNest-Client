import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Route-level Error Boundary — 한 페이지의 렌더 에러가 앱 전체를 흰 화면으로
 * 만드는 걸 막는다. 잡힌 에러는 fallback UI 로 표시하고, 사용자는 다른 라우트로
 * 이동하거나 새로고침해서 회복할 수 있다.
 *
 * 사용:
 *   <ErrorBoundary>
 *     <SomePage />
 *   </ErrorBoundary>
 *
 *   또는 라우트 컨테이너 한 곳에 두르고 location.pathname 으로 reset.
 *
 * 비-React 에러(이벤트 핸들러 / setTimeout / Promise rejection) 는 잡지 못한다 —
 * 그건 window 의 error / unhandledrejection 리스너 + Sentry 같은 외부 도구가
 * 처리할 영역. ErrorBoundary 는 렌더 단계 에러 전용.
 */

type Props = {
  children: ReactNode;
  /** 라우트 키 — 바뀌면 error 상태 reset. 보통 location.pathname. */
  resetKey?: string;
  /** fallback UI 커스텀. 없으면 기본 화면. */
  fallback?: (err: Error, reset: () => void) => ReactNode;
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 운영 환경에서 외부 리포터(Sentry/Datadog 등) 가 있다면 여기서 호출.
    // 사내툴 규모에선 console.error 로도 superadmin 콘솔의 인메모리 버퍼에 잡힘.
    console.error("[ErrorBoundary] render failure", {
      message: error.message,
      stack: error.stack?.split("\n").slice(0, 6).join("\n"),
      component: info.componentStack?.split("\n").slice(0, 5).join("\n"),
    });
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      // 라우트가 바뀌었으면 다음 페이지에는 에러를 끌고 가지 않는다.
      this.setState({ error: null });
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return <DefaultFallback error={this.state.error} reset={this.reset} />;
    }
    return this.props.children;
  }
}

function DefaultFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div
      role="alert"
      className="min-h-[60vh] flex items-center justify-center px-6"
      style={{ background: "var(--c-surface)" }}
    >
      <div className="max-w-md w-full panel p-7 text-center">
        <div className="text-[42px] mb-2" aria-hidden>⚠️</div>
        <h2 className="text-[18px] font-extrabold text-ink-900 mb-1.5">
          이 페이지를 표시하는 중 문제가 발생했어요
        </h2>
        <p className="text-[13px] text-ink-500 leading-relaxed mb-4">
          새로고침하면 대부분 회복돼요. 같은 문제가 반복되면 다른 메뉴로 이동해 주세요.
        </p>
        {/* 에러 메시지는 펼친 상태에선 노출하지 않음 — 운영자 디버깅용으로만 details 안에 */}
        <details className="text-[11px] text-ink-400 mb-4 text-left">
          <summary className="cursor-pointer select-none">기술 정보</summary>
          <code className="block mt-1.5 break-all">{error.message || error.name}</code>
        </details>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => { reset(); window.location.assign("/"); }}
          >
            홈으로
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => window.location.reload()}
          >
            새로고침
          </button>
        </div>
      </div>
    </div>
  );
}
