import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C, FONT, formatBytes } from "./theme";
import type { Attachment, Message, Reaction } from "./types";
import { api } from "../../api";
import { alertAsync } from "../ConfirmHost";
import { parseCodeSegments } from "../../lib/codeDetect";
import { copyToClipboard } from "../../lib/clipboard";
import { downloadFromUrl } from "../../lib/download";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { HljsCode } from "../../lib/useHighlightedCode";
import { LangIcon } from "../../lib/langIcon";
import { splitBlocks, renderInlineMarkdown } from "../../lib/markdown";
import { LinkPreview, extractFirstUrl } from "./LinkPreview";

/**
 * 파일/이미지/동영상 메시지를 문서함으로 복사 저장.
 * - 이미 업로드된 /uploads/xxx URL 을 그대로 재참조 (재업로드 없음 → 중복 용량 안 씀).
 * - 폴더 선택 없이 기본 위치(ALL scope, 루트) 에 저장. 나중에 문서함에서 이동 가능.
 */
function SaveToDocsChip({ fileUrl, fileName, fileType, fileSize, mine }: { fileUrl: string; fileName: string | null; fileType: string | null; fileSize: number | null; mine: boolean }) {
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  async function save() {
    if (saving || done) return;
    setSaving(true);
    try {
      await api("/api/document", {
        method: "POST",
        json: {
          title: fileName ?? "파일",
          description: "채팅방에서 저장",
          fileUrl,
          fileName,
          fileType,
          fileSize,
          scope: "ALL",
        },
      });
      setDone(true);
    } catch (e: any) {
      alertAsync({ title: "문서함 저장 실패", description: e?.message ?? "저장에 실패했어요" });
    } finally {
      setSaving(false);
    }
  }
  return (
    <button
      type="button"
      onClick={save}
      disabled={saving || done}
      style={{
        alignSelf: mine ? "flex-end" : "flex-start",
        fontSize: 11,
        fontWeight: 600,
        padding: "4px 8px",
        borderRadius: 999,
        // 종전엔 white/회색 하드코딩이라 다크 테마에서 우두커니 떴음. 테마 토큰으로 교체.
        border: "1px solid var(--c-border)",
        background: done ? "var(--c-surface-2)" : "var(--c-surface)",
        color: done ? "var(--c-success)" : "var(--c-text-2)",
        cursor: saving || done ? "default" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
      title={done ? "문서함에 저장됨" : "문서함에 저장"}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        {done ? (
          <polyline points="20 6 9 17 4 12" />
        ) : (
          <>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </>
        )}
      </svg>
      {done ? "저장됨" : saving ? "저장 중…" : "문서함 저장"}
    </button>
  );
}

/* ===== 꾹 누르기 + 두번 탭 감지 래퍼 (터치 + 마우스 + 우클릭) =====
 *
 * onLongPress  — 420ms 누르고 있으면 발동 (메시지 리액션 메뉴)
 * onDoubleTap  — 짧게 연속 두번 탭 (300ms 이내). 상대방 메시지에 빠른 따봉 리액션.
 *   · 터치: tapEnd 시점의 시간 간격으로 판정 (모바일)
 *   · 마우스: 브라우저 네이티브 dblclick 으로 판정 (텍스트 선택과 충돌 방지)
 */
export function LongPress({
  children,
  onLongPress,
  onDoubleTap,
  delay = 420,
  style,
}: {
  children: React.ReactNode;
  onLongPress: () => void;
  onDoubleTap?: () => void;
  delay?: number;
  style?: React.CSSProperties;
}) {
  const timerRef = useRef<number | null>(null);
  const firedRef = useRef(false);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const lastTapRef = useRef(0);

  const start = (x: number, y: number) => {
    firedRef.current = false;
    movedRef.current = false;
    startPosRef.current = { x, y };
    timerRef.current = window.setTimeout(() => {
      firedRef.current = true;
      onLongPress();
    }, delay);
  };
  const cancel = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const moveCheck = (x: number, y: number) => {
    const s = startPosRef.current;
    if (!s) return;
    if (Math.abs(x - s.x) > 8 || Math.abs(y - s.y) > 8) {
      movedRef.current = true;
      cancel();
    }
  };

  // 터치 종료 시점에 "짧은 탭" 이면 더블탭 창(300ms) 안쪽인지 검사.
  const handleTouchEnd = (e: React.TouchEvent) => {
    cancel();
    if (!onDoubleTap) return;
    // 롱프레스가 이미 발동했거나 드래그로 취소된 경우엔 탭이 아님
    if (firedRef.current || movedRef.current) return;
    const now = Date.now();
    if (lastTapRef.current && now - lastTapRef.current < 300) {
      // 두 번째 탭 — 따봉 토글
      lastTapRef.current = 0;
      firedRef.current = true; // 따라오는 click 을 onClickCapture 에서 차단
      e.preventDefault();
      onDoubleTap();
    } else {
      lastTapRef.current = now;
    }
  };

  return (
    <div
      onTouchStart={(e) => {
        const t = e.touches[0];
        start(t.clientX, t.clientY);
      }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        moveCheck(t.clientX, t.clientY);
      }}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={cancel}
      onMouseDown={(e) => {
        if (e.button === 0) start(e.clientX, e.clientY);
      }}
      onMouseMove={(e) => moveCheck(e.clientX, e.clientY)}
      onMouseUp={cancel}
      onMouseLeave={cancel}
      onDoubleClick={(e) => {
        // 데스크톱 더블클릭 — 네이티브 dblclick 이 가장 믿을 만함
        if (!onDoubleTap) return;
        e.preventDefault();
        e.stopPropagation();
        firedRef.current = true;
        onDoubleTap();
      }}
      onContextMenu={(e) => {
        // 우클릭도 리액션 메뉴로
        e.preventDefault();
        cancel();
        firedRef.current = true;
        onLongPress();
      }}
      // 롱프레스/더블탭이 발동된 직후 따라오는 click 은 자식(이미지 뷰어 등)으로 내려가지 않게 차단
      onClickCapture={(e) => {
        if (firedRef.current) {
          e.preventDefault();
          e.stopPropagation();
          firedRef.current = false;
        }
      }}
      style={{
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ===== 채팅 비디오 플레이어 =====
 * Chrome 기본 <video controls> 의 3점 메뉴는 좁은 채팅 영역에서 UI 가 부스럭거려서
 * controlsList 로 숨기고, 우리가 직접 styled 한 메뉴로 갈음.
 *
 * 기능은 전부 유지:
 *  - 전체화면: HTMLVideoElement.requestFullscreen
 *  - 다운로드: <a download> 트리거 (동일 오리진 /uploads 만 대상이라 CORS 문제 없음)
 *  - 재생 속도: 0.5 / 1 / 1.25 / 1.5 / 2x — 서브메뉴
 *  - PIP 모드: requestPictureInPicture (지원 안 하는 브라우저는 숨김)
 */
const RATE_OPTIONS = [0.5, 1, 1.25, 1.5, 2] as const;
function ChatVideoPlayer({ src, fileName }: { src: string; fileName: string | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [rate, setRate] = useState(1);
  const supportsPIP = typeof document !== "undefined" && !!(document as any).pictureInPictureEnabled;

  // 바깥 클릭 / ESC 로 닫기
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
        setRateOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setMenuOpen(false); setRateOpen(false); }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const close = () => { setMenuOpen(false); setRateOpen(false); };

  const fullscreen = async () => {
    try { await videoRef.current?.requestFullscreen?.(); } catch {}
    close();
  };
  const download = () => {
    const url = src + (src.includes("?") ? "&" : "?") + "download=1"
      + (fileName ? `&name=${encodeURIComponent(fileName)}` : "");
    downloadFromUrl(url, fileName ?? "");
    close();
  };
  const pip = async () => {
    try { await (videoRef.current as any)?.requestPictureInPicture?.(); } catch {}
    close();
  };
  const pickRate = (r: number) => {
    setRate(r);
    if (videoRef.current) videoRef.current.playbackRate = r;
    close();
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <video
        ref={videoRef}
        src={src}
        controls
        // 기본 메뉴 항목 전부 숨김 → 3점 메뉴 자체가 사라짐.
        controlsList="nodownload noplaybackrate nofullscreen noremoteplayback"
        disableRemotePlayback
        playsInline
        preload="metadata"
        onContextMenu={(e) => e.preventDefault()}
        style={{
          display: "block",
          maxWidth: 180,
          maxHeight: 200,
          borderRadius: 16,
          background: "#000",
        }}
      />
      <button
        type="button"
        aria-label="영상 옵션"
        title="영상 옵션"
        onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); setRateOpen(false); }}
        style={{
          position: "absolute", top: 6, right: 6,
          width: 26, height: 26, borderRadius: 999,
          background: "rgba(0,0,0,0.55)",
          border: 0, color: "#fff",
          cursor: "pointer",
          display: "grid", placeItems: "center",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          opacity: 0.9,
          transition: "opacity .15s ease, background .15s ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.75)"; e.currentTarget.style.opacity = "1"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.55)"; e.currentTarget.style.opacity = "0.9"; }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>

      {menuOpen && (
        <div
          role="menu"
          style={{
            position: "absolute", top: 38, right: 6,
            minWidth: 184,
            background: C.surface,
            color: C.ink,
            border: `1px solid ${C.gray200}`,
            borderRadius: 14,
            padding: 4,
            boxShadow:
              "0 10px 28px rgba(25, 31, 40, .16), 0 2px 6px rgba(25, 31, 40, .06)",
            zIndex: 50,
            fontFamily: FONT,
            overflow: "visible",
          }}
        >
          <VideoMenuItem
            label="전체화면"
            onClick={fullscreen}
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
              </svg>
            }
          />
          <VideoMenuItem
            label="다운로드"
            onClick={download}
            topBorder
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            }
          />
          <div style={{ position: "relative" }}>
            <VideoMenuItem
              label="재생 속도"
              rightText={rate === 1 ? "보통" : `${rate}x`}
              onClick={() => setRateOpen((v) => !v)}
              topBorder
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <polyline points="12 7 12 12 15.5 14" />
                </svg>
              }
            />
            {rateOpen && (
              <div
                style={{
                  position: "absolute", top: 0, right: "calc(100% + 6px)",
                  minWidth: 112,
                  background: C.surface,
                  color: C.ink,
                  border: `1px solid ${C.gray200}`,
                  borderRadius: 12,
                  padding: 4,
                  boxShadow:
                    "0 10px 28px rgba(25, 31, 40, .16), 0 2px 6px rgba(25, 31, 40, .06)",
                  fontFamily: FONT,
                }}
              >
                {RATE_OPTIONS.map((r) => {
                  const active = r === rate;
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => pickRate(r)}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        width: "100%",
                        padding: "8px 10px",
                        border: 0,
                        background: active ? C.gray100 : "transparent",
                        color: active ? C.blue : C.ink,
                        fontSize: 13, fontWeight: 600,
                        fontFamily: FONT,
                        letterSpacing: "-0.01em",
                        borderRadius: 8,
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "background .12s ease",
                      }}
                      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = C.gray100; }}
                      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                    >
                      <span>{r === 1 ? "보통" : `${r}x`}</span>
                      {active && (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {supportsPIP && (
            <VideoMenuItem
              label="PIP 모드"
              onClick={pip}
              topBorder
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <rect x="12" y="12" width="8" height="6" rx="1" fill="currentColor" stroke="none" />
                </svg>
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

function VideoMenuItem({
  label, onClick, icon, rightText, topBorder,
}: { label: string; onClick: () => void; icon: React.ReactNode; rightText?: string; topBorder?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        width: "100%",
        padding: "10px 12px",
        border: 0,
        borderTop: topBorder ? `1px solid ${C.gray100}` : "none",
        background: "transparent",
        color: C.ink,
        fontSize: 14, fontWeight: 600,
        fontFamily: FONT,
        letterSpacing: "-0.01em",
        borderRadius: topBorder ? 0 : 8,
        cursor: "pointer",
        textAlign: "left",
        transition: "background .12s ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = C.gray100; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ display: "grid", placeItems: "center", width: 18, height: 18, color: C.gray600, flexShrink: 0 }}>
        {icon}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {rightText && <span style={{ fontSize: 12, color: C.gray500, fontWeight: 500 }}>{rightText}</span>}
    </button>
  );
}

/* ===== 이미지 썸네일 + 라이트박스 (뷰포트 안에 contain) ===== */
function ImageThumb({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        style={{
          display: "block",
          lineHeight: 0,
          borderRadius: 16,
          overflow: "hidden",
          maxWidth: 140,
          border: 0,
          padding: 0,
          background: "transparent",
          cursor: "zoom-in",
        }}
      >
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          style={{
            display: "block",
            maxWidth: 140,
            maxHeight: 160,
            width: "auto",
            height: "auto",
            borderRadius: 16,
          }}
        />
      </button>
      {open && <ImageLightbox src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // 채팅 미니앱 컨테이너에 transform 이 걸려있어 position:fixed 가 viewport 가 아니라
  // 그 컨테이너 기준으로 잡히는 문제 → document.body 로 portal 해서 진짜 풀 화면.
  // [중요] React portal 은 React 트리 따라 이벤트가 버블링되므로, 여기서 mousedown 을
  // stopPropagation 안 하면 닫기 직후 사라진 모달 위치의 React 부모(LongPress)가
  // mousedown 만 받고 mouseup 은 못 받아 롱프레스 타이머가 발동되는 버그가 생김.
  return createPortal(
    <div
      role="dialog"
      onMouseDown={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, .82)",
        display: "grid",
        placeItems: "center",
        padding: 24,
        animation: "hinest-fade .12s ease",
      }}
    >
      <style>{`@keyframes hinest-fade { from { opacity: 0 } to { opacity: 1 } }`}</style>
      <img
        src={src}
        alt={alt}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          maxWidth: "min(96vw, 1600px)",
          maxHeight: "94vh",
          width: "auto",
          height: "auto",
          objectFit: "contain",
          borderRadius: 8,
          boxShadow: "0 16px 48px rgba(0,0,0,.4)",
        }} loading="lazy" decoding="async"/>
      <button
        type="button"
        onClick={onClose}
        aria-label="닫기"
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          width: 40,
          height: 40,
          borderRadius: 999,
          background: "rgba(255,255,255,.12)",
          border: 0,
          color: "#fff",
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
          backdropFilter: "blur(8px)",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
      <a
        href={src}
        download={alt || undefined}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="다운로드"
        style={{
          position: "absolute",
          top: 16,
          right: 64,
          width: 40,
          height: 40,
          borderRadius: 999,
          background: "rgba(255,255,255,.12)",
          color: "#fff",
          textDecoration: "none",
          display: "grid",
          placeItems: "center",
          backdropFilter: "blur(8px)",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M7 10l5 5 5-5" />
          <path d="M12 15V3" />
        </svg>
      </a>
    </div>,
    document.body,
  );
}

/* ===== 메시지 컨텍스트 메뉴(이모지 + 액션) ===== */
const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export type MessageAction = {
  key: string;
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  onSelect: () => void;
};

export function ReactionPicker({
  mine,
  onPick,
  onDismiss,
  actions = [],
  header,
}: {
  mine: boolean;
  onPick: (emoji: string) => void;
  onDismiss: () => void;
  actions?: MessageAction[];
  /** 액션 메뉴 상단에 표시할 부가 정보(예: 보낸 시각) */
  header?: string;
}) {
  // 버블 위에 띄움. 바깥 클릭 시 닫기.
  useEffect(() => {
    const onDown = () => onDismiss();
    const t = window.setTimeout(
      () => window.addEventListener("mousedown", onDown),
      0
    );
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onDismiss]);

  // 긴 버블일 때 위쪽으로 띄우면 스크롤 컨테이너/뷰포트에서 잘리므로
  // 렌더 직후 측정 → 잘리면 버블 하단으로 뒤집음.
  const ref = useRef<HTMLDivElement | null>(null);
  const [flip, setFlip] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // 가장 가까운 스크롤 가능한 조상 찾기
    let p: HTMLElement | null = el.parentElement;
    let limitTop = 0;
    while (p) {
      const style = window.getComputedStyle(p);
      if (/(auto|scroll)/.test(style.overflowY)) {
        limitTop = p.getBoundingClientRect().top;
        break;
      }
      p = p.parentElement;
    }
    if (r.top < limitTop + 4) setFlip(true);
  }, []);

  return (
    <div
      ref={ref}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        ...(flip
          ? { top: "calc(100% + 6px)" }
          : { bottom: "calc(100% + 6px)" }),
        [mine ? "right" : "left"]: 0,
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        alignItems: mine ? "flex-end" : "flex-start",
        gap: 8,
        animation: "hinest-pop .14s cubic-bezier(.22,.61,.36,1)",
      } as React.CSSProperties}
    >
      <style>{`@keyframes hinest-pop {
        from { transform: scale(.85) translateY(4px); opacity: 0; }
        to   { transform: scale(1) translateY(0); opacity: 1; }
      }`}</style>

      {/* 이모지 행 */}
      <div
        style={{
          background: C.surface,
          border: `1px solid ${C.gray200}`,
          borderRadius: 999,
          padding: "4px 6px",
          display: "flex",
          alignItems: "center",
          gap: 2,
          boxShadow:
            "0 8px 24px rgba(25, 31, 40, .14), 0 2px 6px rgba(25, 31, 40, .06)",
        }}
      >
        {QUICK_EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onPick(e)}
            style={{
              width: 32,
              height: 32,
              borderRadius: 999,
              background: "transparent",
              border: 0,
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              display: "grid",
              placeItems: "center",
              transition: "background .12s ease, transform .12s ease",
            }}
            onMouseEnter={(ev) => {
              ev.currentTarget.style.background = C.gray100;
              ev.currentTarget.style.transform = "scale(1.15)";
            }}
            onMouseLeave={(ev) => {
              ev.currentTarget.style.background = "transparent";
              ev.currentTarget.style.transform = "scale(1)";
            }}
          >
            {e}
          </button>
        ))}
      </div>

      {/* 액션 메뉴 */}
      {(actions.length > 0 || header) && (
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.gray200}`,
            borderRadius: 14,
            minWidth: 200,
            padding: 4,
            boxShadow:
              "0 10px 28px rgba(25, 31, 40, .16), 0 2px 6px rgba(25, 31, 40, .06)",
            overflow: "hidden",
          }}
        >
          {header && (
            <div
              style={{
                padding: "8px 12px 6px",
                fontSize: 11,
                fontWeight: 600,
                color: C.gray500,
                fontFamily: FONT,
                borderBottom: `1px solid ${C.gray100}`,
                marginBottom: 2,
              }}
            >
              {header}
            </div>
          )}
          {actions.map((a, i) => (
            <button
              key={a.key}
              type="button"
              onClick={() => {
                a.onSelect();
                onDismiss();
              }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                background: "transparent",
                border: 0,
                borderTop: i === 0 ? "none" : `1px solid ${C.gray100}`,
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 600,
                fontFamily: FONT,
                color: a.danger ? C.red : C.ink,
                textAlign: "left",
                transition: "background .12s ease",
              }}
              onMouseEnter={(ev) => {
                ev.currentTarget.style.background = C.gray100;
              }}
              onMouseLeave={(ev) => {
                ev.currentTarget.style.background = "transparent";
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  display: "grid",
                  placeItems: "center",
                  color: a.danger ? C.red : C.gray600,
                }}
              >
                {a.icon}
              </span>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* 액션 아이콘 (stroke-current) */
const ICON_SVG = (d: React.ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);
export const ActionIcons = {
  copy: ICON_SVG(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>),
  download: ICON_SVG(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></>),
  pin: ICON_SVG(<><path d="M12 17v5" /><path d="M5 2h14l-2 7 3 5H4l3-5-2-7z" /></>),
  unpin: ICON_SVG(<><path d="M3 3l18 18" /><path d="M12 17v5" /><path d="M5 2h14l-2 7 3 5h-5" /></>),
  trash: ICON_SVG(<><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></>),
};

/** 같은 이모지끼리 그룹핑 + 카운트 + 누구 단건지 이름 배열 */
export function groupReactions(list: Reaction[]) {
  const map = new Map<
    string,
    { emoji: string; count: number; userIds: string[]; names: string[] }
  >();
  for (const r of list) {
    const g = map.get(r.emoji) ?? {
      emoji: r.emoji,
      count: 0,
      userIds: [],
      names: [],
    };
    g.count += 1;
    g.userIds.push(r.userId);
    if (r.user?.name) g.names.push(r.user.name);
    map.set(r.emoji, g);
  }
  return Array.from(map.values());
}

/** 서버가 이미 검증하지만 렌더 단에서 한 번 더 방어 — /uploads/ 경로만 허용 */
export function safeFileUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  return /^\/uploads\/[A-Za-z0-9._-]+$/.test(u) ? u : null;
}

/* ===== 메시지 버블 — 텍스트 / 이미지 / 비디오 / 파일 =====
 *
 * React.memo 로 감싼다. 메시지 리스트는 거의 append-only 라 대부분의 기존 버블은
 * props 가 그대로다 (msg 참조·mine 동일). memo 로 재렌더를 차단하면 1.5초 증분
 * 폴링마다 전체 리스트가 아니라 "새로 추가된 것" 만 렌더된다.
 *
 * msg 는 서버 응답이 들어올 때마다 새 객체지만, 증분 폴링은 기존 요소를 그대로
 * 두고 새 요소만 append 하므로 기존 msg reference 는 유지된다. full 동기화
 * 때는 배열 전체가 새로 만들어져 모두 재렌더되는데, 그건 15초에 한 번이라 허용.
 */
function MessageBubbleInner({ msg, mine }: { msg: Message; mine: boolean }) {
  const fileUrl = safeFileUrl(msg.fileUrl);
  const hasFile = !!fileUrl;
  const hasText = !!msg.content?.trim();

  // 이미지: 버블 없이 썸네일. 캡션은 아래 작은 버블.
  if (hasFile && msg.kind === "IMAGE") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: mine ? "flex-end" : "flex-start",
          gap: 4,
        }}
      >
        <ImageThumb src={fileUrl!} alt={msg.fileName ?? ""} />
        {hasText && <TextBubble content={msg.content} mine={mine} />}
        <SaveToDocsChip fileUrl={fileUrl!} fileName={msg.fileName ?? null} fileType={msg.fileType ?? null} fileSize={typeof msg.fileSize === "number" ? msg.fileSize : null} mine={mine} />
      </div>
    );
  }

  // 비디오: 컨트롤 달린 플레이어.
  if (hasFile && msg.kind === "VIDEO") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: mine ? "flex-end" : "flex-start",
          gap: 4,
        }}
      >
        {/* 기능(전체화면·다운로드·재생속도·PIP) 은 유지하되 Chrome 기본 3점 메뉴는
            너무 크고 좁은 채팅 패널에서 잘려서 UI 가 구림 → controlsList 로 기본 메뉴
            항목 전부 숨기고, 우리가 직접 styled 한 커스텀 오버플로 메뉴로 대체. */}
        <ChatVideoPlayer src={fileUrl!} fileName={msg.fileName ?? null} />
        {hasText && <TextBubble content={msg.content} mine={mine} />}
        <SaveToDocsChip fileUrl={fileUrl!} fileName={msg.fileName ?? null} fileType={msg.fileType ?? null} fileSize={typeof msg.fileSize === "number" ? msg.fileSize : null} mine={mine} />
      </div>
    );
  }

  // 파일: 다운로드 카드.
  if (hasFile && msg.kind === "FILE") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: mine ? "flex-end" : "flex-start",
          gap: 4,
        }}
      >
        <a
          href={fileUrl!}
          target="_blank"
          rel="noreferrer"
          download={msg.fileName ?? undefined}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            background: mine ? C.blue : C.bubbleOther,
            color: mine ? C.brandFg : C.ink,
            borderRadius: 14,
            textDecoration: "none",
            maxWidth: 240,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: mine ? "rgba(255,255,255,.2)" : C.surface,
              color: mine ? C.brandFg : C.gray700,
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {msg.fileName ?? "파일"}
            </div>
            {typeof msg.fileSize === "number" && (
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  opacity: 0.75,
                  marginTop: 2,
                }}
              >
                {formatBytes(msg.fileSize)}
              </div>
            )}
          </div>
        </a>
        {hasText && <TextBubble content={msg.content} mine={mine} />}
        <SaveToDocsChip fileUrl={fileUrl!} fileName={msg.fileName ?? null} fileType={msg.fileType ?? null} fileSize={typeof msg.fileSize === "number" ? msg.fileSize : null} mine={mine} />
      </div>
    );
  }

  // 기본: 텍스트 버블
  return <TextBubble content={msg.content} mine={mine} />;
}

// 얕은 비교로 충분 — msg 는 서버에서 객체 그대로 넘어오고, 증분 폴링 때 기존 요소의
// 참조는 바뀌지 않는다. full 동기화(15초 주기) 시에만 reference 가 새로 만들어져
// 재렌더가 발생 → 의도된 동작.
export const MessageBubble = memo(
  MessageBubbleInner,
  (a, b) => a.mine === b.mine && a.msg === b.msg
);

// URL 자동 링크화 — http(s):// 또는 www. 로 시작하는 문자열을 <a> 로 변환.
// 안전 조치: href 는 반드시 http/https 로만 구성하고, rel=noopener noreferrer + target=_blank.
const URL_REGEX = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;

function renderWithLinks(content: string, mine: boolean): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(content)) !== null) {
    const raw = match[0];
    const start = match.index;
    if (start > lastIndex) nodes.push(content.slice(lastIndex, start));
    // 문장 끝 구두점은 링크에서 제외
    const trailing = raw.match(/[).,!?;:]+$/);
    const clean = trailing ? raw.slice(0, raw.length - trailing[0].length) : raw;
    const href = clean.startsWith("http") ? clean : `https://${clean}`;
    nodes.push(
      <a
        key={start}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: mine ? "#fff" : C.blue,
          textDecoration: "underline",
          textUnderlineOffset: 2,
          wordBreak: "break-all",
        }}
        onClick={(e) => {
          e.stopPropagation();
          // Electron 데스크톱 앱 안에서는 OS 기본 브라우저로 강제 열기
          const bridge = window.hinest;
          if (bridge?.openExternal) {
            e.preventDefault();
            bridge.openExternal(href).catch(() => {});
          }
        }}
      >
        {clean}
      </a>
    );
    if (trailing) nodes.push(trailing[0]);
    lastIndex = start + raw.length;
  }
  if (lastIndex < content.length) nodes.push(content.slice(lastIndex));
  return nodes;
}

