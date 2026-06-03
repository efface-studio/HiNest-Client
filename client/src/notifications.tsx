import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, apiUrl } from "./api";
import { getAuthToken } from "./lib/authToken";
import { deliverPendingNotifications, markSeen } from "./lib/desktopNotify";
import { initNativeNotificationTaps } from "./lib/nativeNotify";
import { shouldDeliverNotif } from "./lib/notifPrefs";

export type NotifType = "NOTICE" | "DM" | "APPROVAL_REQUEST" | "APPROVAL_REVIEW" | "MENTION" | "SYSTEM";

export type Notif = {
  id: string;
  type: NotifType;
  title: string;
  body?: string;
  linkUrl?: string;
  actorName?: string;
  readAt?: string | null;
  createdAt: string;
};

const CHAT_TYPES: NotifType[] = ["DM", "MENTION"];
const isChatType = (t: NotifType) => CHAT_TYPES.includes(t);

type Ctx = {
  items: Notif[];            // 전체 (벨+채팅 포함)
  bellItems: Notif[];        // 벨에 표시할 것 (DM/MENTION 제외)
  unread: number;            // 벨 미읽음 (DM/MENTION 제외)
  chatUnread: number;        // 채팅 미읽음 (DM/MENTION)
  /** 최초 서버에서 알림 목록을 받아온 뒤 true — 펄스 로직이 이 전엔 동작하지 않도록 함 */
  ready: boolean;
  reload: () => Promise<void>;
  markRead: (ids?: string[], all?: boolean) => Promise<void>;
  /** 특정 채팅방에 들어갔을 때 해당 방의 DM/MENTION 알림 일괄 읽음 처리 */
  markRoomRead: (roomId: string) => Promise<void>;
};

