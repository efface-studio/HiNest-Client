import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 일정 페이지의 캘린더 디자인을 그대로 쓰는 경량 DatePicker.
 * - 트리거: 현재 날짜(YYYY-MM-DD) 또는 placeholder 를 보여주는 버튼
 * - 팝오버: 월 그리드(일~토), 일요일 빨강 / 토요일 파랑, 오늘은 brand 원형 배경
 * - 값은 문자열 "YYYY-MM-DD" 로 주고받음 — SQLite 에서 바로 저장 가능
 */
export default function DatePicker({
  value,
  onChange,
  placeholder = "YYYY-MM-DD",
  className,
  variant = "plain",
  disabled,
  min,
}: {
  value: string; // "YYYY-MM-DD" or ""
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  // plain: 테이블/인라인용 최소 스타일 (기본)
  // input: 폼 필드용 — `.input` 과 동일한 테두리/패딩/배경
  variant?: "plain" | "input";
  disabled?: boolean;
  /** YYYY-MM-DD — 이 날짜 이전 셀은 비활성화. 시작일 이후만 고를 수 있는 종료일 필드용. */
  min?: string;
}) {
  const [open, setOpen] = useState(false);
  // 팝오버 커서(보여줄 월) — 값이 없으면 오늘 기준
  const initial = value ? new Date(value + "T00:00:00") : new Date();
  const [cursor, setCursor] = useState<Date>(
    isNaN(initial.getTime()) ? new Date() : new Date(initial.getFullYear(), initial.getMonth(), 1)
  );
  const wrapperRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // 팝오버 절대 좌표 — body 에 portal 로 렌더하므로 overflow 에 안 가림.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 바깥 클릭으로 닫기 — wrapper 와 popover 둘 다 체크
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapperRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // 트리거 위치 기준으로 팝오버 좌표 계산 (뷰포트 경계 벗어나면 위쪽 / 왼쪽으로 이동)
  useLayoutEffect(() => {
    if (!open || !wrapperRef.current) return;
    const calc = () => {
      const r = wrapperRef.current!.getBoundingClientRect();
      const w = 280; // 팝오버 너비
      const h = 310; // 대략적인 팝오버 높이
      let top = r.bottom + 4;
      let left = r.left;
      if (top + h > window.innerHeight) top = Math.max(8, r.top - h - 4);
      if (left + w > window.innerWidth) left = Math.max(8, window.innerWidth - w - 8);
      setPos({ top, left });
    };
    calc();
    window.addEventListener("scroll", calc, true);
    window.addEventListener("resize", calc);
    return () => {
      window.removeEventListener("scroll", calc, true);
      window.removeEventListener("resize", calc);
    };
  }, [open]);

  // 팝오버 열릴 때 현재 값 기준으로 커서 맞춤
  useEffect(() => {
    if (!open) return;
    const d = value ? new Date(value + "T00:00:00") : new Date();
    if (!isNaN(d.getTime())) setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [open]); // eslint-disable-line

  // 해당 월의 7×N 그리드 날짜 배열 (앞 공백은 null 대신 이전달 날짜로 채워 UX 좋음)
  const days = buildMonthDays(cursor);
  const today = new Date();
  const selected = value ? new Date(value + "T00:00:00") : null;

  function pick(d: Date) {
    const s = fmt(d);
    onChange(s);
    setOpen(false);
  }

  return (
    <div className={`relative ${className ?? ""}`} ref={wrapperRef}>
      <button
        type="button"
        disabled={disabled}
        className={
          variant === "input"
            ? "input text-left tabular flex items-center justify-between gap-1 disabled:opacity-60"
            : "w-full min-w-0 bg-transparent border-0 focus:bg-[color:var(--c-surface)] text-[color:var(--c-text)] focus:outline-none focus:ring-1 focus:ring-brand-400 rounded text-[12px] px-1 py-1.5 tabular text-left hover:bg-[color:var(--c-surface-3)]"
        }
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        {/* whitespace-nowrap — 좁은 칸에서 'YYYY-MM-DD' 가 'YYYY-/MM-DD' 로 줄바꿈되던 깨짐 방지 */}
        <span className={`whitespace-nowrap overflow-hidden text-ellipsis ${value ? "" : "text-ink-400"}`}>
          {value || placeholder}
        </span>
        {variant === "input" && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-ink-400">
            <rect x="3" y="4" width="18" height="17" rx="2" stroke="currentColor" strokeWidth="1.8" />
            <path d="M3 9h18M8 2v4M16 2v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        )}
      </button>
      {open && pos && createPortal(
        // z-[2000]: BottomSheet/모달(zIndex 1000~1200) 위에 떠야 클릭 가능 — 낮으면 시트 뒤로 깔림.
        <div
          ref={popRef}
          className="fixed z-[2000] bg-[var(--c-surface)] rounded-lg shadow-lg border border-[color:var(--c-border)] p-3"
          style={{ width: 280, top: pos.top, left: pos.left }}
        >
          {/* 월 헤더 + 이동 */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              className="btn-ghost !px-2 !py-1 text-[12px]"
              onClick={() => setCursor(new Date(cursor.getFullYear() - 1, cursor.getMonth(), 1))}
              title="이전 해"
            >«</button>
            <button
              type="button"
              className="btn-ghost !px-2 !py-1 text-[12px]"
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              title="이전 달"
            >‹</button>
            <div className="font-bold text-ink-900 text-[13px]">
              {cursor.getFullYear()}년 {cursor.getMonth() + 1}월
            </div>
            <button
              type="button"
              className="btn-ghost !px-2 !py-1 text-[12px]"
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              title="다음 달"
            >›</button>
            <button
              type="button"
              className="btn-ghost !px-2 !py-1 text-[12px]"
              onClick={() => setCursor(new Date(cursor.getFullYear() + 1, cursor.getMonth(), 1))}
              title="다음 해"
            >»</button>
          </div>

          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 mb-1">
            {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
              <div
                key={d}
                className={`text-[11px] font-bold text-center py-1 ${
                  i === 0 ? "text-rose-500" : i === 6 ? "text-accent-500" : "text-ink-500"
                }`}
              >
                {d}
              </div>
            ))}
          </div>

          {/* 날짜 그리드 */}
          <div className="grid grid-cols-7 gap-0.5">
            {days.map((d, i) => {
              const inMonth = d.getMonth() === cursor.getMonth();
              const isToday = sameDay(d, today);
              const isSelected = selected && sameDay(d, selected);
              const dow = d.getDay();
              const beforeMin = !!min && fmt(d) < min;
              let color = "text-ink-700";
              if (!inMonth) color = "text-ink-300";
              else if (dow === 0) color = "text-rose-500";
              else if (dow === 6) color = "text-accent-500";
              return (
                <button
                  key={i}
                  type="button"
                  disabled={beforeMin}
                  className={`h-8 w-full text-[12px] font-semibold tabular rounded transition hover:bg-slate-100 ${color} ${
                    isSelected ? "!bg-brand-500 !text-white" : isToday ? "ring-1 ring-brand-400" : ""
                  } ${beforeMin ? "opacity-30 cursor-not-allowed hover:!bg-transparent" : ""}`}
                  onClick={() => !beforeMin && pick(d)}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          {/* 하단 액션 */}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-ink-100">
            <button
              type="button"
              className="text-[11px] text-ink-500 hover:text-ink-800"
              onClick={() => { onChange(""); setOpen(false); }}
            >
              지우기
            </button>
            <button
              type="button"
              className="text-[11px] text-brand-600 font-bold hover:text-brand-700"
              onClick={() => { onChange(fmt(new Date())); setOpen(false); }}
            >
              오늘
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
// 월 커서 기준으로 7의 배수로 채운 날짜 배열 반환 (앞뒤는 이전/다음 달 날짜)
function buildMonthDays(cursor: Date): Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const startDow = first.getDay();
  const start = new Date(first);
  start.setDate(1 - startDow);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}
