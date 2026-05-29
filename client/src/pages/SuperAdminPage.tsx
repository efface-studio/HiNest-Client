import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { safeUploadUrl } from "../lib/safeUrl";
import { useTheme } from "../theme";
import PageHeader from "../components/PageHeader";
import SuperStepUpGate from "../components/SuperStepUpGate";
import { ErrorBoundary } from "../components/ErrorBoundary";
import SessionsPanel from "../components/superadmin/SessionsPanel";
import ErrorsPanel from "../components/superadmin/ErrorsPanel";
import HealthPanel from "../components/superadmin/HealthPanel";
import TrashPanel from "../components/superadmin/TrashPanel";
import AuditPanel from "../components/superadmin/AuditPanel";
import FlagsPanel from "../components/superadmin/FlagsPanel";
import TokensPanel from "../components/superadmin/TokensPanel";
import SecurityPanel from "../components/superadmin/SecurityPanel";
import TwoFAPanel from "../components/superadmin/TwoFAPanel";
import RolePermissionsPanel from "../components/superadmin/RolePermissionsPanel";

type Log = {
  id: string;
  action: string;
  target?: string | null;
  detail?: string | null;
  ip?: string | null;
  createdAt: string;
  user?: { name: string; email: string } | null;
};

type RoomMember = { user: { id: string; name: string; avatarColor: string } };
type Room = {
  id: string;
  name: string;
  type: "GROUP" | "DIRECT" | "TEAM";
  createdAt: string;
  members: RoomMember[];
  messages: { content: string; createdAt: string }[];
};
type Message = {
  id: string;
  content: string;
  kind: "TEXT" | "IMAGE" | "VIDEO" | "FILE";
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  fileSize?: number | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  scheduledAt?: string | null;
  createdAt: string;
  sender: { id: string; name: string; avatarColor: string; avatarUrl?: string | null };
};

type Tab = "logs" | "chat" | "api" | "console" | "server" | "nav" | "sessions" | "errors" | "health" | "trash" | "audit" | "flags" | "tokens" | "security" | "twofa" | "roles";

type ApiSpecRoute = {
  method: string;
  path: string;
  auth: "PUBLIC" | "AUTH" | "ADMIN" | "SUPER";
  middlewares: string[];
  pathParams: string[];
  headers: { name: string; value: string; required: boolean }[];
  hasBody: boolean;
};

export default function SuperAdminPage() {
  return (
    <div>
      <PageHeader
        eyebrow="관리 › 개발자"
        title="개발자 콘솔"
        description="시스템 전반의 활동 로그와 모든 대화를 조회할 수 있습니다."
      />
      {/*
        페이지 레벨 ErrorBoundary — 게이트/콘텐츠 최상위(탭 바·훅 등 패널 바깥)에서
        나는 throw 를 여기서 잡는다. 이게 없으면 그런 에러가 App 최상위 라우트
        바운더리까지 올라가 사이드바 포함 화면 전체가 덮였음(패널 안쪽만 감싼
        탭 레벨 바운더리로는 못 잡던 영역). 폴백이 에러를 인라인 노출해 진단 가능.
      */}
      <ErrorBoundary
        fallback={(err, reset) => (
          <DevErrorFallback
            err={err}
            reset={reset}
            title="개발자 콘솔을 표시하는 중 오류가 발생했어요"
            hint="왼쪽 사이드바로 다른 메뉴는 이동할 수 있어요. 아래 오류 내용을 확인해 주세요."
          />
        )}
      >
        <SuperStepUpGate>
          <SuperAdminContent />
        </SuperStepUpGate>
      </ErrorBoundary>
    </div>
  );
}

/** 사내톡 감사 탭은 평소엔 UI 에서 가려두고, 콘솔의 \`chat log\` 명령 + 비밀번호로만 노출.
 *  서버 측 ChatAuditPanel API 들은 요청 자체에 super-stepup 게이트가 또 걸려있어 이중 가드.
 *  비밀번호 일치 시 30분 unlock — sessionStorage 사용으로 탭 닫으면 자동 잠금. */
const CHAT_LOG_KEY = "hinest.chatAudit.unlock";

function isChatAuditUnlocked(): boolean {
  try {
    const v = sessionStorage.getItem(CHAT_LOG_KEY);
    if (!v) return false;
    return Date.now() < Number(v);
  } catch {
    return false;
  }
}