/** 마크다운 블록(>, -, 1.) + 인라인(**, *, ~~, URL) 을 React 노드로. */
function MarkdownText({ text, mine }: { text: string; mine: boolean }) {
  const blocks = splitBlocks(text);
  // 텍스트 안의 URL 링크화는 종전 renderWithLinks 를 그대로 쓰되, 인라인 마크다운 후에 호출.
  const inline = (s: string, key: string) => <span key={key}>{renderWithLinks(s, mine)}</span>;
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === "blockquote") {
          return (
            <blockquote
              key={i}
              style={{
                margin: "4px 0",
                padding: "2px 10px",
                borderLeft: `3px solid ${mine ? "rgba(255,255,255,0.45)" : "var(--c-border-strong)"}`,
                color: mine ? "rgba(255,255,255,0.9)" : "var(--c-text-2)",
                fontStyle: "normal",
              }}
            >
              {renderInlineMarkdown(b.text, inline)}
            </blockquote>
          );
        }
        if (b.kind === "ul") {
          return (
            <ul key={i} style={{ margin: "4px 0", paddingLeft: 22 }}>
              {b.items.map((it, j) => (
                <li key={j}>{renderInlineMarkdown(it, inline)}</li>
              ))}
            </ul>
          );
        }
        if (b.kind === "ol") {
          return (
            <ol key={i} start={b.start} style={{ margin: "4px 0", paddingLeft: 22 }}>
              {b.items.map((it, j) => (
                <li key={j}>{renderInlineMarkdown(it, inline)}</li>
              ))}
            </ol>
          );
        }
        return <span key={i}>{renderInlineMarkdown(b.text, inline)}</span>;
      })}
    </>
  );
}

