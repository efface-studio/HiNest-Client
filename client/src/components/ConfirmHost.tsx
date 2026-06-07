import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { nativePlatform } from "../lib/platform";
import { LiquidGlassTabBar } from "../lib/liquidGlassTabBar";

/**
 * 전역 확인/알림/입력 모달 호스트 — 네이티브 window.confirm/alert/prompt 를 대체한다.
 *
 * 왜 필요한가:
 * - iOS Safari 는 한글 IME 입력 중 confirm/prompt 가 블록되면 입력 창이 얼어붙는 사례가 있음.
 * - 설치형(스탠드얼론) PWA 에선 네이티브 다이얼로그가 아예 안 뜨는 경우도 있음.
 * - 브라우저마다 생김새가 제각각이라 UI 일관성이 깨짐.
 *
 * 사용법 (동기→비동기 교체):
 *   if (!(await confirmAsync({ description: "삭제할까요?", tone: "danger" }))) return;
 *   await alertAsync({ description: "저장했어요" });
 *   const name = await promptAsync({ title: "새 이름", defaultValue: f.name });
 *
 * 동시에 여러 개 열리지는 않게 큐잉이 아니라 "마지막 호출 우선" — 이전 프라미스는 cancel(false/null) 로 resolve.
 */

type ConfirmOpts = {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  // 2차 액션 (선택) — "삭제"/"보관하며 삭제" 같은 3지선다용.
  //   확인 버튼이 "전체 삭제" 라면 secondary 는 "문서만 남기고 폴더 삭제" 처럼.
  //   선택되면 confirmAsync 가 "secondary" 문자열로 resolve.
  secondaryLabel?: string;
};

type AlertOpts = {
  title?: string;
  description?: string;
  confirmLabel?: string;
};

type PromptOpts = {
  title?: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 비밀번호 등 마스킹이 필요한 입력은 "password" 로. 기본은 "text". */
  inputType?: "text" | "password";
};

type ConfirmResult = boolean | "secondary";
type Dialog =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: ConfirmResult) => void }
  | { kind: "alert"; opts: AlertOpts; resolve: () => void }
  | { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void };

// 싱글턴 상태 — 훅 없이 모듈 어디서나 호출할 수 있게.
let currentDialog: Dialog | null = null;
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function emit() {
  listeners.forEach((cb) => cb());
}

function getSnapshot() {
  return currentDialog;
}

function cancelPrevious() {
  if (!currentDialog) return;
  const d = currentDialog;
  currentDialog = null;
  if (d.kind === "confirm") d.resolve(false);
  else if (d.kind === "alert") d.resolve();
  else d.resolve(null);
}

// iOS/iPadOS(Capacitor) 에서는 커스텀 웹 모달 대신 애플 기본 UIAlertController 를 쓴다.
// 내용(제목/본문/버튼 라벨)은 동일하게 전달 — 네이티브 룩앤필만 입힌다. 웹/데스크톱/안드로이드는
// 기존 커스텀 모달 유지. 네이티브 호출 실패 시(플러그인 부재 등) 웹 모달로 폴백.
function useNativeDialogs(): boolean {
  return nativePlatform() === "ios"; // iPad 도 Capacitor 에선 "ios"
}

export function confirmAsync(opts: ConfirmOpts): Promise<ConfirmResult> {
  if (useNativeDialogs()) {
    return LiquidGlassTabBar.confirm({
      title: opts.title,
      message: opts.description,
      confirmText: opts.confirmLabel,
      cancelText: opts.cancelLabel,
      destructive: opts.tone === "danger",
      secondaryText: opts.secondaryLabel,
    })
      .then((r): ConfirmResult => (r.action === "secondary" ? "secondary" : !!r.confirmed))
      .catch(() => webConfirm(opts));
  }
  return webConfirm(opts);
}

export function alertAsync(opts: AlertOpts): Promise<void> {
  if (useNativeDialogs()) {
    return LiquidGlassTabBar.confirm({
      title: opts.title,
      message: opts.description,
      confirmText: opts.confirmLabel ?? "확인",
      alertOnly: true,
    })
      .then(() => undefined)
      .catch(() => webAlert(opts));
  }
  return webAlert(opts);
}

