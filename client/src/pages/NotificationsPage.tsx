import { useEffect, useState } from "react";
import { useRefresh } from "../lib/useRefresh";
import { useNavigate } from "react-router-dom";
import { useNotifications, type Notif } from "../notifications";
import { NotifRow, navigateToNotif } from "../components/notifShared";
import NotificationPrefsModal from "../components/NotificationPrefsModal";
import { Skeleton } from "../components/Skeleton";

/**
 * 전용 알림 페이지 — 주로 모바일에서 진입한다(벨을 누르면 드롭다운 대신 이 페이지로 이동).
 * 데스크톱은 벨 드롭다운을 그대로 쓰지만, URL(/notifications)로도 접근할 수 있게 라우트는
 * 공통으로 둔다. 행 UI·이동 로직은 벨과 동일하게 notifShared 를 재사용한다.
 */
export default function NotificationsPage() {
  const nav = useNavigate();
  const { bellItems, unread, reload, markRead } = useNotifications();
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [prefsOpen, setPrefsOpen] = useState(false);
  // 첫 reload 완료 여부 — useNotifications 훅이 loading 을 노출하지 않으므로 로컬로 추적.
  // false 동안엔 빈 영역 대신 Skeleton 행을 띄워 깜빡임 제거.
  const [loaded, setLoaded] = useState(false);
  const { refreshing, refresh } = useRefresh(() => reload());

  // 페이지 진입 시 최신 알림으로 한 번 갱신(프로바이더의 주기 폴링과 별개로 즉시 동기화).
  useEffect(() => {
    let alive = true;
    Promise.resolve(reload()).finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [reload]);


  const visible = tab === "unread" ? bellItems.filter((n) => !n.readAt) : bellItems;

  async function handleClick(n: Notif) {
    if (!n.readAt) await markRead([n.id]);
    navigateToNotif(n, nav);
  }

  return (
    <div className="max-w-[640px] mx-auto">
      {/* 헤더 — 제목 + 미읽음 수, 우측에 모두 읽음 / 설정 */}
      <div className="flex items-center gap-2 mb-4">
        <h1 className="text-[20px] font-extrabold text-ink-900 tracking-tight">알림</h1>
        {unread > 0 && (
          <span className="min-w-[20px] h-[20px] px-1.5 rounded-full bg-danger text-white text-[11px] font-bold grid place-items-center tabular">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {unread > 0 && (
            <button
              className="text-[12px] font-bold text-brand-600 hover:text-brand-700 px-2 py-1"
              onClick={() => markRead(undefined, true)}
            >
              모두 읽음
            </button>
          )}
          {/* 데스크탑 전용 새로고침 — 모바일은 PTR 이 담당하므로 hidden md:inline-flex. */}
          <button
            className="btn-icon !w-8 !h-8 hidden md:inline-flex disabled:opacity-50"
            title="새로고침"
            aria-label="새로고침"
            onClick={refresh}
            disabled={refreshing}
            data-haptic="selection"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={refreshing ? "hinest-spin" : ""} aria-hidden>
              <path d="M3 12a9 9 0 0 1 9-9c2.39 0 4.68.94 6.4 2.6L21 8" /><path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9c-2.39 0-4.68-.94-6.4-2.6L3 16" /><path d="M3 21v-5h5" />
            </svg>
          </button>
          <button
            className="btn-icon !w-8 !h-8"
            title="알림 설정"
            aria-label="알림 설정"
            onClick={() => setPrefsOpen(true)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

      {/* 탭 — 전체 / 안읽음 */}
      <div className="tabs mb-3">
        <button className={`tab ${tab === "all" ? "tab-active" : ""}`} onClick={() => setTab("all")}>전체</button>
        <button className={`tab ${tab === "unread" ? "tab-active" : ""}`} onClick={() => setTab("unread")}>
          안읽음 {unread > 0 && <span className="ml-0.5 text-danger tabular">{unread}</span>}
        </button>
      </div>

      {/* 리스트 */}
      <div className="panel overflow-hidden">
        {!loaded && visible.length === 0 ? (
          // 첫 로드 동안 — 알림 행 형태의 Skeleton(아바타 + 제목·시간 두 줄).
          <div className="divide-y divide-[color:var(--c-border)]">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton circle w={36} h={36} />
                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  <Skeleton w="70%" h={12} />
                  <Skeleton w="40%" h={10} />
                </div>
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mx-auto w-11 h-11 rounded-xl bg-ink-100 grid place-items-center mb-2.5">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8E959E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              </svg>
            </div>
            <div className="text-[13px] text-ink-500">
              {tab === "unread" ? "안 읽은 알림이 없어요." : "알림이 없어요."}
            </div>
          </div>
        ) : (
          visible.map((n) => <NotifRow key={n.id} n={n} onClick={() => handleClick(n)} />)
        )}
      </div>

      <NotificationPrefsModal open={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </div>
  );
}
