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

const FILTERS: { key: Status | "ALL"; label: string }[] = [
  { key: "PENDING", label: "승인 대기" },
  { key: "ACTIVE", label: "운영중" },
  { key: "SUSPENDED", label: "일시정지" },
  { key: "REJECTED", label: "반려됨" },
  { key: "ALL", label: "전체" },
];

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return iso;
  }
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
      setCompanies(list.companies);
      setSummary(sum.summary);
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

      {/* 상태 요약 배지 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {(Object.keys(STATUS_META) as Status[]).map((s) => {
          const meta = STATUS_META[s];
          const active = filter === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className="text-left rounded-2xl px-4 py-3 border transition"
              style={{
                background: active ? meta.bg : "var(--c-surface)",
                borderColor: active ? "transparent" : "var(--c-border)",
                boxShadow: active ? `inset 0 0 0 1.5px ${meta.color}` : "none",
              }}
            >
              <div className="text-[12px] font-bold" style={{ color: meta.color }}>{meta.label}</div>
              <div className="text-[24px] font-extrabold text-ink-900 tabular mt-0.5">{summary[s]}</div>
            </button>
          );
        })}
      </div>

      {/* 필터 탭 */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className="px-3.5 h-[34px] rounded-full text-[13px] font-bold transition"
            style={
              filter === f.key
                ? { background: "var(--c-brand)", color: "#fff" }
                : { background: "var(--c-surface-2, var(--c-surface))", color: "var(--c-text-2)", border: "1px solid var(--c-border)" }
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="py-16 text-center text-ink-400 text-[14px]">불러오는 중…</div>
      ) : companies.length === 0 ? (
        <div className="py-16 text-center text-ink-400 text-[14px]">해당 상태의 회사가 없습니다.</div>
      ) : (
        <div className="space-y-3">
          {companies.map((c) => {
            const meta = STATUS_META[c.status];
            const busy = busyId === c.id;
            return (
              <div
                key={c.id}
                className="rounded-2xl border p-4 sm:p-5"
                style={{ borderColor: "var(--c-border)", background: "var(--c-surface)" }}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[16px] font-extrabold text-ink-900 truncate">{c.name}</span>
                      <span
                        className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                        style={{ color: meta.color, background: meta.bg }}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <div className="text-[12.5px] text-ink-500 mt-1.5 space-y-0.5">
                      <div>
                        담당자 {c.contactName ?? "—"}
                        {c.contactEmail ? ` · ${c.contactEmail}` : ""}
                        {c.contactPhone ? ` · ${c.contactPhone}` : ""}
                      </div>
                      <div>
                        {c.bizRegNo ? `사업자 ${c.bizRegNo} · ` : ""}
                        신청 {fmtDate(c.createdAt)}
                        {typeof c._count?.users === "number" ? ` · 직원 ${c._count.users}명` : ""}
                      </div>
                      {c.status === "REJECTED" && c.rejectedReason && (
                        <div style={{ color: "var(--c-danger)" }}>반려 사유: {c.rejectedReason}</div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {(c.status === "PENDING" || c.status === "SUSPENDED" || c.status === "REJECTED") && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => approve(c)}
                        className="h-[36px] px-4 rounded-full text-[13px] font-bold text-white transition disabled:opacity-50"
                        style={{ background: "var(--c-brand)" }}
                      >
                        {c.status === "PENDING" ? "승인" : "재활성화"}
                      </button>
                    )}
                    {c.status === "PENDING" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => reject(c)}
                        className="h-[36px] px-4 rounded-full text-[13px] font-bold transition disabled:opacity-50"
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
                        className="h-[36px] px-4 rounded-full text-[13px] font-bold transition disabled:opacity-50"
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
