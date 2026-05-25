import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useNotifications } from "../notifications";
import ChatMiniApp from "./ChatMiniApp";

/**
 * 우하단 플로팅 채팅 버튼 — 토스(Toss) 스타일 팝업.
 *
 * 헤더는 상황에 따라 2가지:
 *  1) 목록 화면: "사내톡" + "안 읽은 메시지 N개 / 모든 메시지를 확인했어요"
 *  2) 대화방 화면: ← 뒤로 + 아바타 + 방 이름 + 서브텍스트
 */

// 라이트/다크 자동 전환 — CSS 변수 매핑. 하드코딩 hex 를 유지하면 다크 모드에서
// 사내톡 팝업 헤더/컨테이너가 흰색으로 튀는 문제가 발생하므로 전체 리팩.
const C = {
  blue: "var(--c-brand)",
  blueHover: "var(--c-brand-hover)",
  ink: "var(--c-text)",
  gray700: "var(--c-text-2)",
  gray600: "var(--c-text-3)",
  gray500: "var(--c-text-muted)",
  gray200: "var(--c-border)",
  gray100: "var(--c-surface-3)",
  red: "var(--c-danger)",
  surface: "var(--c-surface)",
  bg: "var(--c-bg)",
};
const FONT =
  "Pretendard, 'Pretendard Variable', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', system-ui, sans-serif";

type ActiveRoomInfo = {
  title: string;
  subtitle: string;
  color: string;
  imageUrl?: string | null;
  onBack: () => void;
  onTitleClick?: () => void;
  isSettings?: boolean;
};

