/**
 * 공용 바텀시트 — iOS/iPadOS 에선 애플 UISheetPresentationController 느낌의 하단 시트,
 * 데스크탑(웹·Electron)에선 가운데 정렬 모달로 자동 전환한다.
 *
 * 왜 웹 시트인가:
 *   입력 폼이 많은 모달(일정 추가 등)은 진짜 네이티브 WebView 시트로 만들면 세션/쿠키 공유 +
 *   폼 제출 후 부모 갱신 메시지 패싱 + 이중 유지보수 비용이 매우 크다. 인스타·노션·토스도
 *   입력 폼 모달은 "웹 바텀시트 + 네이티브 느낌"으로 처리한다. 단순 카드/목록 UI(공유 시트)만
 *   진짜 네이티브로 간다(ShareSheet → presentShareSheet).
 *
 * 네이티브 느낌 요소:
 *   - 하단에서 스프링 슬라이드업(cubic-bezier(0.32,0.72,0,1))
 *   - 상단 그래버(grabber) 핸들 — 드래그해서 닫기(아래로 100px+ 끌면 닫힘, 손가락 추종)
 *   - 둥근 상단 모서리(22px) + 백드롭 페이드
 *   - safe-area-inset-bottom 흡수
 *   - 키보드 인셋(--hinest-keyboard-h)에 맞춰 콘텐츠가 위로 따라옴
 *
 * 데스크탑: 가운데 카드 모달(슬라이드업 대신 페이드+살짝 라이즈). 드래그 없음.
 *
 * 사용:
 *   <BottomSheet open={open} onClose={close} title="일정 추가" subtitle="...">
 *     ...폼...
 *     <BottomSheet.Footer>...버튼...</BottomSheet.Footer>   // 선택: 하단 고정 푸터
 *   </BottomSheet>
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import Portal from "./Portal";
import { nativePlatform } from "../lib/platform";

function isIOS(): boolean {
  return nativePlatform() === "ios";
}

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** 헤더 좌측 아이콘(색 배지 등). 없으면 생략. */
  icon?: ReactNode;
  /** 본문. 스크롤 가능 영역. */
  children: ReactNode;
  /** 하단 고정 푸터(저장·취소 등). 시트 바닥에 sticky. */
  footer?: ReactNode;
  /** 데스크탑 모달 최대 폭. 기본 640px. */
  maxWidth?: number;
  /** z-index. 기본 1000. */
  zIndex?: number;
};

export default function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  maxWidth = 640,
  zIndex = 1000,
}: BottomSheetProps) {
  const ios = isIOS();
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false); // 슬라이드업/페이드 트리거
  const [dragY, setDragY] = useState(0); // iOS 드래그 중 아래로 끌린 px
  const dragStartRef = useRef<number | null>(null);
  const closingRef = useRef(false);

  // open 토글 → 마운트/언마운트 + 슬라이드 애니메이션.
  useEffect(() => {
    if (open) {
      closingRef.current = false;
      setMounted(true);
      setDragY(0);
      setShown(false);
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    } else if (mounted) {
      // 닫힘 애니메이션 후 언마운트.
      setShown(false);
      const t = setTimeout(() => setMounted(false), 320);
      return () => clearTimeout(t);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ESC 로 닫기(데스크탑).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  // ── iOS 드래그 핸들 ──
  function onDragStart(clientY: number) { dragStartRef.current = clientY; }
  function onDragMove(clientY: number) {
    if (dragStartRef.current == null) return;
    setDragY(Math.max(0, clientY - dragStartRef.current));
  }
  function onDragEnd() {
    if (dragStartRef.current == null) return;
    dragStartRef.current = null;
    if (dragY > 100) { onClose(); }
    else setDragY(0); // 임계 미만이면 제자리 복귀
  }

  const backdropOpacity = shown ? 0.45 : 0;

  return (
    <Portal>
      <div
        role="dialog"
        aria-modal="true"
        className={
          "fixed inset-0 flex justify-center " + (ios ? "items-end" : "items-center")
        }
        style={{
          zIndex,
          background: `rgba(15,18,28,${backdropOpacity})`,
          transition: "background 280ms ease",
          // 데스크탑·웹은 노치 없음(env=0). iOS 는 상단만 패딩(시트는 바닥에 붙음).
          paddingTop: ios ? "max(1rem, env(safe-area-inset-top))" : undefined,
        }}
        onClick={onClose}
      >
        <div
          className={
            "bg-[var(--c-surface)] flex flex-col shadow-2xl " +
            (ios
              ? "w-full rounded-t-[22px]"
              : "w-full rounded-[18px] m-4")
          }
          style={{
            maxWidth: ios ? undefined : maxWidth,
            maxHeight: ios ? "92vh" : "88vh",
            transform: ios
              ? `translateY(${shown ? dragY : 1000}px)`
              : `translateY(${shown ? 0 : 12}px)`,
            opacity: ios ? 1 : shown ? 1 : 0,
            transition:
              dragStartRef.current == null
                ? "transform 320ms cubic-bezier(0.32,0.72,0,1), opacity 220ms ease"
                : "none",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* iOS 그래버 핸들 — 드래그해서 닫기 */}
          {ios && (
            <div
              className="flex justify-center pt-2.5 pb-1 touch-none cursor-grab active:cursor-grabbing flex-shrink-0"
              data-no-haptic
              onTouchStart={(e) => onDragStart(e.touches[0].clientY)}
              onTouchMove={(e) => onDragMove(e.touches[0].clientY)}
              onTouchEnd={onDragEnd}
            >
              <div className="w-10 h-1.5 rounded-full bg-ink-200" />
            </div>
          )}

          {/* 헤더 */}
          {(title || icon) && (
            <div className="flex items-center justify-between px-5 sm:px-6 pt-3 sm:pt-5 pb-3 flex-shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                {icon}
                <div className="min-w-0">
                  {title && <div className="h-title truncate">{title}</div>}
                  {subtitle && <div className="text-[11.5px] text-ink-500 truncate">{subtitle}</div>}
                </div>
              </div>
              <button
                type="button"
                className="btn-icon flex-shrink-0"
                onClick={onClose}
                aria-label="닫기"
                data-haptic="selection"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* 본문 — 스크롤 영역 */}
          <div className="px-5 sm:px-6 overflow-auto flex-1 min-h-0">{children}</div>

          {/* 푸터 — 하단 고정. iOS 는 safe-area-inset-bottom 흡수. */}
          {footer && (
            <div
              className="px-5 sm:px-6 pt-3 border-t border-ink-100 bg-[var(--c-surface)] flex-shrink-0"
              style={{ paddingBottom: ios ? "calc(env(safe-area-inset-bottom, 0px) + 12px)" : "16px" }}
            >
              {footer}
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}
