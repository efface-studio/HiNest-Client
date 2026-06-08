import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api";

/**
 * 개발자 콘솔 — 회사 선택 드롭다운 공유 상태.
 *
 * 로그·감사·세션처럼 회사(companyId)로 나뉘는 탭들을 한 회사로 좁혀 볼 수 있게 한다.
 * 선택값은 URL ?company=<id> 로 동기화 → 새로고침·탭 전환에도 유지되고, 링크 공유도 가능.
 * "전체"(companyId=null)면 지금까지처럼 전 회사 데이터를 그대로 본다.
 *
 * 서버·에러·헬스·플래그처럼 회사 구분이 없는 전역 탭에서는 드롭다운을 숨긴다
 * (COMPANY_SCOPED_TABS 로 판별).
 */

export type ConsoleCompany = {
  id: string;
  name: string;
  slug: string | null;
  status: string;
};

/** 회사 단위로 필터링을 지원하는 탭들. 여기 없는 탭은 전역 데이터로 간주해 드롭다운을 숨긴다. */
export const COMPANY_SCOPED_TABS: ReadonlySet<string> = new Set(["logs", "audit", "sessions", "trash"]);
export function isCompanyScoped(tab: string): boolean {
  return COMPANY_SCOPED_TABS.has(tab);
}

type Ctx = {
  companyId: string | null;
  setCompanyId: (id: string | null) => void;
  companies: ConsoleCompany[];
  loading: boolean;
};

const ConsoleCompanyContext = createContext<Ctx>({
  companyId: null,
  setCompanyId: () => {},
  companies: [],
  loading: false,
});

export function useConsoleCompany(): Ctx {
  return useContext(ConsoleCompanyContext);
}

/** 회사 fetch 쿼리스트링 헬퍼 — companyId 가 있으면 &companyId=... 를 덧붙인다. */
export function appendCompanyParam(params: URLSearchParams, companyId: string | null): URLSearchParams {
  if (companyId) params.set("companyId", companyId);
  return params;
}

export function CompanyFilterProvider({ children }: { children: ReactNode }) {
  const [sp, setSp] = useSearchParams();
  const companyId = sp.get("company") || null;
  const [companies, setCompanies] = useState<ConsoleCompany[]>([]);
  const [loading, setLoading] = useState(false);

  const setCompanyId = (id: string | null) => {
    const next = new URLSearchParams(sp);
    if (!id) next.delete("company");
    else next.set("company", id);
    setSp(next, { replace: true });
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<{ companies: ConsoleCompany[] }>("/api/admin/companies")
      .then((r) => { if (alive) setCompanies(r.companies || []); })
      .catch(() => { /* step-up 전이거나 권한 없음 — 드롭다운만 비고 패널은 정상 동작 */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <ConsoleCompanyContext.Provider value={{ companyId, setCompanyId, companies, loading }}>
      {children}
    </ConsoleCompanyContext.Provider>
  );
}

/** 회사 선택 드롭다운 — 크롬 헤더 우측에 둔다. 회사 스코프 탭에서만 렌더하는 게 자연스럽다. */
export function CompanyFilterDropdown({ accent = "#64748B" }: { accent?: string }) {
  const { companyId, setCompanyId, companies, loading } = useConsoleCompany();
  const selected = companies.find((c) => c.id === companyId) || null;

  return (
    <label className="inline-flex items-center gap-1.5 flex-shrink-0" title="회사별로 좁혀 보기">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" />
        <path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01" />
      </svg>
      <select
        value={companyId ?? ""}
        onChange={(e) => setCompanyId(e.target.value || null)}
        disabled={loading && companies.length === 0}
        className="input !py-1 !h-[30px] !text-[12px] max-w-[190px] font-semibold"
        style={{ borderColor: companyId ? accent : undefined, color: companyId ? accent : undefined }}
        aria-label="회사 선택"
      >
        <option value="">전체 회사</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}{c.slug ? ` @${c.slug}` : ""}{c.status !== "ACTIVE" ? ` · ${c.status}` : ""}
          </option>
        ))}
      </select>
      {selected && (
        <button
          type="button"
          onClick={() => setCompanyId(null)}
          className="text-ink-400 hover:text-ink-700 transition"
          title="전체 회사로"
          aria-label="회사 필터 해제"
          style={{ width: 20, height: 20, display: "grid", placeItems: "center", borderRadius: 999 }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </label>
  );
}
