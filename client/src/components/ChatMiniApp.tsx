import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiFetch, imgSrc } from "../api";
import { useAuth } from "../auth";
import { useNotifications } from "../notifications";
import { resolvePresence } from "../lib/presence";
import { downloadFromUrl } from "../lib/download";
import { isCapacitorNative, nativePlatform } from "../lib/platform";
import { isNativeAppActive } from "../lib/appActive";
import { prewarmChatAvatars } from "../lib/liquidGlassTabBar";
import { setActiveChatRoom } from "../lib/desktopNotify";
import { Browser } from "@capacitor/browser";
import { alertAsync, confirmAsync } from "./ConfirmHost";
import { SnippetSlashMenu, type SnippetSlashHandle } from "./chat/SnippetSlashMenu";
import { MentionMenu, type MentionHandle } from "./chat/MentionMenu";
import {
  C,
  FONT,
  Avatar,
  formatBytes,
  formatClock,
  formatDetailed,
  formatDayDivider,
  formatRelative,
  loadAllRoomSettings,
  previewForMessage,
  roomColor,
  roomImageUrl,
  roomTitle,
  saveAllRoomSettings,
} from "./chat/theme";
import type {
  Attachment,
  Message,
  MessageHit,
  Room,
  RoomLocalSetting,
} from "./chat/types";
import {
  ActionIcons,
  AttachmentPreview,
  LongPress,
  MessageBubble,
  ReactionPicker,
  groupReactions,
  safeFileUrl,
  type MessageAction,
} from "./chat/MessageBubble";
import { parseCodeSegments } from "../lib/codeDetect";
import { copyToClipboard } from "../lib/clipboard";
import { useHighlightedCode } from "../lib/useHighlightedCode";
import { LangIcon } from "../lib/langIcon";
import { isDevAccount, DevBadge } from "../lib/devBadge";

/**
 * 팝업 내부 사내톡 — 토스(Toss) 스타일 코디네이터.
 *  - 방 목록 / 대화방 / 방 설정 / 그룹 생성 뷰를 상태 기반으로 전환
 *  - 테마/타입/말풍선은 ./chat/* 로 분할
 */

