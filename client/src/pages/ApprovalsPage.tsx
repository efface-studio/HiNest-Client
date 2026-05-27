import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import PageHeader from "../components/PageHeader";
import DateTimePicker from "../components/DateTimePicker";
import { alertAsync } from "../components/ConfirmHost";
import { isDevAccount, DevBadge } from "../lib/devBadge";
import { useApprovalCounts, refreshApprovalCounts } from "../lib/useApprovalCounts";

type ApprovalType = "TRIP" | "OFFSITE" | "EXPENSE" | "PURCHASE" | "GENERAL" | "OTHER";
type Step = {
  id: string;
  order: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "SKIPPED";
  comment?: string | null;
  actedAt?: string | null;
  reviewer: { id: string; name: string; avatarColor: string; avatarUrl?: string | null; position?: string | null };
};
type Approval = {
  id: string;
  type: ApprovalType;
  title: string;
  content?: string;
  data?: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELED";
  startDate?: string;
  endDate?: string;
  amount?: number;
  createdAt: string;
  requester: { id: string; name: string; avatarColor: string; avatarUrl?: string | null; position?: string; team?: string };
  steps: Step[];
  currentReviewerId?: string;
};

type DirUser = { id: string; name: string; email: string; team?: string; position?: string; avatarColor?: string; avatarUrl?: string | null };

type ApprovalComment = {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string; avatarColor: string; avatarUrl?: string | null };
};
type ApprovalRef = { id: string; title: string; status: Approval["status"]; createdAt: string };
type ApprovalFull = Approval & {
  revisedFromId?: string | null;
  revisedFrom?: ApprovalRef | null;
  revisions?: ApprovalRef[];
  comments?: ApprovalComment[];
};

// CreateModal 이 결재 재상신에도 재사용되도록 prefill 타입을 정리. 원본 결재를 그대로
// 카피하되 결재선은 자유롭게 다시 고를 수 있게 — 원본 결재선을 기본값으로 두긴 한다.
type CreatePrefill = {
  type?: ApprovalType;
  title?: string;
  content?: string;
  startDate?: string;
  endDate?: string;
  amount?: string;
  destination?: string;
  reviewerIds?: string[];
};

type ApprovalTemplate = {
  id: string;
  name: string;
  type: ApprovalType;
  scope: "ALL" | "TEAM" | "ME";
  scopeTeam?: string | null;
  body: {
    title?: string;
    content?: string;
    fields?: { destination?: string; amount?: number };
    defaultLine?: string[];
  };
  createdById: string;
};

type ApprovalLineFav = { id: string; name: string; reviewerIds: string[] };

