import { useCallback, useEffect, useState } from "react";
import { api, invalidateCache } from "../api";
import PageHeader from "../components/PageHeader";
import { confirmAsync, promptAsync, alertAsync } from "../components/ConfirmHost";

/**
 * 플랫폼 운영자 콘솔 — 회사(테넌트) 가입 승인 워크플로우.
 * platformAdmin 만 접근(라우트 가드 + 서버 requirePlatformAdmin 이중 차단).
 * 회사 내부 관리자(admin/superAdmin) 페이지와 별개다.
 */

type Status = "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED";

type Company = {
  id: string;
  name: string;
  status: Status;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  bizRegNo?: string | null;
  rejectedReason?: string | null;
  createdAt: string;
  approvedAt?: string | null;
  _count?: { users: number };
};

type Summary = Record<Status, number>;

const STATUS_META: Record<Status, { label: string; color: string; bg: string }> = {
  PENDING: { label: "승인 대기", color: "#B45309", bg: "rgba(245,158,11,0.14)" },
  ACTIVE: { label: "운영중", color: "#047857", bg: "rgba(16,185,129,0.14)" },
  SUSPENDED: { label: "일시정지", color: "#B91C1C", bg: "rgba(239,68,68,0.13)" },
  REJECTED: { label: "반려됨", color: "#6B7280", bg: "rgba(107,114,128,0.13)" },
};

// 회사명에서 결정적으로 모노그램 색을 뽑는다 — 같은 회사는 항상 같은 색.
const MONO_COLORS = ["#3B5CF0", "#0EA5E9", "#8B5CF6", "#EC4899", "#F59E0B", "#10B981", "#EF4444", "#14B8A6"];
function monoColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0;
  return MONO_COLORS[Math.abs(h) % MONO_COLORS.length];
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return iso;
  }
}

function IconUser() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function IconInbox() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