export default function ChatMiniApp({
  active: isPanelOpen,
  onActiveRoomChange,
  createGroupRequestId,
  openRoomRequest,
}: {
  active: boolean;
  /** 대화방 진입/뒤로가기를 ChatFab 헤더가 알 수 있게 알림 */
  onActiveRoomChange?: (info: {
    title: string;
    subtitle: string;
    color: string;
    imageUrl?: string | null;
    onBack: () => void;
    onTitleClick?: () => void;
    isSettings?: boolean;
  } | null) => void;
  /** 이 값이 변할 때마다 그룹 생성 뷰를 엶 */
  createGroupRequestId?: number;
  /** 외부(검색 등)에서 특정 방을 강제로 열고 싶을 때 — id 가 바뀔 때마다 해당 roomId 로 진입 */
  openRoomRequest?: { id: number; roomId: string } | null;
}) {
  const { user } = useAuth();
  const { items: notifItems, markRoomRead, isSseAlive } = useNotifications();

  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [readStates, setReadStates] = useState<{ userId: string; lastReadAt: string | null }[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // 한 메시지에 여러 첨부를 붙일 수 있도록 배열로 관리.
  // 전송 시 첨부가 N개면: 첫 메시지에 텍스트+첫 첨부, 이어지는 첨부는 각각 별도 메시지로 전송.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [q, setQ] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  // 방별 로컬 설정(별명/음소거) — localStorage 보관
  const [roomSettings, setRoomSettings] = useState<Record<string, RoomLocalSetting>>(() => loadAllRoomSettings());
  const scrollRef = useRef<HTMLDivElement>(null);

  // 유저별 업무 상태 매핑 — 아바타 프레즌스 점용. 주기적으로 /api/users 갱신.
  const [presenceMap, setPresenceMap] = useState<Record<string, { presenceStatus: string | null; workStatus: string | null; presenceMessage: string | null }>>({});
  useEffect(() => {
    if (!isPanelOpen) return;
    let cancelled = false;
    const fetchPresence = async () => {
      try {
        // 경량 전용 엔드포인트 — 풀 유저행(이메일/아바타/HR 필드 등) 대신 presence 4필드만.
        // 30초 폴링(채팅 패널 열림 시)의 응답 크기를 ~8x 줄인다. (서버 users.ts /presence)
        const res = await api<{ users: Array<{ id: string; presenceStatus?: string | null; workStatus?: string | null; presenceMessage?: string | null }> }>("/api/users/presence");
        if (cancelled) return;
        const m: Record<string, { presenceStatus: string | null; workStatus: string | null; presenceMessage: string | null }> = {};
        for (const u of res.users) {
          m[u.id] = {
            presenceStatus: u.presenceStatus ?? null,
            workStatus: u.workStatus ?? null,
            presenceMessage: u.presenceMessage ?? null,
          };
        }
        setPresenceMap(m);
      } catch {}
    };
    fetchPresence();
    // presence 는 사이드패널이 열려 있을 때만 polling. 탭 hidden 이면 polling 중단해서
    // 백그라운드 탭 다수 운영 시 서버 RPS 누적을 막는다 (SSE 가 실시간 이벤트는 별도 채널).
    let t: number | null = null;
    function start() { if (t === null) t = window.setInterval(fetchPresence, 30_000); }
    function stop() { if (t !== null) { window.clearInterval(t); t = null; } }
    if (document.visibilityState === "visible") start();
    function onVis() {
      if (document.visibilityState === "visible") { fetchPresence(); start(); }
      else { stop(); }
    }
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelled = true; stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [isPanelOpen]);

  const patchRoomSetting = (roomId: string, patch: { nickname?: string; muted?: boolean }) => {
    setRoomSettings((prev) => {
      const next = { ...prev, [roomId]: { ...prev[roomId], ...patch } };
      // 빈 별명은 삭제로 취급
      if (patch.nickname === "") {
        const cp = { ...next[roomId] };
        delete cp.nickname;
        next[roomId] = cp;
      }
      saveAllRoomSettings(next);
      return next;
    });
    // 음소거는 서버에도 영속화 — 기기 간 동기화 + 서버가 음소거 방의 APNs(폰 푸시) 를 생략하도록.
    // (별명은 로컬 전용이므로 muted 가 명시될 때만 호출.) 낙관적 — 실패해도 다음 동기화에서 보정.
    if (patch.muted !== undefined) {
      void api(`/api/chat/rooms/${roomId}/mute`, { method: "PATCH", json: { muted: patch.muted } }).catch(() => {});
    }
  };

  // 서버의 RoomMember.muted → 로컬 roomSettings.muted 동기화.
  // notifPrefs.shouldDeliverNotif 가 localStorage 를 직접 읽으므로 localStorage 도 함께 갱신.
  const hydrateMutedFromServer = (list: Room[]) => {
    const meId = user?.id;
    if (!meId) return;
    setRoomSettings((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const r of list) {
        const mine = r.members.find((m) => m.user.id === meId);
        if (!mine) continue;
        const serverMuted = !!mine.muted;
        if (serverMuted !== !!next[r.id]?.muted) {
          next[r.id] = { ...next[r.id], muted: serverMuted };
          changed = true;
        }
      }
      if (changed) saveAllRoomSettings(next);
      return changed ? next : prev;
    });
  };

  const roomUnread = useMemo(() => {
    const map: Record<string, number> = {};
    for (const n of notifItems) {
      if (n.readAt) continue;
      if (n.type !== "DM" && n.type !== "MENTION") continue;
      const m = n.linkUrl?.match(/room=([^&]+)/);
      if (!m) continue;
      map[m[1]] = (map[m[1]] ?? 0) + 1;
    }
    return map;
  }, [notifItems]);

  const active = useMemo(() => rooms.find((r) => r.id === activeId) ?? null, [rooms, activeId]);

  const loadRooms = async () => {
    try {
      const res = await api<{ rooms: Room[] }>("/api/chat/rooms");
      setRooms(res.rooms);
      hydrateMutedFromServer(res.rooms);
      // iOS: 발신 가능성 있는 멤버 아바타를 NSE 캐시에 선기록 → 첫 알림부터 통신알림 아바타.
      prewarmChatAvatars(res.rooms.flatMap((r) => r.members.map((m) => m.user.avatarUrl)));
    } catch {}
  };
  // 1:1 대화 '나만 삭제'(per-user 숨김). 내 목록에서만 사라지고 상대에겐 유지. 새 메시지 오면 다시 나타남.
  const hideRoom = async (r: Room) => {
    const ok = await confirmAsync({
      title: "대화 삭제",
      description: "이 대화를 내 목록에서 삭제할까요?\n상대방에게는 그대로 남아있고, 새 메시지가 오면 다시 나타나요.",
      tone: "danger",
      confirmLabel: "삭제",
    });
    if (!ok) return;
    // 낙관적 — 즉시 목록에서 제거. 실패하면 복원.
    setRooms((prev) => prev.filter((x) => x.id !== r.id));
    try {
      await api(`/api/chat/rooms/${r.id}/hide`, { method: "POST" });
    } catch (e: any) {
      await alertAsync({ title: "삭제 실패", description: e?.message || "대화를 삭제하지 못했어요." });
      loadRooms();
    }
  };
  // 메시지 로더.
  // - full=true: 전체 재조회 (방 진입/포커스 복귀/주기적 동기화)
  // - full=false: 마지막 메시지 이후만 증분 조회. 서버가 `?after=<id>` 로 새 메시지만 반환 →
  //   1.5초 폴링에서 빈 응답이 대부분이라 트래픽·DB 부하 체감상 제로.
  //   단점: 기존 메시지에 대한 수정/삭제/리액션은 여기서 못 받음 → 포커스 복귀·15초 주기·전송 직후에
  //   full 갱신으로 보정.
  const latestIdRef = useRef<string | null>(null);
  useEffect(() => {
    latestIdRef.current = messages.length ? messages[messages.length - 1].id : null;
  }, [messages]);

  const loadMessages = async (roomId: string, opts: { full?: boolean } = {}) => {
    const full = opts.full ?? false;
    const after = !full ? latestIdRef.current : null;
    try {
      const qs = after ? `?after=${encodeURIComponent(after)}` : "";
      const res = await api<{
        messages: Message[];
        readStates?: { userId: string; lastReadAt: string | null }[];
      }>(`/api/chat/rooms/${roomId}/messages${qs}`);

      if (after) {
        if (res.messages.length > 0) {
          setMessages((prev) => {
            // 혹시라도 중복이 오면 dedupe — after 이후지만 정합성 방어
            const seen = new Set(prev.map((m) => m.id));
            const fresh = res.messages.filter((m) => !seen.has(m.id));
            return fresh.length ? [...prev, ...fresh] : prev;
          });
        }
        // readStates 는 가벼워서 매번 교체 — 안읽음 카운트가 실시간으로 갱신돼야 함.
        // 단, 내 것은 로컬 낙관 갱신(markRead)이 더 최신일 수 있으니 max() 로 병합해야
        // 방 진입 순간 발사한 loadMessages 응답이 markRead 낙관 갱신을 덮어쓰지 않는다.
        if (res.readStates) mergeReadStatesKeepingMine(res.readStates);
      } else {
        setMessages(res.messages);
        mergeReadStatesKeepingMine(res.readStates ?? []);
      }
      // 스크롤은 RoomView 의 useLayoutEffect 에서 페인트 전에 수행 (플래시 방지)
    } catch {}
  };

  // 현재 채팅이 사용자에게 실제로 보이는지 — 창이 포커스 잃었거나 탭이 백그라운드면 읽음 처리 금지.
  // ⚠️ 네이티브(Capacitor WKWebView)에선 document.hasFocus() 가 키보드 표시·인풋 포커스 등
  //    상호작용 중에 false 반환하는 케이스가 잦아, 사용자가 채팅창을 명백히 보고 있는 동안에도
  //    하트비트 markRead 가 스킵되어 active-viewer APNs 스킵이 동작하지 않았다.
  //    → 네이티브에선 hasFocus 의존성 제거(panel 열림 + visible 만 본다). 데스크톱 웹은 기존대로.
  // ⚠️ 네이티브(iOS/안드)는 document.visibilityState 가 백그라운드/잠금에도 'visible' 로 남는 경우가
  //    있어, 그걸로 판정하면 백그라운드에서도 하트비트 markRead 가 계속 돌아 lastReadAt 이 신선하게
  //    유지된다 → 서버 active-viewer 게이트가 "지금 보는 중"으로 오판해 그 방의 백그라운드 푸시까지
  //    막아버린다(알림 안 옴). 네이티브는 @capacitor/app 의 실제 active 상태로 판정해, 백그라운드면
  //    하트비트를 멈춘다. 웹은 기존대로 visibility + focus.
  const isChatVisible = () => {
    if (!isPanelOpen || typeof document === "undefined") return false;
    if (isCapacitorNative()) return isNativeAppActive();
    return document.visibilityState === "visible" && (typeof document.hasFocus !== "function" || document.hasFocus());
  };

  /**
   * 서버가 반환한 readStates 를 로컬에 반영하되, **내 lastReadAt 은 로컬이 더 최신이면 유지**한다.
   * 방 진입 시:
   *   1) loadMessages(activeId, {full:true}) 발사 — 서버는 그 시점 스냅샷을 응답으로 준비
   *   2) markRead(activeId) 로컬 낙관 갱신 (내 lastReadAt = now) — UI 즉시 반영
   *   3) markRead 안의 서버 POST /read 완료 → DB 업데이트
   *   4) loadMessages 응답 도착 — 하지만 이 응답의 readStates 는 t=0 시점(=옛날 값)
   *   5) 그냥 setReadStates(res.readStates) 하면 옛날 값이 낙관 갱신 덮어씀 → "1" 안 사라짐 버그
   * 그래서 내 lastReadAt 은 max(local, server) 로 유지.
   */
  const mergeReadStatesKeepingMine = (incoming: { userId: string; lastReadAt: string | null }[]) => {
    const meId = user?.id;
    setReadStates((prev) => {
      if (!meId) return incoming;
      const prevMy = prev.find((r) => r.userId === meId)?.lastReadAt ?? null;
      if (!prevMy) return incoming;
      const serverMy = incoming.find((r) => r.userId === meId)?.lastReadAt ?? null;
      if (serverMy && serverMy >= prevMy) return incoming;
      // 로컬이 더 최신 → 서버 목록에 내 항목만 로컬 값으로 덮어씀
      const hasMe = incoming.some((r) => r.userId === meId);
      return hasMe
        ? incoming.map((r) => (r.userId === meId ? { userId: meId, lastReadAt: prevMy } : r))
        : [...incoming, { userId: meId, lastReadAt: prevMy }];
    });
  };

  const markRead = async (roomId: string) => {
    // 내 readStates 를 로컬에서 즉시 낙관 갱신 — 메시지별 "1" 뱃지가 SSE/30s 폴링 대기 없이 사라진다.
    // (서버 POST 가 끝나면 SSE chat:update(kind:"read") 가 도착해 같은 값으로 재확인됨.)
    const meId = user?.id;
    if (meId && roomId === activeId) {
      const now = new Date().toISOString();
      setReadStates((prev) => {
        const idx = prev.findIndex((r) => r.userId === meId);
        if (idx < 0) return [...prev, { userId: meId, lastReadAt: now }];
        const next = prev.slice();
        next[idx] = { userId: meId, lastReadAt: now };
        return next;
      });
    }
    try {
      await api(`/api/chat/rooms/${roomId}/read`, { method: "POST" });
    } catch {}
  };

  useEffect(() => { if (isPanelOpen) loadRooms(); }, [isPanelOpen]);

  // 외부(검색 모달 등)에서 openRoomRequest 가 바뀌면 해당 방으로 진입
  useEffect(() => {
    if (!openRoomRequest?.id || !openRoomRequest.roomId) return;
    setShowSettings(false);
    setCreatingGroup(false);
    setActiveId(openRoomRequest.roomId);
    // 방 목록에 아직 없을 수도 있으니 새로고침
    loadRooms();
  }, [openRoomRequest?.id]);
  useEffect(() => {
    if (!isPanelOpen) return;
    // SSE (chat:sse-message / chat:sse-room) 가 primary path — 방 목록은
    // 상태 확인용 안전망으로 60초만 돈다 (기존 5~10s 는 SSE 와 충돌해 느림의 원인).
    // ★ SSE 가 살아있으면(주로 네이티브) onRoom 이벤트가 이미 loadRooms 를 트리거하므로
    //   이 60초 폴링(모든 방×멤버 아바타 재전송)은 순수 중복 → 스킵. 끊겼을 때만 안전망 가동.
    const t = setInterval(() => { if (!isSseAlive()) loadRooms(); }, 60_000);
    return () => clearInterval(t);
  }, [isPanelOpen, activeId]);
  useEffect(() => {
    if (!activeId) return;
    // 새 방 진입 시 이전 메시지 즉시 제거 → 이전 방의 메시지가 잠깐 보이는 현상 방지
    setMessages([]);
    latestIdRef.current = null;
    loadMessages(activeId, { full: true });
    if (isChatVisible()) {
      markRead(activeId);
      markRoomRead(activeId);
    }
    // SSE 가 primary path — 폴링은 SSE 끊김·누락 대비 안전망으로만 돈다.
    // 기존 10s 폴링은 SSE 푸시와 경쟁해 체감 지연의 원인이었다 (같은 데이터 2번 왕복).
    // 지금은 30s 간격으로 증분 조회, 90s 마다 한 번 full 동기화 + read 마킹.
    let tick = 0;
    const t = setInterval(() => {
      tick++;
      // 90초마다 full 동기화(수정/삭제/리액션 반영). 단 SSE 가 살아있으면 chat:sse-update 가
      // 그것들을 이미 실시간 푸시하므로 300건 full 재전송은 불필요 → 증분(after=)만.
      // SSE 끊김 시에만 full 로 떨어져 정합성 안전망 유지. (서버 egress 절감, 성능 무영향)
      const full = tick % 3 === 0 && !isSseAlive();
      loadMessages(activeId, { full });
      if (isChatVisible()) {
        markRead(activeId);
        // 폴링 사이 도착한 DM/MENTION 알림이 NotificationProvider items 에 쌓여있을 수 있음.
        // 서버 read 만으로는 로컬 chatUnread 가 안 줄어든다 — markRoomRead 로 명시 동기화.
        markRoomRead(activeId);
      }
    }, 30_000);
    return () => clearInterval(t);
  }, [activeId, isPanelOpen]);

  // active-viewer 하트비트 — 방을 보는 동안(패널 열림 + 화면 보임) 15초마다 읽음을 갱신해,
  // 서버가 'lastReadAt 신선 = 지금 보고 있음'으로 판정하게 한다(보는 방엔 APNs 푸시 X). 폴링과
  // 별개의 전용 경로라 폴링 주기가 바뀌어도 active-viewer 판정이 안 깨진다. 닫거나 숨기면 멈춤.
  useEffect(() => {
    if (!activeId || !isPanelOpen) return;
    const ping = () => { if (isChatVisible()) void markRead(activeId); };
    const t = setInterval(ping, 15_000);
    return () => clearInterval(t);
  }, [activeId, isPanelOpen]);

  // 디바이스 로컬 active 방 추적 — desktopNotify 가 시스템 알림 띄우기 전에 참조해, 지금 보고
  // 있는 방으로 향하는 알림은 OS 시스템 알림을 띄우지 않게 한다. 서버 active-viewer 게이트는
  // APNs 만 막아주지만, 데스크탑/웹 시스템 알림은 디바이스 로컬 판단이 더 정확하다.
  // (visibility 변경 / 패널 닫힘 시 즉시 해제.)
  useEffect(() => {
    const apply = () => {
      const visible = typeof document !== "undefined" && document.visibilityState === "visible";
      setActiveChatRoom(activeId && isPanelOpen && visible ? activeId : null);
    };
    apply();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", apply);
    }
    return () => {
      setActiveChatRoom(null);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", apply);
      }
    };
  }, [activeId, isPanelOpen]);

  // SSE 수신 — NotificationProvider 의 EventSource 가 여기로 재방송한 chat:* 이벤트.
  // 대상 방이 현재 열려있는 방과 일치할 때만 상태에 반영. 아니면 rooms 목록만 갱신
  // (마지막 메시지 미리보기 / 미읽음 뱃지용).
  useEffect(() => {
    const onMessage = (e: Event) => {
      const detail = (e as CustomEvent).detail as { message: Message } | undefined;
      if (!detail?.message) return;
      const msg = detail.message;
      if (msg.roomId === activeId) {
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        if (isChatVisible()) {
          markRead(msg.roomId);
          // 로컬 NotificationProvider items 에서도 이 방의 DM/MENTION 을 즉시 readAt 처리 →
          // 사이드바 채팅 뱃지가 새 메시지 도착하자마자 자동 차감.
          markRoomRead(msg.roomId);
        }
      }
      // rooms 리스트 — 이전엔 loadRooms() 로 매 메시지마다 서버 왕복했는데,
      // 이게 수신자 체감 지연의 핵심 원인이었다. 이제는 들어온 메시지를 해당 방의
      // 마지막 메시지 프리뷰로 로컬에서 즉시 덮어쓰고, 방을 목록 최상단으로 올린다.
      setRooms((prev) => {
        const idx = prev.findIndex((r) => r.id === msg.roomId);
        if (idx < 0) return prev; // 내가 멤버가 아닌 방이면 무시
        const room = prev[idx];
        const updated: Room = { ...room, messages: [msg as any] };
        // 활성 방이 아니면 최상단으로 끌어올려 정렬 (최근 대화 우선)
        if (msg.roomId === activeId) {
          const next = prev.slice();
          next[idx] = updated;
          return next;
        }
        return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
      });
    };
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { kind: "edit" | "pin"; message: Message }
        | { kind: "delete"; messageId: string }
        | { kind: "reactions"; messageId: string; reactions: Message["reactions"] }
        | { kind: "read"; roomId: string; userId: string; lastReadAt: string }
        | undefined;
      if (!detail) return;
      if (detail.kind === "edit" || detail.kind === "pin") {
        const incoming = detail.message;
        if (incoming.roomId !== activeId) return;
        setMessages((prev) => prev.map((m) => (m.id === incoming.id ? { ...m, ...incoming } : m)));
      } else if (detail.kind === "delete") {
        setMessages((prev) => prev.map((m) => (m.id === detail.messageId ? { ...m, deletedAt: new Date().toISOString() } : m)));
      } else if (detail.kind === "reactions") {
        setMessages((prev) => prev.map((m) => (m.id === detail.messageId ? { ...m, reactions: detail.reactions ?? [] } : m)));
      } else if (detail.kind === "read") {
        // 상대방이 읽음 처리 → 열려있는 방의 readStates 를 즉시 갱신해 파란 "1" 뱃지 제거.
        if (detail.roomId !== activeId) return;
        setReadStates((prev) => {
          const idx = prev.findIndex((r) => r.userId === detail.userId);
          if (idx < 0) return [...prev, { userId: detail.userId, lastReadAt: detail.lastReadAt }];
          const next = prev.slice();
          next[idx] = { userId: detail.userId, lastReadAt: detail.lastReadAt };
          return next;
        });
      }
    };
    const onRoom = (ev: Event) => {
      // 서버가 { kind: "deleted", roomId } 푸시 → 활성 방이 그거였으면 즉시 닫고,
      // rooms 목록도 재조회. (그냥 loadRooms() 만 부르면 hover 상태에서 깜빡임)
      const detail = (ev as CustomEvent).detail as { kind?: string; roomId?: string } | undefined;
      if (detail?.kind === "deleted" && detail.roomId) {
        if (activeId === detail.roomId) setActiveId(null);
        setRooms((prev) => prev.filter((r) => r.id !== detail.roomId));
      }
      loadRooms();
    };
    window.addEventListener("chat:sse-message", onMessage);
    window.addEventListener("chat:sse-update", onUpdate);
    window.addEventListener("chat:sse-room", onRoom);
    return () => {
      window.removeEventListener("chat:sse-message", onMessage);
      window.removeEventListener("chat:sse-update", onUpdate);
      window.removeEventListener("chat:sse-room", onRoom);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // 창이 다시 포커스/visibility 복귀할 때 즉시 읽음 처리
  useEffect(() => {
    if (!activeId) return;
    const onFocus = () => {
      if (isChatVisible()) {
        // 포커스 복귀 시 full 동기화 — 백그라운드 동안 들어온 편집/삭제/리액션 반영
        loadMessages(activeId, { full: true });
        markRead(activeId);
        markRoomRead(activeId);
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [activeId, isPanelOpen]);

  // 상위 ChatFab 헤더가 방 정보를 보여줄 수 있도록 알림
  const activeRoomObj = useMemo(() => rooms.find((r) => r.id === activeId) ?? null, [rooms, activeId]);
  useEffect(() => {
    if (!onActiveRoomChange) return;
    if (activeRoomObj) {
      const override = roomSettings[activeRoomObj.id]?.nickname;
      const title = override || roomTitle(activeRoomObj, user?.id ?? "");
      const muted = !!roomSettings[activeRoomObj.id]?.muted;
      const directOther = activeRoomObj.members.find((m) => m.user.id !== (user?.id ?? ""));
      const baseSub =
        activeRoomObj.type === "DIRECT"
          ? ([directOther?.user.position, directOther?.user.team].filter(Boolean).join(" · ") || "1:1 대화")
          : activeRoomObj.type === "TEAM" ? "팀"
            : `${activeRoomObj.members.length}명`;
      const subtitle = showSettings ? "채팅방 설정" : (muted ? `${baseSub} · 알림 꺼짐` : baseSub);
      onActiveRoomChange({
        title,
        subtitle,
        color: roomColor(activeRoomObj, user?.id ?? ""),
        imageUrl: roomImageUrl(activeRoomObj, user?.id ?? ""),
        onBack: showSettings
          ? () => setShowSettings(false)
          : () => { setActiveId(null); setMessages([]); setShowSettings(false); },
        onTitleClick: showSettings ? undefined : () => setShowSettings(true),
        isSettings: showSettings,
      });
    } else {
      onActiveRoomChange(null);
    }
    return () => { if (!activeId) onActiveRoomChange(null); };
  }, [activeRoomObj, user?.id, showSettings, roomSettings]);

  // 방 전환 시 설정 화면은 항상 닫음
  useEffect(() => { setShowSettings(false); }, [activeId]);

  // 상위에서 그룹 생성 요청이 오면 생성 뷰 열기 (0은 초기값이라 무시)
  useEffect(() => {
    if (!createGroupRequestId) return;
    setCreatingGroup(true);
  }, [createGroupRequestId]);

  // 그룹 생성 뷰가 열려 있는 동안은 헤더를 "새 그룹 만들기"로 교체,
  // 닫히면 목록 상태일 때 헤더를 ListHeader(사내톡)로 되돌림.
  useEffect(() => {
    if (!onActiveRoomChange) return;
    if (creatingGroup) {
      onActiveRoomChange({
        title: "새 그룹 만들기",
        subtitle: "",
        color: C.blue,
        onBack: () => setCreatingGroup(false),
        isSettings: true, // compact 헤더 재사용
      });
    } else if (!activeRoomObj) {
      // 방도 안 열려 있으면 헤더 해제 (ChatFab이 ListHeader를 렌더)
      onActiveRoomChange(null);
    }
  }, [creatingGroup]);

  async function uploadFile(file: File): Promise<Attachment | null> {
    // 채팅 첨부는 서버에서 500MB 까지만 받음. 미리 걸러 사용자 경험을 개선.
    if (file.size > 500 * 1024 * 1024) {
      alertAsync({
        title: "파일 크기 초과",
        description: "채팅 첨부는 500MB 이하만 가능해요. 더 큰 파일은 문서함으로 공유해주세요.",
      });
      return null;
    }
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    try {
      const r = await apiFetch("/api/upload", { method: "POST", body: form });
      if (!r.ok) throw new Error("upload failed");
      const j = await r.json();
      return { url: j.url, name: j.name, type: j.type, size: j.size, kind: j.kind };
    } catch {
      alertAsync({ title: "업로드 실패", description: "파일 업로드에 실패했어요" });
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function pickAndUpload(file: File) {
    const att = await uploadFile(file);
    if (att) setAttachments((prev) => [...prev, att]);
  }

  function removeAttachmentAt(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  async function reactToMessage(messageId: string, emoji: string) {
    // 낙관적 토글: 내 리액션이 이미 있으면 제거, 없으면 추가
    setMessages((prev) => prev.map((m) => {
      if (m.id !== messageId) return m;
      const list = m.reactions ?? [];
      const mine = list.find((r) => r.userId === (user?.id ?? "") && r.emoji === emoji);
      const next = mine
        ? list.filter((r) => !(r.userId === (user?.id ?? "") && r.emoji === emoji))
        : [...list, { userId: user?.id ?? "", emoji, user: { name: user?.name ?? "나" } }];
      return { ...m, reactions: next };
    }));
    try {
      await api(`/api/chat/messages/${messageId}/reactions`, {
        method: "POST",
        json: { emoji },
      });
      // SSE 가 chat:update(kind:"reactions") 를 푸시해 동기화 — 성공 시 추가 조회 불필요.
    } catch {
      // 실패 시엔 낙관적 상태를 되돌리기 위해 full 재조회
      if (activeId) loadMessages(activeId, { full: true });
    }
  }

  async function pinMessage(messageId: string) {
    // 낙관적: 현재 pinnedAt 상태를 토글
    setMessages((prev) => prev.map((m) =>
      m.id === messageId
        ? { ...m, pinnedAt: m.pinnedAt ? null : new Date().toISOString() }
        : m
    ));
    try {
      await api(`/api/chat/messages/${messageId}/pin`, { method: "POST" });
      // SSE chat:update(kind:"pin") 로 동기화.
    } catch {
      if (activeId) loadMessages(activeId, { full: true });
    }
  }

  /**
   * 메시지 삭제(소프트). 본인이 보낸 메시지만.
   * 확인 → 낙관적으로 deletedAt 설정 → DELETE 호출.
   * 서버는 chat:update(kind:"delete") 로 나머지 멤버에 브로드캐스트 → 모두 "삭제된 메시지" 로 대체.
   */
  async function deleteMessage(messageId: string) {
    const ok = await confirmAsync({
      title: "메시지 삭제",
      description: "이 메시지를 삭제할까요?\n삭제하면 '삭제된 메시지' 로 표시됩니다.",
      confirmLabel: "삭제",
      cancelLabel: "취소",
      tone: "danger",
    });
    if (!ok) return;

    // 낙관적 — deletedAt 을 즉시 세팅해 UI 를 "삭제된 메시지" 로 교체.
    const now = new Date().toISOString();
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, deletedAt: now } : m)));
    try {
      await api(`/api/chat/messages/${messageId}`, { method: "DELETE" });
      // SSE chat:update(kind:"delete") 로 다른 탭/유저 동기화.
    } catch (e: any) {
      // 실패 시 서버 상태로 복구
      if (activeId) loadMessages(activeId, { full: true });
      await alertAsync({ title: "삭제 실패", description: e?.message || "메시지를 삭제하지 못했습니다." });
    }
  }

  async function send() {
    if (!activeId || sending) return;
    const content = input.trim();
    if (!content && attachments.length === 0) return;
    // @멘션 — 본문의 `@멤버이름` 을 그룹 멤버명과 매칭해 userId 목록 파생(그룹만). 서버가 그들에게
    // MENTION 알림을 보낸다(1:1 은 멘션 없음). 빈 배열이면 서버가 무시.
    const mentions =
      active && active.type !== "DIRECT"
        ? active.members
            .filter((rm) => rm.user.id !== (user?.id ?? "") && content.includes(`@${rm.user.name}`))
            .map((rm) => rm.user.id)
        : [];
    const prevInput = input;
    const prevAttachments = attachments;
    setInput("");
    setAttachments([]);
    setSending(true);
    try {
      // 전송 응답에 서버가 만든 메시지가 그대로 담겨온다. SSE 도 같은 메시지를
      // 로컬로 다시 푸시하므로 즉시 낙관적 append — dedup 은 message.id 기준.
      const appendLocal = (m: Message) => {
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      };
      if (prevAttachments.length > 0) {
        for (let i = 0; i < prevAttachments.length; i++) {
          const a = prevAttachments[i];
          const r = await api<{ message: Message }>(`/api/chat/rooms/${activeId}/messages`, {
            method: "POST",
            json: {
              content: i === 0 ? content : "",
              kind: a.kind,
              fileUrl: a.url,
              fileName: a.name,
              fileType: a.type,
              fileSize: a.size,
            },
          });
          if (r?.message) appendLocal(r.message);
        }
      } else {
        const r = await api<{ message: Message }>(`/api/chat/rooms/${activeId}/messages`, {
          method: "POST",
          json: { content, kind: "TEXT", mentions },
        });
        if (r?.message) appendLocal(r.message);
      }
      // ← 전체 loadMessages 재조회 제거. SSE + 낙관적 append 로 이미 최신 상태.
    } catch {
      setInput(prevInput);
      setAttachments(prevAttachments);
    } finally {
      setSending(false);
    }
  }

  const filteredRooms = useMemo(() => {
    const k = q.trim().toLowerCase();
    const base = k
      ? rooms.filter((r) => roomTitle(r, user?.id ?? "").toLowerCase().includes(k))
      : rooms;
    // 가장 최근 메시지가 있는 방을 위로. 메시지 없으면 맨 뒤.
    return [...base].sort((a, b) => {
      const ta = a.messages[0]?.createdAt ? new Date(a.messages[0].createdAt).getTime() : 0;
      const tb = b.messages[0]?.createdAt ? new Date(b.messages[0].createdAt).getTime() : 0;
      return tb - ta;
    });
  }, [rooms, q, user?.id]);

  // 메시지 본문 검색 — 검색어 입력 시 debounce 후 서버 조회
  const [messageHits, setMessageHits] = useState<MessageHit[]>([]);
  const [searching, setSearching] = useState(false);
  // 요청 in-flight 중에 q 가 다시 바뀌면 clearTimeout 은 되지만 이미 발사된 fetch 는
  // 취소 불가 → 느린 응답이 나중에 도착해 최신 결과를 덮는 race. token 으로 가장 최근 요청만 UI 반영.
  const searchTokenRef = useRef(0);
  useEffect(() => {
    const k = q.trim();
    if (!k) { setMessageHits([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      const my = ++searchTokenRef.current;
      try {
        const res = await api<{ hits: MessageHit[] }>(`/api/chat/search?q=${encodeURIComponent(k)}`);
        if (my !== searchTokenRef.current) return;
        setMessageHits(res.hits);
      } catch {
        if (my !== searchTokenRef.current) return;
        setMessageHits([]);
      } finally {
        if (my === searchTokenRef.current) setSearching(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div
      style={{
        width: "100%", height: "100%",
        display: "flex", flexDirection: "column",
        background: C.surface,
        fontFamily: FONT,
        color: C.ink,
        letterSpacing: "-0.01em",
      }}
    >
      {creatingGroup ? (
        <CreateGroupView
          meId={user?.id ?? ""}
          onCancel={() => setCreatingGroup(false)}
          onCreated={(roomId) => {
            setCreatingGroup(false);
            loadRooms();
            setActiveId(roomId);
          }}
        />
      ) : active && showSettings ? (
        <SettingsView
          room={active}
          meId={user?.id ?? ""}
          isAdmin={user?.role === "ADMIN"}
          settings={roomSettings[active.id] ?? {}}
          onPatch={(p) => patchRoomSetting(active.id, p)}
          messages={messages}
          onDeleteRoom={async () => {
            // 그룹 생성자(또는 ADMIN) 만 가능 — 서버가 한 번 더 검증.
            // 삭제 성공하면 onRoom SSE 가 도착하기 전에 클라가 먼저 정리.
            const ok = await confirmAsync({
              title: "그룹방 삭제",
              description: `"${roomTitle(active, user?.id ?? "")}" 을(를) 삭제할까요?\n메시지와 첨부도 모두 사라지고, 되돌릴 수 없어요.`,
              tone: "danger",
              confirmLabel: "삭제",
            });
            if (!ok) return;
            try {
              await api(`/api/chat/rooms/${active.id}`, { method: "DELETE" });
              setShowSettings(false);
              setActiveId(null);
              setRooms((prev) => prev.filter((r) => r.id !== active.id));
            } catch (e: any) {
              await alertAsync({
                title: "삭제 실패",
                description: e?.message ?? "잠시 후 다시 시도해 주세요",
              });
            }
          }}
        />
      ) : active ? (
        <RoomView
          room={active}
          messages={messages}
          meId={user?.id ?? ""}
          onBack={() => { setActiveId(null); setMessages([]); }}
          input={input}
          setInput={setInput}
          onSend={send}
          sending={sending}
          scrollRef={scrollRef}
          attachments={attachments}
          uploading={uploading}
          onPickFile={pickAndUpload}
          onRemoveAttachment={removeAttachmentAt}
          onReact={reactToMessage}
          onPin={pinMessage}
          onDelete={deleteMessage}
          readStates={readStates}
          presenceMap={presenceMap}
        />
      ) : (
        <ListView
          rooms={filteredRooms}
          meId={user?.id ?? ""}
          unread={roomUnread}
          q={q}
          setQ={setQ}
          onOpen={(id) => setActiveId(id)}
          onHideRoom={hideRoom}
          messageHits={messageHits}
          searching={searching}
          roomSettings={roomSettings}
          presenceMap={presenceMap}
        />
      )}
    </div>
  );
}

/* ======================= 목록 ======================= */
function ListView({
  rooms, meId, unread, q, setQ, onOpen, onHideRoom, messageHits, searching, roomSettings, presenceMap,
}: {
  rooms: Room[]; meId: string; unread: Record<string, number>;
  q: string; setQ: (v: string) => void; onOpen: (id: string) => void;
  onHideRoom: (r: Room) => void;
  messageHits: MessageHit[]; searching: boolean;
  roomSettings: Record<string, RoomLocalSetting>;
  presenceMap: Record<string, { presenceStatus: string | null; workStatus: string | null; presenceMessage: string | null }>;
}) {
  const displayTitle = (r: Room) => roomSettings[r.id]?.nickname || roomTitle(r, meId);
  const isSearching = q.trim().length > 0;
  // 이름 매치된 방에 이미 있는 roomId는 메시지 히트에서 제외 (중복 방지)
  const nameHitIds = new Set(rooms.map((r) => r.id));
  const uniqueMsgHits = messageHits.filter((h) => !nameHitIds.has(h.roomId));

  return (
    <>
      {/* 검색바 */}
      <div style={{ padding: "4px 18px 10px" }}>
        <div
          style={{
            display: "flex", alignItems: "center", gap: 8,
            height: 44, padding: "0 14px",
            background: C.gray100,
            borderRadius: 12,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.gray500} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름 · 메시지 검색"
            maxLength={80}
            style={{
              flex: 1, border: 0, outline: 0, background: "transparent",
              fontSize: 14, fontWeight: 500, color: C.ink,
              fontFamily: FONT, letterSpacing: "-0.01em",
            }}
          />
          {isSearching && (
            <button
              onClick={() => setQ("")}
              title="지우기"
              style={{
                width: 18, height: 18, borderRadius: 999,
                background: C.gray500, color: "#fff",
                border: 0, cursor: "pointer",
                display: "grid", placeItems: "center",
                flexShrink: 0,
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 결과 영역 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 12px" }}>
        {/* ===== 이름 섹션 ===== */}
        {isSearching && <SectionLabel>이름</SectionLabel>}
        {rooms.length === 0 && !isSearching && (
          <div style={{ padding: "72px 0", textAlign: "center", color: C.gray500, fontSize: 14, fontWeight: 500 }}>
            대화가 없어요
          </div>
        )}
        {isSearching && rooms.length === 0 && (
          <EmptyRow>이름이 일치하는 대화가 없어요</EmptyRow>
        )}
        {rooms.map((r) => {
          const title = displayTitle(r);
          const last = r.messages[0];
          const muted = !!roomSettings[r.id]?.muted;
          // 음소거 방은 방 목록 뱃지를 0 으로 — 서버 알림 레코드는 유지되므로 벨/사이드바
          // 카운트에는 남지만, 방 목록의 미읽음 뱃지는 표시 안 함(카톡·Slack 컨벤션).
          // 서버 정책 참조: server/src/lib/notify.ts 상단 주석("음소거 방 알림 정책").
          const u = muted ? 0 : (unread[r.id] ?? 0);
          const mine = !!last && last.senderId === meId;
          const preview = last ? previewForMessage(last) : "새로운 대화를 시작해보세요";
          const prefix = last && mine ? "나: " : undefined;
          // 1:1 방이면 상대방의 presence 점을 아바타 우하단에 표시
          let presenceColor: string | undefined;
          let presenceTitle: string | undefined;
          if (r.type === "DIRECT") {
            const other = r.members.find((m) => m.user.id !== meId);
            if (other) {
              const p = presenceMap[other.user.id];
              const info = resolvePresence(
                (p?.presenceStatus ?? null) as any,
                (p?.workStatus ?? null) as any,
              );
              presenceColor = info.color;
              presenceTitle = p?.presenceMessage ? `${info.label} · ${p.presenceMessage}` : info.label;
            }
          }
          // 그룹/팀방: 아바타에 people 뱃지 + 제목 옆에 인원수 칩.
          // 1:1 은 종전과 동일 (presence 점만).
          const isGroup = r.type !== "DIRECT";
          const memberCount = isGroup ? r.members.length : undefined;
          return (
            <ListRow
              key={r.id}
              onClick={() => onOpen(r.id)}
              onDelete={r.type === "DIRECT" ? () => onHideRoom(r) : undefined}
              avatar={{ name: title, color: roomColor(r, meId), imageUrl: roomImageUrl(r, meId) }}
              title={title}
              titleHighlight={q}
              subtitle={preview}
              subtitlePrefix={prefix}
              rightTop={last ? formatRelative(new Date(last.createdAt)) : null}
              unread={u}
              muted={muted}
              presenceColor={presenceColor}
              presenceTitle={presenceTitle}
              isGroup={isGroup}
              memberCount={memberCount}
            />
          );
        })}

        {/* ===== 채팅 내역 섹션 ===== */}
        {isSearching && (
          <>
            <SectionLabel>채팅 내역{searching ? " · 검색중" : ""}</SectionLabel>
            {uniqueMsgHits.length === 0 && !searching && (
              <EmptyRow>메시지 내용이 일치하는 대화가 없어요</EmptyRow>
            )}
            {uniqueMsgHits.map((h) => {
              const title = roomSettings[h.roomId]?.nickname || roomTitle(h.room, meId);
              return (
                <ListRow
                  key={h.message.id}
                  onClick={() => onOpen(h.roomId)}
                  avatar={{ name: title, color: roomColor(h.room, meId), imageUrl: roomImageUrl(h.room, meId) }}
                  title={title}
                  subtitle={h.message.content}
                  subtitleHighlight={q}
                  subtitlePrefix={(h.message.sender.id === meId ? "나" : h.message.sender.name) + ": "}
                  rightTop={formatRelative(new Date(h.message.createdAt))}
                  unread={0}
                />
              );
            })}
          </>
        )}
      </div>
    </>
  );
}

/* ===== 리스트 섹션 헤더 (토스 스타일) ===== */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "14px 12px 6px",
        fontSize: 12,
        fontWeight: 700,
        color: C.gray500,
        letterSpacing: "-0.01em",
      }}
    >
      {children}
    </div>
  );
}
function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "18px 12px", color: C.gray500, fontSize: 13, fontWeight: 500 }}>
      {children}
    </div>
  );
}

/* ===== 범용 리스트 행 ===== */
function ListRow({
  onClick, onDelete, avatar, title, titleHighlight, subtitle, subtitleHighlight, subtitlePrefix, rightTop, unread, muted, presenceColor, presenceTitle, isGroup, memberCount,
}: {
  onClick: () => void;
  onDelete?: () => void;
  avatar: { name: string; color: string; imageUrl?: string | null };
  title: string;
  titleHighlight?: string;
  subtitle: string;
  subtitleHighlight?: string;
  subtitlePrefix?: string;
  rightTop: string | null;
  unread: number;
  muted?: boolean;
  presenceColor?: string;
  presenceTitle?: string;
  isGroup?: boolean;
  memberCount?: number;
}) {
  // 길게 누르기(모바일) / 우클릭(데스크톱) / 호버 시 나타나는 × 버튼 → 삭제. 짧은 탭은 그대로 열기.
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const [hovered, setHovered] = useState(false);
  const startPress = () => {
    if (!onDelete) return;
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => { longPressed.current = true; onDelete(); }, 500);
  };
  const cancelPress = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; } };
  return (
    <button
      onClick={() => { if (longPressed.current) { longPressed.current = false; return; } onClick(); }}
      onContextMenu={onDelete ? (e) => { e.preventDefault(); onDelete(); } : undefined}
      onTouchStart={startPress}
      onTouchEnd={cancelPress}
      onTouchMove={cancelPress}
      style={{
        position: "relative",
        width: "100%",
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 12px",
        borderRadius: 12,
        background: "transparent",
        border: 0, textAlign: "left", cursor: "pointer",
        fontFamily: FONT,
        transition: "background .12s ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = C.gray100; setHovered(true); }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; setHovered(false); }}
    >
      {/* 삭제 버튼 — 호버 시 우측에 표시(데스크톱 발견성). 모바일은 길게 누르기도 동작. */}
      {onDelete && hovered && (
        <span
          role="button"
          aria-label="대화 삭제"
          title="대화 삭제 (길게 누르기·우클릭도 가능)"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{
            position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
            width: 28, height: 28, borderRadius: 8, zIndex: 2,
            display: "grid", placeItems: "center",
            background: "var(--c-surface)", color: C.gray500,
            boxShadow: "0 1px 4px rgba(0,0,0,.12)", cursor: "pointer",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </span>
      )}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <Avatar name={avatar.name} color={avatar.color} imageUrl={avatar.imageUrl ?? null} size={46} presenceColor={isGroup ? undefined : presenceColor} presenceTitle={isGroup ? undefined : presenceTitle} />
        {isGroup && (
          // 그룹/팀방 표시 — 아바타 우하단에 사람 두 명 아이콘. presence 점 자리.
          <div
            title={memberCount ? `그룹 · ${memberCount}명` : "그룹"}
            style={{
              position: "absolute",
              bottom: -2,
              right: -2,
              width: 18,
              height: 18,
              borderRadius: 999,
              background: C.blue,
              color: "#fff",
              border: `2px solid var(--c-surface)`,
              display: "grid",
              placeItems: "center",
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              flex: 1, minWidth: 0,
              display: "flex", alignItems: "center", gap: 4,
              fontSize: 15, fontWeight: 700, color: C.ink,
              letterSpacing: "-0.015em",
            }}
          >
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {highlight(title, titleHighlight)}
            </span>
            {isGroup && memberCount !== undefined && (
              // 인원수 칩 — 글자 톤 낮춰서 제목보다 부차적으로.
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: 999,
                  background: C.gray100,
                  color: C.gray600,
                  flexShrink: 0,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {memberCount}
              </span>
            )}
            {muted && (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.gray500} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="알림 꺼짐" style={{ flexShrink: 0 }}>
                <path d="M15 9v3M3 21l18-18" />
                <path d="M18 8a6 6 0 0 0-9.33-4.96" />
                <path d="M6 8v3a6 6 0 0 0 9.6 4.8" />
                <path d="M4 17h14" />
                <path d="M9 21h6" />
              </svg>
            )}
          </div>
          {/* 상단 우측: 안 읽은 메시지 수 배지. 시간은 아래 줄로 내려서 시각적 우선순위를
              "대화 미리보기(아래) ← 시간" vs "제목(위) ← 배지" 로 분리. */}
          {unread > 0 && (
            <span
              style={{
                minWidth: 20, height: 20, padding: "0 6px",
                borderRadius: 999,
                background: C.blue, color: "#fff",
                fontSize: 11, fontWeight: 700,
                display: "grid", placeItems: "center",
                flexShrink: 0,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
          <div
            style={{
              flex: 1, minWidth: 0,
              fontSize: 13,
              fontWeight: unread > 0 ? 600 : 500,
              color: unread > 0 ? C.gray700 : C.gray500,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              letterSpacing: "-0.01em",
            }}
          >
            {subtitlePrefix && <span style={{ color: C.gray500 }}>{subtitlePrefix}</span>}
            {highlight(subtitle, subtitleHighlight)}
          </div>
          {rightTop && (
            <div style={{ fontSize: 12, fontWeight: 500, color: C.gray500, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
              {rightTop}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

/* ===== 키워드 하이라이트 ===== */
function highlight(text: string, q?: string) {
  if (!q || !q.trim()) return text;
  const needle = q.trim();
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  const i = lower.indexOf(n);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <span style={{ color: C.blue, fontWeight: 700 }}>{text.slice(i, i + needle.length)}</span>
      {text.slice(i + needle.length)}
    </>
  );
}

/* ======================= 새 그룹 만들기 ======================= */
type DirUser = { id: string; name: string; email?: string; team?: string | null; position?: string | null; avatarColor?: string; avatarUrl?: string | null };

function CreateGroupView({
  meId, onCancel, onCreated,
}: {
  meId: string;
  onCancel: () => void;
  onCreated: (roomId: string) => void;
}) {
  const [allUsers, setAllUsers] = useState<DirUser[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api<{ users: DirUser[] }>("/api/users");
        setAllUsers(res.users.filter((u) => u.id !== meId));
      } catch {}
    })();
  }, [meId]);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return allUsers;
    return allUsers.filter((u) =>
      u.name.toLowerCase().includes(k) ||
      (u.team ?? "").toLowerCase().includes(k) ||
      (u.position ?? "").toLowerCase().includes(k)
    );
  }, [allUsers, q]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedList = useMemo(() => allUsers.filter((u) => selected.has(u.id)), [allUsers, selected]);

  async function submit() {
    setErr(null);
    if (selected.size < 1) { setErr("멤버를 1명 이상 선택해주세요"); return; }
    setBusy(true);
    try {
      const res = await api<{ room: Room }>("/api/chat/rooms", {
        method: "POST",
        json: {
          type: "GROUP",
          name: name.trim() || undefined,
          memberIds: Array.from(selected),
        },
      });
      onCreated(res.room.id);
    } catch (e: any) {
      setErr(e?.message ?? "생성에 실패했어요");
    } finally {
      setBusy(false);
    }
  }

  return (
    // minHeight:0 — flex 자식이 부모 높이를 넘지 않게 (없으면 스크롤 영역이 부모를 밀어 올려 하단 버튼이 화면 밖으로 사라짐).
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: C.surface }}>
      {/* 스크롤 영역 — minHeight:0 + flex:1 조합으로만 overflowY 스크롤이 정상 작동. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 18px 12px" }}>
        {/* 그룹 이름 */}
        <SectionLabel>그룹 이름 (선택)</SectionLabel>
        <div
          style={{
            background: C.gray100, borderRadius: 12,
            padding: "10px 14px",
            display: "flex", alignItems: "center",
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예) 마케팅 팀"
            maxLength={40}
            style={{
              flex: 1, border: 0, outline: 0, background: "transparent",
              fontSize: 14, fontWeight: 600, color: C.ink,
              fontFamily: FONT, letterSpacing: "-0.01em",
            }}
          />
        </div>

        {/* 선택된 멤버 칩 */}
        {selectedList.length > 0 && (
          <>
            <SectionLabel>선택한 멤버 {selectedList.length}명</SectionLabel>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {selectedList.map((u) => (
                <button
                  key={u.id}
                  onClick={() => toggle(u.id)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "6px 8px 6px 4px",
                    background: C.blue, color: "#fff",
                    borderRadius: 999, border: 0, cursor: "pointer",
                    fontSize: 12.5, fontWeight: 600, fontFamily: FONT,
                    letterSpacing: "-0.01em",
                  }}
                  title="선택 해제"
                >
                  <Avatar name={u.name} color={u.avatarColor ?? "rgba(255,255,255,.3)"} imageUrl={u.avatarUrl ?? null} size={22} />
                  {u.name}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              ))}
            </div>
          </>
        )}

        {/* 검색 */}
        <SectionLabel>멤버 추가</SectionLabel>
        <div
          style={{
            display: "flex", alignItems: "center", gap: 8,
            height: 44, padding: "0 14px",
            background: C.gray100, borderRadius: 12,
            marginBottom: 8,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.gray500} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름 · 팀 · 직책으로 검색"
            maxLength={80}
            style={{
              flex: 1, border: 0, outline: 0, background: "transparent",
              fontSize: 14, fontWeight: 500, color: C.ink,
              fontFamily: FONT, letterSpacing: "-0.01em",
            }}
          />
        </div>

        {/* 유저 리스트 */}
        {filtered.length === 0 && (
          <EmptyRow>일치하는 사용자가 없어요</EmptyRow>
        )}
        {filtered.map((u) => {
          const on = selected.has(u.id);
          const subtitle = [u.team, u.position].filter(Boolean).join(" · ") || (u.email ?? "");
          return (
            <button
              key={u.id}
              onClick={() => toggle(u.id)}
              style={{
                width: "100%",
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 8px",
                background: "transparent", border: 0,
                borderRadius: 12, cursor: "pointer",
                fontFamily: FONT, textAlign: "left",
                transition: "background .12s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = C.gray100)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <Avatar name={u.name} color={u.avatarColor ?? C.blue} imageUrl={u.avatarUrl ?? null} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, letterSpacing: "-0.015em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {u.name}
                </div>
                {subtitle && (
                  <div style={{ marginTop: 1, fontSize: 12, fontWeight: 500, color: C.gray500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {subtitle}
                  </div>
                )}
              </div>
              {/* 체크박스 */}
              <div
                style={{
                  width: 22, height: 22, borderRadius: 999,
                  background: on ? C.blue : "transparent",
                  border: on ? "0" : `2px solid ${C.gray300}`,
                  display: "grid", placeItems: "center",
                  flexShrink: 0,
                  transition: "background .12s ease",
                }}
              >
                {on && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* 하단 액션 바 */}
      <div style={{ padding: "12px 18px 16px", background: C.surface, display: "flex", gap: 8 }}>
        {err && (
          <div style={{ alignSelf: "center", fontSize: 12.5, fontWeight: 600, color: C.red }}>{err}</div>
        )}
        <button
          onClick={onCancel}
          disabled={busy}
          style={{
            padding: "0 16px", height: 48, borderRadius: 12,
            background: C.gray100, color: C.ink,
            border: 0, cursor: "pointer",
            fontSize: 14, fontWeight: 700, fontFamily: FONT,
          }}
        >
          취소
        </button>
        <button
          onClick={submit}
          disabled={busy || selected.size < 1}
          style={{
            flex: 1, height: 48, borderRadius: 12,
            background: busy || selected.size < 1 ? C.gray300 : C.blue,
            color: "#fff",
            border: 0, cursor: busy || selected.size < 1 ? "not-allowed" : "pointer",
            fontSize: 15, fontWeight: 700, fontFamily: FONT,
            letterSpacing: "-0.01em",
          }}
        >
          {busy ? "만드는 중..." : selected.size > 0 ? `${selected.size}명과 그룹 만들기` : "멤버 선택"}
        </button>
      </div>
    </div>
  );
}

/* ======================= 채팅방 설정 ======================= */
function SettingsView({
  room, meId, isAdmin, settings, onPatch, messages, onDeleteRoom,
}: {
  room: Room;
  meId: string;
  /** ADMIN 권한이면 어떤 그룹방이든 삭제 가능. */
  isAdmin: boolean;
  settings: { nickname?: string; muted?: boolean };
  onPatch: (p: { nickname?: string; muted?: boolean }) => void;
  messages: Message[];
  onDeleteRoom: () => void | Promise<void>;
}) {
  // 그룹/팀방 삭제 권한 — 생성자 본인 또는 ADMIN.
  // DM 은 어떤 경우에도 삭제 불가 (서버에서도 거부).
  const canDeleteRoom =
    room.type !== "DIRECT" && (room.createdById === meId || isAdmin);
  const originalTitle = roomTitle(room, meId);
  const [draft, setDraft] = useState(settings.nickname ?? "");
  const [editing, setEditing] = useState(false);
  const muted = !!settings.muted;

  const commit = () => {
    const next = draft.trim();
    // 원본 이름과 같으면 저장하지 않음 (별명 해제)
    onPatch({ nickname: next === originalTitle ? "" : next });
    setEditing(false);
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "6px 18px 18px", background: C.surface }}>
      {/* 프로필 블록 — 중앙 정렬 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 0 20px" }}>
        <Avatar name={settings.nickname || originalTitle} color={roomColor(room, meId)} imageUrl={roomImageUrl(room, meId)} size={72} />
        <div
          style={{
            marginTop: 12,
            fontSize: 18, fontWeight: 700, color: C.ink,
            letterSpacing: "-0.02em",
          }}
        >
          {settings.nickname || originalTitle}
        </div>
        {settings.nickname && (
          <div style={{ marginTop: 2, fontSize: 12, fontWeight: 500, color: C.gray500 }}>
            원래 이름: {originalTitle}
          </div>
        )}
      </div>

      {/* 이름 변경 */}
      <SectionLabel>이름 변경</SectionLabel>
      <div
        style={{
          background: C.gray100,
          borderRadius: 12,
          padding: "10px 14px",
          display: "flex", alignItems: "center", gap: 8,
        }}
      >
        {editing ? (
          <>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) commit();
                if (e.key === "Escape") { setDraft(settings.nickname ?? ""); setEditing(false); }
              }}
              placeholder={originalTitle}
              maxLength={120}
              style={{
                flex: 1, border: 0, outline: 0, background: "transparent",
                fontSize: 14, fontWeight: 600, color: C.ink,
                fontFamily: FONT, letterSpacing: "-0.01em",
              }}
            />
            <button
              onClick={commit}
              style={{
                padding: "6px 12px", borderRadius: 8,
                background: C.blue, color: "#fff",
                border: 0, cursor: "pointer",
                fontSize: 13, fontWeight: 700, fontFamily: FONT,
              }}
            >
              저장
            </button>
          </>
        ) : (
          <>
            <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: C.ink }}>
              {settings.nickname || originalTitle}
            </div>
            <button
              onClick={() => { setDraft(settings.nickname ?? ""); setEditing(true); }}
              style={{
                padding: "6px 12px", borderRadius: 8,
                background: C.surface, color: C.ink,
                border: `1px solid ${C.gray300}`, cursor: "pointer",
                fontSize: 13, fontWeight: 600, fontFamily: FONT,
              }}
            >
              변경
            </button>
          </>
        )}
      </div>
      {settings.nickname && !editing && (
        <button
          onClick={() => onPatch({ nickname: "" })}
          style={{
            marginTop: 8, padding: "8px 12px",
            background: "transparent", color: C.gray600,
            border: 0, cursor: "pointer",
            fontSize: 12, fontWeight: 600, fontFamily: FONT,
          }}
        >
          원래 이름으로 되돌리기
        </button>
      )}

      {/* 알림 끄기 */}
      <SectionLabel>알림</SectionLabel>
      <button
        onClick={() => onPatch({ muted: !muted })}
        style={{
          width: "100%",
          display: "flex", alignItems: "center", gap: 12,
          padding: "14px 14px",
          background: C.gray100, borderRadius: 12,
          border: 0, cursor: "pointer",
          fontFamily: FONT, textAlign: "left",
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, letterSpacing: "-0.01em" }}>
            알림 끄기
          </div>
          <div style={{ marginTop: 2, fontSize: 12, fontWeight: 500, color: C.gray600 }}>
            {muted ? "이 대화는 알림을 받지 않아요" : "메시지 알림을 받아요"}
          </div>
        </div>
        {/* 스위치 */}
        <div
          style={{
            width: 46, height: 28, borderRadius: 999,
            background: muted ? C.blue : C.gray300,
            position: "relative",
            transition: "background .18s ease",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 2, left: muted ? 20 : 2,
              width: 24, height: 24, borderRadius: "50%",
              background: C.surface,
              boxShadow: "0 1px 3px rgba(0,0,0,.15)",
              transition: "left .18s ease",
            }}
          />
        </div>
      </button>

      {/* 멤버 — 그룹/팀방만 (DM 은 위 프로필 블록이 상대를 보여줌). 헤더(방 이름) 탭 → 설정 뷰에서 노출. */}
      {room.type !== "DIRECT" && (
        <>
          <SectionLabel>멤버 {room.members.length}명</SectionLabel>
          <div style={{ background: C.gray100, borderRadius: 12, padding: "4px 0", overflow: "hidden" }}>
            {room.members.map((m) => {
              const isMe = m.user.id === meId;
              const isOwner = !!room.createdById && room.createdById === m.user.id;
              return (
                <div key={m.user.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px" }}>
                  <Avatar name={m.user.name} color={m.user.avatarColor ?? C.blue} imageUrl={m.user.avatarUrl ?? null} size={36} />
                  <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: C.ink, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.user.name}{isMe ? " (나)" : ""}
                  </div>
                  {isOwner && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.blue, background: "color-mix(in srgb, var(--c-brand) 12%, transparent)", padding: "2px 8px", borderRadius: 999, flexShrink: 0 }}>
                      방장
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <SharedMediaTabs messages={messages} />

      {canDeleteRoom && (
        <>
          <SectionLabel>위험 구역</SectionLabel>
          <button
            type="button"
            onClick={onDeleteRoom}
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 12,
              background: "color-mix(in srgb, var(--c-danger) 8%, transparent)",
              border: "1px solid color-mix(in srgb, var(--c-danger) 24%, transparent)",
              color: "var(--c-danger)",
              fontSize: 14, fontWeight: 700,
              cursor: "pointer",
              textAlign: "left",
              display: "flex", alignItems: "center", gap: 10,
              transition: "background .12s ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--c-danger) 14%, transparent)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--c-danger) 8%, transparent)")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            <div style={{ flex: 1 }}>
              <div>그룹방 삭제</div>
              <div style={{ fontSize: 11.5, fontWeight: 500, marginTop: 2, opacity: 0.85 }}>
                메시지 · 첨부 · 멤버 정보가 모두 사라지고 되돌릴 수 없어요
              </div>
            </div>
          </button>
        </>
      )}
    </div>
  );
}

/* ===== 공유된 사진/영상/파일/코드 — 채팅방 설정 화면 하단 ===== */
type MediaTab = "photo" | "video" | "file" | "code";
function SharedMediaTabs({ messages }: { messages: Message[] }) {
  const [tab, setTab] = useState<MediaTab>("photo");

  // 한 번 훑어 분류 — 메시지 수가 적은 케이스가 대부분이라 매 렌더 비용 무시 가능.
  const photos = messages.filter((m) => m.kind === "IMAGE" && safeFileUrl(m.fileUrl));
  const videos = messages.filter((m) => m.kind === "VIDEO" && safeFileUrl(m.fileUrl));
  const files = messages.filter(
    (m) => (m.kind === "FILE" || (m.kind !== "IMAGE" && m.kind !== "VIDEO" && m.fileUrl)) && safeFileUrl(m.fileUrl)
  );
  // 코드: TEXT 본문에 코드 펜스/휴리스틱이 잡히는 메시지.
  const codeItems = messages.flatMap((m) => {
    if (m.kind !== "TEXT" || !m.content) return [];
    const segs = parseCodeSegments(m.content);
    const codes = segs.filter((s) => s.kind === "code") as { kind: "code"; code: string; lang?: string }[];
    return codes.map((c, idx) => ({ messageId: m.id, idx, code: c.code, lang: c.lang, createdAt: m.createdAt, sender: m.sender }));
  });

  const tabs: { key: MediaTab; label: string; count: number }[] = [
    { key: "photo", label: "사진", count: photos.length },
    { key: "video", label: "영상", count: videos.length },
    { key: "file", label: "파일", count: files.length },
    { key: "code", label: "코드", count: codeItems.length },
  ];

  return (
    <div style={{ marginTop: 24 }}>
      <SectionLabel>공유된 콘텐츠</SectionLabel>
      <div style={{ display: "flex", gap: 4, marginBottom: 10, borderBottom: `1px solid ${C.gray200}` }}>
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: "8px 12px",
                background: "transparent",
                border: 0,
                borderBottom: `2px solid ${active ? C.blue : "transparent"}`,
                color: active ? C.ink : C.gray600,
                fontSize: 13,
                fontWeight: active ? 700 : 600,
                cursor: "pointer",
                fontFamily: FONT,
                marginBottom: -1,
              }}
            >
              {t.label}
              <span style={{ marginLeft: 4, fontSize: 11, color: active ? C.blue : C.gray500, fontVariantNumeric: "tabular-nums" }}>
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {tab === "photo" &&
        (photos.length === 0 ? (
          <EmptyMedia label="공유된 사진이 없어요" />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
            {photos.map((m) => {
              const url = safeFileUrl(m.fileUrl)!;
              return (
                <a
                  key={m.id}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => { if (isCapacitorNative()) { e.preventDefault(); const u = imgSrc(url); if (u) void Browser.open({ url: u }); } }}
                  style={{ aspectRatio: "1 / 1", overflow: "hidden", borderRadius: 8, background: C.gray100 }}
                  title={m.fileName ?? ""}
                >
                  <img
                    src={imgSrc(url)}
                    alt={m.fileName ?? ""}
                    loading="lazy"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                </a>
              );
            })}
          </div>
        ))}

      {tab === "video" &&
        (videos.length === 0 ? (
          <EmptyMedia label="공유된 영상이 없어요" />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
            {videos.map((m) => {
              const url = safeFileUrl(m.fileUrl)!;
              return (
                <a
                  key={m.id}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => { if (isCapacitorNative()) { e.preventDefault(); const u = imgSrc(url); if (u) void Browser.open({ url: u }); } }}
                  style={{ position: "relative", aspectRatio: "16 / 10", overflow: "hidden", borderRadius: 8, background: "#000" }}
                  title={m.fileName ?? ""}
                >
                  <video
                    src={imgSrc(url)}
                    preload="metadata"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "grid",
                      placeItems: "center",
                      background: "rgba(0,0,0,0.25)",
                      color: "#fff",
                    }}
                    aria-hidden
                  >
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="6 4 20 12 6 20" />
                    </svg>
                  </div>
                </a>
              );
            })}
          </div>
        ))}

      {tab === "file" &&
        (files.length === 0 ? (
          <EmptyMedia label="공유된 파일이 없어요" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {files.map((m) => {
              const url = safeFileUrl(m.fileUrl)!;
              return (
                <a
                  key={m.id}
                  href={url}
                  download={m.fileName ?? undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: C.gray100,
                    color: C.ink,
                    textDecoration: "none",
                    minWidth: 0,
                  }}
                  title={m.fileName ?? ""}
                >
                  <div style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 8, background: C.surface, display: "grid", placeItems: "center", border: `1px solid ${C.gray200}` }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <path d="M14 2v6h6" />
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.fileName ?? "파일"}
                    </div>
                    <div style={{ fontSize: 11, color: C.gray500, marginTop: 2 }}>
                      {typeof m.fileSize === "number" ? formatBytes(m.fileSize) : ""}
                      {m.fileSize ? " · " : ""}
                      {new Date(m.createdAt).toLocaleDateString("ko-KR")}
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        ))}

      {tab === "code" &&
        (codeItems.length === 0 ? (
          <EmptyMedia label="공유된 코드가 없어요" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {codeItems.map((c) => (
              <SharedCodeRow key={`${c.messageId}-${c.idx}`} code={c.code} lang={c.lang} createdAt={c.createdAt} senderName={c.sender?.name ?? ""} />
            ))}
          </div>
        ))}
    </div>
  );
}

function EmptyMedia({ label }: { label: string }) {
  return (
    <div style={{ padding: "32px 0", textAlign: "center", color: C.gray500, fontSize: 13 }}>
      {label}
    </div>
  );
}

/* ===== 채팅 헤더 바로 아래 고정된 메시지 정보 띠 ===== */
function PinnedBar({
  pinned,
  onJump,
  onUnpin,
}: {
  pinned: Message[];
  onJump: (id: string) => void;
  onUnpin: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (pinned.length === 0) return null;
  // 콜랩스 기본은 가장 최근 핀 1개만 노출. 클릭하면 전체 리스트로 확장.
  const top = pinned[0];
  const more = pinned.length - 1;

  return (
    <div
      style={{
        background: C.gray100,
        borderBottom: `1px solid ${C.gray200}`,
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        onClick={() => (more > 0 ? setExpanded((x) => !x) : onJump(top.id))}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 14px",
          background: "transparent",
          border: 0,
          textAlign: "left",
          cursor: "pointer",
          fontFamily: FONT,
        }}
        title={more > 0 ? (expanded ? "고정 목록 접기" : "고정 목록 펼치기") : "메시지로 이동"}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d="M12 17v5" />
          <path d="M9 9h6l1 8H8z" />
          <path d="M9 9V3h6v6" />
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, letterSpacing: "0.02em" }}>
            고정된 메시지{pinned.length > 1 ? ` · ${pinned.length}` : ""}
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: C.ink,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: 1,
            }}
          >
            <span style={{ color: C.gray600, marginRight: 4 }}>{top.sender?.name ?? ""}:</span>
            {previewForMessage(top)}
          </div>
        </div>
        {more > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: C.gray500, flexShrink: 0 }}>
            {expanded ? "접기" : `+${more}`}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onUnpin(top.id);
          }}
          aria-label="고정 해제"
          title="고정 해제"
          style={{
            width: 22, height: 22, borderRadius: 999,
            background: "transparent",
            border: 0, color: C.gray500,
            cursor: "pointer",
            display: "grid", placeItems: "center",
            flexShrink: 0,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </button>
      {expanded && more > 0 && (
        <div style={{ borderTop: `1px solid ${C.gray200}`, maxHeight: 240, overflowY: "auto" }}>
          {pinned.slice(1).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onJump(m.id)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "8px 14px 8px 38px",
                background: "transparent",
                border: 0,
                borderTop: `1px solid ${C.gray200}`,
                textAlign: "left",
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: C.ink,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ color: C.gray600, marginRight: 4 }}>{m.sender?.name ?? ""}:</span>
                  {previewForMessage(m)}
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUnpin(m.id);
                }}
                aria-label="고정 해제"
                style={{
                  width: 20, height: 20, borderRadius: 999,
                  background: "transparent",
                  border: 0, color: C.gray500,
                  cursor: "pointer",
                  display: "grid", placeItems: "center",
                  flexShrink: 0,
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SharedCodeRow({ code, lang, createdAt, senderName }: { code: string; lang?: string; createdAt: string; senderName: string }) {
  // 미리보기는 첫 4줄만. 길이 제한은 자체 maxHeight 로.
  const html = useHighlightedCode(code, lang);
  const lineCount = (code.match(/\n/g)?.length ?? 0) + 1;
  return (
    <div
      className="code-block"
      style={{
        borderRadius: 10,
        background: "#1B1F27",
        border: "1px solid rgba(255,255,255,0.10)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 10px",
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.7)",
          borderBottom: "1px solid rgba(255,255,255,0.10)",
        }}
      >
        <LangIcon lang={lang} size={12} />
        <span>{lang || "code"}</span>
        <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.55)" }}>
          {senderName} · {new Date(createdAt).toLocaleDateString("ko-KR")} · {lineCount}줄
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            copyToClipboard(code, { title: "복사됨", description: "코드를 클립보드에 복사했어요." });
          }}
          style={{
            background: "transparent",
            border: 0,
            color: "rgba(255,255,255,0.85)",
            fontSize: 10.5,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          복사
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 12,
          lineHeight: 1.5,
          color: "#fff",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 140,
          overflowY: "auto",
        }}
      >
        <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}

/* 메시지 컨텍스트 메뉴 액션 빌드 — 복사 / 다운로드(파일) / 고정(토글) / 삭제(본인만) */
function buildMessageActions(
  m: Message,
  mine: boolean,
  onPin: (id: string) => void,
  onDelete: (id: string) => void,
): MessageAction[] {
  const actions: MessageAction[] = [];

  // 복사 — 텍스트는 본문, 파일은 파일명을 복사(없으면 본문)
  actions.push({
    key: "copy",
    label: "복사",
    icon: ActionIcons.copy,
    onSelect: () => {
      const text = m.kind === "TEXT" ? (m.content || "") : (m.fileName || m.content || "");
      if (!text) return;
      navigator.clipboard?.writeText(text).catch(() => {});
    },
  });

  // 다운로드 — 파일 종류인 경우만
  if (m.kind !== "TEXT" && m.fileUrl) {
    actions.push({
      key: "download",
      label: "다운로드",
      icon: ActionIcons.download,
      onSelect: () => downloadFromUrl(m.fileUrl!, m.fileName || ""),
    });
  }

  // 고정 / 고정 해제
  const isPinned = !!m.pinnedAt;
  actions.push({
    key: "pin",
    label: isPinned ? "고정 해제" : "고정",
    icon: isPinned ? ActionIcons.unpin : ActionIcons.pin,
    onSelect: () => onPin(m.id),
  });

  // 삭제 — 본인이 보낸 메시지 한정. 삭제 시 "삭제된 메시지" 자리표시로 대체.
  if (mine) {
    actions.push({
      key: "delete",
      label: "삭제",
      icon: ActionIcons.trash,
      danger: true,
      onSelect: () => onDelete(m.id),
    });
  }

  return actions;
}

/* ======================= 대화방 ======================= */
function RoomView({
  room, messages, meId, onBack, input, setInput, onSend, sending, scrollRef,
  attachments, uploading, onPickFile, onRemoveAttachment, onReact, onPin, onDelete, readStates, presenceMap,
}: {
  room: Room; messages: Message[]; meId: string; onBack: () => void;
  input: string; setInput: (v: string) => void; onSend: () => void; sending: boolean;
  scrollRef: React.RefObject<HTMLDivElement>;
  attachments: Attachment[]; uploading: boolean;
  onPickFile: (file: File) => void; onRemoveAttachment: (index: number) => void;
  onReact: (messageId: string, emoji: string) => void;
  onPin: (messageId: string) => void;
  onDelete: (messageId: string) => void;
  readStates: { userId: string; lastReadAt: string | null }[];
  presenceMap: Record<string, { presenceStatus: string | null; workStatus: string | null; presenceMessage: string | null }>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const slashRef = useRef<SnippetSlashHandle | null>(null);
  const mentionRef = useRef<MentionHandle | null>(null);
  const [reactingId, setReactingId] = useState<string | null>(null);
  // 롱프레스한 버블의 화면 위치 — iOS peek 오버레이를 그 자리에 띄우기 위해 측정.
  const [reactingRect, setReactingRect] = useState<DOMRect | null>(null);
  const [ready, setReady] = useState(false);
  const nav = useNavigate();
  // 전송 래퍼 — onSend() 후 입력창 포커스를 되돌려 키보드를 유지(카톡/메신저처럼 연속 입력).
  // 전송 버튼이 width:0 으로 collapse 되거나 setInput("") 리렌더가 끼어도 다음 프레임에
  // textarea 로 포커스를 복원해 iOS/Android 가 키보드를 내리지 않게 한다.
  const handleSend = () => {
    onSend();
    requestAnimationFrame(() => textareaRef.current?.focus());
  };
  const isGroupRoom = room.type !== "DIRECT";
  // 반응(이모지) 프로필 표시용 — userId → 멤버(아바타) 매핑. 그룹방에서 반응 칩에 누른 사람 아바타를 띄운다.
  const membersById = useMemo(
    () => new Map(room.members.map((rm) => [rm.user.id, rm.user])),
    [room.members],
  );
  // "누가 반응했는지" 바텀시트 상태(이모지 칩 길게누름). { emoji, userIds } 또는 null.
  const [reactorSheet, setReactorSheet] = useState<{ emoji: string; userIds: string[] } | null>(null);
  const reactLpTimer = useRef<number | null>(null);
  const reactLpFired = useRef(false);
  // 채팅 메시지의 발신자 이름·아바타 클릭 → 사용자 프로필 페이지로. 채팅 팝업은 닫고 이동.
  function openProfile(userId: string) {
    if (!userId) return;
    window.dispatchEvent(new CustomEvent("chat:close"));
    nav(`/users/${userId}`);
  }
  const prevCountRef = useRef(0);
  const stuckToBottomRef = useRef(true);

  // 마지막 메시지의 상대 시각을 분 단위로 갱신 (방금 → 1분 전 …)
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // 방이 바뀌면 다시 준비 상태로 돌려서 첫 페인트 전에 최하단으로 점프
  useEffect(() => {
    setReady(false);
    prevCountRef.current = 0;
    stuckToBottomRef.current = true;
  }, [room.id]);

  // 페인트 직전에 스크롤 조정 — 플래시 방지
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const count = messages.length;
    const grew = count > prevCountRef.current;

    if (!ready && count > 0) {
      // 첫 로드: 즉시 최하단으로 (부드러운 스크롤 X, 화면에 안 보이는 상태에서 점프)
      el.scrollTop = el.scrollHeight;
      setReady(true);
    } else if (grew && stuckToBottomRef.current) {
      // 새 메시지가 왔고 사용자가 하단에 있었으면 따라 내려감
      el.scrollTop = el.scrollHeight;
    }
    prevCountRef.current = count;
  }, [messages, ready]);

  // 사용자가 위로 스크롤했는지 추적 — 추적값에 따라 자동 하단 붙기 토글
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    stuckToBottomRef.current = distanceFromBottom < 40;
  };

  // 이미지/첨부가 늦게 로드되어 scrollHeight 가 나중에 커질 때도 하단 유지
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (stuckToBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    // 스크롤 영역 자체 + 내부 자식들 관찰
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child as Element);
    // 이미지 개별 load 이벤트 — ResizeObserver 가 못 잡는 브라우저 대비
    const imgs = el.querySelectorAll("img");
    const onLoad = () => {
      if (stuckToBottomRef.current) el.scrollTop = el.scrollHeight;
    };
    imgs.forEach((img) => {
      if (!(img as HTMLImageElement).complete) img.addEventListener("load", onLoad);
    });
    return () => {
      ro.disconnect();
      imgs.forEach((img) => img.removeEventListener("load", onLoad));
    };
  }, [room.id, messages.length]);

  // iOS 키보드 등장 시 메시지 리스트를 바닥으로 재고정.
  // Keyboard.resize:'native' 가 WebView(=스크롤 컨테이너)를 줄이면 브라우저가 scrollTop 을
  // 보존해 최신 메시지가 접힘선 아래로 밀린다. 바닥에 붙어있던 사용자에 한해 다시 끌어내린다.
  // 과거 메시지를 보던 중(stuckToBottomRef=false)이면 방해하지 않는다. 안드/웹/데스크톱은 no-op.
  useEffect(() => {
    if (nativePlatform() !== "ios") return;
    let cancelled = false;
    const removers: Array<() => void> = [];
    const pinBottom = () => {
      const el = scrollRef.current;
      if (!el) return;
      if (!stuckToBottomRef.current) return;
      el.scrollTop = el.scrollHeight; // 즉시 점프 — 줄어든 높이 기준 바닥(smooth 는 키보드 곡선 추격 실패)
    };
    void import("@capacitor/keyboard")
      .then(({ Keyboard }) => {
        if (cancelled) return;
        const reg = (ev: "keyboardWillShow" | "keyboardDidShow") => {
          Keyboard.addListener(ev as never, (() => {
            // willShow: 애니메이션 시작 직전. didShow: native 리사이즈 확정 후 한 번 더.
            pinBottom();
            requestAnimationFrame(pinBottom); // 레이아웃 반영 직후 1프레임 보정
          }) as never).then((h) => {
            removers.push(() => { try { void h.remove(); } catch {} });
          });
        };
        reg("keyboardWillShow");
        reg("keyboardDidShow");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      removers.forEach((fn) => fn());
    };
  }, [room.id]);
  const rendered = useMemo(() => {
    // 상대방이 보낸 메시지 중 가장 최근 것의 인덱스
    let lastFromOtherIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender.id !== meId) { lastFromOtherIdx = i; break; }
    }
    // 같은 발신자가 연속으로 보낸 묶음의 "마지막" 메시지에만 시각을 표시한다 —
    // KakaoTalk 처럼. 기준: 다음 메시지가 없거나, 발신자가 바뀌었거나, 5분 이상 공백.
    const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    return messages.map((m, i) => {
      const prev = messages[i - 1];
      const next = messages[i + 1];
      const showMeta = !prev || prev.sender.id !== m.sender.id
        || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60_000;
      const showTime = !next || next.sender.id !== m.sender.id
        || new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() > 5 * 60_000;
      // 날짜가 바뀌는 첫 메시지에 "오늘/어제/M월 D일" 구분선을 붙인다.
      const today = dayKey(new Date(m.createdAt));
      const showDayDivider = !prev || dayKey(new Date(prev.createdAt)) !== today;
      const isLast = i === messages.length - 1;
      const isLastFromOther = i === lastFromOtherIdx;

      // 안읽음 카운트 — 발신자 본인은 제외, lastReadAt 이 메시지 createdAt 보다 이전인 멤버 수
      const sent = new Date(m.createdAt).getTime();
      let unread = 0;
      const unreadNames: string[] = [];
      for (const r of readStates) {
        if (r.userId === m.sender.id) continue;
        const readAt = r.lastReadAt ? new Date(r.lastReadAt).getTime() : 0;
        if (readAt < sent) {
          unread++;
          const mem = room.members.find((rm) => rm.user.id === r.userId);
          if (mem) unreadNames.push(mem.user.name);
        }
      }
      return { ...m, showMeta, showTime, showDayDivider, isLast, isLastFromOther, unread, unreadNames };
    });
  }, [messages, meId, readStates]);
  // 헤더는 상위 ChatFab이 렌더링 — 여기서는 메시지 + 입력만
  void room; void onBack; // 시그니처 유지

  // 고정된 메시지 — pinnedAt 기준 최근순. 가장 최근 1개를 바에 노출 + 추가 N개 카운트.
  // 헤더 바로 아래에 정주행 정보 띠(slack 패턴) 로 띄움.
  const pinnedList = useMemo(
    () =>
      messages
        .filter((m) => m.pinnedAt && !m.deletedAt)
        .sort((a, b) => (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? "")),
    [messages],
  );

  function scrollToMessage(id: string) {
    const el = document.querySelector<HTMLElement>(`[data-msg-id="${id}"]`);
    if (!el || !scrollRef.current) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // 짧게 강조 — focus-visible 같은 ring 효과.
    el.style.transition = "background .2s ease";
    const prev = el.style.background;
    el.style.background = "rgba(120,150,255,0.18)";
    setTimeout(() => { el.style.background = prev; }, 900);
  }

  return (
    <>
      {/* 글래스 헤더가 본문 위에 떠 있으므로, 고정 메시지 바가 있으면 헤더 높이만큼 내려 보이게 한다. */}
      <div style={{ flexShrink: 0, paddingTop: pinnedList.length ? "var(--chat-room-header-h, 60px)" : 0 }}>
        <PinnedBar pinned={pinnedList} onJump={scrollToMessage} onUnpin={onPin} />
      </div>
      {/* 메시지 영역 */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{
          flex: 1, overflowY: "auto",
          // 글래스 헤더 뒤로 메시지가 스크롤되도록 헤더 높이만큼 위 여백(고정바가 있으면 그쪽이 이미 내려줌).
          padding: pinnedList.length ? "4px 14px 10px" : "calc(4px + var(--chat-room-header-h, 60px)) 14px 10px",
          background: C.surface,
          // 첫 로드 완료 전에는 감춰서 "위에서 아래로 스크롤되는" 플래시를 숨김
          visibility: ready || messages.length === 0 ? "visible" : "hidden",
        }}
      >
        {messages.length === 0 && (
          <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 999,
                  background: C.gray100,
                  display: "grid",
                  placeItems: "center",
                  margin: "0 auto 10px",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8E959E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 5h16v11H9l-4 4z" />
                </svg>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>아직 메시지가 없어요</div>
              <div style={{ fontSize: 12, color: C.gray500, marginTop: 4 }}>첫 메시지를 남겨보세요.</div>
            </div>
          </div>
        )}
        {rendered.map((m) => {
          const mine = m.sender.id === meId;
          const isPicking = reactingId === m.id;
          return (
            <div key={m.id} data-msg-id={m.id}>
              {m.showDayDivider && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    margin: "14px 4px 10px",
                  }}
                >
                  <div style={{ flex: 1, height: 1, background: C.gray200 }} />
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: C.gray600,
                      letterSpacing: "0.02em",
                      padding: "3px 10px",
                      borderRadius: 999,
                      background: C.gray100,
                    }}
                  >
                    {formatDayDivider(new Date(m.createdAt))}
                  </div>
                  <div style={{ flex: 1, height: 1, background: C.gray200 }} />
                </div>
              )}
            {/* 연속 같은 발신자 메시지는 좁게(2px) 붙여 한 묶음처럼, 묶음의 마지막(showTime=다음이
                다른 발신자/시간갭)이면 넓게(10px) 떨어뜨려 그룹을 시각적으로 구분한다(카톡 패턴). */}
            <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", marginBottom: m.showTime ? 10 : 2 }}>
              {/* 세로 컬럼: [아바타+이름+버블row] 을 먼저 두고 그 아래에 리액션/피커를 형제로 배치.
                  기존엔 리액션이 inner column 안에 같이 들어있어 flex-end 정렬의 '컬럼 바닥' 이
                  리액션 줄까지 내려가 아바타가 리액션 옆에 붙었음. 리액션을 형제로 빼서
                  아바타가 버블과 정확히 정렬되도록 바꿈. */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", maxWidth: "78%", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flexDirection: mine ? "row-reverse" : "row", maxWidth: "100%", minWidth: 0 }}>
                  {/* 프로필은 "연속 묶음의 마지막 메시지" 옆에 붙인다 (KakaoTalk 패턴).
                      showMeta(첫 메시지) 기준이면 여러 개를 연속으로 보낼 때 아바타가
                      맨 윗 버블 옆에 붙어 마지막 버블과 멀어져 어색함. showTime 이 곧
                      같은 묶음의 마지막 메시지 플래그이므로 그걸로 교체. */}
                  {!mine && m.showTime ? (
                    (() => {
                      const p = presenceMap[m.sender.id];
                      const info = resolvePresence(
                        (p?.presenceStatus ?? null) as any,
                        (p?.workStatus ?? null) as any,
                      );
                      return (
                        <button
                          type="button"
                          onClick={() => openProfile(m.sender.id)}
                          style={{ background: "transparent", border: 0, padding: 0, cursor: "pointer", flexShrink: 0 }}
                          title="프로필 보기"
                          aria-label={`${m.sender.name} 프로필 보기`}
                        >
                          <Avatar
                            name={m.sender.name}
                            color={m.sender.avatarColor ?? C.blue}
                            imageUrl={m.sender.avatarUrl ?? null}
                            size={26}
                            presenceColor={info.color}
                            presenceTitle={info.label + (p?.presenceMessage ? ` · ${p.presenceMessage}` : "")}
                          />
                        </button>
                      );
                    })()
                  ) : !mine ? (
                    <div style={{ width: 26, flexShrink: 0 }} />
                  ) : null}
                  <div style={{ minWidth: 0, flex: "0 1 auto", position: "relative" }}>
                    {/* 발신자 이름·뱃지는 그룹방에서만 — 1:1 은 상대가 한 명이라 불필요(요구사항). */}
                    {!mine && m.showMeta && room.type !== "DIRECT" && (
                      <button
                        type="button"
                        onClick={() => openProfile(m.sender.id)}
                        style={{
                          fontSize: 11.5, fontWeight: 600, color: C.gray600,
                          marginLeft: 4, marginBottom: 3,
                          display: "inline-flex", alignItems: "center", gap: 4,
                          background: "transparent", border: 0, padding: 0, cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                        title="프로필 보기"
                      >
                        <span style={{ textDecoration: "none" }}>{m.sender.name}</span>
                        {isDevAccount(m.sender) && <DevBadge iconOnly />}
                      </button>
                    )}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-end",
                        gap: 4,
                        flexDirection: mine ? "row" : "row-reverse",
                        justifyContent: "flex-end",
                        minWidth: 0,
                        maxWidth: "100%",
                      }}
                    >
                    {/* 버블 옆 메타 — 안읽음 카운트(위) + 시각(아래) 을 세로로 스택.
                        예전에는 [시각 | 안읽음 | 버블] 이 한 줄로 늘어서 있어 "오후 6:03 1"
                        처럼 읽혀 어떤 값이 안읽음인지 즉시 구분되지 않던 문제가 있었음.
                        같은 발신자 연속 묶음의 마지막에만 시각을 노출(m.showTime). */}
                    {(m.showTime && !m.deletedAt) || m.unread > 0 ? (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: mine ? "flex-end" : "flex-start",
                          gap: 1,
                          marginBottom: 2,
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {m.unread > 0 && (
                          <span
                            title={m.unreadNames?.length ? `안 읽음: ${m.unreadNames.join(", ")}` : undefined}
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: C.blue,
                              fontVariantNumeric: "tabular-nums",
                              cursor: "help",
                              lineHeight: 1.1,
                            }}
                          >
                            {m.unread}
                          </span>
                        )}
                        {m.showTime && !m.deletedAt && (
                          <span
                            style={{
                              fontSize: 10.5,
                              fontWeight: 500,
                              color: C.gray500,
                              fontVariantNumeric: "tabular-nums",
                              lineHeight: 1.1,
                            }}
                          >
                            {formatClock(new Date(m.createdAt))}
                          </span>
                        )}
                      </div>
                    ) : null}
                    {m.deletedAt ? (
                      <div
                        style={{
                          padding: "9px 13px", fontSize: 14, fontWeight: 500,
                          lineHeight: 1.4, letterSpacing: "-0.01em",
                          color: mine ? C.brandFg : C.ink,
                          background: mine ? C.blue : C.bubbleOther,
                          borderRadius: 16, fontStyle: "italic", opacity: 0.6,
                        }}
                      >
                        삭제된 메시지
                      </div>
                    ) : (
                      <LongPress
                        onLongPress={(rect) => { setReactingId(m.id); setReactingRect(rect); }}
                        // 상대 메시지 두 번 탭 → 👍 토글 (있으면 제거, 없으면 추가).
                        // 본인 메시지에선 더블탭이 무의미하므로 비활성.
                        onDoubleTap={!mine ? () => onReact(m.id, "👍") : undefined}
                        style={{
                          transition: "transform .12s ease",
                          transform: isPicking ? "scale(.97)" : "scale(1)",
                        }}
                      >
                        <MessageBubble msg={m} mine={mine} />
                      </LongPress>
                    )}
                    </div>
                  </div>
                </div>
                {/* 리액션 칩 — 버블 행 바깥(하단 형제) 로 뺐다. 안에 두면 inner column 의
                    flex-end 정렬 기준이 리액션 줄까지 내려가 아바타가 리액션 옆에 붙는다.
                    상대방(non-mine) 기준으로 아바타(26px) + gap(8px) = 34px 만큼 좌측으로
                    들여 버블과 정렬 맞춤. */}
                {m.reactions && m.reactions.length > 0 && (
                  <div
                    style={{
                      display: "flex", flexWrap: "wrap", gap: 4,
                      marginTop: 4,
                      justifyContent: mine ? "flex-end" : "flex-start",
                      paddingLeft: !mine ? 34 : 0,
                    }}
                  >
                    {groupReactions(m.reactions).map((g) => {
                      const isMine = g.userIds.includes(meId);
                      // 그룹방: 최근 누른 3명 아바타를 옆으로 중첩(마지막=최근). 1:1: 숫자.
                      const recent = isGroupRoom ? g.userIds.slice(-3).reverse() : [];
                      const ringBg = isMine ? C.blueSoft : C.gray100;
                      const startLp = () => {
                        reactLpFired.current = false;
                        reactLpTimer.current = window.setTimeout(() => {
                          reactLpFired.current = true;
                          setReactorSheet({ emoji: g.emoji, userIds: g.userIds });
                        }, 420);
                      };
                      const clearLp = () => { if (reactLpTimer.current) { clearTimeout(reactLpTimer.current); reactLpTimer.current = null; } };
                      return (
                        <button
                          key={g.emoji}
                          type="button"
                          onClick={() => { if (reactLpFired.current) { reactLpFired.current = false; return; } onReact(m.id, g.emoji); }}
                          onPointerDown={startLp}
                          onPointerUp={clearLp}
                          onPointerLeave={clearLp}
                          onPointerCancel={clearLp}
                          onContextMenu={(e) => { e.preventDefault(); setReactorSheet({ emoji: g.emoji, userIds: g.userIds }); }}
                          title={g.names.join(", ")}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            padding: "2px 8px", height: 24,
                            borderRadius: 999,
                            background: ringBg,
                            border: isMine ? `1px solid ${C.blue}` : `1px solid ${C.gray200}`,
                            color: C.ink, cursor: "pointer",
                            fontSize: 12, fontWeight: 600,
                            fontFamily: FONT,
                          }}
                        >
                          <span style={{ fontSize: 13 }}>{g.emoji}</span>
                          {isGroupRoom ? (
                            <span style={{ display: "inline-flex", alignItems: "center" }}>
                              {recent.map((uid, i) => {
                                const u = membersById.get(uid);
                                return (
                                  <span key={uid} style={{ marginLeft: i === 0 ? 0 : -7, position: "relative", zIndex: 3 - i, borderRadius: 999, boxShadow: `0 0 0 1.5px ${ringBg}` }}>
                                    <Avatar name={u?.name ?? "?"} color={u?.avatarColor ?? C.blue} imageUrl={u?.avatarUrl ?? null} size={16} />
                                  </span>
                                );
                              })}
                              {g.count > 3 && <span style={{ marginLeft: 3, fontVariantNumeric: "tabular-nums" }}>+{g.count - 3}</span>}
                            </span>
                          ) : (
                            <span style={{ fontVariantNumeric: "tabular-nums" }}>{g.count}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* 컨텍스트 메뉴(iOS peek 스타일): 블러 backdrop + 이모지 바 + 강조 버블 + 액션 메뉴 */}
                {isPicking && reactingRect && (
                  <ReactionPicker
                    anchorRect={reactingRect}
                    mine={mine}
                    onPick={(e) => onReact(m.id, e)}
                    onDismiss={() => { setReactingId(null); setReactingRect(null); }}
                    header={formatDetailed(new Date(m.createdAt))}
                    actions={buildMessageActions(m, mine, onPin, onDelete)}
                  >
                    <MessageBubble msg={m} mine={mine} />
                  </ReactionPicker>
                )}
              </div>
            </div>
            </div>
          );
        })}
      </div>

      {/* 숨김 파일 인풋 — 다중 선택 허용 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,*/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          for (const f of files) onPickFile(f);
          e.target.value = "";
          // 파일 인풋에 포커스가 남아있으면 엔터가 다시 파일 선택창을 열어버림.
          // 명시적으로 텍스트 입력창으로 포커스 이동.
          setTimeout(() => textareaRef.current?.focus(), 0);
        }}
      />

      {/* 첨부 미리보기 — 파일 선택 시 입력바 위에 표시 (여러 개 가로 나열 + 좌측 '+' 로 추가) */}
      {(attachments.length > 0 || uploading) && (
        <div
          style={{
            padding: "0 14px 8px",
            background: C.surface,
            display: "flex",
            alignItems: "center",
            gap: 8,
            overflowX: "auto",
          }}
        >
          {/* 추가 버튼 — 첨부가 있을 때만 좌측에 표시 */}
          {attachments.length > 0 && (
            <button
              type="button"
              title="파일 더 추가"
              aria-label="파일 더 추가"
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: 72, height: 72, flexShrink: 0,
                borderRadius: 14,
                border: `1.5px dashed ${C.gray300 ?? "#D1D5DB"}`,
                background: C.gray100,
                color: C.gray600,
                cursor: "pointer",
                display: "grid", placeItems: "center",
                transition: "background .12s ease, color .12s ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.gray200 ?? "#E5E7EB"; e.currentTarget.style.color = C.ink; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = C.gray100; e.currentTarget.style.color = C.gray600; }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          )}
          {attachments.map((a, i) => (
            <AttachmentPreview key={i} att={a} onClear={() => onRemoveAttachment(i)} />
          ))}
          {uploading && (
            <div style={{ fontSize: 12, color: C.gray600, fontWeight: 500, flexShrink: 0 }}>
              업로드 중…
            </div>
          )}
        </div>
      )}

      {/* 입력바 — 필(내부 클립) + 외부 전송 버튼(입력/첨부 시 슬라이드 인) */}
      {(() => {
        const hasContent = !!input.trim() || attachments.length > 0;
        return (
          <div
            style={{
              padding: "10px 14px 14px",
              background: C.surface,
              display: "flex", alignItems: "flex-end", gap: 8,
              position: "relative",
            }}
          >
            <SnippetSlashMenu
              textareaRef={textareaRef}
              value={input}
              onReplace={(start, end, replacement) => {
                const next = input.slice(0, start) + replacement + input.slice(end);
                setInput(next);
                // 치환 후 커서를 삽입 끝으로 이동 + 높이 자동 조정.
                requestAnimationFrame(() => {
                  const ta = textareaRef.current;
                  if (!ta) return;
                  const pos = start + replacement.length;
                  ta.focus();
                  ta.setSelectionRange(pos, pos);
                  ta.style.height = "auto";
                  ta.style.height = Math.min(ta.scrollHeight, 92) + "px";
                });
              }}
              innerRef={slashRef}
            />
            {isGroupRoom && (
              <MentionMenu
                textareaRef={textareaRef}
                value={input}
                members={room.members.map((rm) => rm.user)}
                onReplace={(start, end, replacement) => {
                  const next = input.slice(0, start) + replacement + input.slice(end);
                  setInput(next);
                  requestAnimationFrame(() => {
                    const ta = textareaRef.current;
                    if (!ta) return;
                    const pos = start + replacement.length;
                    ta.focus();
                    ta.setSelectionRange(pos, pos);
                    ta.style.height = "auto";
                    ta.style.height = Math.min(ta.scrollHeight, 92) + "px";
                  });
                }}
                innerRef={mentionRef}
              />
            )}
            <div
              style={{
                flex: 1, minWidth: 0,
                background: C.gray100,
                borderRadius: 20,
                padding: "8px 8px 8px 14px",
                display: "flex", alignItems: "center", gap: 6,
                transition: "padding .22s cubic-bezier(.22,.61,.36,1)",
              }}
            >
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 92) + "px";
                }}
                onKeyDown={(e) => {
                  // @멘션 / 슬래시 자동완성 메뉴가 열려있으면 ↑↓/Enter/Esc/Tab 을 그쪽이 먼저 소비.
                  if (mentionRef.current?.handleKey(e)) return;
                  if (slashRef.current?.handleKey(e)) return;
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                onPaste={(e) => {
                  // 클립보드에서 이미지/영상 붙여넣기 지원 (macOS/Windows 브라우저, 모바일 공통).
                  // 텍스트가 같이 있으면 텍스트는 기본 동작에 맡기고 파일만 낚아챔.
                  const items = e.clipboardData?.items;
                  if (!items || items.length === 0) return;
                  const files: File[] = [];
                  for (const it of Array.from(items)) {
                    if (it.kind !== "file") continue;
                    const f = it.getAsFile();
                    if (!f) continue;
                    // 스크린샷 등 일부 브라우저는 name 이 비어있음 → MIME 로 확장자 추정해 채워넣음.
                    let file = f;
                    if (!file.name || file.name === "image.png") {
                      const ext = (file.type.split("/")[1] || "bin").split(";")[0];
                      const ts = new Date().toISOString().replace(/[:.]/g, "-");
                      file = new File([f], `pasted-${ts}.${ext}`, { type: f.type });
                    }
                    files.push(file);
                  }
                  if (files.length === 0) return;
                  // 파일이 붙어있으면 기본 paste(텍스트 삽입) 를 막고 업로드로 라우팅.
                  e.preventDefault();
                  for (const f of files) onPickFile(f);
                }}
                placeholder="메시지를 입력하세요"
                name="chat-message"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={8000}
                data-1p-ignore="true"
                data-lpignore="true"
                data-form-type="other"
                style={{
                  flex: 1, border: 0, outline: 0, resize: "none",
                  background: "transparent",
                  fontSize: 14, fontWeight: 500, color: C.ink,
                  fontFamily: FONT, letterSpacing: "-0.01em",
                  lineHeight: 1.4,
                  maxHeight: 92, minHeight: 20,
                }}
              />
              {/* 파일 첨부(클립) — 입력/첨부 없을 때만 표시 */}
              <button
                type="button"
                title="사진, 영상, 파일 첨부"
                aria-label="파일 첨부"
                onClick={() => fileInputRef.current?.click()}
                tabIndex={hasContent ? -1 : 0}
                style={{
                  width: hasContent ? 0 : 28,
                  height: 28,
                  padding: 0,
                  borderRadius: 999,
                  background: "transparent",
                  color: C.gray500,
                  border: 0,
                  cursor: "pointer",
                  display: "grid", placeItems: "center",
                  flexShrink: 0,
                  overflow: "hidden",
                  opacity: hasContent ? 0 : 1,
                  transform: hasContent ? "scale(.7) rotate(-20deg)" : "scale(1) rotate(0)",
                  transition:
                    "opacity .18s ease, transform .22s cubic-bezier(.22,.61,.36,1), width .22s cubic-bezier(.22,.61,.36,1)",
                  pointerEvents: hasContent ? "none" : "auto",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = C.ink)}
                onMouseLeave={(e) => (e.currentTarget.style.color = C.gray500)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05 12.25 20.24a6 6 0 1 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66L9.41 17.41a2 2 0 1 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
            </div>

            {/* 외부 전송 버튼 — 입력/첨부 시 슬라이드 인 */}
            <button
              onClick={handleSend}
              // 탭 시 mousedown 기본동작(포커스 이동)을 막아 textarea 포커스 유지 → 키보드 안 내려감.
              // MentionMenu/SnippetSlashMenu 가 쓰는 것과 동일 패턴.
              onMouseDown={(e) => e.preventDefault()}
              disabled={!hasContent || sending}
              title="보내기"
              aria-label="보내기"
              tabIndex={hasContent ? 0 : -1}
              style={{
                width: hasContent ? 40 : 0,
                height: 40,
                padding: 0,
                borderRadius: 999,
                background: sending ? C.gray200 : C.blue,
                color: sending ? C.gray500 : "#fff",
                border: 0,
                cursor: !hasContent || sending ? "default" : "pointer",
                display: "grid", placeItems: "center",
                flexShrink: 0,
                overflow: "hidden",
                marginLeft: hasContent ? 0 : -8, // gap 상쇄 — 숨김 상태에서 갭까지 제거
                opacity: hasContent ? 1 : 0,
                transform: hasContent ? "scale(1) translateX(0)" : "scale(.6) translateX(8px)",
                pointerEvents: hasContent ? "auto" : "none",
                transition:
                  "opacity .2s ease, transform .26s cubic-bezier(.22,.61,.36,1), width .26s cubic-bezier(.22,.61,.36,1), margin-left .26s cubic-bezier(.22,.61,.36,1), background .15s ease",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        );
      })()}
      {/* 이모지 반응 누른 사람 목록(칩 길게누름) — 바텀시트. 항목 탭 → 프로필. */}
      {reactorSheet && (
        <div
          onClick={() => setReactorSheet(null)}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 480, background: C.surface,
              borderTopLeftRadius: 18, borderTopRightRadius: 18,
              padding: "8px 0 max(16px, var(--sa-bottom, env(safe-area-inset-bottom)))",
              maxHeight: "60vh", overflowY: "auto",
            }}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: C.gray200, margin: "4px auto 6px" }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontWeight: 700, color: C.ink, padding: "4px 18px 10px", fontSize: 15 }}>
              <span style={{ fontSize: 18 }}>{reactorSheet.emoji}</span>
              <span>{reactorSheet.userIds.length}</span>
            </div>
            {reactorSheet.userIds.slice().reverse().map((uid) => {
              const u = membersById.get(uid);
              return (
                <button
                  key={uid}
                  type="button"
                  onClick={() => { setReactorSheet(null); openProfile(uid); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 18px", background: "transparent", border: 0, cursor: "pointer", fontFamily: FONT }}
                >
                  <Avatar name={u?.name ?? "?"} color={u?.avatarColor ?? C.blue} imageUrl={u?.avatarUrl ?? null} size={36} />
                  <span style={{ color: C.ink, fontSize: 14.5, fontWeight: 600 }}>{u?.name ?? "알 수 없음"}{uid === meId ? " (나)" : ""}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