function SuperAdminContent() {
  // 새로고침 유지 — URL 쿼리로 탭 동기화.
  const [sp, setSp] = useSearchParams();
  const raw = sp.get("tab");
  const [chatUnlocked, setChatUnlocked] = useState<boolean>(() => isChatAuditUnlocked());
  const [chatPwOpen, setChatPwOpen] = useState(false);

  // 콘솔에서 \`chat log\` 명령 시 발사되는 이벤트 — 암호 모달 노출.
  useEffect(() => {
    function onPrompt() { setChatPwOpen(true); }
    window.addEventListener("hinest:chatAuditPrompt", onPrompt);
    return () => window.removeEventListener("hinest:chatAuditPrompt", onPrompt);
  }, []);

  const tab: Tab =
    raw === "chat" && chatUnlocked ? "chat"
    : raw === "api" ? "api"
    : raw === "console" ? "console"
    : raw === "server" ? "server"
    : raw === "nav" ? "nav"
    : raw === "sessions" ? "sessions"
    : raw === "errors" ? "errors"
    : raw === "health" ? "health"
    : raw === "trash" ? "trash"
    : raw === "audit" ? "audit"
    : raw === "flags" ? "flags"
    : raw === "tokens" ? "tokens"
    : raw === "security" ? "security"
    : raw === "twofa" ? "twofa"
    : raw === "roles" ? "roles"
    : "logs";

  const setTab = (t: Tab) => {
    const next = new URLSearchParams(sp);
    if (t === "logs") next.delete("tab");
    else next.set("tab", t);
    setSp(next, { replace: true });
  };

  async function unlockChat(pw: string): Promise<boolean> {
    try {
      const r = await api<{ ok: true; ttlMs: number }>("/api/admin/chat-audit/unlock", {
        method: "POST",
        json: { password: pw },
      });
      try {
        sessionStorage.setItem(CHAT_LOG_KEY, String(Date.now() + (r.ttlMs ?? 30 * 60 * 1000)));
      } catch {}
      setChatUnlocked(true);
      setChatPwOpen(false);
      setTab("chat");
      return true;
    } catch {
      return false;
    }
  }

  function lockChat() {
    try { sessionStorage.removeItem(CHAT_LOG_KEY); } catch {}
    setChatUnlocked(false);
    // 현재 사내톡 탭 보고 있었으면 활동 로그로 되돌림.
    if (tab === "chat") setTab("logs");
  }

  // 콘솔 \`chat lock\` 명령으로도 즉시 잠금 가능 — escape hatch.
  useEffect(() => {
    function onLock() { lockChat(); }
    window.addEventListener("hinest:chatAuditLock", onLock);
    return () => window.removeEventListener("hinest:chatAuditLock", onLock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <>
      <div className="flex items-center gap-1 mb-4 border-b border-ink-150 overflow-x-auto whitespace-nowrap" style={{ scrollbarWidth: "thin" }}>
        <TabBtn active={tab === "logs"} onClick={() => setTab("logs")}>활동 로그</TabBtn>
        {chatUnlocked && (
          <div className="flex items-center">
            <TabBtn active={tab === "chat"} onClick={() => setTab("chat")}>사내톡 감사</TabBtn>
            <button
              type="button"
              onClick={lockChat}
              className="ml-1 text-ink-500 hover:text-red-600 transition"
              title="사내톡 감사 즉시 잠그기"
              aria-label="사내톡 감사 잠그기"
              style={{ width: 22, height: 22, display: "grid", placeItems: "center", borderRadius: 999 }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="11" width="16" height="9" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            </button>
          </div>
        )}
        <TabBtn active={tab === "api"} onClick={() => setTab("api")}>API 명세서</TabBtn>
        <TabBtn active={tab === "console"} onClick={() => setTab("console")}>콘솔</TabBtn>
        <TabBtn active={tab === "server"} onClick={() => setTab("server")}>서버 로그</TabBtn>
        <TabBtn active={tab === "nav"} onClick={() => setTab("nav")}>메뉴 관리</TabBtn>
        <TabBtn active={tab === "sessions"} onClick={() => setTab("sessions")}>세션</TabBtn>
        <TabBtn active={tab === "errors"} onClick={() => setTab("errors")}>에러</TabBtn>
        <TabBtn active={tab === "health"} onClick={() => setTab("health")}>헬스</TabBtn>
        <TabBtn active={tab === "trash"} onClick={() => setTab("trash")}>휴지통</TabBtn>
        <TabBtn active={tab === "audit"} onClick={() => setTab("audit")}>감사 로그</TabBtn>
        <TabBtn active={tab === "flags"} onClick={() => setTab("flags")}>기능 플래그</TabBtn>
        <TabBtn active={tab === "tokens"} onClick={() => setTab("tokens")}>API 토큰</TabBtn>
        <TabBtn active={tab === "security"} onClick={() => setTab("security")}>보안 룰</TabBtn>
        <TabBtn active={tab === "twofa"} onClick={() => setTab("twofa")}>2FA 정책</TabBtn>
        <TabBtn active={tab === "roles"} onClick={() => setTab("roles")}>역할 권한</TabBtn>
      </div>
      <ErrorBoundary
        resetKey={tab}
        fallback={(err, reset) => (
          <DevErrorFallback
            err={err}
            reset={reset}
            title="이 탭을 표시하는 중 오류가 발생했어요"
            hint="다른 탭은 정상 동작해요. 아래 오류 내용을 확인하거나 다시 시도해 주세요."
          />
        )}
      >
        {tab === "logs" && <LogsPanel />}
        {tab === "chat" && chatUnlocked && <ChatAuditPanel />}
        {tab === "api" && <ApiSpecPanel />}
        {tab === "console" && <ConsolePanel />}
        {tab === "server" && <ServerLogsPanel />}
        {tab === "nav" && <NavVisibilityPanel />}
        {tab === "sessions" && <SessionsPanel />}
        {tab === "errors" && <ErrorsPanel />}
        {tab === "health" && <HealthPanel />}
        {tab === "trash" && <TrashPanel />}
        {tab === "audit" && <AuditPanel />}
        {tab === "flags" && <FlagsPanel />}
        {tab === "tokens" && <TokensPanel />}
        {tab === "security" && <SecurityPanel />}
        {tab === "twofa" && <TwoFAPanel />}
        {tab === "roles" && <RolePermissionsPanel />}
      </ErrorBoundary>
      {chatPwOpen && (
        <ChatAuditPwModal
          onClose={() => setChatPwOpen(false)}
          onSubmit={unlockChat}
        />
      )}
    </>
  );
}

/**
 * 개발자 콘솔용 인라인 에러 폴백.
 * 최상위 라우트 ErrorBoundary 의 기본 폴백은 에러를 접힌 "기술 정보" 안에 숨겨
 * 진단이 불가능했음. 개발자 콘솔에선 메시지 + 스택 상단을 그대로 노출해 바로 원인을
 * 볼 수 있게 한다. 페이지 레벨(게이트·콘텐츠 최상위)·탭 레벨(개별 패널) 양쪽에서 재사용.
 */
function DevErrorFallback({ err, reset, title, hint }: { err: Error; reset: () => void; title: string; hint: string }) {
  return (
    <div className="panel p-6" role="alert">
      <div className="flex items-start gap-3">
        <div className="text-[22px] leading-none" aria-hidden>⚠️</div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-extrabold text-ink-900 mb-1">{title}</div>
          <div className="text-[12px] text-ink-500 mb-3">{hint}</div>
          <div className="rounded-lg p-3 font-mono text-[11.5px] break-all whitespace-pre-wrap"
               style={{ background: "var(--c-surface-3)", color: "var(--c-danger)" }}>
            {err.message || err.name}
            {err.stack && (
              <div className="mt-1.5 text-ink-500" style={{ fontSize: 10.5 }}>
                {err.stack.split("\n").slice(1, 4).join("\n")}
              </div>
            )}
          </div>
          <button className="btn-ghost btn-xs mt-3" onClick={reset}>다시 시도</button>
        </div>
      </div>
    </div>
  );
}

function ChatAuditPwModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (pw: string) => Promise<boolean> }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  async function submit() {
    if (busy || !pw) return;
    setBusy(true);
    setErr("");
    try {
      const ok = await onSubmit(pw);
      if (!ok) {
        setErr("암호가 일치하지 않아요.");
        setPw("");
        inputRef.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div className="panel p-5 w-full max-w-[400px]" onClick={(e) => e.stopPropagation()}>
        <div className="text-[15px] font-bold text-ink-900 mb-1">사내톡 감사 접근</div>
        <div className="text-[12px] text-ink-500 mb-4 leading-relaxed">
          이 영역은 평소엔 가려져 있어요. 접근 암호를 입력하면 30분 동안 활성화됩니다.
        </div>
        <input
          ref={inputRef}
          className="input"
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="암호"
          autoComplete="off"
        />
        {err && <div className="text-[12px] font-semibold text-red-600 mt-2">{err}</div>}
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>취소</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !pw}>
            {busy ? "확인 중…" : "확인"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative px-4 h-[36px] text-[13px] font-semibold transition flex-shrink-0 whitespace-nowrap ${
        active ? "text-ink-900" : "text-ink-500 hover:text-ink-800"
      }`}
    >
      {children}
      {active && <span className="absolute -bottom-px left-2 right-2 h-[2px] bg-brand-500 rounded-full" />}
    </button>
  );
}

/* =============== 활동 로그 =============== */
function LogsPanel() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [q, setQ] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  // 500개 로그를 필터할 때 한글 IME 입력이 끊기지 않도록 우선순위 낮춰 실행.
  const deferredQ = useDeferredValue(q);

  // 언마운트 후 setState 호출 방지 + 새로고침 버튼 연타 시 stale 응답 폐기.
  const aliveRef = useRef(true);
  const tokenRef = useRef(0);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  async function load() {
    const myToken = ++tokenRef.current;
    const res = await api<{ logs: Log[] }>("/api/admin/logs?limit=500");
    if (!aliveRef.current || myToken !== tokenRef.current) return;
    setLogs(res.logs);
  }

  useEffect(() => {
    load();
  }, []);

  const uniqueActions = useMemo(() => Array.from(new Set(logs.map((l) => l.action))).sort(), [logs]);

  const filtered = useMemo(() => {
    let arr = logs;
    if (actionFilter) arr = arr.filter((l) => l.action === actionFilter);
    const keyword = deferredQ.trim().toLowerCase();
    if (keyword) {
      arr = arr.filter((l) =>
        [l.action, l.target, l.detail, l.user?.name, l.user?.email]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(keyword))
      );
    }
    return arr;
  }, [logs, actionFilter, deferredQ]);

  return (
    <div className="panel p-0 overflow-hidden">
      <div className="section-head flex-wrap">
        <div className="title">
          활동 로그 <span className="text-ink-400 font-medium ml-1 tabular">{filtered.length}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="input text-[12px] h-[30px] w-full sm:w-[160px]" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="">모든 액션</option>
            {uniqueActions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input
            className="input text-[12px] h-[30px] w-full sm:w-[200px]"
            placeholder="검색 (이름·대상·상세)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={80}
          />
          <button className="btn-ghost btn-xs" onClick={load}>새로고침</button>
        </div>
      </div>
      <div className="overflow-x-auto">
      <table className="pro" style={{ minWidth: 820 }}>
        <thead>
          <tr>
            <th>시각</th>
            <th>사용자</th>
            <th>액션</th>
            <th>대상</th>
            <th>상세</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((l) => (
            <tr key={l.id}>
              <td className="tabular text-[11px] text-ink-600">{new Date(l.createdAt).toLocaleString("ko-KR")}</td>
              <td>{l.user?.name ?? "—"}</td>
              <td><span className="chip-gray tabular">{l.action}</span></td>
              <td className="tabular text-[11px] text-ink-600 max-w-[180px] truncate" title={l.target ?? ""}>{l.target ?? "—"}</td>
              <td className="text-[11px] text-ink-600 max-w-[280px] truncate" title={l.detail ?? ""}>{l.detail ?? "—"}</td>
              <td className="tabular text-[11px] text-ink-500">{l.ip ?? "—"}</td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6} style={{ textAlign: "center", padding: "40px 0" }} className="t-caption">
                로그가 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

/* =============== 사내톡 감사 =============== */
function ChatAuditPanel() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [active, setActive] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [filter, setFilter] = useState<"all" | "direct" | "group">("all");
  const [q, setQ] = useState("");
  // 방 리스트 필터는 수백개 수준에서 한 번에 일어나므로 deferred 로 스케줄 낮춤.
  const deferredQ = useDeferredValue(q);

  // 방 전환 중 이전 요청이 늦게 돌아오면 새 방의 메시지를 덮어써버리는 race 가 있어,
  // activeIdRef 로 현재 의도한 방을 기억해두고 응답이 stale 이면 버림.
  const activeIdRef = useRef<string | null>(null);
  // 언마운트 후 setState 방지. loadRooms 는 exit 시점에 오래 걸릴 수도 있음.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  async function loadRooms() {
    const res = await api<{ rooms: Room[] }>("/api/chat/rooms?scope=audit");
    if (!aliveRef.current) return;
    setRooms(res.rooms);
    // setActive 는 함수형 업데이트로 — loadRooms 진행 중에 유저가 방을 바꿨다면 덮어쓰지 않음.
    setActive((prev) => prev ?? res.rooms[0] ?? null);
  }
  async function loadMessages(roomId: string) {
    activeIdRef.current = roomId;
    const res = await api<{ messages: Message[] }>(`/api/chat/rooms/${roomId}/messages`);
    if (!aliveRef.current) return;
    if (activeIdRef.current !== roomId) return; // 방이 바뀌었으면 stale 응답 무시
    setMessages(res.messages);
  }
  useEffect(() => { loadRooms(); }, []);
  useEffect(() => { if (active) loadMessages(active.id); }, [active?.id]);

  const visible = useMemo(() => {
    let arr = rooms;
    if (filter === "direct") arr = arr.filter((r) => r.type === "DIRECT");
    if (filter === "group") arr = arr.filter((r) => r.type !== "DIRECT");
    const k = deferredQ.trim().toLowerCase();
    if (k) {
      arr = arr.filter((r) =>
        r.name.toLowerCase().includes(k) ||
        r.members.some((m) => m.user.name.toLowerCase().includes(k))
      );
    }
    return arr;
  }, [rooms, filter, deferredQ]);

  function roomLabel(r: Room) {
    if (r.type === "DIRECT") {
      const names = r.members.map((m) => m.user.name);
      return names.join(" ↔ ");
    }
    return r.name;
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[12px]">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
        <span className="font-semibold">모든 DM·팀·그룹 대화가 조회되며 조회 기록이 AuditLog 에 남습니다.</span>
      </div>

      <div className="panel p-0 overflow-hidden" style={{ height: "calc(100vh - 280px)" }}>
        <div className="flex h-full">
          <div className={`${active ? "hidden md:flex" : "flex w-full"} md:w-[320px] border-r border-ink-150 flex-col`}>
            <div className="p-3 border-b border-ink-150 space-y-2">
              <input className="input text-[12px] h-[32px]" placeholder="방·참가자 검색" value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} />
              <div className="flex items-center gap-1">
                {(["all", "direct", "group"] as const).map((f) => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-2.5 h-[26px] text-[11px] font-semibold rounded-md ${filter === f ? "bg-ink-100 text-ink-900" : "text-ink-500 hover:text-ink-800"}`}>
                    {f === "all" ? "전체" : f === "direct" ? "1:1" : "그룹/팀"}
                  </button>
                ))}
                <span className="ml-auto text-[11px] text-ink-400 tabular">{visible.length}</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {visible.map((r) => (
                <button key={r.id} onClick={() => setActive(r)}
                  className={`w-full text-left px-3 py-2.5 border-b border-ink-100 hover:bg-ink-25 ${active?.id === r.id ? "bg-brand-50" : ""}`}>
                  <div className="flex items-center gap-2">
                    <RoomTypeChip type={r.type} />
                    <div className="text-[13px] font-semibold text-ink-900 truncate flex-1">{roomLabel(r)}</div>
                  </div>
                  <div className="text-[11px] text-ink-500 mt-1 truncate">
                    {r.messages[0]?.content ?? `${r.members.length}명 참여`}
                  </div>
                  <div className="text-[10px] text-ink-400 mt-0.5 tabular">
                    생성일 {new Date(r.createdAt).toLocaleDateString("ko-KR")}
                  </div>
                </button>
              ))}
              {visible.length === 0 && <div className="px-4 py-12 text-center t-caption">조건에 맞는 대화가 없습니다.</div>}
            </div>
          </div>

          <div className={`${active ? "flex" : "hidden md:flex"} flex-1 flex-col min-w-0`}>
            {active ? (
              <>
                <div className="h-[52px] px-5 border-b border-ink-150 flex items-center justify-between bg-ink-25">
                  <div className="min-w-0 flex items-center gap-2">
                    <button
                      type="button"
                      className="md:hidden btn-icon"
                      onClick={() => setActive(null)}
                      aria-label="목록으로"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                    </button>
                    <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <RoomTypeChip type={active.type} />
                      <div className="text-[14px] font-bold text-ink-900 truncate">{roomLabel(active)}</div>
                      <span className="chip-amber">READ ONLY</span>
                    </div>
                    <div className="text-[11px] text-ink-500 mt-0.5 truncate">
                      참가자 {active.members.length}명 · {active.members.map((m) => m.user.name).join(", ")}
                    </div>
                    </div>
                  </div>
                  <button className="btn-ghost btn-xs" onClick={() => active && loadMessages(active.id)}>새로고침</button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-2 bg-ink-25">
                  {messages.length === 0 && (
                    <div className="h-full grid place-items-center"><div className="t-caption">메시지가 없습니다.</div></div>
                  )}
                  {messages.map((m) => {
                    const deleted = !!m.deletedAt;
                    const scheduled = !!m.scheduledAt && new Date(m.scheduledAt).getTime() > Date.now();
                    return (
                      <div key={m.id} className="flex gap-2">
                        <div className="w-7 h-7 rounded-full grid place-items-center text-white text-[11px] font-bold flex-shrink-0 overflow-hidden"
                          style={{ background: m.sender.avatarUrl ? "transparent" : m.sender.avatarColor }}>
                          {m.sender.avatarUrl ? (
                            <img src={m.sender.avatarUrl} alt={m.sender.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
                          ) : (
                            m.sender.name[0]
                          )}
                        </div>
                        <div className="max-w-[72%]">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-[11px] font-semibold text-ink-700">{m.sender.name}</span>
                            <span className="text-[10px] text-ink-400 tabular">
                              {new Date(m.createdAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                            </span>
                            {m.editedAt && <span className="text-[10px] text-ink-500">편집됨</span>}
                            {deleted && <span className="chip-red">삭제됨</span>}
                            {scheduled && <span className="chip-amber">예약</span>}
                          </div>
                          <div className={`inline-block px-3 py-1.5 rounded-lg text-[13px] whitespace-pre-wrap ${
                            deleted
                              ? "bg-ink-100 text-ink-500 italic line-through"
                              : "bg-white border border-ink-150 text-ink-900"
                          }`}>
                            <AuditAttachment msg={m} />
                            {m.content || (m.fileName ? "" : "(빈 메시지)")}
                            {scheduled && (
                              <div className="mt-1 text-[10px] text-amber-700">
                                ⏱ {new Date(m.scheduledAt!).toLocaleString("ko-KR")} 발송 예정
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex-1 grid place-items-center"><div className="t-caption">좌측에서 대화방을 선택하세요.</div></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AuditAttachment({ msg }: { msg: Message }) {
  // 다른 모든 첨부 렌더 지점(MessageBubble·ChatMiniApp·DocumentsPage 등)과 동일하게
  // /uploads/ 경로만 허용 — 비정상 스킴(javascript:/data:)이 src/href 로 들어가는 것을 방어.
  const fileUrl = safeUploadUrl(msg.fileUrl);
  if (!fileUrl) return null;
  if (msg.kind === "IMAGE") return <img src={fileUrl} alt={msg.fileName ?? ""} loading="lazy" decoding="async" className="max-h-56 rounded mb-1" />;
  if (msg.kind === "VIDEO") return <video src={fileUrl} controls className="max-h-56 rounded mb-1" />;
  return (
    <a href={fileUrl} target="_blank" rel="noreferrer"
      className="flex items-center gap-2 p-2 rounded-md mb-1 bg-ink-50 border border-ink-200 no-underline">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
      </svg>
      <span className="text-[12px] font-semibold">{msg.fileName}</span>
      <span className="text-[10px] text-ink-500 tabular">{humanSize(msg.fileSize ?? 0)}</span>
    </a>
  );
}

function RoomTypeChip({ type }: { type: Room["type"] }) {
  if (type === "DIRECT") return <span className="chip-brand">DM</span>;
  if (type === "TEAM") return <span className="chip-blue">TEAM</span>;
  return <span className="chip-gray">GROUP</span>;
}

function humanSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/* =============== API 명세 =============== */
function ApiSpecPanel() {
  const [routes, setRoutes] = useState<ApiSpecRoute[]>([]);
  const [baseUrl, setBaseUrl] = useState("");
  const [q, setQ] = useState("");
  const [authFilter, setAuthFilter] = useState<"" | ApiSpecRoute["auth"]>("");
  const [methodFilter, setMethodFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => {
    api<{ baseUrl: string; routes: ApiSpecRoute[]; total: number }>("/api/admin/api-spec")
      .then((r) => {
        if (!aliveRef.current) return;
        setRoutes(r.routes);
        setBaseUrl(r.baseUrl ?? "");
      })
      .catch((e) => { if (aliveRef.current) setErr(e?.message ?? "불러오기 실패"); })
      .finally(() => { if (aliveRef.current) setLoading(false); });
  }, []);

  const grouped = useMemo(() => {
    const filtered = routes.filter((r) => {
      if (authFilter && r.auth !== authFilter) return false;
      if (methodFilter && r.method !== methodFilter) return false;
      if (q) {
        const k = q.toLowerCase();
        if (!r.path.toLowerCase().includes(k) && !r.method.toLowerCase().includes(k)) return false;
      }
      return true;
    });
    const map = new Map<string, ApiSpecRoute[]>();
    for (const r of filtered) {
      const segs = r.path.split("/").filter(Boolean);
      const key = segs.length >= 2 ? `/${segs[0]}/${segs[1]}` : `/${segs[0] ?? ""}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [routes, q, authFilter, methodFilter]);

  if (loading) return <div className="panel p-8 text-center text-ink-500 text-[13px]">불러오는 중…</div>;
  if (err) return <div className="panel p-6 text-red-600 text-[13px]">{err}</div>;

  const totalShown = grouped.reduce((acc, [, list]) => acc + list.length, 0);

  return (
    <div>
      {/* Base URL — 모든 호출 앞에 붙는 절대 호스트. 프록시 환경 X-Forwarded-Host 도 반영. */}
      {baseUrl && (
        <div className="panel p-3 mb-3 flex items-center gap-3 flex-wrap">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-ink-500">Base URL</span>
          <code className="text-[13px] font-mono text-ink-900 flex-1 min-w-0 break-all">{baseUrl}</code>
          <button
            type="button"
            className="btn-ghost btn-xs"
            onClick={() => navigator.clipboard?.writeText(baseUrl).catch(() => {})}
          >
            복사
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input
          className="input flex-1 min-w-[220px]"
          placeholder="path 또는 method 검색 — 예: /chat, GET"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="input !w-auto" value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}>
          <option value="">메소드 전체</option>
          {["GET", "POST", "PATCH", "PUT", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className="input !w-auto" value={authFilter} onChange={(e) => setAuthFilter(e.target.value as any)}>
          <option value="">권한 전체</option>
          <option value="PUBLIC">PUBLIC</option>
          <option value="AUTH">AUTH</option>
          <option value="ADMIN">ADMIN</option>
          <option value="SUPER">SUPER</option>
        </select>
        <div className="text-[11px] text-ink-500">
          총 <b className="text-ink-800">{routes.length}</b> 개 · 표시 <b className="text-ink-800">{totalShown}</b>
        </div>
      </div>

      {grouped.length === 0 ? (
        <div className="panel p-10 text-center text-ink-500 text-[13px]">조건에 맞는 라우트가 없어요</div>
      ) : (
        <div className="space-y-3">
          {grouped.map(([groupKey, list]) => (
            <div key={groupKey} className="panel p-0 overflow-hidden">
              <div className="px-3 py-2 bg-ink-25 border-b border-ink-150 flex items-center justify-between">
                <div className="text-[12.5px] font-bold text-ink-800 font-mono">{groupKey}</div>
                <div className="text-[11px] text-ink-500">{list.length}개</div>
              </div>
              <ul className="divide-y divide-ink-100">
                {list.map((r) => {
                  const k = `${r.method} ${r.path}`;
                  const open = openKey === k;
                  return (
                    <li key={k}>
                      <button
                        type="button"
                        onClick={() => setOpenKey(open ? null : k)}
                        className="w-full px-3 py-2 flex items-center gap-3 text-left hover:bg-ink-25"
                      >
                        <MethodChip method={r.method} />
                        <code className="flex-1 min-w-0 text-[12.5px] font-mono text-ink-900 truncate">{r.path}</code>
                        <AuthChip auth={r.auth} />
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{ color: "var(--c-text-3)", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }}
                          aria-hidden
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                      {open && <ApiSpecRouteDetail r={r} baseUrl={baseUrl} />}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ApiSpecRouteDetail({ r, baseUrl }: { r: ApiSpecRoute; baseUrl: string }) {
  // 경로 파라미터 자리에 placeholder 가 들어간 예시 URL.
  const samplePath = r.pathParams.reduce(
    (acc, p) => acc.replace(`:${p}`, `<${p}>`),
    r.path,
  );
  const fullUrl = baseUrl + samplePath;
  const curl = buildCurl(r, fullUrl);

  return (
    <div className="px-4 py-3 bg-ink-25 border-t border-ink-100 space-y-3">
      {/* URL */}
      <Field label="Full URL">
        <code className="text-[12.5px] font-mono text-ink-900 break-all">{fullUrl}</code>
      </Field>

      {/* Path params */}
      {r.pathParams.length > 0 && (
        <Field label="Path Params">
          <ul className="text-[12.5px] font-mono text-ink-900 space-y-1">
            {r.pathParams.map((p) => (
              <li key={p} className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[11.5px] font-bold">
                  :{p}
                </span>
                <span className="text-ink-500 text-[11.5px]">— 라우트 핸들러 코드 참고 (cuid / 숫자 / 문자 등)</span>
              </li>
            ))}
          </ul>
        </Field>
      )}

      {/* Headers */}
      <Field label="Required Headers">
        {r.headers.length === 0 ? (
          <div className="text-[12px] text-ink-500">없음 (인증 불필요, body 없음)</div>
        ) : (
          <ul className="text-[12px] space-y-1">
            {r.headers.map((h, i) => (
              <li key={i} className="flex items-center gap-2 font-mono">
                <span className="text-ink-700 font-bold">{h.name}:</span>
                <span className="text-ink-600">{h.value}</span>
                {h.required && <span className="text-[10px] text-amber-700 font-bold ml-1">required</span>}
              </li>
            ))}
          </ul>
        )}
      </Field>

      {/* Body */}
      <Field label="Body">
        {r.hasBody ? (
          <div className="text-[12px] text-ink-600">
            JSON. 정확한 스키마는 라우트 핸들러의 <code className="font-mono text-ink-800">zod</code> 검증 참고.
            <br />
            전형적 예: <code className="font-mono text-ink-800">{`{ "field": "value" }`}</code>
          </div>
        ) : (
          <div className="text-[12px] text-ink-500">없음</div>
        )}
      </Field>

      {/* Middlewares */}
      {r.middlewares.length > 0 && (
        <Field label="Middleware Chain">
          <div className="text-[11.5px] font-mono text-ink-700">
            {r.middlewares.join(" → ")}
          </div>
        </Field>
      )}

      {/* cURL */}
      <Field label="cURL 예시">
        <pre className="text-[11.5px] font-mono text-ink-900 bg-white border border-ink-150 rounded-md p-2.5 overflow-x-auto whitespace-pre">
{curl}
        </pre>
        <button
          type="button"
          className="btn-ghost btn-xs mt-1"
          onClick={() => navigator.clipboard?.writeText(curl).catch(() => {})}
        >
          복사
        </button>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-ink-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

function buildCurl(r: ApiSpecRoute, fullUrl: string): string {
  const lines: string[] = [];
  lines.push(`curl -X ${r.method} '${fullUrl}'`);
  for (const h of r.headers) {
    lines.push(`  -H '${h.name}: ${h.value}'`);
  }
  if (r.hasBody) {
    lines.push(`  -d '{"key":"value"}'`);
  }
  return lines.join(" \\\n");
}

function MethodChip({ method }: { method: string }) {
  const tone =
    method === "GET" ? "chip-blue"
    : method === "POST" ? "chip-green"
    : method === "PATCH" || method === "PUT" ? "chip-amber"
    : method === "DELETE" ? "chip-red"
    : "chip-gray";
  return <span className={`chip ${tone} font-mono`} style={{ minWidth: 56, justifyContent: "center" }}>{method}</span>;
}

/* =============== 콘솔 — 명령어로 권한·계정 제어 =============== */
type ConsoleEntry =
  | { kind: "input"; text: string; ts: number }
  | { kind: "output"; text: string; ok: boolean; ts: number };

/** 명령어 트리 — 토큰 위치별로 다음에 올 수 있는 후보. 'arg:user' 같이 prefix 가
 *  arg: 인 항목은 정적 후보가 아니라 동적 fetch 컨텍스트 (서버 자동완성). */
const CMD_TREE: Record<string, any> = {
  help: {},
  "?": {},
  whoami: {},
  clear: {},
  cls: {},
  users: { list: { "arg:limit": {} }, find: { "arg:query": {} }, devs: {} },
  user: {
    info: { "arg:user": {} },
    role: { "arg:user": { MEMBER: {}, MANAGER: {}, ADMIN: {} } },
    grant: { admin: { "arg:user": {} }, super: { "arg:user": {} }, dev: { "arg:user": {} }, developer: { "arg:user": {} } },
    revoke: { admin: { "arg:user": {} }, super: { "arg:user": {} }, dev: { "arg:user": {} }, developer: { "arg:user": {} } },
    lock: { "arg:user": {} },
    unlock: { "arg:user": {} },
    resign: { "arg:user": { "arg:date": {} } },
    "reset-pw": { "arg:user": {} },
    team: { "arg:user": { "arg:team": {} } },
    position: { "arg:user": { "arg:position": {} } },
    impersonate: { "arg:user": {} },
  },
  imp: { "arg:user": {} },
  unimp: {},
  rooms: { list: { "arg:limit": {} } },
  room: { info: { "arg:roomId": {} } },
  notice: { broadcast: { "arg:text": {} } },
  system: { stats: {} },
  audit: { recent: { "arg:limit": {} } },
  cache: { evict: { user: { "arg:user": {} } } },
};

type Suggestion = {
  /** 화면에 보일 라벨 */
  label: string;
  /** 입력에 삽입될 토큰 */
  insert: string;
  /** 보조 정보 우측 노출 */
  hint?: string;
};

type CompCtx =
  | { kind: "static"; tokens: string[] } // 트리에 박힌 정적 토큰 후보
  | { kind: "user" }
  | { kind: "team" }
  | { kind: "position" };

/** input + 커서 위치를 보고 현재 토큰 + 다음 후보 컨텍스트를 결정. */
function resolveCompletion(
  input: string,
  cursor: number,
): { ctx: CompCtx; tokenStart: number; tokenEnd: number; query: string } | null {
  // 토큰 = 공백으로 잘랐을 때의 단어 단위.
  const before = input.slice(0, cursor);
  // 커서 직전 토큰 위치.
  let s = cursor;
  while (s > 0 && !/\s/.test(input[s - 1])) s--;
  const currentToken = input.slice(s, cursor);
  const completed = before.slice(0, s).trim();
  const completedTokens = completed ? completed.split(/\s+/) : [];

  // 트리를 따라 들어감.
  let node: any = CMD_TREE;
  let lostInTree = false; // 도중에 모르는 토큰이 나오면 마킹 — @ 는 그래도 user 로 살림.
  for (const t of completedTokens) {
    // 동적 arg: 자식이면 그 자식 노드의 자식 단계로 진입 (값은 무시하고 트리만 한 칸 깊게).
    const argKey = Object.keys(node).find((k) => k.startsWith("arg:"));
    if (node[t] !== undefined) {
      node = node[t];
    } else if (argKey) {
      node = node[argKey];
    } else {
      // 알 수 없는 토큰 — Tab 정적 후보는 의미 없지만 @ 는 살려둠.
      lostInTree = true;
      break;
    }
    if (!node || typeof node !== "object") {
      lostInTree = true;
      break;
    }
  }

  // 현재 토큰이 @ 로 시작하면 동적 컨텍스트(user/team/position) 강제.
  const atMatch = currentToken.startsWith("@");
  if (atMatch) {
    // 트리에서 길을 잃었으면 user 기본값으로 fallback — \"비싼 호출\" 아니므로 관대하게.
    if (lostInTree) {
      return {
        ctx: { kind: "user" },
        tokenStart: s,
        tokenEnd: cursor,
        query: currentToken.slice(1),
      };
    }
    // 트리에서 arg:user|arg:team|arg:position 자식이 있는지 보고 그 컨텍스트 사용.
    const argKey = Object.keys(node).find((k) => k.startsWith("arg:"));
    let kind: CompCtx["kind"] = "user";
    if (argKey === "arg:team") kind = "team";
    else if (argKey === "arg:position") kind = "position";
    else if (argKey === "arg:user") kind = "user";
    else if (!argKey) kind = "user"; // 기본은 user (가장 자주 쓰이는 시나리오)
    return {
      ctx: { kind },
      tokenStart: s,
      tokenEnd: cursor,
      query: currentToken.slice(1),
    };
  }

  // 트리에서 길 잃음 + @ 가 아닌 경우 — Tab 후보는 줄 게 없음.
  if (lostInTree) return null;

  // 정적 후보 (Tab 완성).
  const keys = Object.keys(node);
  const staticKeys = keys.filter((k) => !k.startsWith("arg:"));
  // 동적 자식이 있으면 — 컨텍스트도 같이 후보로 노출.
  const argKey = keys.find((k) => k.startsWith("arg:"));
  if (staticKeys.length > 0) {
    return {
      ctx: { kind: "static", tokens: staticKeys },
      tokenStart: s,
      tokenEnd: cursor,
      query: currentToken,
    };
  }
  if (argKey === "arg:user") return { ctx: { kind: "user" }, tokenStart: s, tokenEnd: cursor, query: currentToken };
  if (argKey === "arg:team") return { ctx: { kind: "team" }, tokenStart: s, tokenEnd: cursor, query: currentToken };
  if (argKey === "arg:position") return { ctx: { kind: "position" }, tokenStart: s, tokenEnd: cursor, query: currentToken };
  return null;
}

function ConsolePanel() {
  const [history, setHistory] = useState<ConsoleEntry[]>(() => [
    {
      kind: "output",
      ok: true,
      ts: Date.now(),
      text:
        "개발자 콘솔. `help` 로 사용법.\n" +
        "Tab — 명령어 자동완성, @ — 유저/팀/직급 자동완성.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const compRef = useRef<{ tokenStart: number; tokenEnd: number } | null>(null);
  const fetchSeq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // 위/아래 화살표로 이전 명령 재호출 (자동완성 닫혀있을 때만).
  const cmdHistRef = useRef<string[]>([]);
  const cmdHistIdxRef = useRef(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  // 출력이 추가되면 항상 최하단으로.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history]);

  /** input 또는 cursor 가 바뀔 때 동적 컨텍스트(@) 면 자동으로 fetch. */
  async function recomputeOpen() {
    const el = inputRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? el.value.length;
    const r = resolveCompletion(input, cursor);
    if (!r) {
      setOpen(false);
      setSuggestions([]);
      compRef.current = null;
      return;
    }
    compRef.current = { tokenStart: r.tokenStart, tokenEnd: r.tokenEnd };
    if (r.ctx.kind === "static") {
      // @ 가 아닌 경우엔 Tab 누를 때만 메뉴 노출. 자동 표시는 안 함.
      if (input.slice(r.tokenStart, r.tokenEnd).startsWith("@")) {
        // 도달 안 함, 안전망
      }
      // 자동 노출 X
      setOpen(false);
      return;
    }
    // 동적 컨텍스트 — @ 토큰일 때만 자동 fetch + 표시.
    const isAt = input.slice(r.tokenStart, r.tokenEnd).startsWith("@");
    if (!isAt) {
      setOpen(false);
      return;
    }
    const seq = ++fetchSeq.current;
    try {
      const res = await api<{ items: any[] }>(
        `/api/admin/console/complete?ctx=${r.ctx.kind}&q=${encodeURIComponent(r.query)}&limit=10`,
      );
      if (seq !== fetchSeq.current) return;
      const items: Suggestion[] = (res.items ?? []).map((it) => {
        if (r.ctx.kind === "user") {
          // 이름·이메일 어느 쪽이라도 비어있을 수 있어 안전한 라벨 조합.
          const name = String(it?.name ?? "(이름없음)");
          const email = String(it?.email ?? "");
          const team = it?.team ? ` · ${it.team}` : "";
          const role = String(it?.role ?? "");
          return {
            label: `${name}${email ? ` · ${email}` : ""}${team}`,
            insert: String(it?.id ?? ""),
            hint: role + (it?.active === false ? " (비활성)" : ""),
          };
        }
        const value = String(it?.value ?? "");
        return { label: value, insert: /\s/.test(value) ? `"${value}"` : value };
      });
      setSuggestions(items);
      setActive(0);
      setOpen(items.length > 0);
      if (items.length === 0) {
        // 매치 없음을 사용자에게 작게 알려주는 placeholder. 직접 history 에 흐름 끊지 않도록 표시만.
      }
    } catch (e: any) {
      // 종전엔 catch{} 무음 — 401/500 시 사용자가 \"왜 안 뜨지\" 알 길 없었음. 콘솔에 한 줄 박고
      // 401(Super stepup 만료) 의 경우엔 history 에도 안내해서 재인증 유도.
      // eslint-disable-next-line no-console
      console.warn("[console] 자동완성 실패:", e?.status, e?.message);
      setOpen(false);
      if (e?.status === 401) {
        setHistory((h) => [
          ...h,
          {
            kind: "output",
            ok: false,
            ts: Date.now(),
            text: "자동완성 실패 — 개발자 세션이 만료된 것 같아요. 페이지 새로고침 후 다시 진입해 주세요.",
          },
        ]);
      }
    }
  }

  // 입력 변할 때마다 컨텍스트 재계산. @ 면 자동으로 fetch+open.
  useEffect(() => {
    void recomputeOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  async function execute(raw: string) {
    const cmd = raw.trim();
    if (!cmd) return;
    cmdHistRef.current.push(cmd);
    cmdHistIdxRef.current = cmdHistRef.current.length;
    setHistory((h) => [...h, { kind: "input", text: cmd, ts: Date.now() }]);
    if (cmd === "clear" || cmd === "cls") {
      setHistory([]);
      return;
    }
    // 비공개 명령 — 콘솔에서만 알 수 있는 escape hatch. 부모 컴포넌트가 이 이벤트를
    // 받아 암호 모달을 띄움. 서버로 안 보냄.
    if (/^chat\s+log\s*$/i.test(cmd)) {
      window.dispatchEvent(new Event("hinest:chatAuditPrompt"));
      setHistory((h) => [
        ...h,
        { kind: "output", ok: true, text: "사내톡 감사 접근 — 암호 입력창을 띄웠어요.", ts: Date.now() },
      ]);
      return;
    }
    // 즉시 잠금 — 30분 만료 안 기다리고 곧장 OFF.
    if (/^chat\s+lock\s*$/i.test(cmd)) {
      window.dispatchEvent(new Event("hinest:chatAuditLock"));
      setHistory((h) => [
        ...h,
        { kind: "output", ok: true, text: "사내톡 감사 즉시 잠금됨.", ts: Date.now() },
      ]);
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; output: string }>("/api/admin/console", {
        method: "POST",
        json: { cmd },
      });
      if (!aliveRef.current) return;
      setHistory((h) => [...h, { kind: "output", ok: r.ok, text: r.output, ts: Date.now() }]);
    } catch (e: any) {
      if (!aliveRef.current) return;
      setHistory((h) => [...h, { kind: "output", ok: false, text: `요청 실패: ${e?.message ?? "unknown"}`, ts: Date.now() }]);
    } finally {
      if (aliveRef.current) {
        setBusy(false);
        // disabled 가 풀린 직후 포커스 복구 — busy 동안 input 이 disabled 라 포커스가 빠지므로
        // 다음 페인트 사이클에서 다시 잡아줘야 사용자가 곧장 다음 명령을 칠 수 있음.
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
  }

  function applySuggestion(s: Suggestion) {
    const range = compRef.current;
    if (!range) return;
    const next = input.slice(0, range.tokenStart) + s.insert + " " + input.slice(range.tokenEnd);
    setInput(next);
    setOpen(false);
    setSuggestions([]);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      const pos = range.tokenStart + s.insert.length + 1;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  /** Tab 핸들러 — 정적/동적 후보를 즉석에서 만들어 노출. 후보 1개면 곧장 삽입. */
  async function handleTab() {
    const el = inputRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? el.value.length;
    const r = resolveCompletion(input, cursor);
    if (!r) return;
    compRef.current = { tokenStart: r.tokenStart, tokenEnd: r.tokenEnd };
    let items: Suggestion[] = [];
    if (r.ctx.kind === "static") {
      const q = r.query.toLowerCase();
      items = r.ctx.tokens
        .filter((t) => !q || t.toLowerCase().startsWith(q))
        .map((t) => ({ label: t, insert: t }));
    } else {
      try {
        const res = await api<{ items: any[] }>(
          `/api/admin/console/complete?ctx=${r.ctx.kind}&q=${encodeURIComponent(r.query)}&limit=10`,
        );
        items = (res.items ?? []).map((it) => {
          if (r.ctx.kind === "user") {
            const name = String(it?.name ?? "(이름없음)");
            const email = String(it?.email ?? "");
            const team = it?.team ? ` · ${it.team}` : "";
            return {
              label: `${name}${email ? ` · ${email}` : ""}${team}`,
              insert: String(it?.id ?? ""),
              hint: String(it?.role ?? "") + (it?.active === false ? " (비활성)" : ""),
            };
          }
          const value = String(it?.value ?? "");
          return { label: value, insert: /\s/.test(value) ? `"${value}"` : value };
        });
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.warn("[console] Tab 자동완성 실패:", e?.status, e?.message);
        if (e?.status === 401) {
          setHistory((h) => [
            ...h,
            {
              kind: "output",
              ok: false,
              ts: Date.now(),
              text: "자동완성 실패 — 개발자 세션이 만료된 것 같아요. 페이지 새로고침 후 다시 진입해 주세요.",
            },
          ]);
        }
        items = [];
      }
    }
    if (items.length === 0) return;
    if (items.length === 1) {
      applySuggestion(items[0]);
      return;
    }
    setSuggestions(items);
    setActive(0);
    setOpen(true);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Tab — 자동완성 트리거.
    if (e.key === "Tab") {
      e.preventDefault();
      void handleTab();
      return;
    }
    // 메뉴 열려있을 때 ↑↓/Enter/Esc 가 메뉴를 우선.
    if (open && suggestions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % suggestions.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); applySuggestion(suggestions[active]); return; }
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
    }
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const v = input;
      setInput("");
      void execute(v);
    } else if (e.key === "ArrowUp") {
      const list = cmdHistRef.current;
      if (list.length === 0) return;
      e.preventDefault();
      const next = Math.max(0, cmdHistIdxRef.current - 1);
      cmdHistIdxRef.current = next;
      setInput(list[next] ?? "");
    } else if (e.key === "ArrowDown") {
      const list = cmdHistRef.current;
      if (list.length === 0) return;
      e.preventDefault();
      const next = Math.min(list.length, cmdHistIdxRef.current + 1);
      cmdHistIdxRef.current = next;
      setInput(list[next] ?? "");
    }
  }

  const cmdCount = history.filter((h) => h.kind === "input").length;
  const t = useConsoleTheme();

  return (
    <div
      style={{
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: t.panelShadow,
        background: t.bg,
        color: t.textPrimary,
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        border: `1px solid ${t.border}`,
      }}
    >
      {/* macOS 스타일 타이틀 바 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          background: t.titleBarBg,
          borderBottom: `1px solid ${t.border}`,
          position: "relative",
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          <TrafficLight color="#FF5F57" />
          <TrafficLight color="#FEBC2E" />
          <TrafficLight color="#28C840" />
        </div>
        <div
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            color: t.titleBarText,
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: "0.04em",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          hinest — 개발자 콘솔
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10.5, color: t.textMuted, fontWeight: 600 }}>
            {cmdCount} cmd
          </span>
          <button
            type="button"
            onClick={() => setHistory([])}
            title="화면 비우기 (clear)"
            style={{
              background: t.buttonBg,
              border: `1px solid ${t.buttonBorder}`,
              color: t.titleBarText,
              fontSize: 10.5,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 6,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            clear
          </button>
        </div>
      </div>

      {/* 출력 영역 */}
      <div
        ref={scrollRef}
        style={{
          height: "min(60vh, 540px)",
          overflowY: "auto",
          padding: "14px 16px",
          fontSize: 12.5,
          lineHeight: 1.65,
          background: t.outputBg,
        }}
      >
        {history.map((h, i) => {
          if (h.kind === "input") {
            return (
              <div key={i} style={{ marginTop: i === 0 ? 0 : 12, display: "flex", gap: 8 }}>
                <Prompt ts={h.ts} theme={t} />
                <span style={{ color: t.userInput, whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1 }}>
                  {h.text}
                </span>
              </div>
            );
          }
          return (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 8,
                marginTop: 4,
                paddingLeft: 22,
                color: h.ok ? t.textPrimary : t.errorText,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                borderLeft: `2px solid ${h.ok ? t.okBorder : t.errorBorder}`,
                paddingTop: 1,
                paddingBottom: 1,
                marginLeft: 1,
              }}
            >
              <span style={{ color: h.ok ? t.ok : t.error, fontWeight: 800, flexShrink: 0, marginLeft: 8 }}>
                {h.ok ? "✓" : "✗"}
              </span>
              <span style={{ flex: 1 }}>{h.text}</span>
            </div>
          );
        })}
        {busy && (
          <div style={{ display: "flex", gap: 8, marginTop: 8, color: t.accent, alignItems: "center" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.accent, animation: "hinest-pulse 1s infinite" }} />
            실행 중…
          </div>
        )}
      </div>

      {/* 입력 영역 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderTop: `1px solid ${t.border}`,
          background: t.inputBarBg,
          position: "relative",
        }}
      >
        {open && suggestions.length > 0 && (
          <div
            style={{
              position: "absolute",
              left: 14,
              right: 14,
              bottom: "100%",
              marginBottom: 6,
              background: t.popoverBg,
              border: `1px solid ${t.popoverBorder}`,
              borderRadius: 10,
              boxShadow: t.popoverShadow,
              maxHeight: 240,
              overflowY: "auto",
              zIndex: 10,
              padding: 4,
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => applySuggestion(s)}
                onMouseEnter={() => setActive(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "7px 10px",
                  background: i === active ? t.suggestionActiveBg : "transparent",
                  border: 0,
                  borderRadius: 6,
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "inherit",
                  color: t.textPrimary,
                }}
              >
                <span style={{ color: i === active ? t.accent : t.textMuted, fontSize: 11, fontWeight: 700, width: 14 }}>
                  {i === active ? "▶" : ""}
                </span>
                <span style={{ fontSize: 12.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.label}
                </span>
                {s.hint && <span style={{ color: t.titleBarText, fontSize: 11 }}>{s.hint}</span>}
              </button>
            ))}
          </div>
        )}

        <PromptInline theme={t} />
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
          autoFocus
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="Tab 자동완성 · @ 유저/팀/직급 · help"
          style={{
            flex: 1,
            border: 0,
            outline: 0,
            background: "transparent",
            color: t.textPrimary,
            fontFamily: "inherit",
            fontSize: 13,
            padding: "4px 0",
            caretColor: t.accent,
          }}
        />
        <span
          style={{
            display: input || busy ? "none" : "inline-block",
            width: 8,
            height: 14,
            background: t.accent,
            animation: "hinest-blink 1s steps(2, start) infinite",
            borderRadius: 1,
            marginLeft: -4,
          }}
        />
      </div>

      <style>{`
        @keyframes hinest-blink { 50% { opacity: 0; } }
        @keyframes hinest-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.4); } }
      `}</style>
    </div>
  );
}

/** 콘솔 색상 팔레트 — 테마(라이트/다크)에 맞춰 한 번에 스위치. */
type ConsoleTheme = ReturnType<typeof buildConsoleTheme>;
function buildConsoleTheme(dark: boolean) {
  if (dark) {
    return {
      bg: "#0B0E14",
      titleBarBg: "linear-gradient(180deg, #1A1F2A 0%, #131722 100%)",
      titleBarText: "#7F8AA0",
      inputBarBg: "linear-gradient(180deg, #131722 0%, #0F131C 100%)",
      outputBg: "radial-gradient(ellipse at top, rgba(124,58,237,0.04) 0%, transparent 60%), #0B0E14",
      border: "#1F2733",
      textPrimary: "#D6DCE8",
      textMuted: "#5C6577",
      userInput: "#A8FFE0",
      accent: "#A78BFA",
      ok: "#22C55E",
      okBorder: "rgba(34,197,94,0.4)",
      error: "#F87171",
      errorText: "#FCA5A5",
      errorBorder: "rgba(248,113,113,0.5)",
      promptUser: "#22C55E",
      promptAt: "#7F8AA0",
      promptHost: "#7896FF",
      promptTime: "#7F8AA0",
      promptBracket: "#5C6577",
      buttonBg: "rgba(255,255,255,0.04)",
      buttonBorder: "rgba(255,255,255,0.08)",
      popoverBg: "#131722",
      popoverBorder: "#2A3344",
      popoverShadow: "0 12px 32px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.04) inset",
      suggestionActiveBg: "linear-gradient(90deg, rgba(124,58,237,0.18), rgba(124,58,237,0.04))",
      panelShadow: "0 20px 50px rgba(2, 6, 23, 0.45), 0 1px 0 rgba(255,255,255,0.04) inset",
    };
  }
  // Light theme — 톤은 macOS Terminal 의 "Basic" 라이트 프로파일 + Toss 톤 매칭
  return {
    bg: "#FCFBF9",
    titleBarBg: "linear-gradient(180deg, #F0EDE9 0%, #E6E2DC 100%)",
    titleBarText: "#6E7280",
    inputBarBg: "linear-gradient(180deg, #F4F2EE 0%, #ECE9E4 100%)",
    outputBg: "radial-gradient(ellipse at top, rgba(124,58,237,0.04) 0%, transparent 60%), #FCFBF9",
    border: "#D8D4CD",
    textPrimary: "#1F2937",
    textMuted: "#9CA3AF",
    userInput: "#047857",
    accent: "#7C3AED",
    ok: "#16A34A",
    okBorder: "rgba(22,163,74,0.35)",
    error: "#DC2626",
    errorText: "#B91C1C",
    errorBorder: "rgba(220,38,38,0.4)",
    promptUser: "#16A34A",
    promptAt: "#9CA3AF",
    promptHost: "#3B5CF0",
    promptTime: "#9CA3AF",
    promptBracket: "#A8B1C2",
    buttonBg: "rgba(15,23,42,0.04)",
    buttonBorder: "rgba(15,23,42,0.08)",
    popoverBg: "#FFFFFF",
    popoverBorder: "#D8D4CD",
    popoverShadow: "0 12px 32px rgba(15,23,42,0.12), 0 1px 0 rgba(255,255,255,0.6) inset",
    suggestionActiveBg: "linear-gradient(90deg, rgba(124,58,237,0.10), rgba(124,58,237,0.02))",
    panelShadow: "0 12px 30px rgba(15,23,42,0.10), 0 1px 0 rgba(255,255,255,0.6) inset",
  };
}
function useConsoleTheme(): ConsoleTheme {
  const { resolved } = useTheme();
  return useMemo(() => buildConsoleTheme(resolved === "dark"), [resolved]);
}

/** 서버 로그 패널 팔레트 — 콘솔과 톤 통일하되 줄 수가 많아 더 차분한 톤. */
function buildLogsTheme(dark: boolean) {
  if (dark) {
    return {
      bg: "#0E1014",
      border: "var(--c-border)",
      textPrimary: "#D4D8DE",
      textMuted: "#7F8792",
      levelInfo:  "#86EFAC", // soft green
      levelHttp:  "#7896FF", // soft blue
      levelWarn:  "#FCD34D", // soft amber
      levelError: "#FCA5A5", // soft red
    };
  }
  return {
    bg: "#FCFBF9",
    border: "var(--c-border)",
    textPrimary: "#1F2937",
    textMuted: "#9CA3AF",
    levelInfo:  "#15803D", // deeper green — 라이트 배경에서 대비 확보
    levelHttp:  "#1D4ED8", // deep blue
    levelWarn:  "#B45309", // deep amber
    levelError: "#B91C1C", // deep red
  };
}
function useLogsTheme() {
  const { resolved } = useTheme();
  return useMemo(() => buildLogsTheme(resolved === "dark"), [resolved]);
}

function TrafficLight({ color }: { color: string }) {
  return (
    <span
      style={{
        width: 12,
        height: 12,
        borderRadius: "50%",
        background: color,
        boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.2)",
      }}
    />
  );
}

function Prompt({ ts, theme }: { ts: number; theme: ConsoleTheme }) {
  const t = new Date(ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <span style={{ color: theme.promptBracket, fontSize: 11.5, flexShrink: 0, fontWeight: 600, paddingTop: 2 }}>
      <span style={{ color: theme.promptTime }}>[{t}]</span>{" "}
      <span style={{ color: theme.promptUser }}>dev</span>
      <span style={{ color: theme.promptAt }}>@</span>
      <span style={{ color: theme.promptHost }}>hinest</span>
      <span style={{ color: theme.accent, marginLeft: 2 }}>$</span>
    </span>
  );
}

function PromptInline({ theme }: { theme: ConsoleTheme }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 0, fontSize: 12.5, fontWeight: 700, flexShrink: 0 }}>
      <span style={{ color: theme.promptUser }}>dev</span>
      <span style={{ color: theme.promptAt }}>@</span>
      <span style={{ color: theme.promptHost }}>hinest</span>
      <span style={{ color: theme.accent, marginLeft: 4 }}>❯</span>
    </span>
  );
}

/* =============== 서버 로그 — 인메모리 버퍼 폴링 =============== */
type LogLevel = "info" | "warn" | "error" | "http";
type ServerLog = { ts: number; level: LogLevel; msg: string };

function ServerLogsPanel() {
  const [logs, setLogs] = useState<ServerLog[]>([]);
  const [level, setLevel] = useState<"" | LogLevel>("");
  const [q, setQ] = useState("");
  const [follow, setFollow] = useState(true);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const aliveRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const t = useLogsTheme();

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  async function load() {
    try {
      const params = new URLSearchParams();
      if (level) params.set("level", level);
      if (q) params.set("q", q);
      params.set("limit", "9999");
      const r = await api<{ logs: ServerLog[] }>(`/api/admin/server-logs?${params}`);
      if (!aliveRef.current) return;
      setLogs(r.logs);
      setLoading(false);
    } catch (e: any) {
      if (!aliveRef.current) return;
      setErr(e?.message ?? "불러오기 실패");
      setLoading(false);
    }
  }

  // 검색·레벨 변경 시 즉시 reload, follow 켜져 있으면 자동 갱신.
  // 비용 절감:
  //   - 3초 → 5초. 운영자가 실시간 디버깅할 때 5초면 충분, 시간당 요청 수 1200 → 720.
  //   - 탭 hidden 이거나 follow off 면 폴링 정지.
  useEffect(() => {
    void load();
    if (!follow) return;
    let id: number | null = null;
    function start() { if (id === null) id = window.setInterval(load, 5000); }
    function stop() { if (id !== null) { window.clearInterval(id); id = null; } }
    if (document.visibilityState === "visible") start();
    function onVis() {
      if (document.visibilityState === "visible") { void load(); start(); }
      else { stop(); }
    }
    document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, q, follow]);

  // follow 켜져 있고 새 로그가 들어오면 자동으로 최하단 스크롤.
  useEffect(() => {
    if (!follow) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs, follow]);

  if (loading) return <div className="panel p-8 text-center text-ink-500 text-[13px]">불러오는 중…</div>;
  if (err) return <div className="panel p-6 text-red-600 text-[13px]">{err}</div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input
          className="input flex-1 min-w-[220px]"
          placeholder="로그 본문 검색 — 예: error, /api/chat"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="input !w-auto" value={level} onChange={(e) => setLevel(e.target.value as any)}>
          <option value="">레벨 전체</option>
          <option value="http">HTTP</option>
          <option value="info">INFO</option>
          <option value="warn">WARN</option>
          <option value="error">ERROR</option>
        </select>
        <label className="flex items-center gap-1.5 text-[12px] text-ink-700 cursor-pointer">
          <input
            type="checkbox"
            className="accent-brand-500"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />
          자동 갱신 (3초)
        </label>
        <button className="btn-ghost btn-xs" onClick={() => load()}>새로고침</button>
        <div className="text-[11px] text-ink-500">{logs.length}건</div>
      </div>

      <div
        ref={scrollRef}
        style={{
          background: t.bg,
          color: t.textPrimary,
          borderRadius: 12,
          border: `1px solid ${t.border}`,
          padding: "10px 12px",
          height: "min(64vh, 580px)",
          overflowY: "auto",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 12,
          lineHeight: 1.55,
        }}
      >
        {logs.length === 0 ? (
          <div style={{ color: t.textMuted, textAlign: "center", padding: 32 }}>
            아직 로그가 없어요. 프로세스 재기동 후 새로 쌓인 줄만 보여요.
          </div>
        ) : (
          logs.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              <span style={{ color: t.textMuted, flexShrink: 0 }}>
                {new Date(l.ts).toISOString().slice(11, 23)}
              </span>
              <span
                style={{
                  flexShrink: 0,
                  fontWeight: 700,
                  width: 50,
                  color:
                    l.level === "error" ? t.levelError
                    : l.level === "warn" ? t.levelWarn
                    : l.level === "http" ? t.levelHttp
                    : t.levelInfo,
                }}
              >
                {l.level.toUpperCase()}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>{l.msg}</span>
            </div>
          ))
        )}
      </div>
      <div className="text-[11px] text-ink-500 mt-2">
        프로세스 재기동(배포 등) 시 버퍼 초기화. 디스크/CloudWatch 영속화 없음 — 최근 9,999줄만 메모리에 보관.
      </div>
    </div>
  );
}

/* =============== 메뉴 가시성 — 사이드바 항목 켜고 끄기 =============== */
// AppLayout 의 NAV 그룹과 동일한 path/label 매핑.
const NAV_GROUPS: { label: string; items: { to: string; label: string }[] }[] = [
  {
    label: "워크스페이스",
    items: [
      { to: "/", label: "개요" },
      { to: "/schedule", label: "일정" },
      { to: "/attendance", label: "근태·월차" },
      { to: "/journal", label: "업무일지" },
      { to: "/meetings", label: "회의록" },
      { to: "/approvals", label: "전자결재" },
    ],
  },
  {
    label: "커뮤니케이션",
    items: [
      { to: "/notice", label: "공지사항" },
      { to: "/directory", label: "팀원" },
      { to: "/org", label: "조직도" },
    ],
  },
  {
    label: "자료·재무",
    items: [
      { to: "/documents", label: "문서함" },
      { to: "/expense", label: "법인카드" },
      { to: "/accounts", label: "계정 관리" },
      { to: "/snippets", label: "스니펫" },
    ],
  },
];

type NavConfigRow = { path: string; enabled: boolean; inDev?: boolean; updatedAt: string; updatedBy?: string | null };
type NavStatus = "ON" | "DEV" | "OFF";

function NavStatusGroup({ value, saving, onChange }: { value: NavStatus; saving: boolean; onChange: (s: NavStatus) => void }) {
  const opts: { v: NavStatus; label: string; color: string }[] = [
    { v: "ON", label: "활성", color: "var(--c-brand)" },
    { v: "DEV", label: "개발중", color: "var(--c-warning)" },
    { v: "OFF", label: "끔", color: "var(--c-border-strong)" },
  ];
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--c-surface-3)",
        borderRadius: 8,
        padding: 2,
        gap: 2,
        flexShrink: 0,
        opacity: saving ? 0.6 : 1,
      }}
    >
      {opts.map((o) => {
        const active = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            disabled={saving}
            onClick={() => onChange(o.v)}
            style={{
              padding: "5px 10px",
              borderRadius: 6,
              border: 0,
              cursor: "pointer",
              fontSize: 11.5,
              fontWeight: 700,
              background: active ? o.color : "transparent",
              color: active ? "#fff" : "var(--c-text-2)",
              transition: "background .15s ease",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function NavVisibilityPanel() {
  const [items, setItems] = useState<NavConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  async function load() {
    try {
      const r = await api<{ items: NavConfigRow[] }>("/api/admin/nav-visibility");
      if (!aliveRef.current) return;
      setItems(r.items);
      setLoading(false);
    } catch (e: any) {
      if (!aliveRef.current) return;
      setErr(e?.message ?? "불러오기 실패");
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function statusOf(path: string): NavStatus {
    const r = items.find((x) => x.path === path);
    if (!r) return "ON"; // 행 없으면 기본값
    if (!r.enabled) return "OFF";
    if (r.inDev) return "DEV";
    return "ON";
  }

  async function setStatus(path: string, next: NavStatus) {
    setSaving(path);
    try {
      const body =
        next === "ON" ? { path, enabled: true, inDev: false }
        : next === "DEV" ? { path, enabled: true, inDev: true }
        : { path, enabled: false, inDev: false };
      await api("/api/admin/nav-visibility", { method: "POST", json: body });
      // 낙관적 업데이트.
      setItems((prev) => {
        const exist = prev.find((r) => r.path === path);
        const merged = { ...(exist ?? { path, updatedAt: new Date().toISOString() }), enabled: body.enabled, inDev: body.inDev };
        return exist ? prev.map((r) => (r.path === path ? merged as NavConfigRow : r)) : [...prev, merged as NavConfigRow];
      });
      window.dispatchEvent(new Event("hinest:navVisibilityChange"));
    } catch (e: any) {
      alert(e?.message ?? "저장 실패");
    } finally {
      if (aliveRef.current) setSaving(null);
    }
  }

  if (loading) return <div className="panel p-8 text-center text-ink-500 text-[13px]">불러오는 중…</div>;
  if (err) return <div className="panel p-6 text-red-600 text-[13px]">{err}</div>;

  return (
    <div className="space-y-4">
      <div className="text-[12px] text-ink-500 leading-relaxed">
        <b className="text-ink-700">활성</b> — 사이드바 노출 + 정상 동작.
        &nbsp;<b className="text-amber-700">개발중</b> — 사이드바 노출 + 진입 시 \"개발 중\" 안내(개발자 권한 사용자는 통과).
        &nbsp;<b className="text-ink-700">끔</b> — 사이드바 숨김 + 라우트 차단.
      </div>
      {NAV_GROUPS.map((g) => (
        <div key={g.label} className="panel p-0 overflow-hidden">
          <div className="px-4 py-2 bg-ink-25 border-b border-ink-150 text-[12.5px] font-bold text-ink-800">
            {g.label}
          </div>
          <ul className="divide-y divide-ink-100">
            {g.items.map((it) => {
              const cur = statusOf(it.to);
              const isSaving = saving === it.to;
              return (
                <li key={it.to} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold text-ink-900">{it.label}</div>
                    <code className="text-[11px] text-ink-500 font-mono">{it.to}</code>
                  </div>
                  <NavStatusGroup
                    value={cur}
                    saving={isSaving}
                    onChange={(next) => setStatus(it.to, next)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function AuthChip({ auth }: { auth: ApiSpecRoute["auth"] }) {
  if (auth === "SUPER") return <span className="chip chip-violet">SUPER</span>;
  if (auth === "ADMIN") return <span className="chip chip-orange">ADMIN</span>;
  if (auth === "AUTH") return <span className="chip chip-gray">AUTH</span>;
  return <span className="chip" style={{ background: "transparent", color: "var(--c-text-3)", border: "1px dashed var(--c-border)" }}>PUBLIC</span>;
}