export function promptAsync(opts: PromptOpts): Promise<string | null> {
  if (useNativeDialogs()) {
    return LiquidGlassTabBar.promptInput({
      title: opts.title,
      message: opts.description,
      confirmText: opts.confirmLabel,
      cancelText: opts.cancelLabel,
      placeholder: opts.placeholder,
      defaultValue: opts.defaultValue,
      secure: opts.inputType === "password",
    })
      .then((r) => (r.cancelled ? null : r.value ?? ""))
      .catch(() => webPrompt(opts));
  }
  return webPrompt(opts);
}

// ── 웹/데스크톱/안드로이드용 커스텀 모달 구현(기존 동작) ───────────────────────────
function webConfirm(opts: ConfirmOpts): Promise<ConfirmResult> {
  return new Promise((resolve) => {
    cancelPrevious();
    currentDialog = { kind: "confirm", opts, resolve };
    emit();
  });
}

function webAlert(opts: AlertOpts): Promise<void> {
  return new Promise((resolve) => {
    cancelPrevious();
    currentDialog = { kind: "alert", opts, resolve };
    emit();
  });
}

function webPrompt(opts: PromptOpts): Promise<string | null> {
  return new Promise((resolve) => {
    cancelPrevious();
    currentDialog = { kind: "prompt", opts, resolve };
    emit();
  });
}

function close() {
  currentDialog = null;
  emit();
}

export default function ConfirmHost() {
  const dialog = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);

  // prompt 열릴 때 defaultValue 세팅 + 자동 포커스, 보기 상태 초기화.
  useEffect(() => {
    if (dialog?.kind === "prompt") {
      setValue(dialog.opts.defaultValue ?? "");
      setReveal(false);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [dialog]);

  // ESC 로 취소/닫기.
  useEffect(() => {
    if (!dialog) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (!dialog) return;
        if (dialog.kind === "confirm") dialog.resolve(false);
        else if (dialog.kind === "alert") dialog.resolve();
        else dialog.resolve(null);
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]);

  if (!dialog) return null;

  const onCancel = () => {
    if (dialog.kind === "confirm") dialog.resolve(false);
    else if (dialog.kind === "alert") dialog.resolve();
    else dialog.resolve(null);
    close();
  };
  const onConfirm = () => {
    if (dialog.kind === "confirm") dialog.resolve(true);
    else if (dialog.kind === "alert") dialog.resolve();
    else dialog.resolve(value);
    close();
  };

  const title =
    dialog.opts.title ??
    (dialog.kind === "alert" ? "알림" : dialog.kind === "prompt" ? "입력" : "확인");
  const confirmLabel = dialog.opts.confirmLabel ?? "확인";
  const cancelLabel =
    dialog.kind === "prompt" || dialog.kind === "confirm"
      ? (dialog.opts as ConfirmOpts).cancelLabel ?? "취소"
      : null;
  const tone = dialog.kind === "confirm" ? dialog.opts.tone : undefined;

  return (
    <div
      className="fixed inset-0 bg-ink-900/40 grid place-items-center modal-safe z-[200]"
      onClick={onCancel}
    >
      <div
        className="panel w-full max-w-[420px] shadow-pop"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="section-head">
          <div className="title">{title}</div>
        </div>
        <div className="p-5 space-y-3">
          {dialog.opts.description && (
            <div className="text-[13px] text-ink-700 leading-[1.55] whitespace-pre-line">
              {dialog.opts.description}
            </div>
          )}
          {dialog.kind === "prompt" && (
            <div className="relative">
              <input
                ref={inputRef}
                className={dialog.opts.inputType === "password" ? "input pr-14" : "input"}
                type={dialog.opts.inputType === "password" && !reveal ? "password" : "text"}
                autoComplete={dialog.opts.inputType === "password" ? "current-password" : undefined}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={dialog.opts.placeholder}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onConfirm();
                  }
                }}
              />
              {dialog.opts.inputType === "password" && (
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-bold text-ink-500 hover:text-ink-800"
                  title={reveal ? "가리기" : "보기"}
                >
                  {reveal ? "가리기" : "보기"}
                </button>
              )}
            </div>
          )}
        </div>
        <div className="border-t border-ink-150 px-5 py-3 flex justify-end gap-2 flex-wrap">
          {cancelLabel && (
            <button type="button" className="btn-ghost" onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
          {dialog.kind === "confirm" && dialog.opts.secondaryLabel && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                (dialog as any).resolve("secondary");
                close();
              }}
            >
              {dialog.opts.secondaryLabel}
            </button>
          )}
          <button
            type="button"
            className={tone === "danger" ? "btn-danger" : "btn-primary"}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
