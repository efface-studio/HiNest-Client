import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { C, FONT, formatBytes } from "./theme";
import type { Attachment, Message, Reaction } from "./types";
import { api, imgSrc } from "../../api";
import { alertAsync } from "../ConfirmHost";
import { parseCodeSegments } from "../../lib/codeDetect";
import { copyToClipboard } from "../../lib/clipboard";
import { downloadFromUrl } from "../../lib/download";
import { openExternal } from "../../lib/openExternal";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { HljsCode } from "../../lib/useHighlightedCode";
import { LangIcon } from "../../lib/langIcon";
import { splitBlocks, renderInlineMarkdown } from "../../lib/markdown";
import { LinkPreview, extractFirstUrl } from "./LinkPreview";

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
  onLongPress: (rect: DOMRect) => void;
  onDoubleTap?: () => void;
  delay?: number;
  style?: React.CSSProperties;
}) {
  const elRef = useRef<HTMLDivElement>(null);
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
      const r = elRef.current?.getBoundingClientRect();
      if (r) onLongPress(r);
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
      ref={elRef}
      className="chat-pressable"
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
        const r = elRef.current?.getBoundingClientRect();
        if (r) onLongPress(r);
      }}
      // 롱프레스/더블탭이 발동된 직후 따라오는 click 은 자식(이미지 뷰어 등)으로 내려가지 않게 차단
      onClickCapture={(e) => {
        if (firedRef.current) {
          e.preventDefault();
          e.stopPropagation();
          firedRef.current = false;
        }
      }}
      // user-select 는 .chat-pressable 가 플랫폼별로 담당 — 모바일=none(롱프레스 공감 보호),
      // 데스크탑(.hinest-desktop)=text(메시지 텍스트 드래그 선택·복사). iOS 콜아웃만 인라인 유지.
      style={{
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
        src={imgSrc(src)}
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
function ImageThumb({ src, alt, fileName, fileType, fileSize }: { src: string; alt: string; fileName: string | null; fileType: string | null; fileSize: number | null }) {
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
          src={imgSrc(src)}
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
      {open && <ImageLightbox src={src} alt={alt} fileName={fileName} fileType={fileType} fileSize={fileSize} onClose={() => setOpen(false)} />}
    </>
  );
}

function ImageLightbox({
  src,
  alt,
  fileName,
  fileType,
  fileSize,
  onClose,
}: {
  src: string;
  alt: string;
  fileName: string | null;
  fileType: string | null;
  fileSize: number | null;
  onClose: () => void;
}) {
  const [savingDocs, setSavingDocs] = useState(false);
  const [savedDocs, setSavedDocs] = useState(false);
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

  async function saveToDocs() {
    if (savingDocs || savedDocs) return;
    setSavingDocs(true);
    try {
      await api("/api/document", {
        method: "POST",
        json: { title: fileName ?? "사진", description: "채팅방에서 저장", fileUrl: src, fileName, fileType, fileSize, scope: "ALL" },
      });
      setSavedDocs(true);
    } catch (e: any) {
      alertAsync({ title: "문서함 저장 실패", description: e?.message ?? "저장에 실패했어요" });
    } finally {
      setSavingDocs(false);
    }
  }

  // document.body 로 portal — 채팅 패널 transform 영향 없이 진짜 풀스크린.
  // [중요] mousedown 은 stopPropagation 해 React 부모(LongPress)로 안 새게 한다(롱프레스 오발동 방지).
  // 닫기는 onClick(탭 업)으로 — iOS 에서 onMouseDown(탭다운 즉시 닫힘)보다 탭에 안정적이라 'X·배경
  // 안 먹힘'을 해결. 풀스크린 flexbox 센터 + box-sizing 으로 이미지가 넘쳐 한쪽으로 치우치던 것도 해결.
  return createPortal(
    <div
      role="dialog"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,.92)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // 상단은 버튼줄(safe-area+64), 좌우/하단 여유. 이미지 maxWidth/Height:100% 가 이 패딩 박스 기준.
        padding:
          "calc(env(safe-area-inset-top) + 64px) 16px calc(env(safe-area-inset-bottom) + 16px)",
        boxSizing: "border-box",
        animation: "hinest-fade .12s ease",
      }}
    >
      <style>{`@keyframes hinest-fade { from { opacity: 0 } to { opacity: 1 } }`}</style>
      <img
        src={imgSrc(src)}
        alt={alt}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          width: "auto",
          height: "auto",
          objectFit: "contain",
          borderRadius: 8,
          boxShadow: "0 16px 48px rgba(0,0,0,.4)",
        }}
        loading="lazy"
        decoding="async"
      />
      {/* 상단 버튼줄 — safe-area 아래. 좌: 사진 저장·문서함 저장, 우: 닫기. 탭이 배경 닫기로 안 새게 stop. */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: "calc(env(safe-area-inset-top) + 12px)",
          left: 16,
          right: 16,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", gap: 10 }}>
          {/* 사진 저장 — iOS/안드는 downloadFromUrl 이 네이티브 저장(공유시트 등) 처리. */}
          <button
            type="button"
            aria-label="사진 저장"
            title="사진 저장"
            onClick={() => downloadFromUrl(src, fileName ?? "")}
            style={{ width: 44, height: 44, borderRadius: 999, background: "rgba(255,255,255,.16)", border: 0, color: "#fff", cursor: "pointer", display: "grid", placeItems: "center", WebkitBackdropFilter: "blur(8px)", backdropFilter: "blur(8px)" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M7 10l5 5 5-5" />
              <path d="M12 15V3" />
            </svg>
          </button>
          {/* 문서함 저장 */}
          <button
            type="button"
            aria-label="문서함 저장"
            title={savedDocs ? "문서함에 저장됨" : "문서함 저장"}
            onClick={saveToDocs}
            disabled={savingDocs || savedDocs}
            style={{ width: 44, height: 44, borderRadius: 999, background: "rgba(255,255,255,.16)", border: 0, color: "#fff", cursor: savingDocs || savedDocs ? "default" : "pointer", opacity: savedDocs ? 0.6 : 1, display: "grid", placeItems: "center", WebkitBackdropFilter: "blur(8px)", backdropFilter: "blur(8px)" }}
          >
            {savedDocs ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
            )}
          </button>
        </div>
        {/* 닫기 */}
        <button
          type="button"
          aria-label="닫기"
          title="닫기"
          onClick={onClose}
          style={{ width: 44, height: 44, borderRadius: 999, background: "rgba(255,255,255,.16)", border: 0, color: "#fff", cursor: "pointer", display: "grid", placeItems: "center", WebkitBackdropFilter: "blur(8px)", backdropFilter: "blur(8px)" }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
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

/**
 * 메시지 롱프레스 컨텍스트 메뉴 — iOS 네이티브('peek') 스타일.
 * 풀스크린 블러+딤 backdrop 위에 [이모지 반응 바 · 강조된 메시지 버블 · 액션 메뉴]를 세로로 띄운다.
 * 채팅 컨테이너에 transform 이 걸려 있어 position:fixed 가 어긋나므로 document.body 로 portal.
 * anchorRect(원본 버블 위치)를 측정해 버블을 제자리 근처에 두되, 위/아래가 화면 밖으로
 * 안 나가게 그룹 위치를 클램프한다. (useLayoutEffect = paint 전 보정이라 깜빡임 없음)
 */
export function ReactionPicker({
  anchorRect,
  mine,
  onPick,
  onDismiss,
  actions = [],
  header,
  children,
}: {
  anchorRect: DOMRect;
  mine: boolean;
  onPick: (emoji: string) => void;
  onDismiss: () => void;
  actions?: MessageAction[];
  /** 메뉴 상단 부가 정보(보낸 시각) */
  header?: string;
  /** 강조해 보여줄 메시지 버블(원본과 동일 렌더) */
  children: React.ReactNode;
}) {
  const groupRef = useRef<HTMLDivElement | null>(null);
  const [top, setTop] = useState<number>(anchorRect.top);
  const [ready, setReady] = useState(false);
  const [closing, setClosing] = useState(false);
  // 메뉴가 뜨자마자(롱프레스를 떼는 포인터로) 바로 닫히지 않게 — backdrop 위에서 새로
  // 시작된 탭일 때만 닫는다. 닫을 땐 짧게 페이드아웃 후 언마운트.
  const armedRef = useRef(false);
  const closingRef = useRef(false);
  const requestClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(onDismiss, 150);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") requestClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  useLayoutEffect(() => {
    const el = groupRef.current;
    if (!el) return;
    const groupH = el.offsetHeight;
    const vh = window.innerHeight;
    const safeTop = 56;     // 상태바/노치 여유
    const safeBottom = 36;  // 홈 인디케이터 여유
    // 어느 메시지를 누르든 항상 같은 자리(화면 세로 중앙쯤)에 뜨게 — 메시지 위치(위/아래)
    // 따라 팝업이 흔들리지 않도록 고정. 너무 길면 위/아래 safe-area 안으로 클램프.
    let t = Math.round((vh - groupH) / 2);
    if (t + groupH > vh - safeBottom) t = vh - safeBottom - groupH;
    if (t < safeTop) t = safeTop;
    setTop(t);
    setReady(true);
  }, [anchorRect]);

  const vw = typeof window !== "undefined" ? window.innerWidth : 0;
  const EDGE = 10;
  const MIN_W = 224;
  const side: React.CSSProperties = mine
    ? { right: Math.max(EDGE, Math.min(vw - anchorRect.right, vw - MIN_W - EDGE)) }
    : { left: Math.max(EDGE, Math.min(anchorRect.left, vw - MIN_W - EDGE)) };

  return createPortal(
    <div
      onPointerDown={() => { armedRef.current = true; }}
      onClick={() => { if (armedRef.current) requestClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.28)",
        backdropFilter: "blur(6px) saturate(1.05)",
        WebkitBackdropFilter: "blur(6px) saturate(1.05)",
        animation: closing ? "hinest-ctx-fadeout .15s ease forwards" : "hinest-ctx-fade .18s ease",
      }}
    >
      <style>{`
        @keyframes hinest-ctx-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes hinest-ctx-fadeout { from { opacity: 1 } to { opacity: 0 } }
        @keyframes hinest-ctx-pop { from { opacity: 0; transform: scale(.9) } to { opacity: 1; transform: scale(1) } }
        @keyframes hinest-ctx-popout { from { opacity: 1; transform: scale(1) } to { opacity: 0; transform: scale(.94) } }
      `}</style>

      <div
        ref={groupRef}
        style={{
          position: "fixed",
          top,
          ...side,
          display: "flex",
          flexDirection: "column",
          alignItems: mine ? "flex-end" : "flex-start",
          gap: 10,
          maxWidth: "min(86vw, 360px)",
          opacity: ready ? 1 : 0,
          transformOrigin: "center",
          animation: closing
            ? "hinest-ctx-popout .15s ease forwards"
            : ready ? "hinest-ctx-pop .2s cubic-bezier(.2,.7,.3,1)" : undefined,
        } as React.CSSProperties}
      >
        {/* 이모지 반응 바 — 자기 위 탭은 backdrop 로 안 새게 차단 */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: C.surface,
            borderRadius: 999,
            padding: "5px 8px",
            display: "flex",
            alignItems: "center",
            gap: 2,
            border: `1px solid ${C.gray200}`,
            boxShadow: "0 12px 34px rgba(0,0,0,.3)",
          }}
        >
          {QUICK_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => { onPick(e); requestClose(); }}
              style={{
                width: 38,
                height: 38,
                borderRadius: 999,
                background: "transparent",
                border: 0,
                cursor: "pointer",
                fontSize: 23,
                lineHeight: 1,
                display: "grid",
                placeItems: "center",
                transition: "transform .1s ease",
              }}
              onMouseEnter={(ev) => { ev.currentTarget.style.transform = "scale(1.22)"; }}
              onMouseLeave={(ev) => { ev.currentTarget.style.transform = "scale(1)"; }}
            >
              {e}
            </button>
          ))}
        </div>

        {/* 강조된 메시지 버블(원본과 동일) */}
        <div data-ctx-bubble style={{ pointerEvents: "none", maxWidth: "100%" }}>
          {children}
        </div>

        {/* 액션 메뉴 — 자기 위 탭은 backdrop 로 안 새게 차단 */}
        {(actions.length > 0 || header) && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: C.surface,
              borderRadius: 16,
              minWidth: MIN_W,
              border: `1px solid ${C.gray200}`,
              boxShadow: "0 14px 38px rgba(0,0,0,.3)",
              overflow: "hidden",
            }}
          >
            {header && (
              <div
                style={{
                  padding: "9px 16px 7px",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: C.gray500,
                  fontFamily: FONT,
                }}
              >
                {header}
              </div>
            )}
            {actions.map((a, i) => (
              <button
                key={a.key}
                type="button"
                onClick={() => { a.onSelect(); requestClose(); }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 13,
                  padding: "13px 16px",
                  background: "transparent",
                  border: 0,
                  borderTop: (i === 0 && !header) ? "none" : `1px solid ${C.gray100}`,
                  cursor: "pointer",
                  fontSize: 15,
                  fontWeight: 500,
                  fontFamily: FONT,
                  color: a.danger ? C.red : C.ink,
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    flexShrink: 0,
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
    </div>,
    document.body,
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

  // 공유 카드 — 공지/메모/회의록 등. ShareSheet 가 보낸 메시지.
  // fileType 은 "share:announcement" 같은 식별자, fileName 은 카드 제목, fileUrl 은 deep link.
  if (msg.kind === "SHARE") {
    return <ShareCardBubble msg={msg} mine={mine} />;
  }

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
        <ImageThumb
          src={fileUrl!}
          alt={msg.fileName ?? ""}
          fileName={msg.fileName ?? null}
          fileType={msg.fileType ?? null}
          fileSize={typeof msg.fileSize === "number" ? msg.fileSize : null}
        />
        {hasText && <TextBubble content={msg.content} mine={mine} />}
        {/* 문서함 저장 칩은 사진 밑에서 제거 — 라이트박스(사진 확대)의 저장 버튼으로 이동. */}
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

// 공유 카드 — kind="SHARE" 메시지. fileType="share:announcement|memo|meeting|document|journal" 분기.
// 클릭 시 fileUrl 경로로 SPA 내 이동(react-router). 외부 링크가 들어와도 안전을 위해 same-origin 만.
const SHARE_LABEL: Record<string, { label: string; icon: string }> = {
  "share:announcement": { label: "공지", icon: "📣" },
  "share:memo": { label: "메모", icon: "📝" },
  "share:meeting": { label: "회의록", icon: "🗒️" },
  "share:document": { label: "문서", icon: "📄" },
  "share:journal": { label: "업무일지", icon: "🧾" },
};

function ShareCardBubble({ msg, mine }: { msg: Message; mine: boolean }) {
  const nav = useNavigate();
  const meta = SHARE_LABEL[msg.fileType ?? ""] ?? { label: "공유", icon: "🔗" };
  const href = msg.fileUrl ?? "#";
  // SPA 라우트만 허용 — 외부 absolute URL 은 보안상 차단(피싱 방지).
  const safe = href.startsWith("/") ? href : "#";
  function navigate(e: React.MouseEvent) {
    e.preventDefault();
    if (safe === "#") return;
    // 채팅 오버레이를 먼저 닫고(전체화면이라 안 닫으면 이동해도 가려짐) react-router 로 이동.
    // 이전엔 pushState+popstate 로 직접 바꿔 react-router location 이 갱신을 놓쳐 이동이 안 됐다.
    window.dispatchEvent(new CustomEvent("chat:close"));
    nav(safe);
  }
  const snippet =
    msg.content && msg.content.trim() && msg.content !== msg.fileName
      ? (msg.content.startsWith(`${msg.fileName ?? ""} — `)
          ? msg.content.slice((msg.fileName ?? "").length + 3)
          : msg.content)
      : "";
  // 다크/라이트 자동 대응 — CSS 변수. 카드는 항상 표면색(버블색과 분리되어 또렷).
  return (
    <a
      href={safe}
      onClick={navigate}
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 0,
        width: 264,
        maxWidth: "78vw",
        background: "var(--c-surface)",
        border: "1px solid var(--c-border)",
        borderRadius: 16,
        overflow: "hidden",
        textDecoration: "none",
        boxShadow: "0 1px 3px rgba(15,23,42,0.08)",
      }}
    >
      {/* 좌측 브랜드 컬러 바 + 아이콘 */}
      <div style={{ width: 44, flexShrink: 0, background: "var(--c-brand-soft)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19 }}>
        {meta.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0, padding: "11px 13px" }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--c-brand)", marginBottom: 3, letterSpacing: "0.02em" }}>
          {meta.label}
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3, color: "var(--c-text)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {msg.fileName ?? "(제목 없음)"}
        </div>
        {snippet && (
          <div style={{ fontSize: 12, color: "var(--c-text-3)", lineHeight: 1.4, marginTop: 3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {snippet}
          </div>
        )}
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--c-brand)", fontWeight: 700 }}>
          탭해서 열기 →
        </div>
      </div>
    </a>
  );
}

// URL 자동 링크화(group1) + @멘션 강조(group2).
// 안전 조치: href 는 반드시 http/https 로만 구성하고, rel=noopener noreferrer + target=_blank.
const URL_REGEX = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)|(@[\w가-힣._-]+)/gi;

function renderWithLinks(content: string, mine: boolean): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(content)) !== null) {
    const raw = match[0];
    const start = match.index;
    if (start > lastIndex) nodes.push(content.slice(lastIndex, start));
    // @멘션 — 파랑/볼드 강조(이름 태그). 그룹방에서 누른 사람 알림은 서버가 처리.
    if (match[2]) {
      nodes.push(
        <span key={start} style={{ color: mine ? "#dbe9ff" : C.blue, fontWeight: 700 }}>{raw}</span>
      );
      lastIndex = start + raw.length;
      continue;
    }
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
          e.preventDefault();
          openExternal(href);
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
        padding: "max(var(--sa-top, env(safe-area-inset-top)), 16px) 16px max(var(--sa-bottom, env(safe-area-inset-bottom)), 16px)",
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
        src={imgSrc(att.url)}
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
