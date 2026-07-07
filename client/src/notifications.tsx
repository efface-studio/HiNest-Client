import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, apiUrl } from "./api";
import { getAuthToken } from "./lib/authToken";
import { deliverPendingNotifications, markSeen, getActiveChatRoom } from "./lib/desktopNotify";
import { isCapacitorNative } from "./lib/platform";
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
  actorColor?: string;
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
  /** SSE 스트림이 살아있는지(연결됨/연결중) — 폴링 소비자가 안전망 폴링을 건너뛰는 데 쓴다.
   *  ref 기반 안정 콜백이라 호출해도 리렌더를 유발하지 않음. */
  isSseAlive: () => boolean;
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
  isSseAlive: () => false,
});

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Notif[]>([]);
  const [ready, setReady] = useState(false);
  const initialRef = useRef(true);
  // 백→포그라운드 복귀(resume) 직전에 true 로 세팅 — 그 직후 reload 가 "쌓인 미읽음"을
  // 라이브 알림처럼 토스트하지 않게(네이티브는 이미 APNs 로 표시됨) 구분하는 플래그.
  const catchUpRef = useRef(false);
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
    // resume 직후의 reload 인지 await 전에 캡처 — 네이티브에서 백그라운드 동안 쌓인 미읽음을
    // 다시 토스트하지 않기 위해. 폴링/일반 reload 는 false 라 평소대로 deliver.
    const isResume = catchUpRef.current;
    catchUpRef.current = false;
    try {
      const res = await api<{ notifications: Notif[]; unread: number }>("/api/notification");
      setItems(res.notifications);
      setReady(true);
      const unreadItems = res.notifications.filter((n) => !n.readAt);
      if (initialRef.current) {
        initialRef.current = false;
        markSeen(unreadItems.map((n) => n.id));
      } else if (isResume && isCapacitorNative()) {
        // 네이티브 포그라운드 복귀: 쌓인 미읽음은 백그라운드 동안 이미 원격 APNs(+NSE 아바타)로
        // 표시됐다. 여기서 로컬 배너로 또 토스트하면 "아바타 알림 → 로컬 알림" 중복이 된다.
        // → 배너는 생략하고 seen 처리만(벨/미읽음 카운트는 setItems 로 이미 반영됨).
        markSeen(unreadItems.map((n) => n.id));
      } else {
        // 카테고리 토글 / 방별 음소거를 통과한 것만 OS 알림으로.
        // 가로막힌 항목은 벨/채팅 UI 에는 그대로 들어가지만 OS 토스트는 안 뜸.
        const allowed = unreadItems.filter((n) => shouldDeliverNotif(n));
        deliverPendingNotifications(
          allowed.map((n) => ({ id: n.id, title: n.title, body: n.body, linkUrl: n.linkUrl, actorName: n.actorName, actorColor: n.actorColor }))
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
    // 언마운트(로그아웃 → /login) 후 재연결 금지 플래그 — connect() 가 티켓 발급을
    // await 하는 도중 cleanup 이 돌면, cleanup 은 "그 시점의" retry 타이머만 지우고
    // connect 의 catch 가 그 뒤에 새 타이머를 걸어 로그인 화면에서도 sse-ticket 401 을
    // 3→60초 백오프로 계속 두드리던 레이스(#1093)를 막는다.
    let disposed = false;
    // SSE 재연결 백오프 — 서버 장애/인증 만료 시 3초마다 무한 재시도해 /stream 을
    // 두드리지 않도록 지수 백오프(3→6→…→최대 60초). 연결 성공(onopen) 시 3초로 리셋.
    let reconnectDelay = 3000;
    function scheduleReconnect() {
      if (disposed) return;
      retry = window.setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
    }
    // 채팅 이벤트는 별도 컴포넌트(ChatMiniApp) 에서 소비하므로 DOM CustomEvent 로
    // 재방송한다. 기존 "chat:open" / "chat:open-room" 같은 in-app event 와 동일 패턴.
    const rebroadcast = (name: "chat:sse-message" | "chat:sse-update" | "chat:sse-room", payload: unknown) => {
      try {
        window.dispatchEvent(new CustomEvent(name, { detail: payload }));
      } catch {}
    };
    // 웹은 Vercel 이 SSE 를 버퍼/끊어 라이브 SSE 가 0 이라, 백엔드(api.*)로 직결한다. 직결엔
    // ?token= 이 필요한데 웹은 JS 에 세션토큰이 없어(httpOnly 쿠키) 짧은 수명 SSE 티켓을 받아 쓴다.
    // 네이티브는 기존처럼 자기 API_BASE + 저장된 토큰으로 직결(별도 티켓 불필요).
    let useDirect = !isCapacitorNative();
    let directOpened = false; // 직결이 한 번이라도 붙었나 — 첫 연결조차 실패하면 프록시로 폴백.
    async function resolveStreamUrl(): Promise<string> {
      if (useDirect) {
        const { ticket } = await api<{ ticket: string }>("/api/notification/sse-ticket");
        return `https://api.${location.hostname}/api/notification/stream?token=${encodeURIComponent(ticket)}`;
      }
      // 네이티브: 저장 토큰으로 ?token= 직결. 웹 폴백: 상대경로(Vercel 프록시)+쿠키.
      const streamToken = getAuthToken();
      return apiUrl("/api/notification/stream") + (streamToken ? `?token=${encodeURIComponent(streamToken)}` : "");
    }
    async function connect() {
      if (disposed) return;
      try {
        const streamUrl = await resolveStreamUrl();
        if (disposed) return; // 티켓 발급 중 언마운트 — 연결 만들지 않음
        // 직결은 티켓(쿼리)으로 인증 → 쿠키 불필요. 프록시 폴백 경로는 기존 쿠키 인증 유지.
        const es = new EventSource(streamUrl, { withCredentials: !useDirect });
        esRef.current = es;
        es.onopen = () => { reconnectDelay = 3000; if (useDirect) directOpened = true; }; // 연결 성공 → 백오프 리셋
        es.addEventListener("notification", (ev: MessageEvent) => {
          try {
            const n = JSON.parse(ev.data) as Notif;
            // 지금 보고 있는 방의 채팅(DM/MENTION) 알림은 도착 즉시 읽음 처리한다. 안 그러면 방을
            // 보다 나갔을 때 그 방이 리스트에서 안읽음으로 남는다 — 메시지는 화면에서 봤지만 알림
            // 레코드가 ChatMiniApp 의 markRoomRead 직후(레이스)에 도착해 미읽음으로 쌓이기 때문.
            const nRoom = n.linkUrl?.match(/room=([^&]+)/)?.[1] ?? null;
            const isActiveRoomChat =
              (n.type === "DM" || n.type === "MENTION") && !!nRoom && nRoom === getActiveChatRoom();
            if (isActiveRoomChat && !n.readAt) {
              n.readAt = new Date().toISOString(); // 로컬 즉시 읽음(리스트 미읽음 방지)
              void api("/api/notification/read", { method: "POST", json: { ids: [n.id] } }).catch(() => {});
            }
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
                { id: n.id, title: n.title, body: n.body, linkUrl: n.linkUrl, actorName: n.actorName, actorColor: n.actorColor },
              ]);
            }
            // (음소거·카테고리로 가로막힌 건 위 if 가 OS 배너만 생략 — 벨/미읽음은 이미 반영됨.)
            // 예전엔 여기서 markSeen 해 "영구 차단" 했는데, 그러면 다른 기기에서 음소거를 풀어도
            // 그 알림이 영영 안 떴다(localStorage 음소거 미러가 stale 인 채 markSeen 까지 박혀서).
            // reload() 도 shouldDeliverNotif 로 동일하게 필터하므로 markSeen 없이도 재발송되지 않고,
            // 음소거 해제 후엔 reload 가 정상 배너를 띄운다. → markSeen 제거(근본 수정).
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
          // 직결이 한 번도 못 붙으면(CORS/오리진/티켓 등) 프록시 경로로 영구 폴백.
          if (useDirect && !directOpened) useDirect = false;
          scheduleReconnect();
        };
      } catch {
        // 티켓 발급 실패 등 → 직결 포기하고 프록시(→폴링 폴백)로.
        if (useDirect && !directOpened) useDirect = false;
        scheduleReconnect();
      }
    }
    void connect();

    // SSE fallback 폴링. 단 웹은 Vercel 이 SSE 를 버퍼/끊어 라이브 SSE 가 사실상 0 이라
    // 이 폴링이 '주 동기화 경로'가 된다 → 미읽음 실시간성(①)을 위해 90초→20초로 단축.
    //   (네이티브는 ?token= 직결 SSE 가 살아있어 이 폴링은 진짜 fallback — 거의 안 돔.)
    //   (근본 해결 = 웹 SSE 백엔드 직결[B]. 그게 배포되기 전까지의 개선책.)
    //   - 탭 hidden 이면 폴링 자체를 중단 (visibility 복귀 시 한 번 reload + interval 재무장).
    let t: number | null = null;
    function startPoll() { if (t === null) t = window.setInterval(reload, 20_000); }
    function stopPoll() { if (t !== null) { window.clearInterval(t); t = null; } }
    if (document.visibilityState === "visible") startPoll();

    function onVisibility() {
      if (document.visibilityState !== "visible") { stopPoll(); return; }
      // 보이는 상태로 복귀 — fallback 폴링 재무장.
      startPoll();
      // SSE 가 살아있으면 실시간 push 로 이미 동기화됨 — reload() 생략.
      // SSE 가 끊긴 상태(재연결 대기 중)에서만 전체 재조회.
      if (esRef.current && esRef.current.readyState !== EventSource.CLOSED) return;
      // 이 reload 는 "복귀 직후 캐치업" — 네이티브에선 쌓인 미읽음을 다시 토스트하지 않게 표시.
      catchUpRef.current = true;
      reload();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true; // 진행 중이던 connect()/재연결 백오프가 이후에 되살아나지 않게
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
  // SSE 생존 여부 — esRef readyState 로 판정(CONNECTING/OPEN 이면 살아있음). ref 읽기라
  // deps 불필요한 안정 콜백 → value 가 이것 때문에 재생성되지 않음.
  const isSseAlive = useCallback(
    () => !!esRef.current && esRef.current.readyState !== EventSource.CLOSED,
    [],
  );

  const value = useMemo<Ctx>(
    () => ({ items, bellItems, unread, chatUnread, ready, reload, markRead, markRoomRead, isSseAlive }),
    [items, bellItems, unread, chatUnread, ready, reload, markRead, markRoomRead, isSseAlive]
  );

  return (
    <NotificationCtx.Provider value={value}>
      {children}
    </NotificationCtx.Provider>
  );
}

export const useNotifications = () => useContext(NotificationCtx);