const TYPE_META: Record<ApprovalType, { label: string; color: string; icon: JSX.Element }> = {
  TRIP:     { label: "출장 신청",   color: "#0EA5E9", icon: <IconSvg><><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" /></></IconSvg> },
  OFFSITE:  { label: "외근 신청",   color: "#16A34A", icon: <IconSvg><><rect x="2" y="8" width="16" height="8" rx="2" /><path d="M6 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><circle cx="6" cy="17" r="2" /><circle cx="14" cy="17" r="2" /></></IconSvg> },
  EXPENSE:  { label: "지출결의",    color: "#D97706", icon: <IconSvg><><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9 9h4.5a2 2 0 0 1 0 4H9a2 2 0 0 0 0 4h5" /></></IconSvg> },
  PURCHASE: { label: "구매 요청",   color: "#DC2626", icon: <IconSvg><><path d="M3 3h2l2 14h12l2-10H7" /><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /></></IconSvg> },
  GENERAL:  { label: "일반 품의",   color: "#3D54C4", icon: <IconSvg><><path d="M4 4h12l4 4v12H4z" /><path d="M14 4v5h5M8 12h8M8 16h6" /></></IconSvg> },
  OTHER:    { label: "기타",       color: "#6B7280", icon: <IconSvg><><circle cx="12" cy="12" r="9" /><path d="M8 12h8M12 8v8" /></></IconSvg> },
};

function IconSvg({ children }: { children: React.ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
  );
}

const STATUS_META: Record<Approval["status"], { label: string; chip: string }> = {
  PENDING:  { label: "진행 중",  chip: "chip-amber" },
  APPROVED: { label: "승인 완료", chip: "chip-green" },
  REJECTED: { label: "반려",     chip: "chip-red" },
  CANCELED: { label: "취소됨",    chip: "chip-gray" },
};

export default function ApprovalsPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // 새로고침해도 현재 탭 유지.
  const [sp, setSp] = useSearchParams();
  const scope = (sp.get("scope") === "pending" ? "pending" : "mine") as "mine" | "pending";
  const setScope = (s: "mine" | "pending") => {
    const next = new URLSearchParams(sp);
    if (s === "mine") next.delete("scope");
    else next.set("scope", s);
    setSp(next, { replace: true });
  };
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [selected, setSelected] = useState<Approval | null>(null);
  const [creating, setCreating] = useState(false);
  // 재상신 시에는 원본 id와 prefill 을 함께 넘겨 POST /:id/revise 로 라우팅.
  const [revising, setRevising] = useState<{ origId: string; prefill: CreatePrefill } | null>(null);
  const [directory, setDirectory] = useState<DirUser[]>([]);
  // 승인/반려/취소 버튼 연속 클릭 방지 — 네트워크 끊겨도 같은 요청이 2중 들어가면 결재선이 이상해짐.
  const [actingId, setActingId] = useState<string | null>(null);
  // 반려 사유 모달 — 기존에 window.prompt() 를 쓰다가 iOS Safari 에서 IME(한글) 입력이
  // 깨지고 긴 문장을 쓰기 어려워 모달로 교체. 사유가 비어 있어도 반려는 가능.
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState("");
  // 결재 취소 역시 window.confirm() 대신 모달로 — 모바일에서 네이티브 다이얼로그가
  // 뒤쪽 페이지를 가리거나 버튼 탭 타깃이 작은 문제 해결.
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  // 승인/반려/취소 직후 load() 가 또 돌 때 사용자가 빠르게 이탈하면 setState 누수.
  // scope 토글을 빠르게 눌러 응답이 거꾸로 도착해도 마지막 것만 반영.
  const aliveRef = useRef(true);
  const loadTokenRef = useRef(0);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  async function load() {
    const myToken = ++loadTokenRef.current;
    const res = await api<{ approvals: Approval[] }>(`/api/approval?scope=${scope}`);
    if (!aliveRef.current || myToken !== loadTokenRef.current) return;
    setApprovals(res.approvals);
    if (selected) {
      const fresh = res.approvals.find((a) => a.id === selected.id);
      if (fresh) setSelected(fresh);
    }
  }
  async function loadDirectory() {
    const res = await api<{ users: DirUser[] }>("/api/users");
    if (!aliveRef.current) return;
    setDirectory(res.users);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [scope]);
  useEffect(() => { loadDirectory(); }, []);

  // ?id=xxx 진입 시 자동 선택
  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    const id = qs.get("id");
    if (!id || approvals.length === 0) return;
    const m = approvals.find((a) => a.id === id);
    if (m) {
      setSelected(m);
      navigate("/approvals", { replace: true });
    }
    // eslint-disable-next-line
  }, [approvals, location.search]);

  async function act(id: string, action: "approve" | "reject") {
    if (actingId) return; // 이미 처리 중이면 무시
    // 반려는 사유 입력 모달을 거치도록 — act() 는 승인만 즉시 처리.
    if (action === "reject") {
      setRejectingId(id);
      setRejectComment("");
      return;
    }
    setActingId(id);
    try {
      const r = await api<{ approval: Approval }>(`/api/approval/${id}/act`, { method: "POST", json: { action } });
      // selected 가 \"승인/반려 후\" 상태로 즉시 반영되도록 응답값을 사용.
      // load() 가 새 목록을 가져와도 pending scope 에선 이 항목이 빠져있어 selected 갱신이 안 되는 문제 회피.
      if (r?.approval) setSelected(r.approval);
      refreshApprovalCounts();
      await load();
    } catch (err: any) {
      alertAsync({ title: "처리 실패", description: err?.message ?? "처리에 실패했어요" });
    } finally {
      setActingId(null);
    }
  }

  async function performReject() {
    const id = rejectingId;
    if (!id) return;
    setRejectingId(null);
    setActingId(id);
    try {
      const r = await api<{ approval: Approval }>(`/api/approval/${id}/act`, {
        method: "POST",
        json: { action: "reject", comment: rejectComment.trim() || undefined },
      });
      if (r?.approval) setSelected(r.approval);
      refreshApprovalCounts();
      await load();
    } catch (err: any) {
      alertAsync({ title: "반려 실패", description: err?.message ?? "반려에 실패했어요" });
    } finally {
      setActingId(null);
      setRejectComment("");
    }
  }

  function askCancel(id: string) {
    if (actingId) return;
    setCancelingId(id);
  }

  async function performCancel() {
    const id = cancelingId;
    if (!id) return;
    setCancelingId(null);
    setActingId(id);
    try {
      await api(`/api/approval/${id}/cancel`, { method: "POST" });
      await load();
    } catch (err: any) {
      alertAsync({ title: "취소 실패", description: err?.message ?? "취소에 실패했어요" });
    } finally {
      setActingId(null);
    }
  }

  // 탭 양쪽 다 표시되는 글로벌 카운터 — 현재 scope 와 무관하게 항상 보임.
  // useApprovalCounts 가 30s 폴링 + 가시성 복귀 시 즉시 새로고침.
  const counts = useApprovalCounts();

  return (
    <div>
      <PageHeader
        eyebrow="업무"
        title="전자결재"
        description="출장·외근·지출·구매 등 사내 결재를 한 곳에서 관리합니다."
        right={
          <>
            <div className="tabs flex-shrink-0">
              <button className={`tab ${scope === "mine" ? "tab-active" : ""}`} onClick={() => setScope("mine")}>
                내 신청 {counts.mine > 0 && <CountChip n={counts.mine} />}
              </button>
              <button className={`tab ${scope === "pending" ? "tab-active" : ""}`} onClick={() => setScope("pending")}>
                결재 대기 {counts.pending > 0 && <CountChip n={counts.pending} tone="danger" />}
              </button>
            </div>
            <button className="btn-primary" onClick={() => setCreating(true)}>+ 새 결재</button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2 panel p-0 overflow-hidden">
          <div className="section-head">
            <div className="title">{scope === "mine" ? "내 신청 목록" : "결재 대기"}</div>
            <span className="text-[11px] text-ink-400 tabular">{approvals.length}건</span>
          </div>
          <div className="divide-y divide-ink-100 max-h-[70vh] overflow-auto">
            {approvals.length === 0 && (
              <div className="py-14 text-center t-caption">해당 항목이 없습니다.</div>
            )}
            {approvals.map((a) => {
              const meta = TYPE_META[a.type];
              const smeta = STATUS_META[a.status];
              const mine = a.requester.id === user?.id;
              const myTurn = a.currentReviewerId === user?.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setSelected(a)}
                  className={`w-full text-left px-4 py-3 hover:bg-ink-25 flex items-start gap-3 ${selected?.id === a.id ? "bg-brand-50" : ""}`}
                >
                  <div className="w-9 h-9 rounded-lg grid place-items-center text-[15px] flex-shrink-0" style={{ background: meta.color + "1A", color: meta.color }}>
                    {meta.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-ink-600">{meta.label}</span>
                      <span className={smeta.chip}>{smeta.label}</span>
                      {myTurn && scope === "pending" && <span className="chip-red">내 차례</span>}
                    </div>
                    <div className="text-[13px] font-bold text-ink-900 truncate mt-0.5">{a.title}</div>
                    <div className="text-[11px] text-ink-500 tabular mt-0.5">
                      {mine ? "내가 요청" : a.requester.name} · {new Date(a.createdAt).toLocaleDateString("ko-KR")}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-3 panel p-0 overflow-hidden">
          {selected ? (
            <ApprovalDetail
              a={selected}
              meId={user?.id}
              onAct={act}
              onCancel={askCancel}
              busy={actingId === selected.id}
              onSelect={(id) => {
                const m = approvals.find((x) => x.id === id);
                if (m) setSelected(m);
                else {
                  // 체인상 다른 스코프의 결재일 수 있음 — 직접 조회해 띄움.
                  api<{ approval: Approval }>(`/api/approval/${id}`)
                    .then((r) => setSelected(r.approval))
                    .catch((e: any) => alertAsync({
                      title: "결재를 불러오지 못했어요",
                      description: e?.message ?? "권한이 없거나 삭제된 결재일 수 있어요.",
                    }));
                }
              }}
              onRevise={(origId, prefill) => setRevising({ origId, prefill })}
            />
          ) : (
            <div className="grid place-items-center h-[70vh]">
              <div className="text-center">
                <div className="mx-auto w-12 h-12 rounded-2xl bg-ink-100 grid place-items-center mb-3">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8E959E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
                  </svg>
                </div>
                <div className="text-[13px] font-bold text-ink-800">결재 항목을 선택하세요</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {creating && <CreateModal directory={directory} meId={user?.id} onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />}

      {revising && (
        <CreateModal
          directory={directory}
          meId={user?.id}
          reviseFromId={revising.origId}
          prefill={revising.prefill}
          onClose={() => setRevising(null)}
          onDone={(newId) => {
            setRevising(null);
            load().then(() => {
              if (newId) {
                api<{ approval: Approval }>(`/api/approval/${newId}`)
                  .then((r) => setSelected(r.approval))
                  .catch((e: any) => alertAsync({
                    title: "새 결재를 불러오지 못했어요",
                    description: e?.message ?? "목록에서 다시 선택해주세요.",
                  }));
              }
            });
          }}
        />
      )}

      {rejectingId && (
        <ConfirmModal
          title="반려 사유"
          description="반려 사유를 입력해주세요. (선택)"
          confirmLabel={actingId ? "처리 중…" : "반려"}
          confirmTone="danger"
          onCancel={() => { setRejectingId(null); setRejectComment(""); }}
          onConfirm={performReject}
          busy={!!actingId}
        >
          <textarea
            className="input"
            rows={3}
            autoFocus
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value.slice(0, 500))}
            placeholder="예: 예산 초과로 반려합니다"
          />
          <div className="text-[11px] text-ink-400 tabular mt-1 text-right">
            {rejectComment.length} / 500
          </div>
        </ConfirmModal>
      )}

      {cancelingId && (
        <ConfirmModal
          title="결재 취소"
          description="이 결재를 취소하시겠습니까? 취소된 결재는 다시 되돌릴 수 없습니다."
          confirmLabel={actingId ? "처리 중…" : "결재 취소"}
          confirmTone="danger"
          onCancel={() => setCancelingId(null)}
          onConfirm={performCancel}
          busy={!!actingId}
        />
      )}
    </div>
  );
}

// 작은 범용 확인 모달 — 반려 사유·결재 취소 등에서 재사용. alert()/confirm() 대체.
function ConfirmModal({
  title, description, confirmLabel, confirmTone = "primary", onCancel, onConfirm, busy, children,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  confirmTone?: "primary" | "danger";
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
  children?: React.ReactNode;
}) {
  // ESC 키로 닫기 — 데스크톱에서 즉시 닫히게. 모달이 열려 있을 때만 바인딩.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 bg-ink-900/40 grid place-items-center p-4 z-50" onClick={() => !busy && onCancel()}>
      <div className="panel w-full max-w-[420px] shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="section-head">
          <div className="title">{title}</div>
        </div>
        <div className="p-5 space-y-3">
          {description && <div className="text-[13px] text-ink-700 leading-[1.55]">{description}</div>}
          {children}
        </div>
        <div className="border-t border-ink-150 px-5 py-3 flex justify-end gap-2">
          <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>취소</button>
          <button
            type="button"
            className={confirmTone === "danger" ? "btn-danger" : "btn-primary"}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 탭 옆에 붙는 작은 카운트 칩. */
function CountChip({ n, tone }: { n: number; tone?: "danger" }) {
  return (
    <span
      className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10.5px] font-extrabold tabular"
      style={
        tone === "danger"
          ? { background: "var(--c-danger)", color: "#fff" }
          : { background: "var(--c-surface-3)", color: "var(--c-text-2)" }
      }
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

function ApprovalDetail({
  a, meId, onAct, onCancel, busy, onSelect, onRevise,
}: {
  a: Approval;
  meId?: string;
  onAct: (id: string, action: "approve" | "reject") => void;
  onCancel: (id: string) => void;
  busy?: boolean;
  onSelect: (id: string) => void;
  onRevise: (origId: string, prefill: CreatePrefill) => void;
}) {
  const meta = TYPE_META[a.type];
  const smeta = STATUS_META[a.status];
  const myTurn = a.currentReviewerId === meId;
  const isRequester = a.requester.id === meId;
  const data = a.data ? safeJson(a.data) : null;

  // 결재 상세(revisedFrom / revisions / comments) 는 목록에 포함되어 있지 않으므로
  // 선택이 바뀔 때마다 따로 조회. a.id 변경이나 status/steps 갱신 후에도 재호출되어
  // 댓글/체인이 제 때 반영되도록 의존성에 업데이트 대리값을 포함.
  const [full, setFull] = useState<ApprovalFull | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [posting, setPosting] = useState(false);
  const stepsFp = a.steps.map((s) => `${s.id}:${s.status}`).join(",");

  async function loadFull() {
    try {
      const r = await api<{ approval: ApprovalFull }>(`/api/approval/${a.id}`);
      setFull(r.approval);
    } catch {}
  }
  useEffect(() => { setFull(null); loadFull(); /* eslint-disable-next-line */ }, [a.id, a.status, stepsFp]);

  async function postComment() {
    const c = commentBody.trim();
    if (!c || posting) return;
    setPosting(true);
    try {
      await api(`/api/approval/${a.id}/comments`, { method: "POST", json: { content: c } });
      setCommentBody("");
      await loadFull();
    } catch (err: any) {
      alertAsync({ title: "댓글 실패", description: err?.message ?? "다시 시도해주세요" });
    } finally {
      setPosting(false);
    }
  }

  function startRevise() {
    const parsed = a.data ? safeJson(a.data) : null;
    onRevise(a.id, {
      type: a.type,
      title: a.title,
      content: a.content ?? "",
      startDate: a.startDate ? a.startDate.slice(0, 10) : "",
      endDate: a.endDate ? a.endDate.slice(0, 10) : "",
      amount: typeof a.amount === "number" ? String(a.amount) : "",
      destination: parsed?.destination ?? "",
      reviewerIds: a.steps.map((s) => s.reviewer.id),
    });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="section-head">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg grid place-items-center" style={{ background: meta.color + "1A", color: meta.color }}>{meta.icon}</div>
          <div>
            <div className="text-[11px] font-bold text-ink-600">{meta.label}</div>
            <div className="title">{a.title}</div>
          </div>
        </div>
        <span className={smeta.chip}>{smeta.label}</span>
      </div>

      <div className="flex-1 overflow-auto p-5 space-y-5">
        {(full?.revisedFrom || (full?.revisions && full.revisions.length > 0)) && (
          <div className="panel p-3 bg-ink-25">
            <div className="text-[11px] font-extrabold text-ink-500 uppercase tracking-[0.08em] mb-1.5">재상신 체인</div>
            <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
              {full?.revisedFrom && (
                <>
                  <button className="chip-gray hover:underline" onClick={() => onSelect(full.revisedFrom!.id)}>
                    ← 원본: {full.revisedFrom.title}
                  </button>
                  <span className="text-ink-300">/</span>
                </>
              )}
              <span className="chip-amber">현재</span>
              {full?.revisions?.map((r) => (
                <span key={r.id} className="flex items-center gap-1.5">
                  <span className="text-ink-300">/</span>
                  <button className="chip-gray hover:underline" onClick={() => onSelect(r.id)}>
                    재상신: {r.title}
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <InfoField label="신청자" value={`${a.requester.name}${a.requester.position ? " · " + a.requester.position : ""}${a.requester.team ? " · " + a.requester.team : ""}`} />
          <InfoField label="신청일" value={new Date(a.createdAt).toLocaleString("ko-KR")} tabular />
          {a.startDate && <InfoField label="시작" value={new Date(a.startDate).toLocaleDateString("ko-KR")} tabular />}
          {a.endDate && <InfoField label="종료" value={new Date(a.endDate).toLocaleDateString("ko-KR")} tabular />}
          {typeof a.amount === "number" && <InfoField label="금액" value={`${a.amount.toLocaleString()}원`} tabular />}
          {data?.destination && <InfoField label="목적지" value={data.destination} />}
        </div>

        {a.content && (
          <div>
            <div className="text-[11px] font-extrabold text-ink-500 uppercase tracking-[0.08em] mb-1.5">내용</div>
            <div className="panel p-3 text-[13px] whitespace-pre-wrap text-ink-800 leading-[1.55]">{a.content}</div>
          </div>
        )}

        <div>
          <div className="text-[11px] font-extrabold text-ink-500 uppercase tracking-[0.08em] mb-2">결재선</div>
          <div className="space-y-2">
            {a.steps.map((s, idx) => (
              <div key={s.id} className="panel p-3 flex items-center gap-3">
                <div className="w-6 h-6 rounded-full grid place-items-center text-white text-[11px] font-bold tabular flex-shrink-0" style={{ background: stepColor(s.status) }}>
                  {idx + 1}
                </div>
                <div className="w-8 h-8 rounded-full grid place-items-center text-white text-[11px] font-bold flex-shrink-0 overflow-hidden" style={{ background: s.reviewer.avatarUrl ? "transparent" : s.reviewer.avatarColor }}>
                  {s.reviewer.avatarUrl ? (
                    <img src={s.reviewer.avatarUrl} alt={s.reviewer.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
                  ) : (
                    s.reviewer.name[0]
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-ink-900">{s.reviewer.name}{s.reviewer.position ? ` · ${s.reviewer.position}` : ""}</div>
                  {s.comment && <div className="text-[11px] text-ink-600 mt-0.5 italic">"{s.comment}"</div>}
                  {s.actedAt && <div className="text-[10px] text-ink-400 tabular mt-0.5">{new Date(s.actedAt).toLocaleString("ko-KR")}</div>}
                </div>
                <StepChip status={s.status} />
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-extrabold text-ink-500 uppercase tracking-[0.08em] mb-2">댓글</div>
          {full?.comments && full.comments.length > 0 ? (
            <div className="space-y-2">
              {full.comments.map((c) => (
                <div key={c.id} className="panel p-3 flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-full grid place-items-center text-white text-[11px] font-bold flex-shrink-0 overflow-hidden" style={{ background: c.author.avatarUrl ? "transparent" : c.author.avatarColor }}>
                    {c.author.avatarUrl ? <img src={c.author.avatarUrl} alt={c.author.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/> : c.author.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <div className="text-[12px] font-bold text-ink-900">{c.author.name}</div>
                      {isDevAccount(c.author) && <DevBadge />}
                      <div className="text-[10px] text-ink-400 tabular">{new Date(c.createdAt).toLocaleString("ko-KR")}</div>
                    </div>
                    <div className="text-[13px] text-ink-800 whitespace-pre-wrap leading-[1.55] mt-0.5">{c.content}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[12px] text-ink-400">아직 댓글이 없어요.</div>
          )}
          <div className="mt-2 flex items-start gap-2">
            <div className="flex-1 relative">
              <textarea
                className="input w-full pb-5"
                rows={2}
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value.slice(0, 2000))}
                placeholder="반려 사유에 대한 맥락이나 추가 질문을 남겨보세요  (⌘/Ctrl+Enter 로 등록)"
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && commentBody.trim() && !posting) {
                    e.preventDefault();
                    postComment();
                  }
                }}
              />
              {/* 글자 수 표시 — 한도 근처에서만 색상 강조. */}
              <div
                className={`absolute right-2 bottom-1 text-[10px] tabular pointer-events-none ${
                  commentBody.length >= 2000 ? "text-rose-500 font-bold" : commentBody.length >= 1800 ? "text-amber-500" : "text-ink-400"
                }`}
              >
                {commentBody.length}/2000
              </div>
            </div>
            <button className="btn-primary" disabled={posting || !commentBody.trim()} onClick={postComment}>
              {posting ? "..." : "등록"}
            </button>
          </div>
        </div>
      </div>

      {a.status === "PENDING" && (
        <div className="border-t border-ink-150 px-5 py-3 flex items-center gap-2">
          {myTurn && (
            <>
              <button className="btn-primary flex-1" disabled={busy} onClick={() => onAct(a.id, "approve")}>
                {busy ? "처리 중…" : "승인"}
              </button>
              <button className="btn-danger flex-1" disabled={busy} onClick={() => onAct(a.id, "reject")}>
                {busy ? "처리 중…" : "반려"}
              </button>
            </>
          )}
          {isRequester && !myTurn && (
            <button className="btn-ghost" disabled={busy} onClick={() => onCancel(a.id)}>
              {busy ? "처리 중…" : "결재 취소"}
            </button>
          )}
          {!myTurn && !isRequester && (
            <div className="text-[12px] text-ink-500">다른 결재자의 차례입니다.</div>
          )}
        </div>
      )}

      {a.status === "REJECTED" && isRequester && (
        <div className="border-t border-ink-150 px-5 py-3 flex items-center gap-2">
          <div className="text-[12px] text-ink-500 flex-1">반려된 결재는 내용을 수정해 다시 올릴 수 있어요. 원본은 그대로 보존됩니다.</div>
          <button className="btn-primary" onClick={startRevise}>수정해서 재상신</button>
        </div>
      )}
    </div>
  );
}

function CreateModal({
  directory, meId, onClose, onDone, reviseFromId, prefill,
}: {
  directory: DirUser[];
  meId?: string;
  onClose: () => void;
  onDone: (newId?: string) => void;
  reviseFromId?: string;
  prefill?: CreatePrefill;
}) {
  const [form, setForm] = useState<{
    type: ApprovalType;
    title: string;
    content: string;
    startDate: string;
    endDate: string;
    amount: string;
    destination: string;
    reviewerIds: string[];
  }>({
    type: prefill?.type ?? "TRIP",
    title: prefill?.title ?? "",
    content: prefill?.content ?? "",
    startDate: prefill?.startDate ?? "",
    endDate: prefill?.endDate ?? "",
    amount: prefill?.amount ?? "",
    destination: prefill?.destination ?? "",
    reviewerIds: prefill?.reviewerIds ?? [],
  });
  // 상신 버튼 중복 클릭 방지 + 실패 시 모달 안에서 오류를 보여줘 사용자가 내용을 다시 수정할 수 있게.
  // 기존에는 실패해도 onDone() 으로 바로 닫아버려 입력한 내용을 전부 잃었음.
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [templates, setTemplates] = useState<ApprovalTemplate[]>([]);
  const [lines, setLines] = useState<ApprovalLineFav[]>([]);
  useEffect(() => {
    // 재상신 모드에서는 원본 그대로 쓰는 게 주 용도라 템플릿/라인을 로드할 필요 적음.
    // 그래도 결재선을 다른 즐겨찾기로 바꾸고 싶을 수 있어 로드는 해둔다.
    api<{ templates: ApprovalTemplate[] }>("/api/approval-extras/templates").then((r) => setTemplates(r.templates)).catch(() => {});
    api<{ lines: ApprovalLineFav[] }>("/api/approval-extras/lines").then((r) => setLines(r.lines)).catch(() => {});
  }, []);

  function applyTemplate(t: ApprovalTemplate) {
    setForm((f) => ({
      ...f,
      type: t.type,
      title: t.body.title ?? f.title,
      content: t.body.content ?? f.content,
      destination: t.body.fields?.destination ?? f.destination,
      amount: typeof t.body.fields?.amount === "number" ? String(t.body.fields.amount) : f.amount,
      reviewerIds: t.body.defaultLine && t.body.defaultLine.length > 0 ? t.body.defaultLine : f.reviewerIds,
    }));
  }

  async function saveAsTemplate() {
    const name = window.prompt("템플릿 이름", form.title || "내 결재 템플릿");
    if (!name) return;
    const scope = window.prompt("공유 범위: ALL(전사) / TEAM(팀) / ME(개인)", "ME");
    if (!scope || !["ALL", "TEAM", "ME"].includes(scope)) return;
    try {
      const body: ApprovalTemplate["body"] = {
        title: form.title || undefined,
        content: form.content || undefined,
        fields: {
          destination: form.destination || undefined,
          amount: form.amount ? Number(form.amount) : undefined,
        },
        defaultLine: form.reviewerIds,
      };
      const r = await api<{ template: ApprovalTemplate }>("/api/approval-extras/templates", {
        method: "POST",
        json: { name, type: form.type, scope, body },
      });
      setTemplates((ts) => [r.template, ...ts]);
    } catch (e: any) {
      alertAsync({ title: "템플릿 저장 실패", description: e?.message ?? "다시 시도해주세요" });
    }
  }

  async function removeTemplate(id: string) {
    try {
      await api(`/api/approval-extras/templates/${id}`, { method: "DELETE" });
      setTemplates((ts) => ts.filter((t) => t.id !== id));
    } catch {}
  }

  async function saveAsLine() {
    if (form.reviewerIds.length === 0) return;
    const name = window.prompt("결재라인 이름", `내 결재선 (${form.reviewerIds.length}명)`);
    if (!name) return;
    try {
      const r = await api<{ line: ApprovalLineFav }>("/api/approval-extras/lines", {
        method: "POST",
        json: { name, reviewerIds: form.reviewerIds },
      });
      setLines((ls) => [r.line, ...ls]);
    } catch (e: any) {
      alertAsync({ title: "저장 실패", description: e?.message ?? "다시 시도해주세요" });
    }
  }

  async function removeLine(id: string) {
    try {
      await api(`/api/approval-extras/lines/${id}`, { method: "DELETE" });
      setLines((ls) => ls.filter((l) => l.id !== id));
    } catch {}
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    if (!form.title.trim()) return setError("제목을 입력해주세요");
    if (form.reviewerIds.length === 0) return setError("결재자를 1명 이상 선택해주세요");
    const payload: any = {
      type: form.type,
      title: form.title,
      content: form.content || undefined,
      reviewerIds: form.reviewerIds,
    };
    if (form.startDate) payload.startDate = new Date(form.startDate).toISOString();
    if (form.endDate) payload.endDate = new Date(form.endDate).toISOString();
    if (form.amount) payload.amount = Number(form.amount);
    if (form.type === "TRIP" || form.type === "OFFSITE") {
      payload.data = { destination: form.destination };
    }
    setSaving(true);
    try {
      const url = reviseFromId ? `/api/approval/${reviseFromId}/revise` : "/api/approval";
      const res = await api<{ approval: { id: string } }>(url, { method: "POST", json: payload });
      onDone(res?.approval?.id);
    } catch (err: any) {
      setError(err?.message ?? "상신에 실패했어요");
      setSaving(false);
      // 모달을 닫지 않음 — 사용자가 오류 보고 다시 수정 가능
    }
  }

  const needDates = form.type === "TRIP" || form.type === "OFFSITE";
  const needAmount = form.type === "EXPENSE" || form.type === "PURCHASE";
  const needDestination = form.type === "TRIP" || form.type === "OFFSITE";

  return (
    <div className="fixed inset-0 bg-ink-900/40 grid place-items-center p-4 z-50" onClick={onClose}>
      <div className="panel w-full max-w-[560px] shadow-pop overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="section-head">
          <div className="title">{reviseFromId ? "수정해서 재상신" : "새 결재 올리기"}</div>
          <button className="btn-icon" onClick={onClose} aria-label="닫기">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3 max-h-[80vh] overflow-auto">
          {templates.length > 0 && (
            <div>
              <label className="field-label">템플릿</label>
              <div className="flex flex-wrap gap-1.5">
                {templates.map((t) => (
                  <span key={t.id} className="inline-flex items-center gap-1 bg-ink-100 rounded-full pl-2.5 pr-1 py-0.5">
                    <button
                      type="button"
                      className="text-[12px] font-bold text-ink-800 hover:text-brand-600"
                      onClick={() => applyTemplate(t)}
                      title={`${TYPE_META[t.type].label}${t.scope !== "ALL" ? ` · ${t.scope === "TEAM" ? t.scopeTeam ?? "팀" : "개인"}` : ""}`}
                    >
                      {t.name}
                    </button>
                    <button
                      type="button"
                      className="w-6 h-6 rounded-full text-ink-400 hover:text-ink-700 text-[14px] leading-none grid place-items-center"
                      onClick={() => removeTemplate(t.id)}
                      title="삭제"
                      aria-label="템플릿 삭제"
                    >×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="field-label">결재 종류</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(Object.keys(TYPE_META) as ApprovalType[]).map((t) => {
                const meta = TYPE_META[t];
                const active = form.type === t;
                return (
                  <button
                    type="button"
                    key={t}
                    className={`h-[60px] rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 transition ${
                      active ? "border-brand-500 bg-brand-50" : "border-ink-150 hover:border-ink-300"
                    }`}
                    onClick={() => setForm({ ...form, type: t })}
                  >
                    <div style={{ color: active ? meta.color : "#4A5058" }}>{meta.icon}</div>
                    <div className="text-[11px] font-bold text-ink-800">{meta.label}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="field-label">제목</label>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              maxLength={200}
            />
          </div>
          <div>
            <label className="field-label">내용</label>
            <textarea
              className="input"
              rows={3}
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              maxLength={5000}
            />
          </div>

          {needDates && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">시작일</label>
                <DateTimePicker mode="date" value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} />
              </div>
              <div>
                <label className="field-label">종료일</label>
                <DateTimePicker mode="date" value={form.endDate} onChange={(v) => setForm({ ...form, endDate: v })} min={form.startDate} />
              </div>
            </div>
          )}

          {needDestination && (
            <div>
              <label className="field-label">목적지</label>
              <input
                className="input"
                value={form.destination}
                onChange={(e) => setForm({ ...form, destination: e.target.value })}
                placeholder="예: 부산 지사"
                maxLength={200}
              />
            </div>
          )}

          {needAmount && (
            <div>
              <label className="field-label">금액 (원)</label>
              <input type="number" className="input tabular" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="field-label !mb-0">결재선 <span className="text-ink-500 font-normal">(순서대로 결재됨 · {form.reviewerIds.length}명)</span></label>
              <div className="flex items-center gap-2">
                {form.reviewerIds.length > 0 && (
                  <button type="button" className="text-[11px] font-bold text-brand-600 hover:text-brand-700" onClick={saveAsLine}>
                    ★ 이 라인 저장
                  </button>
                )}
              </div>
            </div>
            {lines.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {lines.map((l) => (
                  <span key={l.id} className="inline-flex items-center gap-1 bg-brand-50 rounded-full pl-2.5 pr-1 py-0.5">
                    <button
                      type="button"
                      className="text-[12px] font-bold text-brand-700 hover:text-brand-800"
                      onClick={() => setForm((f) => ({ ...f, reviewerIds: l.reviewerIds.filter((id) => id !== meId) }))}
                    >
                      {l.name} <span className="text-ink-500 font-normal tabular">({l.reviewerIds.length})</span>
                    </button>
                    <button
                      type="button"
                      className="w-6 h-6 rounded-full text-ink-400 hover:text-ink-700 text-[14px] leading-none grid place-items-center"
                      onClick={() => removeLine(l.id)}
                      title="삭제"
                      aria-label="결재선 삭제"
                    >×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="max-h-48 overflow-auto rounded-xl border border-ink-150 divide-y divide-ink-100">
              {directory.filter((d) => d.id !== meId).map((d) => {
                const idx = form.reviewerIds.indexOf(d.id);
                const checked = idx >= 0;
                return (
                  <label key={d.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${checked ? "bg-brand-50" : "hover:bg-ink-25"}`}>
                    <input type="checkbox" className="accent-brand-500"
                      checked={checked}
                      onChange={(e) => setForm((f) => e.target.checked
                        ? { ...f, reviewerIds: [...f.reviewerIds, d.id] }
                        : { ...f, reviewerIds: f.reviewerIds.filter((x) => x !== d.id) })
                      }
                    />
                    {checked && <span className="w-5 h-5 rounded bg-brand-500 text-white text-[10px] font-bold grid place-items-center tabular">{idx + 1}</span>}
                    <div className="w-7 h-7 rounded-full grid place-items-center text-white text-[11px] font-bold overflow-hidden" style={{ background: d.avatarUrl ? "transparent" : (d.avatarColor ?? "#3D54C4") }}>
                      {d.avatarUrl ? (
                        <img src={d.avatarUrl} alt={d.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
                      ) : (
                        d.name[0]
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-bold text-ink-900">{d.name}</div>
                      <div className="text-[11px] text-ink-500 truncate">{d.position ?? "—"}{d.team ? ` · ${d.team}` : ""}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="text-[12px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-ghost text-ink-600" disabled={saving || !form.title.trim()} onClick={saveAsTemplate} title="현재 내용을 템플릿으로 저장">
              템플릿으로 저장
            </button>
            <div className="flex-1" />
            <button type="button" className="btn-ghost" disabled={saving} onClick={onClose}>취소</button>
            <button className="btn-primary" disabled={saving}>
              {saving ? "상신 중…" : reviseFromId ? "재상신" : "상신"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InfoField({ label, value, tabular }: { label: string; value: string; tabular?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-extrabold text-ink-500 uppercase tracking-[0.06em]">{label}</div>
      <div className={`text-[13px] text-ink-900 mt-0.5 ${tabular ? "tabular" : ""}`}>{value}</div>
    </div>
  );
}

function StepChip({ status }: { status: Step["status"] }) {
  if (status === "APPROVED") return <span className="chip-green">승인</span>;
  if (status === "REJECTED") return <span className="chip-red">반려</span>;
  if (status === "SKIPPED") return <span className="chip-gray">건너뜀</span>;
  return <span className="chip-amber">대기</span>;
}

function stepColor(s: Step["status"]) {
  if (s === "APPROVED") return "#16A34A";
  if (s === "REJECTED") return "#DC2626";
  return "#B0B8C1";
}

function safeJson(s: string) {
  try { return JSON.parse(s); } catch { return null; }
}