export function TextBubble({
  content,
  mine,
}: {
  content: string;
  mine: boolean;
}) {
  // 코드(펜스/인라인/휴리스틱) 영역을 떼어내고 일반 텍스트만 URL 링크화.
  const segments = parseCodeSegments(content);
  const hasBlockCode = segments.some((s) => s.kind === "code");
  // 메시지가 사실상 "코드 블록만" 일 때(텍스트 segment 가 모두 비었음) 채팅 버블의 색·패딩
  // 전체를 떼어낸다. 종전엔 mine 의 파란 배경이 좌우 8px 띠로 남아 코드 박스 옆에 어색한
  // 프레임처럼 보였음. 이 경우엔 코드 박스 자체가 메시지의 시각적 컨테이너.
  const codeOnly =
    hasBlockCode &&
    segments.every((s) => s.kind === "code" || (s.kind === "text" && !s.text.trim()));
  return (
    <div
      style={{
        // codeOnly 면 패딩/배경 제거 → 코드 박스가 끝까지 차지.
        padding: codeOnly ? 0 : hasBlockCode ? "8px 8px" : "9px 13px",
        fontSize: 14,
        fontWeight: 500,
        lineHeight: 1.4,
        letterSpacing: "-0.01em",
        wordBreak: "break-word",
        overflowWrap: "anywhere",
        whiteSpace: "pre-wrap",
        minWidth: 0,
        maxWidth: "100%",
        color: mine ? C.brandFg : C.ink,
        background: codeOnly ? "transparent" : (mine ? C.blue : C.bubbleOther),
        borderRadius: 16,
        fontFamily: FONT,
      }}
    >
      {segments.map((seg, i) => {
        if (seg.kind === "code") return <CodeBlockBubble key={i} code={seg.code} lang={seg.lang} mine={mine} />;
        if (seg.kind === "inline-code") return <InlineCode key={i} code={seg.code} mine={mine} />;
        return <MarkdownText key={i} text={seg.text} mine={mine} />;
      })}
      {/* 첫 번째 URL 의 링크 프리뷰 — 코드 segment 의 URL 은 parseCodeSegments 가 떼어낸 뒤라
          텍스트 segment 안에서만 검색됨. 메시지당 1개만 노출해 UI 부풀림 방지. */}
      {(() => {
        for (const s of segments) {
          if (s.kind !== "text") continue;
          const u = extractFirstUrl(s.text);
          if (u) return <LinkPreview key="lp" url={u} mine={mine} />;
        }
        return null;
      })()}
    </div>
  );
}

