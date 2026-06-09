import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * 커스텀 Select — 네이티브 <select> 대체.
 *
 * 왜: 안드로이드의 네이티브 <select> 는 OS 가 그리는 풀스크린 라디오 다이얼로그로 떠
 *   앱 디자인과 동떨어진다(CSS 로 스타일 불가 — 팝업이 OS 영역). iOS 는 휠 피커라 그나마
 *   낫지만 플랫폼마다 제각각. 이 컴포넌트는 모든 플랫폼에서 동일한 커스텀 드롭다운을 그려
 *   DatePicker/MonthPicker 와 같은 portal 팝오버 패턴을 따른다(경계 인식 + body portal).
 *
 * 드롭인 가깝게: value(문자열) + onChange(value) + options 배열. 빈 옵션은 { value:"" } 로.
 *   트리거는 전달된 className(보통 "input ...")을 그대로 받아 기존 레이아웃에 자연스럽게 끼움.
 *   options 가 많으면(>10) 검색창이 자동으로 붙는다.
 */

export type SelectOption = {
  value: string;
  label: ReactNode;
  /** 검색 필터용 텍스트. 없으면 label 이 문자열일 때 그걸 사용. */
  searchText?: string;
  disabled?: boolean;
};

type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** 트리거 버튼 className (보통 "input ..."). */
  className?: string;
  /** 트리거 버튼 inline style (선택 시 강조색 등). */
  style?: CSSProperties;
  disabled?: boolean;
  ariaLabel?: string;
  /** 검색창 강제 on/off. 기본: 옵션 10개 초과면 자동 on. */
  searchable?: boolean;
  /** 검색 placeholder. */
  searchPlaceholder?: string;
};

export default function Select({
  value,
  onChange,
  options,
  placeholder = "선택",
  className,
  style,
  disabled,
  ariaLabel,
  searchable,
  searchPlaceholder = "검색…",
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number } | null>(null);

  const selected = options.find((o) => o.value === value) || null;
  const showSearch = searchable ?? options.length > 10;

  const filtered = useMemo(() => {
    if (!showSearch || !q.trim()) return options;
    const needle = q.trim().toLowerCase();
    return options.filter((o) => {
      const t = o.searchText ?? (typeof o.label === "string" ? o.label : "");
      return t.toLowerCase().includes(needle);
    });
  }, [options, q, showSearch]);

  // 바깥 클릭으로 닫기.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // ESC 로 닫기.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // 트리거 기준 팝오버 위치 — 아래 공간 부족하면 위로 플립. 폭은 트리거 폭(최소 220).
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const calc = () => {
      const r = wrapRef.current!.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(Math.max(r.width, 220), vw - 16);
      let left = r.left;
      if (left + width > vw - 8) left = Math.max(8, vw - width - 8);
      const spaceBelow = vh - r.bottom;
      const spaceAbove = r.top;
      const placeAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
      const maxH = Math.max(160, Math.min(360, (placeAbove ? spaceAbove : spaceBelow) - 12));
      if (placeAbove) setPos({ left, width, bottom: vh - r.top + 4, maxH });
      else setPos({ left, width, top: r.bottom + 4, maxH });
    };
    calc();
    window.addEventListener("scroll", calc, true);
    window.addEventListener("resize", calc);
    return () => {
      window.removeEventListener("scroll", calc, true);
      window.removeEventListener("resize", calc);
    };
  }, [open]);

  // 열릴 때 검색창 포커스(검색 가능할 때) + 검색어 초기화.
  useEffect(() => {
    if (open) { setQ(""); if (showSearch) requestAnimationFrame(() => searchRef.current?.focus()); }
  }, [open, showSearch]);

  function pick(v: string) { onChange(v); setOpen(false); }

  return (
    <div className={"relative " + (className?.includes("w-full") ? "w-full" : "inline-block")} ref={wrapRef} style={{ minWidth: 0 }}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={(className ?? "input") + " text-left inline-flex items-center justify-between gap-1.5"}
        style={style}
        data-haptic="selection"
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        <span className={"truncate min-w-0 " + (selected ? "" : "text-[color:var(--c-text-muted)]")}>
          {selected ? selected.label : placeholder}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 opacity-60" aria-hidden style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s ease" }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          role="listbox"
          className="fixed z-[1200] bg-[var(--c-surface)] rounded-[14px] border border-[color:var(--c-border)] shadow-xl overflow-hidden flex flex-col"
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxH }}
        >
          {showSearch && (
            <div className="p-2 border-b border-[color:var(--c-border)] flex-shrink-0">
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={searchPlaceholder}
                className="input !h-9 !text-[13px]"
                aria-label="옵션 검색"
              />
            </div>
          )}
          <div className="overflow-y-auto py-1 flex-1 min-h-0" style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-[12.5px] text-[color:var(--c-text-muted)]">결과 없음</div>
            )}
            {filtered.map((o) => {
              const active = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={o.disabled}
                  className={
                    "w-full text-left px-3 py-2.5 text-[14px] flex items-center justify-between gap-2 transition " +
                    (active ? "bg-[color:var(--c-brand-soft)] text-[color:var(--c-brand)] font-bold" : "text-[color:var(--c-text)] hover:bg-[color:var(--c-surface-3)]") +
                    (o.disabled ? " opacity-40 cursor-not-allowed" : "")
                  }
                  data-haptic="selection"
                  onClick={() => !o.disabled && pick(o.value)}
                >
                  <span className="truncate min-w-0">{o.label}</span>
                  {active && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0" aria-hidden>
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