export default function ChatFab() {
  const loc = useLocation();
  const { chatUnread, ready } = useNotifications();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  // 모바일(≤640px) 에서는 사내톡을 풀스크린 페이지처럼 띄움.
  // 뷰포트 크기 변화(회전/리사이즈) 시 갱신.
  const [isMobile, setIsMobile] = useState<boolean>(
    typeof window !== "undefined" ? window.matchMedia("(max-width: 640px)").matches : false
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobile(mq.matches);
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  // 모바일 풀스크린 상태에서 배경 스크롤 잠금.
  useEffect(() => {
    if (!isMobile || !open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isMobile, open]);
  // 새 채팅 알림이 들어올 때 파란 펄스.
  // - 단순 새로고침/재오픈만으론 발동하지 않음 (localStorage 에 저장된 마지막으로 본 카운트와 비교).
  // - 앱이 꺼진 사이 알림이 쌓였다면 켤 때 1회 발동.
  const [pulsing, setPulsing] = useState(false);
  useEffect(() => {
    if (!ready) return; // 최초 서버 동기화 전엔 비교 무의미
    const KEY = "hinest:lastSeenChatUnread";
    const lastSeen = Number(localStorage.getItem(KEY) ?? "0");
    if (chatUnread > lastSeen) {
      setPulsing(true);
      const t = setTimeout(() => setPulsing(false), 2800);
      localStorage.setItem(KEY, String(chatUnread));
      return () => clearTimeout(t);
    }
    // 내려갔거나 같을 땐 펄스 없이 최신 값으로만 동기화
    localStorage.setItem(KEY, String(chatUnread));
  }, [chatUnread, ready]);
  const [activeRoom, setActiveRoom] = useState<ActiveRoomInfo | null>(null);
  const [createReq, setCreateReq] = useState(0);
  // 외부에서 특정 방을 열어달라고 요청하면 여기에 담아 ChatMiniApp 으로 프롭 전달
  const [openRoomReq, setOpenRoomReq] = useState<{ id: number; roomId: string } | null>(null);

  const hidden =
    loc.pathname.startsWith("/login") ||
    loc.pathname.startsWith("/signup");

  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // 전역 Cmd+K 시 AppLayout 이 "chat:toggle" 이벤트를 날려줌 — 여기서 받아서 토글
  useEffect(() => {
    const onToggle = () => setOpen((s) => { const n = !s; if (n) setMounted(true); return n; });
    const onOpen = () => { setMounted(true); setOpen(true); };
    const onOpenRoom = (e: Event) => {
      const ev = e as CustomEvent<{ roomId?: string }>;
      const rid = ev.detail?.roomId;
      if (!rid) return;
      // 팝업이 닫혀 있으면 먼저 열고, 프롭으로 타겟 방 전달
      setMounted(true);
      setOpen(true);
      setOpenRoomReq((prev) => ({ id: (prev?.id ?? 0) + 1, roomId: rid }));
    };
    window.addEventListener("chat:toggle", onToggle);
    window.addEventListener("chat:open", onOpen);
    window.addEventListener("chat:open-room", onOpenRoom);
    return () => {
      window.removeEventListener("chat:toggle", onToggle);
      window.removeEventListener("chat:open", onOpen);
      window.removeEventListener("chat:open-room", onOpenRoom);
    };
  }, []);

  // 팝업 닫힐 때 방 상태도 초기화
  useEffect(() => { if (!open) setActiveRoom(null); }, [open]);

  if (hidden) return null;

  const toggle = () => setOpen((s) => { const n = !s; if (n) setMounted(true); return n; });

  return (
    <>
      {mounted && (
        <div
          className={`fixed z-40 ${
            open
              ? "opacity-100 translate-y-0 scale-100 pointer-events-auto"
              : "opacity-0 translate-y-3 scale-[.98] pointer-events-none"
          }`}
          style={
            isMobile
              ? {
                  // 모바일: 풀스크린 페이지처럼. 하단 네비/홈인디케이터 영역 safe-area 반영.
                  inset: 0,
                  width: "100vw",
                  height: "100dvh",
                  paddingTop: "env(safe-area-inset-top)",
                  paddingBottom: "env(safe-area-inset-bottom)",
                  paddingLeft: "env(safe-area-inset-left)",
                  paddingRight: "env(safe-area-inset-right)",
                  transformOrigin: "bottom right",
                  borderRadius: 0,
                  overflow: "hidden",
                  background: C.surface,
                  fontFamily: FONT,
                  color: C.ink,
                  letterSpacing: "-0.015em",
                  transition:
                    "opacity .22s cubic-bezier(.22,.61,.36,1), transform .26s cubic-bezier(.22,.61,.36,1)",
                }
              : {
                  // 데스크톱: 기존 우하단 플로팅 팝업.
                  right: "max(12px, env(safe-area-inset-right))",
                  bottom: "calc(96px + env(safe-area-inset-bottom))",
                  width: "min(380px, calc(100vw - 24px))",
                  height: 580,
                  maxHeight: "calc(100vh - 140px - env(safe-area-inset-bottom))",
                  transformOrigin: "bottom right",
                  borderRadius: 20,
                  overflow: "hidden",
                  background: C.surface,
                  fontFamily: FONT,
                  color: C.ink,
                  letterSpacing: "-0.015em",
                  boxShadow:
                    "0 20px 50px rgba(25, 31, 40, .14), 0 4px 12px rgba(25, 31, 40, .06)",
                  transition:
                    "opacity .28s cubic-bezier(.22,.61,.36,1), transform .32s cubic-bezier(.22,.61,.36,1)",
                }
          }
        >
          {/* ===== 헤더 ===== */}
          {activeRoom ? (
            <RoomHeader info={activeRoom} />
          ) : (
            <ListHeader
              chatUnread={chatUnread}
              onCreateGroup={() => setCreateReq((n) => n + 1)}
              onClose={isMobile ? () => setOpen(false) : undefined}
            />
          )}

          {/* ===== 본문 — 설정 화면에서는 헤더가 얇아지므로 top을 50으로 올림 ===== */}
          <div
            style={{
              position: "absolute",
              top: activeRoom?.isSettings ? 50 : 86,
              bottom: 0, left: 0, right: 0,
              background: C.surface,
            }}
          >
            <ChatMiniApp active={open} onActiveRoomChange={setActiveRoom} createGroupRequestId={createReq} openRoomRequest={openRoomReq} />
          </div>
        </div>
      )}

      {/* ===== FAB — 모바일 풀스크린 상태에선 헤더의 X로 닫으므로 숨김 ===== */}
      {!(isMobile && open) && (
      <button
        type="button"
        onClick={toggle}
        title={open ? "사내톡 닫기" : "사내톡 열기"}
        aria-label={chatUnread > 0 ? `사내톡 · 안 읽은 메시지 ${chatUnread}건` : "사내톡"}
        aria-expanded={open}
        className={`fixed z-40 flex items-center justify-center active:scale-[.94]${pulsing ? " siri-pulse" : ""}`}
        style={{
          // notch/홈인디케이터 대응 — iPad/iPhone 세이프 에어리어 안쪽으로 당김.
          right: "max(20px, env(safe-area-inset-right))",
          bottom: "calc(20px + env(safe-area-inset-bottom, 0px))",
          width: 60, height: 60,
          borderRadius: 999,
          background: C.blue, color: "#fff",
          border: 0, cursor: "pointer",
          boxShadow:
            "0 10px 24px rgba(49, 130, 246, .36), 0 2px 6px rgba(49, 130, 246, .20)",
          transition:
            "background .18s ease, transform .18s cubic-bezier(.22,.61,.36,1)",
          transform: open ? "scale(.96)" : undefined,
          fontFamily: FONT,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = C.blueHover)}
        onMouseLeave={(e) => (e.currentTarget.style.background = C.blue)}
      >
        {open ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        )}

        {chatUnread > 0 && !open && (
          <span
            style={{
              position: "absolute",
              top: -2, right: -2,
              minWidth: 22, height: 22, padding: "0 6px",
              borderRadius: 999,
              background: C.red, color: "#fff",
              fontSize: 11, fontWeight: 700,
              display: "grid", placeItems: "center",
              boxShadow: `0 0 0 2px ${C.bg}`,
              fontFamily: FONT,
              letterSpacing: "-0.01em",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {chatUnread > 99 ? "99+" : chatUnread}
          </span>
        )}
      </button>
      )}
    </>
  );
}

/* ===== 목록용 헤더 ===== */
function ListHeader({
  chatUnread,
  onCreateGroup,
  onClose,
}: {
  chatUnread: number;
  onCreateGroup: () => void;
  onClose?: () => void;
}) {
  return (
    <div
      style={{
        padding: "22px 22px 14px",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 10,
        background: C.surface,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: C.ink, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
          사내톡
        </div>
        <div style={{ marginTop: 4, fontSize: 13, fontWeight: 500, color: C.gray600, letterSpacing: "-0.01em" }}>
          {chatUnread > 0 ? `안 읽은 메시지 ${chatUnread}개` : "모든 메시지를 확인했어요"}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <button
          onClick={onCreateGroup}
          title="새 그룹 만들기"
          aria-label="새 그룹 만들기"
          style={{
            width: 38, height: 38, borderRadius: 999,
            background: C.gray100, color: C.ink,
            border: 0, cursor: "pointer",
            display: "grid", placeItems: "center",
            flexShrink: 0,
            transition: "background .15s ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = C.gray200)}
          onMouseLeave={(e) => (e.currentTarget.style.background = C.gray100)}
        >
          {/* 사람 + 플러스 */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" y1="8" x2="19" y2="14" />
            <line x1="22" y1="11" x2="16" y2="11" />
          </svg>
        </button>

        {onClose && (
          <button
            onClick={onClose}
            title="닫기"
            aria-label="사내톡 닫기"
            style={{
              width: 38, height: 38, borderRadius: 999,
              background: C.gray100, color: C.ink,
              border: 0, cursor: "pointer",
              display: "grid", placeItems: "center",
              flexShrink: 0,
              transition: "background .15s ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = C.gray200)}
            onMouseLeave={(e) => (e.currentTarget.style.background = C.gray100)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

/* ===== 대화방용 헤더 ===== */
function RoomHeader({ info }: { info: ActiveRoomInfo }) {
  // 설정 화면에서는 제목/닫기 없이 얇은 뒤로가기 바만 표시
  if (info.isSettings) {
    return (
      <div
        style={{
          padding: "12px 14px 4px",
          display: "flex", alignItems: "center",
          background: C.surface,
        }}
      >
        <button
          onClick={info.onBack}
          title="뒤로"
          style={{
            width: 34, height: 34, borderRadius: 999,
            background: C.gray100, color: C.ink,
            border: 0, cursor: "pointer",
            display: "grid", placeItems: "center",
            transition: "background .12s ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = C.gray200)}
          onMouseLeave={(e) => (e.currentTarget.style.background = C.gray100)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "18px 18px 12px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: C.surface,
      }}
    >
      <button
        onClick={info.onBack}
        title="뒤로"
        style={{
          width: 34, height: 34, borderRadius: 999,
          background: C.gray100, color: C.ink,
          border: 0, cursor: "pointer",
          display: "grid", placeItems: "center",
          flexShrink: 0,
          transition: "background .12s ease",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = C.gray200)}
        onMouseLeave={(e) => (e.currentTarget.style.background = C.gray100)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      <button
        onClick={info.onTitleClick}
        disabled={!info.onTitleClick}
        title={info.onTitleClick ? "채팅방 설정" : undefined}
        style={{
          flex: 1, minWidth: 0,
          display: "flex", alignItems: "center", gap: 10,
          padding: "6px 8px", marginLeft: -8,
          borderRadius: 10,
          background: "transparent",
          border: 0,
          cursor: info.onTitleClick ? "pointer" : "default",
          textAlign: "left",
          transition: "background .12s ease",
        }}
        onMouseEnter={(e) => { if (info.onTitleClick) e.currentTarget.style.background = C.gray100; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <div
          style={{
            width: 38, height: 38, borderRadius: "50%",
            background: info.imageUrl ? "transparent" : info.color,
            color: "#fff", position: "relative", overflow: "hidden",
            flexShrink: 0,
          }}
        >
          {info.imageUrl ? (
            <img src={info.imageUrl} alt={info.title} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" decoding="async"/>
          ) : (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>
              {info.title?.[0] ?? "?"}
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 16, fontWeight: 700, color: C.ink,
              letterSpacing: "-0.02em",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              lineHeight: 1.2,
            }}
          >
            {info.title}
          </div>
          <div style={{ marginTop: 2, fontSize: 12, fontWeight: 500, color: C.gray600 }}>
            {info.subtitle}
          </div>
        </div>
      </button>
    </div>
  );
}