const CODE_FONT =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

function InlineCode({ code, mine }: { code: string; mine: boolean }) {
  return (
    <code
      style={{
        fontFamily: CODE_FONT,
        fontSize: 12.5,
        padding: "1px 5px",
        margin: "0 1px",
        borderRadius: 4,
        background: mine ? "rgba(255,255,255,0.18)" : "var(--c-surface-3)",
        color: mine ? "#fff" : "var(--c-text)",
        wordBreak: "break-word",
      }}
    >
      {code}
    </code>
  );
}

function CodeBlockBubble({ code, lang, mine }: { code: string; lang?: string; mine: boolean }) {
  const [viewerOpen, setViewerOpen] = useState(false);
  // 짧은 코드는 굳이 전체보기를 띄울 필요 없어서 8줄 / 400자 기준으로 노출.
  const lineCount = (code.match(/\n/g)?.length ?? 0) + 1;
  const showExpand = lineCount > 8 || code.length > 400;
  return (
    <div
      // .code-block 클래스를 박아서 styles.css 가 hljs 다크 팔레트로 강제 — 라이트 테마에서도
      // 코드 영역만큼은 항상 어두운 inset 으로 통일 (Slack/Discord 패턴).
      className="code-block"
      style={{
        // display:block + width:100% + min-width:0 콤보 — flex 부모가 0 1 auto 일 때
        // 안에 든 long-content `pre` 가 버블을 부풀려 채팅 영역 밖으로 새는 것 방지.
        display: "block",
        width: "100%",
        minWidth: 0,
        maxWidth: "100%",
        boxSizing: "border-box",
        position: "relative",
        margin: "4px 0",
        borderRadius: 10,
        // mine(파란 버블) / 상대(회색 버블) 모두 동일한 어두운 코드 surface — 색을 통일해
        // 사용자가 어떤 버블에서 코드를 봐도 같은 가독성.
        background: "#1B1F27",
        border: "1px solid rgba(255,255,255,0.10)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 8px 4px 10px",
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          // 코드 박스는 어두운 surface 로 통일했으니 헤더도 그에 맞춰 항상 옅은 흰색.
          color: "rgba(255,255,255,0.7)",
          borderBottom: "1px solid rgba(255,255,255,0.10)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <LangIcon lang={lang} size={13} />
          {lang || "code"}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            copyToClipboard(code, { title: "복사됨", description: "코드를 클립보드에 복사했어요." });
          }}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "inherit",
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.06em",
            padding: "2px 4px",
          }}
          title="코드 복사"
        >
          복사
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          fontFamily: CODE_FONT,
          fontSize: 12.5,
          lineHeight: 1.5,
          // pre-wrap + break-word: 좁은 화면에서 긴 줄이 자동으로 접힘. 의도된 \n 은 보존.
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          overflowWrap: "anywhere",
          maxHeight: "60vh",
          overflowY: "auto",
          maxWidth: "100%",
        }}
      >
        <HljsCode code={code} lang={lang} style={{ fontFamily: "inherit" }} />
      </pre>
      {showExpand && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setViewerOpen(true);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            padding: "6px 10px",
            background: "transparent",
            border: "none",
            borderTop: "1px solid rgba(255,255,255,0.10)",
            color: "rgba(255,255,255,0.85)",
            fontSize: 11.5,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          전체보기 ({lineCount}줄)
        </button>
      )}
      {viewerOpen && (
        <CodeViewerModal code={code} lang={lang} onClose={() => setViewerOpen(false)} />
      )}
    </div>
  );
}

