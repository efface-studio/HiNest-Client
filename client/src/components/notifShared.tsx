import type { Notif } from "../notifications";

/**
 * 알림 표시용 공유 헬퍼 — 벨 드롭다운(NotificationBell)과 전용 알림 페이지
 * (NotificationsPage)가 동일한 행 UI·아이콘·이동 로직을 쓰도록 한곳에 모은다.
 * 이전엔 NotificationBell 안에만 있어 페이지에서 재사용하려면 복붙해야 했다.
 */

/**
 * 알림 클릭 시 이동 처리. 읽음 처리는 호출부에서 먼저 한 뒤 이 함수로 이동만 담당한다.
 * /chat 페이지가 제거됐으므로 chat 링크는 우하단 사내톡 팝업으로 돌린다(레거시 알림의
 * linkUrl 에 "/chat?room=<id>" 가 남아있을 수 있어 호환 처리).
 */
export function navigateToNotif(n: Notif, nav: (to: string) => void) {
  if (!n.linkUrl) return;
  const chatMatch = /^\/chat(?:\?|#).*?room=([^&]+)/.exec(n.linkUrl);
  if (chatMatch) {
    window.dispatchEvent(new CustomEvent("chat:open"));
    window.dispatchEvent(new CustomEvent("chat:open-room", { detail: { roomId: chatMatch[1] } }));
  } else if (n.linkUrl.startsWith("/chat")) {
    // room 지정 없는 /chat 링크는 그냥 팝업만 연다
    window.dispatchEvent(new CustomEvent("chat:open"));
  } else {
    nav(n.linkUrl);
  }
}

export function NotifRow({ n, onClick }: { n: Notif; onClick: () => void }) {
  const { icon, color } = typeVisuals(n.type);
  const unread = !n.readAt;
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 border-b border-ink-100 last:border-b-0 hover:bg-ink-25 flex items-start gap-3 relative"
      style={unread ? { background: "color-mix(in srgb, var(--c-brand) 8%, transparent)" } : undefined}
    >
      {unread && (
        <span
          aria-hidden
          style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "var(--c-brand)" }}
        />
      )}
      <div className={`w-8 h-8 rounded-lg grid place-items-center flex-shrink-0`} style={{ background: color + "20", color }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {!n.readAt && <span className="w-1.5 h-1.5 rounded-full bg-brand-500 flex-shrink-0" />}
          <div className="text-[13px] font-bold text-ink-900 truncate">{n.title}</div>
        </div>
        {n.body && <div className="text-[12px] text-ink-600 mt-0.5 line-clamp-2">{n.body}</div>}
        <div className="text-[10px] text-ink-400 mt-1 tabular">{formatAgo(new Date(n.createdAt))}</div>
      </div>
    </button>
  );
}

function typeVisuals(t: Notif["type"]) {
  const S = (p: React.ReactNode) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p}</svg>
  );
  switch (t) {
    case "NOTICE":
      return { icon: S(<><path d="M3 10v4a2 2 0 0 0 2 2h2l8 5V3L7 8H5a2 2 0 0 0-2 2Z" /><path d="M19 8a5 5 0 0 1 0 8" /></>), color: "#DC2626" };
    case "DM":
      return { icon: S(<path d="M4 5h16v11H9l-4 4z" />), color: "#3B5CF0" };
    case "APPROVAL_REQUEST":
      return { icon: S(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></>), color: "#D97706" };
    case "APPROVAL_REVIEW":
      return { icon: S(<><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>), color: "#16A34A" };
    case "MENTION":
      return { icon: S(<><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.93" /></>), color: "#0EA5E9" };
    default:
      return { icon: S(<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>), color: "#6B7280" };
  }
}

function formatAgo(d: Date) {
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "방금";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const day = Math.floor(h / 24);
  if (day < 7) return `${day}일 전`;
  return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}
