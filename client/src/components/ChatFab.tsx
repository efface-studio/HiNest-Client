import { useEffect, useState, useRef, useLayoutEffect, lazy, Suspense } from "react";
import { useLocation } from "react-router-dom";
import { useNotifications } from "../notifications";
import { imgSrc } from "../api";
import { setNativeTabBarHidden } from "../lib/liquidGlassTabBar";
import { nativePlatform } from "../lib/platform";
// highlight.js(~92KB) 등 무거운 의존성을 끌고오므로 초기 번들에서 분리한다.
// 채팅 패널은 사용자가 처음 열 때(mounted=true) 비로소 마운트되므로 lazy 로딩이 안전.
const ChatMiniApp = lazy(() => import("./ChatMiniApp"));

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
  /** 모바일 풀스크린 모드에서 채팅 패널 자체를 닫을 때 사용. desktop 에선 undefined. */
  onClose?: () => void;
};

export default function ChatFab() {
  const loc = useLocation();
  const { chatUnread, ready } = useNotifications();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // 채팅이 열려 있는 동안엔 네이티브 하단 탭 바를 숨긴다(풀스크린 채팅을 바가 덮는 것 방지).
  useEffect(() => {
    setNativeTabBarHidden("chat", open);
    return () => setNativeTabBarHidden("chat", false);
  }, [open]);
  // 모바일·iPad portrait(<1024px) 에서는 사내톡을 풀스크린 페이지처럼 띄움(데스크탑은 우하단 팝업).
  // Tailwind md=1024 와 동일 기준으로 'md 미만 = 풀스크린', 'md+ = 팝업' 분기. 회전/리사이즈 갱신.
  const MOBILE_MQ = "(max-width: 1023.98px)";
  const [isMobile, setIsMobile] = useState<boolean>(
    typeof window !== "undefined" ? window.matchMedia(MOBILE_MQ).matches : false
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(MOBILE_MQ);
    const update = () => setIsMobile(mq.matches);
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  // 모바일 풀스크린 상태에서 배경 스크롤 잠금.
  // 동시에 body 에 마커 클래스를 달아, 미리보기 배너(sticky z-9999)가 풀스크린 채팅
  // 헤더(z-40) 위로 그려져 닫기·새 채팅 버튼을 가리는 문제를 CSS 로 가린다(styles.css).
  useEffect(() => {
    if (!isMobile || !open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("hinest-chat-fs");
    return () => {
      document.body.style.overflow = prev;
      document.body.classList.remove("hinest-chat-fs");
    };
  }, [isMobile, open]);
  // 새 채팅 알림이 들어올 때 파란 펄스(데스크톱 FAB 전용 연출).
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
    const onCloseEvt = () => setOpen(false);
    window.addEventListener("chat:toggle", onToggle);
    window.addEventListener("chat:open", onOpen);
    window.addEventListener("chat:open-room", onOpenRoom);
    window.addEventListener("chat:close", onCloseEvt);
    return () => {
      window.removeEventListener("chat:toggle", onToggle);
      window.removeEventListener("chat:open", onOpen);
      window.removeEventListener("chat:open-room", onOpenRoom);
      window.removeEventListener("chat:close", onCloseEvt);
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
                  // ※ 절대 위치 계산 대신 flex column 으로 변경 — 이전엔 헤더는 padding 안에,
                  //    본문은 absolute top:86 (border-box 기준) 으로 두면서 safe-area-top 만큼
                  //    헤더 일부가 본문에 가려져 모바일에서 뒤로가기 버튼이 사라져 보였음.
                  // ※ height:100dvh 를 제거 — inset:0(top:0+bottom:0) 만으로 풀스크린.
                  //   Keyboard.resize:'native' 가 키보드 곡선에 맞춰 WebView 를 줄이면, bottom:0
                  //   앵커가 그 줄어드는 바닥에 자동으로 붙어 입력바가 키보드와 '동기' 로 올라온다.
                  //   100dvh(고정 길이)는 iOS 가 키보드 애니메이션 중 보간하지 않고 끝난 뒤에야
                  //   재계산해 입력바가 늦게 따라잡히는 증상을 유발했다.
                  inset: 0,
                  width: "100vw",
                  // safe-area(상태바)는 패널이 아니라 헤더(RoomHeader/ListHeader)가 흡수한다 —
                  // 그래야 글래스 헤더가 상태바 영역까지 위로 덮어, 'safe-area 와 헤더가 따로 노는'
                  // 분리(상단 솔리드 띠 + 그 아래 글래스 헤더)가 사라지고 한 덩어리로 보인다.
                  paddingTop: 0,
                  paddingBottom: "var(--sa-bottom, env(safe-area-inset-bottom))",
                  paddingLeft: "var(--sa-left, env(safe-area-inset-left))",
                  paddingRight: "var(--sa-right, env(safe-area-inset-right))",
                  transformOrigin: "bottom right",
                  borderRadius: 0,
                  overflow: "hidden",
                  background: C.surface,
                  fontFamily: FONT,
                  color: C.ink,
                  letterSpacing: "-0.015em",
                  display: "flex",
                  flexDirection: "column",
                  transition:
                    "opacity .22s cubic-bezier(.22,.61,.36,1), transform .26s cubic-bezier(.22,.61,.36,1)",
                }
              : {
                  // 데스크톱: 기존 우하단 플로팅 팝업. flex column 으로 통일.
                  // 641~767px(=태블릿 좁은 폭)에선 하단 네비 바가 보이므로 그만큼 더 띄운다.
                  right: "max(12px, var(--sa-right, env(safe-area-inset-right)))",
                  bottom:
                    "calc(96px + var(--sa-bottom, env(safe-area-inset-bottom)) + var(--hinest-bottomnav-h, 0px))",
                  width: "min(380px, calc(100vw - 24px))",
                  height: 580,
                  maxHeight: "calc(100vh - 140px - var(--sa-bottom, env(safe-area-inset-bottom)))",
                  transformOrigin: "bottom right",
                  borderRadius: 20,
                  overflow: "hidden",
                  background: C.surface,
                  fontFamily: FONT,
                  color: C.ink,
                  letterSpacing: "-0.015em",
                  boxShadow:
                    "0 20px 50px rgba(25, 31, 40, .14), 0 4px 12px rgba(25, 31, 40, .06)",
                  display: "flex",
                  flexDirection: "column",
                  transition:
                    "opacity .28s cubic-bezier(.22,.61,.36,1), transform .32s cubic-bezier(.22,.61,.36,1)",
                }
          }
        >
          {/* ===== 리스트 헤더 — 방 목록일 때만 flex 흐름. 대화방 헤더는 본문 위에 글래스로 떠 있다. ===== */}
          {!activeRoom && (
            <ListHeader
              chatUnread={chatUnread}
              onCreateGroup={() => setCreateReq((n) => n + 1)}
              onClose={() => setOpen(false)}
            />
          )}

          {/* ===== 본문 — flex:1 로 남은 공간 모두 채움 ===== */}
          <div
            style={{
              flex: 1,
              minHeight: 0,        // 자식의 overflow 가 동작하도록
              position: "relative",
              background: C.surface,
            }}
          >
            {/* 대화방 헤더 — iOS 26 리퀴드 글래스. 본문 기준 absolute 오버레이라 메시지가 이 뒤로 스크롤된다.
                (헤더의 X 로 패널을 닫는다 — 런처가 상단바로 옮겨진 뒤 모바일·데스크톱 공통) */}
            {activeRoom && (
              <RoomHeader
                info={{
                  ...activeRoom,
                  onClose: () => setOpen(false),
                }}
              />
            )}
            <Suspense fallback={null}>
              <ChatMiniApp active={open} onActiveRoomChange={setActiveRoom} createGroupRequestId={createReq} openRoomRequest={openRoomReq} />
            </Suspense>
          </div>
        </div>
      )}

      {/* ===== FAB — 데스크톱(md+) 전용 우하단 런처. 모바일(<md)은 상단바 벨 옆 버튼을 쓴다.
           모바일 풀스크린 상태(≤640px)에선 헤더의 X로 닫으므로 그때도 숨김. ===== */}
      {!(isMobile && open) && (
      <button
        type="button"
        onClick={toggle}
        title={open ? "사내톡 닫기" : "사내톡 열기"}
        aria-label={chatUnread > 0 ? `사내톡 · 안 읽은 메시지 ${chatUnread}건` : "사내톡"}
        aria-expanded={open}
        className={`fixed z-40 hidden md:flex items-center justify-center active:scale-[.94]${pulsing ? " siri-pulse" : ""}`}
        style={{
          // notch/홈인디케이터 대응 — iPad/iPhone 세이프 에어리어 안쪽으로 당김.
          // 데스크톱은 하단 네비 바가 없어 --hinest-bottomnav-h 가 0 이라 그대로 우하단.
          right: "max(20px, var(--sa-right, env(safe-area-inset-right)))",
          bottom:
            "calc(20px + var(--sa-bottom, env(safe-area-inset-bottom, 0px)) + var(--hinest-bottomnav-h, 0px))",
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
        // 패널이 더 이상 safe-area 를 안 먹으므로 리스트 헤더가 상태바를 흡수(상단 패딩).
        padding: "calc(22px + var(--sa-top, env(safe-area-inset-top))) 22px 14px",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 10,
        background: C.surface,
        flexShrink: 0,
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
  // 글래스 헤더의 실제 높이를 CSS 변수로 노출 → 메시지 스크롤이 그만큼 padding-top 을 받아
  // 헤더 뒤로 자연스럽게 스크롤된다(고정값 대신 실측이라 1줄·2줄 제목 모두 정확).
  const headerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const h = headerRef.current?.offsetHeight;
    if (h) document.documentElement.style.setProperty("--chat-room-header-h", `${h}px`);
  });
  // 리퀴드 글래스는 iOS·Android 네이티브 앱에만 — 데스크톱/웹은 솔리드 헤더(요구사항).
  const glass = nativePlatform() === "ios" || nativePlatform() === "android";
  // 설정 화면에서는 제목/닫기 없이 얇은 뒤로가기 바만 표시
  if (info.isSettings) {
    return (
      <div
        style={{
          padding: "12px 14px 4px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: C.surface,
          flexShrink: 0,
        }}
      >
        <button
          onClick={info.onBack}
          title="뒤로"
          aria-label="뒤로"
          style={{
            width: 34, height: 34, borderRadius: 999,
            // iOS 26 리퀴드 글래스 — 네이티브 앱에서만 반투명+블러. 데스크톱/웹은 기존 솔리드.
            background: glass ? "var(--c-glass)" : C.gray100, color: C.ink,
            WebkitBackdropFilter: glass ? "blur(20px) saturate(180%)" : undefined,
            backdropFilter: glass ? "blur(20px) saturate(180%)" : undefined,
            border: glass ? "1px solid var(--c-glass-border)" : 0, cursor: "pointer",
            display: "grid", placeItems: "center",
            transition: "background .12s ease",
          }}
          onMouseEnter={(e) => { if (!glass) e.currentTarget.style.background = C.gray200; }}
          onMouseLeave={(e) => { if (!glass) e.currentTarget.style.background = C.gray100; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        {info.onClose && <HeaderCloseButton onClose={info.onClose} glass={glass} />}
      </div>
    );
  }

  return (
    <div
      ref={headerRef}
      style={{
        // 상단 패딩에 safe-area(상태바) 흡수 → 글래스가 상태바까지 덮고 제목은 그 아래에 온다.
        // (데스크톱은 --sa-top=0 이라 무영향. 헤더 높이는 ref 로 실측돼 메시지 padding 이 자동 보정.)
        padding: "calc(18px + var(--sa-top, env(safe-area-inset-top))) 18px 12px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        // iOS 26 리퀴드 글래스 — iOS·Android 네이티브 앱에서만 반투명+블러로 메시지가 뒤로 비친다.
        // 데스크톱/웹은 솔리드 surface (글래스 미적용 — 요구사항). 오버레이 구조는 동일.
        background: glass ? "var(--c-glass)" : "var(--c-surface)",
        WebkitBackdropFilter: glass ? "blur(20px) saturate(180%)" : undefined,
        backdropFilter: glass ? "blur(20px) saturate(180%)" : undefined,
        borderBottom: "1px solid var(--c-glass-border)",
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
      }}
    >
      <button
        onClick={info.onBack}
        title="뒤로"
        aria-label="뒤로"
        style={{
          width: 34, height: 34, borderRadius: 999,
          // iOS 26 리퀴드 글래스 — 네이티브 앱에서만 반투명+블러. 데스크톱/웹은 기존 솔리드.
          background: glass ? "var(--c-glass)" : C.gray100, color: C.ink,
          WebkitBackdropFilter: glass ? "blur(20px) saturate(180%)" : undefined,
          backdropFilter: glass ? "blur(20px) saturate(180%)" : undefined,
          border: glass ? "1px solid var(--c-glass-border)" : 0, cursor: "pointer",
          display: "grid", placeItems: "center",
          flexShrink: 0,
          transition: "background .12s ease",
        }}
        onMouseEnter={(e) => { if (!glass) e.currentTarget.style.background = C.gray200; }}
        onMouseLeave={(e) => { if (!glass) e.currentTarget.style.background = C.gray100; }}
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
            <img src={imgSrc(info.imageUrl)} alt={info.title} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" decoding="async"/>
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

      {/* 모바일 풀스크린에선 패널 자체를 닫는 X — 방 안에서도 한 탭으로 빠져나갈 수 있게.
          desktop 에선 onClose 미전달 → 렌더링 안 됨 (외부에 띄운 팝업이라 별도 닫기 불필요). */}
      {info.onClose && <HeaderCloseButton onClose={info.onClose} glass={glass} />}
    </div>
  );
}

/** 헤더 우측 X — 모바일 풀스크린 채팅을 한 번에 닫는 버튼. */
function HeaderCloseButton({ onClose, glass = false }: { onClose: () => void; glass?: boolean }) {
  return (
    <button
      onClick={onClose}
      title="채팅 닫기"
      aria-label="채팅 닫기"
      style={{
        width: 34, height: 34, borderRadius: 999,
        // iOS 26 리퀴드 글래스 — 네이티브 앱에서만 반투명+블러. 데스크톱/웹은 기존 솔리드.
        background: glass ? "var(--c-glass)" : C.gray100, color: C.ink,
        WebkitBackdropFilter: glass ? "blur(20px) saturate(180%)" : undefined,
        backdropFilter: glass ? "blur(20px) saturate(180%)" : undefined,
        border: glass ? "1px solid var(--c-glass-border)" : 0, cursor: "pointer",
        display: "grid", placeItems: "center",
        flexShrink: 0,
        transition: "background .12s ease",
      }}
      onMouseEnter={(e) => { if (!glass) e.currentTarget.style.background = C.gray200; }}
      onMouseLeave={(e) => { if (!glass) e.currentTarget.style.background = C.gray100; }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  );
}