/** 코드 전체보기 — 화면 거의 전체 차지하는 모달.
 *  큰 폰트·줄번호·복사 버튼 제공. Esc 로 닫기 + 배경 스크롤 잠금은 useModalDismiss. */
function CodeViewerModal({ code, lang, onClose }: { code: string; lang?: string; onClose: () => void }) {
  useModalDismiss(true, onClose);
  const lines = code.split("\n");
  const lineNumWidth = String(lines.length).length * 9 + 16; // 자릿수에 따라 좌측 패딩.
  // 채팅 미니앱 컨테이너에 transform 이 걸려있어 자식의 position:fixed 가 viewport 가 아니라
  // 그 컨테이너 기준으로 잡힘 → portal 로 document.body 에 직접 마운트.
  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        // dim 은 약하게(0.45) 두고 backdrop-filter 로 강하게 흐림(blur 12px) — 배경이 보이긴 하되
        // 어떤 콘텐츠인지 식별 안 될 정도로 부드럽게. 모달은 100% 불투명 패널이라 가독성 영향 없음.
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(12px) saturate(1.2)",
        WebkitBackdropFilter: "blur(12px) saturate(1.2)",
        display: "grid",
        placeItems: "center",
        padding: "max(env(safe-area-inset-top), 16px) 16px max(env(safe-area-inset-bottom), 16px)",
      }}
      // 같은 portal 버블링 방지 — 닫기 후 React 부모 LongPress 가 mousedown 만 받고
      // mouseup 못 받아 롱프레스 메뉴가 자동으로 뜨는 사고 차단.
      onMouseDown={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1100px, 100%)",
          height: "100%",
          maxHeight: "100%",
          // 패널은 불투명한 surface — 종전엔 토큰 var 가 일부 환경에서 투명하게 잡혀 배경이 비쳤음.
          background: "var(--c-surface)",
          color: "var(--c-text)",
          borderRadius: 14,
          border: "1px solid var(--c-border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* 헤더 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderBottom: "1px solid var(--c-border)",
            background: "var(--c-surface-2)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: "3px 8px",
              borderRadius: 6,
              background: "var(--c-surface-3)",
              color: "var(--c-text-3)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <LangIcon lang={lang} size={14} />
            {lang || "code"}
          </div>
          <div style={{ flex: 1, fontSize: 12, color: "var(--c-text-3)" }}>
            {lines.length}줄 · {code.length.toLocaleString()}자
          </div>
          <button
            type="button"
            onClick={() =>
              copyToClipboard(code, { title: "복사됨", description: "코드를 클립보드에 복사했어요." })
            }
            className="btn-ghost btn-xs"
          >
            복사
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost btn-xs"
            aria-label="닫기"
            title="닫기 (Esc)"
          >
            ✕
          </button>
        </div>
        {/* 본문 — 줄번호 + 코드. 둘 다 불투명한 surface 위에 그려야 배경 비치지 않음. */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            background: "var(--c-surface)",
          }}
        >
          <div style={{ display: "flex", alignItems: "stretch", minHeight: "100%" }}>
            {/* 줄번호 칼럼 — 따로 둬서 복사 시 줄번호가 같이 따라오지 않도록. */}
            <pre
              aria-hidden
              style={{
                margin: 0,
                padding: "12px 8px",
                paddingLeft: 12,
                fontFamily: CODE_FONT,
                fontSize: 13,
                lineHeight: 1.6,
                color: "var(--c-text-3)",
                background: "var(--c-surface-2)",
                borderRight: "1px solid var(--c-border)",
                userSelect: "none",
                textAlign: "right",
                minWidth: lineNumWidth,
                whiteSpace: "pre",
                flexShrink: 0,
              }}
            >
              {lines.map((_, i) => `${i + 1}\n`).join("")}
            </pre>
            <pre
              style={{
                margin: 0,
                padding: "12px 14px",
                fontFamily: CODE_FONT,
                fontSize: 13,
                lineHeight: 1.6,
                whiteSpace: "pre",
                overflowX: "auto",
                flex: 1,
                minWidth: 0,
                background: "var(--c-surface)",
              }}
            >
              <HljsCode code={code} lang={lang} style={{ fontFamily: "inherit" }} />
            </pre>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ===== 첨부 미리보기 (전송 전 입력바 위) ===== */
