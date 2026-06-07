/**
 * 공유 트리거 버튼 — 공지/메모/회의록 등 게시물 페이지에 박는다.
 *
 * 누르면 <ShareSheet> 가 열리고 동료/그룹방을 선택해 채팅으로 카드 메시지 전송.
 *
 * 사용:
 *   <ShareButton payload={{ kind: "ANNOUNCEMENT", title, snippet, href: "/notice/..." }} />
 *
 * variant:
 *   - "icon"  : 아이콘 단독 (페이지 상단 액션바 등)
 *   - "button": 라벨 포함 (게시물 하단 액션 영역)
 */
import { useState } from "react";
import ShareSheet, { type SharePayload } from "./ShareSheet";
import { useAuth } from "../auth";
import { presentShareNative } from "../lib/share";

function ShareIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

export default function ShareButton({
  payload,
  variant = "button",
  label = "공유",
  className = "",
}: {
  payload: SharePayload;
  variant?: "icon" | "button";
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();

  return (
    <>
      <button
        type="button"
        onClick={async (e) => {
          e.stopPropagation();
          // iOS/iPadOS 는 애플 기본 바텀시트(네이티브). 미지원/실패 시에만 웹 시트로 폴백.
          if (await presentShareNative(payload)) return;
          setOpen(true);
        }}
        aria-label="공유"
        className={
          variant === "icon"
            ? `inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-ink-100 text-ink-600 ${className}`
            : `inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] border border-ink-200 hover:bg-ink-50 text-[12px] font-bold text-ink-700 ${className}`
        }
      >
        <ShareIcon size={variant === "icon" ? 18 : 15} />
        {variant === "button" && <span>{label}</span>}
      </button>
      <ShareSheet open={open} onClose={() => setOpen(false)} payload={payload} meId={user?.id ?? null} />
    </>
  );
}