const NotificationCtx = createContext<Ctx>({
  items: [],
  bellItems: [],
  unread: 0,
  chatUnread: 0,
  ready: false,
  reload: async () => {},
  markRead: async () => {},
  markRoomRead: async () => {},
});

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Notif[]>([]);
  const [ready, setReady] = useState(false);
  const initialRef = useRef(true);
  const esRef = useRef<EventSource | null>(null);

  const bellItems = useMemo(() => items.filter((n) => !isChatType(n.type)), [items]);
  const unread = useMemo(
    () => bellItems.filter((n) => !n.readAt).length,
    [bellItems]
  );
  const chatUnread = useMemo(
    () => items.filter((n) => !n.readAt && isChatType(n.type)).length,
    [items]
  );

  const reload = useCallback(async () => {
    try {
      const res = await api<{ notifications: Notif[]; unread: number }>("/api/notification");
      setItems(res.notifications);
      setReady(true);
      const unreadItems = res.notifications.filter((n) => !n.readAt);
      if (initialRef.current) {
        initialRef.current = false;
        markSeen(unreadItems.map((n) => n.id));
      } else {
        // 카테고리 토글 / 방별 음소거를 통과한 것만 OS 알림으로.
        // 가로막힌 항목은 벨/채팅 UI 에는 그대로 들어가지만 OS 토스트는 안 뜸.
        const allowed = unreadItems.filter((n) => shouldDeliverNotif(n));
        deliverPendingNotifications(
          allowed.map((n) => ({ id: n.id, title: n.title, body: n.body, linkUrl: n.linkUrl }))
        );
      }
    } catch {}
  }, []);

  const markRead = useCallback(async (ids?: string[], all?: boolean) => {
    // 낙관적 업데이트 — API 왕복을 기다리지 않고 즉시 벨/룸 뱃지에서 숫자 사라지게.
    // 실패해도 다음 reload(30s) / SSE 에서 서버가 진실을 다시 싱크하므로 롤백 불필요.
    const now = new Date().toISOString();
    setItems((prev) =>
      prev.map((n) =>
        (all || (ids && ids.includes(n.id))) && !n.readAt
          ? { ...n, readAt: now }
          : n
      )
    );
    try {
      await api("/api/notification/read", {
        method: "POST",
        json: all ? { all: true } : { ids: ids ?? [] },
      });
    } catch {}
  }, []);

  const markRoomRead = useCallback(async (roomId: string) => {
    // 현재 items 에서 해당 방에 연결된 미읽음 DM/MENTION 을 추려서 즉시 읽음 처리.
    // linkUrl 패턴은 /chat?room=<roomId>
    const now = new Date().toISOString();
    let targetIds: string[] = [];
    setItems((prev) => {
      const next = prev.map((n) => {
        if (!n.readAt && isChatType(n.type) && n.linkUrl && n.linkUrl.includes(`room=${roomId}`)) {
          targetIds.push(n.id);
          return { ...n, readAt: now };
        }
        return n;
      });
      return next;
    });
    if (targetIds.length === 0) return;
    try {
      await api("/api/notification/read", { method: "POST", json: { ids: targetIds } });
    } catch {}
  }, []);

  useEffect(() => {
    // 미리보기 모드는 실제 서버에 SSE 연결을 만들지 않는다 — 데모 환경에서 어차피 푸시될 알림 없음.
    if (typeof window !== "undefined" && (window as any).__HINEST_PREVIEW__) {
      setReady(true);
      return;
    }
    void initNativeNotificationTaps(); // 네이티브 로컬 알림 탭 → 인앱 라우팅
    reload();

    let retry: number | null = null;
    // 채팅 이벤트는 별도 컴포넌트(ChatMiniApp) 에서 소비하므로 DOM CustomEvent 로
    // 재방송한다. 기존 "chat:open" / "chat:open-room" 같은 in-app event 와 동일 패턴.
    const rebroadcast = (name: "chat:sse-message" | "chat:sse-update" | "chat:sse-room", payload: unknown) => {
      try {
        window.dispatchEvent(new CustomEvent(name, { detail: payload }));
      } catch {}
    };
    function connect() {
      try {
        // 네이티브 앱은 EventSource 가 헤더를 못 싣고 쿠키도 cross-site ITP 로 막혀 SSE 가 안 붙는다.
        // 세션 토큰을 ?token= 쿼리로 보내 인증한다(서버 queryTokenAuth 가 Bearer 로 승격). 웹/데스크톱은
        // 토큰이 없어 쿼리 없이 기존 쿠키 인증 그대로.
        const streamToken = getAuthToken();
        const streamUrl =
          apiUrl("/api/notification/stream") + (streamToken ? `?token=${encodeURIComponent(streamToken)}` : "");
        const es = new EventSource(streamUrl, { withCredentials: true });
        esRef.current = es;
        es.addEventListener("notification", (ev: MessageEvent) => {
          try {
            const n = JSON.parse(ev.data) as Notif;
            // 낙관적 삽입 — 서버 왕복 없이 즉시 벨에 반영.
            // (기존에는 매 이벤트마다 reload() 를 한 번 더 불렀지만, 공지사항 일괄 브로드캐스트 때
            //  같은 유저 세션이 동시에 여러 번 GET /api/notification 치는 문제 → 서버 부하 증가.
            //  30초 주기 poll + visibilitychange poll 으로 서버 기준 재싱크는 이미 커버됨.)
            setItems((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev]));
            // 결재 관련 알림이 도착하면 사이드바 배지/탭 카운트 즉시 새로고침.
            if (n.type === "APPROVAL_REQUEST" || n.type === "APPROVAL_REVIEW") {
              window.dispatchEvent(new Event("hinest:approvalCountsRefresh"));
            }
            // 동일 가드 — 음소거된 방의 SSE 푸시는 OS 알림 띄우지 않음.
            if (shouldDeliverNotif(n)) {
              deliverPendingNotifications([
                { id: n.id, title: n.title, body: n.body, linkUrl: n.linkUrl },
              ]);
            } else {
              // 가드에 걸린 알림도 "이미 본 것" 으로 마킹해서 reload() 시 재발송 방지.
              markSeen([n.id]);
            }
          } catch {}
        });
        // 채팅 실시간 푸시 — ChatMiniApp 이 window 리스너로 수신.
        es.addEventListener("chat:message", (ev: MessageEvent) => {
          try { rebroadcast("chat:sse-message", JSON.parse(ev.data)); } catch {}
        });
        es.addEventListener("chat:update", (ev: MessageEvent) => {
          try { rebroadcast("chat:sse-update", JSON.parse(ev.data)); } catch {}
        });
        es.addEventListener("chat:room", (ev: MessageEvent) => {
          try { rebroadcast("chat:sse-room", JSON.parse(ev.data)); } catch {}
        });
        es.onerror = () => {
          es.close();
          esRef.current = null;
          retry = window.setTimeout(connect, 3000);
        };
      } catch {
        retry = window.setTimeout(connect, 3000);
      }
    }
    connect();

    // SSE fallback 폴링 — SSE 가 끊겼을 때만 의미가 있다.
    // 비용 절감:
    //   - 30초 → 90초. SSE 가 살아있으면 어차피 push 로 동기화되므로 fallback 빈도 낮춰도 안전.
    //   - 탭 hidden 이면 폴링 자체를 중단 (visibility 복귀 시 한 번 reload + interval 재무장).
    let t: number | null = null;
    function startPoll() { if (t === null) t = window.setInterval(reload, 90_000); }
    function stopPoll() { if (t !== null) { window.clearInterval(t); t = null; } }
    if (document.visibilityState === "visible") startPoll();

    function onVisibility() {
      if (document.visibilityState !== "visible") { stopPoll(); return; }
      // 보이는 상태로 복귀 — fallback 폴링 재무장.
      startPoll();
      // SSE 가 살아있으면 실시간 push 로 이미 동기화됨 — reload() 생략.
      // SSE 가 끊긴 상태(재연결 대기 중)에서만 전체 재조회.
      if (esRef.current && esRef.current.readyState !== EventSource.CLOSED) return;
      reload();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (retry) clearTimeout(retry);
      stopPoll();
      esRef.current?.close();
      esRef.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line
  }, []);

  // 데스크톱 앱: dock / 태스크바 뱃지에 총 미읽음 개수 반영.
  // 숫자가 바뀔 때만 IPC 호출 (매 렌더마다 보내지 않게 값으로 memo).
  // 웹 브라우저에서는 window.hinest 가 없어 no-op.
  useEffect(() => {
    const total = unread + chatUnread;
    try {
      window.hinest?.setBadge?.(total);
    } catch {}
  }, [unread, chatUnread]);

  // 컨텍스트 value 를 memo 화 — 이 Provider 는 90초 폴링·SSE 푸시·낙관적 읽음처리마다
  // 리렌더되는 가장 뜨거운 프로바이더다. 매 렌더마다 새 객체 리터럴을 넘기면 소비자
  // (AppLayout·ChatFab·NotificationBell) 가 값이 안 바뀌어도 전부 리렌더된다.
  // reload/markRead/markRoomRead 는 useCallback 으로 고정이고 bellItems/unread/chatUnread
  // 는 items 파생이라, 실제로 items·ready 가 바뀔 때만 새 객체가 만들어진다.
  const value = useMemo<Ctx>(
    () => ({ items, bellItems, unread, chatUnread, ready, reload, markRead, markRoomRead }),
    [items, bellItems, unread, chatUnread, ready, reload, markRead, markRoomRead]
  );

  return (
    <NotificationCtx.Provider value={value}>
      {children}
    </NotificationCtx.Provider>
  );
}

export const useNotifications = () => useContext(NotificationCtx);