export function AttachmentPreview({
  att,
  onClear,
}: {
  att: Attachment;
  onClear: () => void;
}) {
  const common = {
    position: "relative" as const,
    display: "inline-flex",
    borderRadius: 14,
    overflow: "hidden",
    background: C.gray100,
    border: `1px solid ${C.gray200}`,
  };

  let body: React.ReactNode;
  if (att.kind === "IMAGE") {
    body = (
      <img
        src={att.url}
        alt={att.name}
        loading="lazy"
        decoding="async"
        style={{ display: "block", width: 72, height: 72, objectFit: "cover" }}
      />
    );
  } else if (att.kind === "VIDEO") {
    body = (
      <div
        style={{
          width: 180,
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "#111",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: C.ink,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {att.name}
          </div>
          <div style={{ fontSize: 11, color: C.gray600, marginTop: 2 }}>
            {formatBytes(att.size)}
          </div>
        </div>
      </div>
    );
  } else {
    body = (
      <div
        style={{
          width: 180,
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: C.surface,
            color: C.gray700,
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
            border: `1px solid ${C.gray200}`,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: C.ink,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {att.name}
          </div>
          <div style={{ fontSize: 11, color: C.gray600, marginTop: 2 }}>
            {formatBytes(att.size)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={common}>
      {body}
      <button
        type="button"
        onClick={onClear}
        title="첨부 제거"
        aria-label="첨부 제거"
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          width: 22,
          height: 22,
          borderRadius: 999,
          background: "rgba(0,0,0,.55)",
          color: "#fff",
          border: 0,
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
