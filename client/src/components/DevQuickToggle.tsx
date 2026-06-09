/**
 * 개발자 빠른 토글 — "개발 중" 페이지 진입 ON/OFF (사이드바 프로필 옆 작은 `<>` 버튼).
 * 마이페이지의 "개발자 옵션" 패널과 같은 localStorage 키(devPagesPref)를 공유한다.
 * ON 이면 주황(warning) 색 + 우하단 점. AppLayout(회사 앱)·ConsoleLayout(운영 콘솔) 공용.
 */
import { useEffect, useState } from "react";
import { getDevPagesEnabled, setDevPagesEnabled } from "../lib/devPagesPref";

export default function DevQuickToggle() {
  const [on, setOn] = useState<boolean>(() => getDevPagesEnabled());
  useEffect(() => {
    function refresh() { setOn(getDevPagesEnabled()); }
    window.addEventListener("hinest:devPagesChange", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("hinest:devPagesChange", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  function toggle() {
    const next = !on;
    setOn(next);
    setDevPagesEnabled(next);
  }
  return (
    <button
      type="button"
      onClick={toggle}
      className="btn-icon"
      title={on ? "“개발 중” 페이지 진입 켜짐 — 클릭해서 끄기" : "“개발 중” 페이지 진입 꺼짐 — 클릭해서 켜기"}
      aria-label={on ? "개발 페이지 보기 끄기" : "개발 페이지 보기 켜기"}
      style={{
        position: "relative",
        color: on ? "var(--c-warning)" : "var(--c-text-3)",
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
      <span
        aria-hidden
        style={{
          position: "absolute",
          right: 2,
          bottom: 2,
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: on ? "var(--c-warning)" : "var(--c-border-strong)",
          border: "1.5px solid var(--c-surface)",
        }}
      />
    </button>
  );
}
