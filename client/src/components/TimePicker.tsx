import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 우리 웹 톤(Toss light) TimePicker — DatePicker 와 쌍.
 * - 기본 `<input type="time">` 은 다크모드·OS 에 따라 UI 가 제각각이라
 *   DatePicker 와 결이 안 맞음 → 시(0~23) / 분(0~59) 2열 스크롤 리스트로 통일.
 * - 값은 "HH:mm" 문자열. 빈 문자열 = 미지정.
 */
export default function TimePicker({
  value,
  onChange,
  placeholder = "--:--",
  className,
  disabled,
  minuteStep = 1,
}: {
  value: string; // "HH:mm" or ""
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  minuteStep?: number; // 분 스크롤 간격 (기본 1)
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 현재 선택값 파싱
  const { hh, mm } = useMemo(() => parse(value), [value]);

  // 바깥 클릭으로 닫기
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

  // 팝오버 위치 계산
  useLayoutEffect(() => {
    if (!open || !wrapperRef.current) return;
    const calc = () => {
      const r = wrapperRef.current!.getBoundingClientRect();
      const w = 220;
      const h = 260;
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

  // 열릴 때 현재 선택 행을 스크롤 중앙으로
  const hourListRef = useRef<HTMLDivElement>(null);
  const minListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // 렌더 직후 실행
    const t = setTimeout(() => {
      const hi = hh ?? new Date().getHours();
      const mi = mm ?? 0;
      const scrollTo = (container: HTMLDivElement | null, idx: number) => {
        if (!container) return;
        const btn = container.querySelector<HTMLButtonElement>(`button[data-idx="${idx}"]`);
        if (btn) btn.scrollIntoView({ block: "center" });
      };
      scrollTo(hourListRef.current, hi);
      scrollTo(minListRef.current, Math.floor(mi / minuteStep));
    }, 0);
    return () => clearTimeout(t);
  }, [open]); // eslint-disable-line

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const minutes = useMemo(() => {
    const arr: number[] = [];
    for (let i = 0; i < 60; i += minuteStep) arr.push(i);
    return arr;
  }, [minuteStep]);

  function pickHour(h: number) {
    const next = `${pad(h)}:${pad(mm ?? 0)}`;
    onChange(next);
  }
  function pickMin(m: number) {
    const next = `${pad(hh ?? new Date().getHours())}:${pad(m)}`;
    onChange(next);
    setOpen(false);
  }

  return (
    <div className={`relative ${className ?? ""}`} ref={wrapperRef}>
      <button
        type="button"
        disabled={disabled}
        className="input text-left tabular flex items-center justify-between disabled:opacity-60"
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        <span className={value ? "" : "text-ink-400"}>
          {value || placeholder}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-ink-400">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      {open && pos && createPortal(
        // z-[2000]: BottomSheet/모달(zIndex 1000~1200) 위에 떠야 클릭 가능 — 낮으면 시트 뒤로 깔림.
        <div
          ref={popRef}
          className="fixed z-[2000] bg-white rounded-lg shadow-lg border border-ink-100"
          style={{ width: 220, top: pos.top, left: pos.left }}
        >
          <div className="flex items-center justify-between px-3 pt-2 pb-1">
            <div className="text-[12px] font-bold text-ink-700">시각 선택</div>
            <button
              type="button"
              className="text-[11px] text-ink-500 hover:text-ink-800"
              onClick={() => { onChange(""); setOpen(false); }}
            >
              지우기
            </button>
          </div>
          <div className="grid grid-cols-2 gap-0 border-t border-ink-100">
            {/* 시 */}
            <div className="border-r border-ink-100">
              <div className="text-[10px] text-center text-ink-400 py-1 border-b border-ink-100">시</div>
              <div ref={hourListRef} className="max-h-[200px] overflow-y-auto py-1">
                {hours.map((h) => {
                  const selected = hh === h;
                  return (
                    <button
                      key={h}
                      type="button"
                      data-idx={h}
                      className={`w-full text-center py-1.5 text-[13px] tabular font-semibold transition ${
                        selected
                          ? "bg-brand-500 text-white"
                          : "text-ink-700 hover:bg-slate-100"
                      }`}
                      onClick={() => pickHour(h)}
                    >
                      {pad(h)}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* 분 */}
            <div>
              <div className="text-[10px] text-center text-ink-400 py-1 border-b border-ink-100">분</div>
              <div ref={minListRef} className="max-h-[200px] overflow-y-auto py-1">
                {minutes.map((m, idx) => {
                  const selected = mm === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      data-idx={idx}
                      className={`w-full text-center py-1.5 text-[13px] tabular font-semibold transition ${
                        selected
                          ? "bg-brand-500 text-white"
                          : "text-ink-700 hover:bg-slate-100"
                      }`}
                      onClick={() => pickMin(m)}
                    >
                      {pad(m)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function parse(v: string): { hh: number | null; mm: number | null } {
  if (!v) return { hh: null, mm: null };
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(v.trim());
  if (!m) return { hh: null, mm: null };
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return { hh: null, mm: null };
  return { hh, mm };
}