export default function PlatformPage() {
  const [filter, setFilter] = useState<Status | "ALL">("PENDING");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [summary, setSummary] = useState<Summary>({ PENDING: 0, ACTIVE: 0, SUSPENDED: 0, REJECTED: 0 });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const q = filter === "ALL" ? "" : `?status=${filter}`;
      const [list, sum] = await Promise.all([
        api<{ companies: Company[] }>(`/api/platform/companies${q}`),
        api<{ summary: Summary }>("/api/platform/companies/summary"),
      ]);
      setCompanies(list.companies ?? []);
      setSummary(sum.summary ?? { PENDING: 0, ACTIVE: 0, SUSPENDED: 0, REJECTED: 0 });
    } catch (e: any) {
      await alertAsync({ description: e?.message ?? "목록을 불러오지 못했어요" });
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    reload();
  }, [reload]);

  function bustCache() {
    invalidateCache("/api/platform/companies");
  }

  async function approve(c: Company) {
    const verb = c.status === "PENDING" ? "승인" : "재활성화";
    if (!(await confirmAsync({
      title: `${c.name} ${verb}`,
      description: `이 회사를 ${verb}하면 소속 직원들이 로그인할 수 있게 됩니다.`,
      confirmLabel: verb,
      tone: "primary",
    }))) return;
    setBusyId(c.id);
    try {
      await api(`/api/platform/companies/${c.id}/approve`, { method: "POST" });
      bustCache();
      await reload();
    } catch (e: any) {
      await alertAsync({ description: e?.message ?? `${verb}에 실패했어요` });
    } finally {
      setBusyId(null);
    }
  }

  async function reject(c: Company) {
    const reason = await promptAsync({
      title: `${c.name} 반려`,
      description: "반려 사유를 입력하세요. 신청자에게 전달될 수 있습니다.",
      placeholder: "예: 사업자 정보 확인 불가",
      confirmLabel: "반려하기",
    });
    if (reason === null) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      await alertAsync({ description: "반려 사유를 입력해주세요" });
      return;
    }
    setBusyId(c.id);
    try {
      await api(`/api/platform/companies/${c.id}/reject`, { method: "POST", json: { reason: trimmed } });
      bustCache();
      await reload();
    } catch (e: any) {
      await alertAsync({ description: e?.message ?? "반려에 실패했어요" });
    } finally {
      setBusyId(null);
    }
  }

  async function suspend(c: Company) {
    if (!(await confirmAsync({
      title: `${c.name} 일시정지`,
      description: "정지하면 소속 직원의 로그인이 차단됩니다. 데이터는 보존되며 언제든 재활성화할 수 있어요.",
      confirmLabel: "일시정지",
      tone: "danger",
    }))) return;
    setBusyId(c.id);
    try {
      await api(`/api/platform/companies/${c.id}/suspend`, { method: "POST" });
      bustCache();
      await reload();
    } catch (e: any) {
      await alertAsync({ description: e?.message ?? "정지에 실패했어요" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="플랫폼 운영"
        title="회사 가입 관리"
        description="가입 신청한 회사를 검토하고 승인·반려·정지할 수 있습니다."
      />

      {/* 상태별 KPI — 카드를 누르면 해당 상태로 필터. (기존엔 카드+칩이 같은 일을 중복했음) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 mb-5">
        {(Object.keys(STATUS_META) as Status[]).map((s) => {
          const meta = STATUS_META[s];
          const active = filter === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              aria-pressed={active}
              className="text-left rounded-2xl px-4 py-3.5 border transition-all hover:-translate-y-px"
              style={{
                background: active ? meta.bg : "var(--c-surface)",
                borderColor: active ? meta.color : "var(--c-border)",
                boxShadow: active ? `inset 0 0 0 1px ${meta.color}` : "none",
              }}
            >
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: meta.color }} />
                <span className={`text-[12.5px] font-bold truncate ${active ? "" : "text-ink-500"}`} style={active ? { color: meta.color } : undefined}>{meta.label}</span>
              </div>
              <div className={`text-[26px] leading-none font-extrabold tabular mt-2 ${active ? "" : "text-ink-900"}`} style={active ? { color: meta.color } : undefined}>{summary[s]}</div>
            </button>
          );
        })}
      </div>

      {/* 목록 헤더: 현재 보기 라벨 + 개수 + 전체 토글 */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-[14.5px] font-extrabold text-ink-800 flex items-center gap-1.5">
          {filter === "ALL" ? "전체 회사" : STATUS_META[filter].label}
          {!loading && <span className="text-ink-400 tabular font-bold">{companies.length}</span>}
        </h2>
        <button
          type="button"
          onClick={() => setFilter(filter === "ALL" ? "PENDING" : "ALL")}
          aria-pressed={filter === "ALL"}
          className="text-[12.5px] font-bold px-3.5 h-[32px] rounded-full transition"
          style={
            filter === "ALL"
              ? { background: "var(--c-brand)", color: "#fff" }
              : { background: "var(--c-surface)", color: "var(--c-text-2)", border: "1px solid var(--c-border)" }
          }
        >
          전체 보기
        </button>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-2xl border p-4 sm:p-5 animate-pulse"
              style={{ borderColor: "var(--c-border)", background: "var(--c-surface)" }}
            >
              <div className="flex items-start gap-3.5">
                <div className="w-11 h-11 rounded-xl flex-shrink-0" style={{ background: "var(--c-border)" }} />
                <div className="flex-1 space-y-2.5 pt-1">
                  <div className="h-3.5 w-40 max-w-full rounded" style={{ background: "var(--c-border)" }} />
                  <div className="h-3 w-64 max-w-full rounded" style={{ background: "var(--c-border)" }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : companies.length === 0 ? (
        <div
          className="rounded-2xl border py-16 px-6 flex flex-col items-center text-center"
          style={{ borderColor: "var(--c-border)", background: "var(--c-surface)" }}
        >
          <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3 text-ink-300" style={{ background: "var(--c-surface-2, rgba(0,0,0,0.04))" }}>
            <IconInbox />
          </div>
          <div className="text-[14px] font-bold text-ink-600">표시할 회사가 없어요</div>
          <div className="text-[12.5px] text-ink-400 mt-1">
            {filter === "ALL" ? "아직 가입 신청한 회사가 없습니다." : `'${STATUS_META[filter].label}' 상태의 회사가 없습니다.`}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {companies.map((c) => {
            const meta = STATUS_META[c.status];
            const busy = busyId === c.id;
            return (
              <div
                key={c.id}
                className="rounded-2xl border p-4 sm:p-5 transition hover:shadow-sm"
                style={{ borderColor: "var(--c-border)", background: "var(--c-surface)" }}
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-3.5 sm:gap-4">
                  <div className="flex items-start gap-3.5 min-w-0 flex-1">
                    <div className="avatar avatar-lg !rounded-xl flex-shrink-0" style={{ background: monoColor(c.name) }}>
                      {c.name?.[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[16px] font-extrabold text-ink-900 truncate">{c.name}</span>
                        <span
                          className="text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                          style={{ color: meta.color, background: meta.bg }}
                        >
                          {meta.label}
                        </span>
                      </div>
                      <div className="mt-2 space-y-1 text-[12.5px] text-ink-500">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-ink-300 flex-shrink-0"><IconUser /></span>
                          <span className="font-semibold text-ink-700">{c.contactName ?? "담당자 미상"}</span>
                          {c.contactEmail && <><span className="text-ink-300">·</span><span className="truncate">{c.contactEmail}</span></>}
                          {c.contactPhone && <><span className="text-ink-300">·</span><span>{c.contactPhone}</span></>}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-ink-300 flex-shrink-0"><IconCalendar /></span>
                          <span>신청 {fmtDate(c.createdAt)}</span>
                          {c.bizRegNo && <><span className="text-ink-300">·</span><span>사업자 {c.bizRegNo}</span></>}
                          {typeof c._count?.users === "number" && <><span className="text-ink-300">·</span><span>직원 {c._count.users}명</span></>}
                        </div>
                        {c.status === "REJECTED" && c.rejectedReason && (
                          <div className="font-medium" style={{ color: "var(--c-danger)" }}>반려 사유: {c.rejectedReason}</div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 pl-[58px] sm:pl-0">
                    {(c.status === "PENDING" || c.status === "SUSPENDED" || c.status === "REJECTED") && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => approve(c)}
                        className="h-[36px] px-4 rounded-full text-[13px] font-bold text-white transition disabled:opacity-50 active:scale-95"
                        style={{ background: "var(--c-brand)" }}
                      >
                        {busy ? "처리중…" : c.status === "PENDING" ? "승인" : "재활성화"}
                      </button>
                    )}
                    {c.status === "PENDING" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => reject(c)}
                        className="h-[36px] px-4 rounded-full text-[13px] font-bold transition disabled:opacity-50 active:scale-95"
                        style={{ background: "var(--c-surface)", color: "var(--c-text-2)", border: "1px solid var(--c-border)" }}
                      >
                        반려
                      </button>
                    )}
                    {c.status === "ACTIVE" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => suspend(c)}
                        className="h-[36px] px-4 rounded-full text-[13px] font-bold transition disabled:opacity-50 active:scale-95"
                        style={{ background: "var(--c-surface)", color: "var(--c-danger)", border: "1px solid color-mix(in srgb, var(--c-danger) 30%, transparent)" }}
                      >
                        일시정지
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
