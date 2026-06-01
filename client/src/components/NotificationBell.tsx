import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNotifications, type Notif } from "../notifications";
import NotificationPrefsModal from "./NotificationPrefsModal";
import { NotifRow, navigateToNotif } from "./notifShared";

export default function NotificationBell() {
  const nav = useNavigate();
  const { bellItems, unread, reload, markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [prefsOpen, setPrefsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const visible = tab === "unread" ? bellItems.filter((n) => !n.readAt) : bellItems;

  async function handleClick(n: Notif) {
    if (!n.readAt) await markRead([n.id]);
    navigateToNotif(n, nav);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        className="btn-icon relative"
        onClick={() => {
          const willOpen = !open;
          setOpen(willOpen);
          if (willOpen) reload();
        }}
        title="알림"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-danger text-white text-[10px] font-bold grid place-items-center tabular">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-[360px] max-w-[calc(100vw-1.5rem)] panel shadow-pop z-50 p-0 overflow-hidden">
          <div className="section-head">
            <div className="title">알림</div>
            <div className="flex items-center gap-1">
              <div className="tabs">
                <button className={`tab ${tab === "all" ? "tab-active" : ""}`} onClick={() => setTab("all")}>전체</button>
                <button className={`tab ${tab === "unread" ? "tab-active" : ""}`} onClick={() => setTab("unread")}>
                  안읽음 {unread > 0 && <span className="ml-0.5 text-danger tabular">{unread}</span>}
                </button>
              </div>
              {unread > 0 && (
                <button className="text-[11px] font-bold text-brand-600 hover:text-brand-700 ml-2" onClick={() => markRead(undefined, true)}>
                  모두 읽음
                </button>
              )}
              <button
                className="btn-icon !w-7 !h-7 ml-1"
                title="알림 설정"
                onClick={() => { setPrefsOpen(true); setOpen(false); }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            </div>
          </div>
          <div className="max-h-[440px] overflow-auto">
            {visible.length === 0 ? (
              <div className="py-14 text-center">
                <div className="mx-auto w-10 h-10 rounded-xl bg-ink-100 grid place-items-center mb-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8E959E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                  </svg>
                </div>
                <div className="text-[12px] text-ink-500">알림이 없어요.</div>
              </div>
            ) : (
              visible.map((n) => <NotifRow key={n.id} n={n} onClick={() => handleClick(n)} />)
            )}
          </div>
        </div>
      )}
      <NotificationPrefsModal open={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </div>
  );
}
