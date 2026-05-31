import { useEffect, useMemo, useState } from "react";
import { api, apiUrl } from "../api";
import { useAuth } from "../auth";
import PageHeader from "../components/PageHeader";
import { confirmAsync, alertAsync, promptAsync } from "../components/ConfirmHost";
import { safeExternalUrl } from "../lib/safeUrl";

/**
 * 서비스 계정 레지스트리 — 회사에서 쓰는 AWS/Vercel/GitHub/테스트 계정을 한 곳에 모으는 페이지.
 *
 * 보안 원칙:
 * - 비밀번호/토큰/액세스키는 저장하지 않는다. 전용 비밀번호 관리자(1Password 등) 사용 전제.
 * - 이 페이지의 목적은 "어떤 서비스의 계정을 누가 담당하는지" 인덱스.
 *
 * 공개 범위(scope):
 * - ALL     — 전사. 로그인 사용자 전원.
 * - TEAM    — 팀. 동일 팀 사용자(+ ADMIN).
 * - PROJECT — 프로젝트. 해당 프로젝트 멤버(+ ADMIN).
 *
 * 편집 권한: 작성자 본인 또는 ADMIN.
 */

type Category = "CLOUD" | "HOSTING" | "VCS" | "PAYMENT" | "DOMAIN" | "EMAIL" | "MONITOR" | "DB" | "AI" | "TESTING" | "OTHER";

const CATEGORY_META: Record<Category, { label: string; color: string; emoji: string }> = {
  CLOUD:    { label: "클라우드", color: "#F59E0B", emoji: "☁️" },
  HOSTING:  { label: "호스팅",   color: "#000000", emoji: "▲" },
  VCS:      { label: "저장소",   color: "#24292F", emoji: "🐙" },
  PAYMENT:  { label: "결제",     color: "#635BFF", emoji: "💳" },
  DOMAIN:   { label: "도메인",   color: "#F38020", emoji: "🌐" },
  EMAIL:    { label: "이메일",   color: "#EA4335", emoji: "✉️" },
  MONITOR:  { label: "모니터링", color: "#7B3FE4", emoji: "📡" },
  DB:       { label: "데이터베이스", color: "#336791", emoji: "🗄️" },
  AI:       { label: "AI",       color: "#10A37F", emoji: "🤖" },
  TESTING:  { label: "테스트",   color: "#16A34A", emoji: "🧪" },
  OTHER:    { label: "기타",     color: "#6B7280", emoji: "📦" },
};
const CATEGORY_ORDER: Category[] = ["CLOUD", "HOSTING", "VCS", "DB", "PAYMENT", "DOMAIN", "EMAIL", "MONITOR", "AI", "TESTING", "OTHER"];

/**
 * URL/서비스 이름에서 파비콘용 도메인 추정.
 * - URL 이 있으면 hostname 그대로.
 * - 없으면 서비스 이름에서 유명 브랜드를 매칭 (BRAND_HOSTS).
 * - 그래도 매칭 실패하면 한 단어로 된 이름에 한해 <slug>.com 추정.
 *   다국어 이름(예: "팀 드라이브") 이나 복합 이름(예: "AWS 프로덕션")은 추정을 피함 —
 *   엉뚱한 도메인으로 흘러 보안상 리퍼러가 새는 걸 막기 위함.
 */
const BRAND_HOSTS: Array<[RegExp, string]> = [
  [/(^|\W)aws|amazon\s*web/i, "aws.amazon.com"],
  [/vercel/i, "vercel.com"],
  [/netlify/i, "netlify.com"],
  [/cloudflare/i, "cloudflare.com"],
  [/github/i, "github.com"],
  [/gitlab/i, "gitlab.com"],
  [/bitbucket/i, "bitbucket.org"],
  [/notion/i, "notion.so"],
  [/figma/i, "figma.com"],
  [/slack/i, "slack.com"],
  [/discord/i, "discord.com"],
  [/google\s*cloud|gcp/i, "cloud.google.com"],
  [/google\s*workspace|gsuite|g\s*suite/i, "workspace.google.com"],
  [/google/i, "google.com"],
  [/microsoft|office\s*365|m365/i, "microsoft.com"],
  [/azure/i, "azure.microsoft.com"],
  [/apple/i, "apple.com"],
  [/instagram|insta/i, "instagram.com"],
  [/facebook|meta\b/i, "facebook.com"],
  [/twitter|^x\b/i, "twitter.com"],
  [/tiktok/i, "tiktok.com"],
  [/youtube/i, "youtube.com"],
  [/linkedin/i, "linkedin.com"],
  [/naver/i, "naver.com"],
  [/kakao/i, "kakao.com"],
  [/toss/i, "toss.im"],
  [/stripe/i, "stripe.com"],
  [/paypal/i, "paypal.com"],
  [/openai|chatgpt/i, "openai.com"],
  [/anthropic|claude/i, "anthropic.com"],
  [/supabase/i, "supabase.com"],
  [/firebase/i, "firebase.google.com"],
  [/mongodb|mongo\s*atlas/i, "mongodb.com"],
  [/planetscale/i, "planetscale.com"],
  [/datadog/i, "datadoghq.com"],
  [/sentry/i, "sentry.io"],
  [/new\s*relic/i, "newrelic.com"],
  [/mailgun/i, "mailgun.com"],
  [/sendgrid/i, "sendgrid.com"],
  [/resend/i, "resend.com"],
  [/twilio/i, "twilio.com"],
  [/dropbox/i, "dropbox.com"],
  [/zoom/i, "zoom.us"],
  [/linear/i, "linear.app"],
  [/jira|atlassian/i, "atlassian.com"],
  [/cloudinary/i, "cloudinary.com"],
];

function guessHost(url: string | null, name: string): string | null {
  if (url) {
    try { return new URL(url).hostname; } catch {}
  }
  const n = name.trim();
  if (!n) return null;
  for (const [re, host] of BRAND_HOSTS) {
    if (re.test(n)) return host;
  }
  // 마지막 수단 — 공백/특수문자 없고 ascii 만 있는 단일 단어면 .com 추정.
  const slug = n.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (slug.length >= 3 && /^[a-z0-9]+$/.test(slug) && slug === n.toLowerCase()) {
    return `${slug}.com`;
  }
  return null;
}

type Scope = "ALL" | "TEAM" | "PROJECT";
const SCOPE_LABEL: Record<Scope, string> = { ALL: "전사", TEAM: "팀", PROJECT: "프로젝트" };
type ScopeTab = "ALL_TAB" | Scope;

type OwnerUser = { id: string; name: string; avatarColor: string; avatarUrl: string | null; email: string; team?: string | null; position?: string | null };
type ProjectChip = { id: string; name: string; color: string };
type Account = {
  id: string;
  serviceName: string;
  category: Category;
  loginId: string | null;
  url: string | null;
  notes: string | null;
  scope: Scope;
  scopeTeam: string | null;
  scopeTeams: string[];
  projectId: string | null;
  projectIds: string[];
  project: ProjectChip | null;
  ownerUser: OwnerUser | null;
  ownerName: string | null;
  iconUrl: string | null;
  iconShape: "SQUIRCLE" | "CIRCLE";
  active: boolean;
  hasPassword: boolean;
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
};

type DirUser = { id: string; name: string; email: string; team?: string | null; position?: string | null; avatarColor?: string; avatarUrl?: string | null };

type FormState = {
  serviceName: string;
  category: Category;
  loginId: string;
  url: string;
  notes: string;
  ownerUserId: string;
  ownerName: string;
  scope: Scope;
  // 다중 팀/프로젝트 공유 — scopeTeams[0] 이 레거시 대표값(scopeTeam) 과 동기화됨.
  scopeTeams: string[];
  scopeProjectIds: string[];
  // 비밀번호 입력 — 편집 시 빈 값은 "변경 없음", "CLEAR" sentinel 은 제거, 문자열은 새 값.
  password: string;
  clearPassword: boolean;
  // 커스텀 로고 URL — "" 이면 자동 추측(파비콘/이모지), 값 있으면 그 이미지를 그대로 사용.
  iconUrl: string;
  // 아이콘 모양 — SQUIRCLE(기본, iOS 앱아이콘) | CIRCLE(원형 로고 전용).
  iconShape: "SQUIRCLE" | "CIRCLE";
};

const emptyForm = (defaultTeam: string): FormState => ({
  serviceName: "",
  category: "OTHER",
  loginId: "",
  url: "",
  notes: "",
  ownerUserId: "",
  ownerName: "",
  scope: "ALL",
  scopeTeams: defaultTeam ? [defaultTeam] : [],
  scopeProjectIds: [],
  password: "",
  clearPassword: false,
  iconUrl: "",
  iconShape: "SQUIRCLE",
});

export default function ServiceAccountsPage() {
  const { user } = useAuth();
  const myTeam = (user as any)?.team ?? "";
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [users, setUsers] = useState<DirUser[]>([]);
  const [projects, setProjects] = useState<ProjectChip[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filterCat, setFilterCat] = useState<Category | "ALL">("ALL");
  const [scopeTab, setScopeTab] = useState<ScopeTab>("ALL_TAB");
  const [filterProjectId, setFilterProjectId] = useState<string>("");

  // 모달 상태 — "new" 생성, 문자열은 편집 중 id
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(myTeam));
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const canEdit = (a: Account) => user?.role === "ADMIN" || (user as any)?.superAdmin || a.createdBy.id === user?.id;

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (scopeTab !== "ALL_TAB") params.set("scope", scopeTab);
      if (scopeTab === "PROJECT" && filterProjectId) params.set("projectId", filterProjectId);
      const qs = params.toString();
      const r = await api<{ accounts: Account[] }>(`/api/service-accounts${qs ? `?${qs}` : ""}`);
      setAccounts(r.accounts);
      setLoadErr(null);
    } catch (e: any) {
      setLoadErr(e?.message ?? "계정 목록을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [scopeTab, filterProjectId]);

  useEffect(() => {
    api<{ users: DirUser[] }>("/api/users").then((r) => setUsers(r.users)).catch(() => {});
    api<{ projects: ProjectChip[] }>("/api/service-accounts/projects").then((r) => setProjects(r.projects)).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return accounts.filter((a) => {
      if (filterCat !== "ALL" && a.category !== filterCat) return false;
      if (!k) return true;
      return (
        a.serviceName.toLowerCase().includes(k) ||
        (a.loginId ?? "").toLowerCase().includes(k) ||
        (a.ownerUser?.name ?? "").toLowerCase().includes(k) ||
        (a.ownerName ?? "").toLowerCase().includes(k) ||
        (a.notes ?? "").toLowerCase().includes(k)
      );
    });
  }, [accounts, q, filterCat]);

  const grouped = useMemo(() => {
    const m = new Map<Category, Account[]>();
    for (const a of filtered) {
      const list = m.get(a.category) ?? [];
      list.push(a);
      m.set(a.category, list);
    }
    return CATEGORY_ORDER.filter((c) => m.has(c)).map((c) => ({ category: c, items: m.get(c)! }));
  }, [filtered]);

  function openCreate() {
    const init = emptyForm(myTeam);
    // 프로젝트 탭에서 선택된 프로젝트가 있으면 초기값으로 주입
    if (scopeTab === "PROJECT" && filterProjectId) {
      init.scope = "PROJECT";
      init.scopeProjectIds = [filterProjectId];
    } else if (scopeTab === "TEAM") {
      init.scope = "TEAM";
    }
    setForm(init);
    setFormErr(null);
    setEditing("new");
  }
  function openEdit(a: Account) {
    setForm({
      serviceName: a.serviceName,
      category: a.category,
      loginId: a.loginId ?? "",
      url: a.url ?? "",
      notes: a.notes ?? "",
      ownerUserId: a.ownerUser?.id ?? "",
      ownerName: a.ownerName ?? "",
      scope: a.scope,
      scopeTeams: a.scopeTeams?.length
        ? a.scopeTeams
        : a.scopeTeam
          ? [a.scopeTeam]
          : myTeam ? [myTeam] : [],
      scopeProjectIds: a.projectIds?.length
        ? a.projectIds
        : a.projectId
          ? [a.projectId]
          : [],
      password: "",
      clearPassword: false,
      iconUrl: a.iconUrl ?? "",
      iconShape: a.iconShape ?? "SQUIRCLE",
    });
    setFormErr(null);
    setEditing(a.id);
  }
  function closeModal() {
    setEditing(null);
    setForm(emptyForm(myTeam));
    setFormErr(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!form.serviceName.trim()) {
      setFormErr("서비스 이름을 입력해주세요.");
      return;
    }
    if (form.scope === "TEAM" && form.scopeTeams.filter((t) => t.trim()).length === 0) {
      setFormErr("팀을 하나 이상 입력해주세요.");
      return;
    }
    if (form.scope === "PROJECT" && form.scopeProjectIds.length === 0) {
      setFormErr("프로젝트를 하나 이상 선택해주세요.");
      return;
    }
    setSaving(true);
    setFormErr(null);
    try {
      const payload: any = {
        serviceName: form.serviceName.trim(),
        category: form.category,
        loginId: form.loginId.trim() || null,
        url: form.url.trim() || null,
        notes: form.notes.trim() || null,
        ownerUserId: form.ownerUserId || null,
        ownerName: form.ownerName.trim() || null,
        scope: form.scope,
        scopeTeams: form.scope === "TEAM" ? form.scopeTeams.map((t) => t.trim()).filter(Boolean) : [],
        // 서버가 scopeTeam(레거시 대표값)도 배열 첫 요소로 채우지만, 명시적으로 같이 보내 호환 보장.
        scopeTeam: form.scope === "TEAM" ? (form.scopeTeams[0]?.trim() || null) : null,
        projectIds: form.scope === "PROJECT" ? form.scopeProjectIds : [],
        projectId: form.scope === "PROJECT" ? (form.scopeProjectIds[0] || null) : null,
        iconUrl: form.iconUrl.trim() || null,
        iconShape: form.iconShape,
      };
      // 비밀번호: 명시적으로 지우기 선택 시 null, 새 값 있으면 보냄, 빈 값이면 변경 없음(PATCH).
      if (form.clearPassword) {
        payload.password = null;
      } else if (form.password) {
        payload.password = form.password;
      } else if (editing === "new") {
        // 생성 시 빈 값이면 저장하지 않는다 (undefined 동등).
      }
      if (editing === "new") {
        await api("/api/service-accounts", { method: "POST", json: payload });
      } else if (typeof editing === "string") {
        await api(`/api/service-accounts/${editing}`, { method: "PATCH", json: payload });
      }
      closeModal();
      await load();
    } catch (err: any) {
      setFormErr(err?.message ?? "저장에 실패했어요.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(a: Account) {
    const ok = await confirmAsync({
      title: "이 계정 항목을 삭제할까요?",
      description: `"${a.serviceName}" 에 대한 기록이 사라집니다. (실제 서비스 계정은 영향받지 않아요)`,
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api(`/api/service-accounts/${a.id}`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      alertAsync({ title: "삭제 실패", description: e?.message ?? "다시 시도해주세요" });
    }
  }

  async function copyId(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      alertAsync({ title: "복사됨", description: "로그인 ID 를 클립보드에 복사했어요." });
    } catch {
      window.prompt("복사하세요", text);
    }
  }

  const scopeTabs: { key: ScopeTab; label: string }[] = [
    { key: "ALL_TAB", label: "전체" },
    { key: "ALL", label: "전사" },
    { key: "TEAM", label: "팀" },
    { key: "PROJECT", label: "프로젝트" },
  ];

  return (
    <div className="container-narrow py-6">
      <PageHeader
        eyebrow="팀 리소스"
        title="계정 관리"
        description="AWS · Vercel · 테스트 계정 등 팀이 쓰는 서비스 계정을 한 곳에서 관리해요. ⚠️ 비밀번호는 저장하지 마세요."
        right={
          <button className="btn-primary" onClick={openCreate}>+ 계정 추가</button>
        }
      />

      {/* 경고 배너 */}
      <div className="panel p-3 mb-4 bg-amber-50 border border-amber-200 text-[12px] text-amber-800 flex items-start gap-2">
        <span className="text-base leading-none">🔐</span>
        <div>
          <div className="font-bold">비밀번호는 암호화해서 저장돼요 (AES-256-GCM).</div>
          <div className="mt-0.5 text-amber-700">공용 계정의 비밀번호만 여기에 기록하고, 개인 비번·루트 키·2차 인증 백업 코드는 1Password / Bitwarden 같은 전용 도구를 쓰세요. 비번 열람은 작성자와 관리자만 가능해요.</div>
        </div>
      </div>

      {/* 스코프 탭 */}
      <div className="flex items-center gap-1 mb-3 border-b border-ink-200 overflow-x-auto">
        {scopeTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setScopeTab(t.key); if (t.key !== "PROJECT") setFilterProjectId(""); }}
            className={`px-3 py-2 text-[12px] font-bold whitespace-nowrap border-b-2 -mb-px transition-colors ${
              scopeTab === t.key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-ink-500 hover:text-ink-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 프로젝트 칩 필터 (PROJECT 탭일 때만) */}
      {scopeTab === "PROJECT" && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <button
            onClick={() => setFilterProjectId("")}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${
              filterProjectId === "" ? "bg-brand-600 text-white border-brand-600" : "bg-white text-ink-600 border-ink-200 hover:border-ink-300"
            }`}
          >
            전체 프로젝트
          </button>
          {projects.length === 0 ? (
            <span className="text-[11px] text-ink-400 px-2">참여 중인 프로젝트가 없어요.</span>
          ) : projects.map((p) => (
            <button
              key={p.id}
              onClick={() => setFilterProjectId(p.id)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                filterProjectId === p.id ? "text-white border-transparent" : "bg-white text-ink-700 border-ink-200 hover:border-ink-300"
              }`}
              style={filterProjectId === p.id ? { background: p.color } : undefined}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: filterProjectId === p.id ? "#ffffff" : p.color }} />
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* 검색 + 카테고리 필터 */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          className="input flex-1"
          placeholder="서비스 이름·로그인 ID·담당자·메모 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={80}
        />
        <select
          className="input sm:w-40"
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value as Category | "ALL")}
        >
          <option value="ALL">전체 카테고리</option>
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>{CATEGORY_META[c].emoji} {CATEGORY_META[c].label}</option>
          ))}
        </select>
      </div>

      {loadErr && (
        <div className="mb-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-[12px] text-rose-700 flex items-center justify-between gap-2">
          <span>{loadErr}</span>
          <button className="btn-ghost !h-7 !px-2.5 text-[11px]" onClick={load}>다시 시도</button>
        </div>
      )}

      {loading ? (
        <div className="panel py-14 text-center t-caption">불러오는 중…</div>
      ) : accounts.length === 0 ? (
        <div className="panel py-14 text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-ink-100 grid place-items-center mb-3 text-xl">🔑</div>
          <div className="text-[13px] font-bold text-ink-800">아직 등록된 계정이 없어요</div>
          <div className="text-[12px] text-ink-500 mt-1">우측 상단 <b>+ 계정 추가</b> 버튼으로 첫 계정을 등록해보세요.</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel py-14 text-center">
          <div className="text-[13px] font-bold text-ink-800">일치하는 계정이 없어요</div>
          <div className="text-[12px] text-ink-500 mt-1">검색어나 필터를 바꿔보세요.</div>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ category, items }) => {
            const meta = CATEGORY_META[category];
            return (
              <section key={category}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold text-ink-500 uppercase tracking-[0.08em]">
                    <span>{meta.emoji}</span>
                    <span>{meta.label}</span>
                    <span className="text-ink-400 tabular">· {items.length}</span>
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {items.map((a) => (
                    <AccountCard
                      key={a.id}
                      a={a}
                      canEdit={canEdit(a)}
                      onEdit={() => openEdit(a)}
                      onDelete={() => remove(a)}
                      onCopy={() => a.loginId && copyId(a.loginId)}
                      onToggleActive={async () => {
                        // 낙관적 업데이트 — 실패 시 load() 로 서버값으로 복구.
                        const next = !a.active;
                        setAccounts((prev) => prev.map((x) => (x.id === a.id ? { ...x, active: next } : x)));
                        try {
                          await api(`/api/service-accounts/${a.id}`, { method: "PATCH", json: { active: next } });
                        } catch (e: any) {
                          await alertAsync({ title: "변경 실패", description: e?.message ?? "활성 상태를 바꾸지 못했어요." });
                          load();
                        }
                      }}
                      onCopyPassword={async () => {
                        // 본인 로그인 비번 재확인 — promptAsync 의 password 타입으로 화면에 안 보이게 입력받음.
                        const myPw = await promptAsync({
                          title: "본인 확인",
                          description: `"${a.serviceName}" 의 비밀번호를 보려면 로그인 비밀번호를 다시 입력해주세요.`,
                          placeholder: "로그인 비밀번호",
                          inputType: "password",
                          confirmLabel: "확인",
                        });
                        if (!myPw) return;
                        try {
                          const r = await api<{ password: string | null }>(`/api/service-accounts/${a.id}/password`, {
                            method: "POST",
                            json: { password: myPw },
                          });
                          if (!r.password) {
                            await alertAsync({ title: "저장된 비밀번호가 없어요" });
                            return;
                          }
                          try {
                            await navigator.clipboard.writeText(r.password);
                            alertAsync({ title: "복사됨", description: "비밀번호를 클립보드에 복사했어요. 사용 후 다른 내용을 복사해 지우세요." });
                          } catch {
                            window.prompt("비밀번호", r.password);
                          }
                        } catch (e: any) {
                          alertAsync({ title: "열람 실패", description: e?.message ?? "권한이 없거나 비밀번호가 일치하지 않아요." });
                        }
                      }}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {editing && (
        <AccountModal
          mode={editing === "new" ? "new" : "edit"}
          form={form}
          setForm={setForm}
          users={users}
          projects={projects}
          myTeam={myTeam}
          saving={saving}
          err={formErr}
          onClose={closeModal}
          onSubmit={submit}
        />
      )}
    </div>
  );
}

function ScopeBadge({ a }: { a: Account }) {
  // 라이트/다크 겸용 — 다크에선 토널한 배경(색상/10~15% 알파)으로 자연스럽게 녹아들게.
  //   bg-*-50 은 다크 모드에선 눈에 거슬리게 튀어서 dark: 변종으로 톤 다운.
  const base = "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold border";
  if (a.scope === "ALL") {
    return <span className={`${base} bg-ink-100 text-ink-600 border-ink-200 dark:bg-white/5 dark:text-ink-300 dark:border-white/10`}>전사</span>;
  }
  if (a.scope === "TEAM") {
    const teams = (a.scopeTeams?.length ? a.scopeTeams : a.scopeTeam ? [a.scopeTeam] : []);
    const label = teams.length <= 2 ? teams.join(", ") : `${teams[0]} 외 ${teams.length - 1}개`;
    return <span className={`${base} bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-400/10 dark:text-sky-300 dark:border-sky-400/20`}>팀 · {label || "-"}</span>;
  }
  // PROJECT
  const extraCount = Math.max(0, (a.projectIds?.length ?? 0) - 1);
  return (
    <span className={`${base} gap-1 bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-400/10 dark:text-violet-300 dark:border-violet-400/20`}>
      {a.project?.color && <span className="w-1.5 h-1.5 rounded-full" style={{ background: a.project.color }} />}
      프로젝트 · {a.project?.name ?? "-"}{extraCount > 0 ? ` 외 ${extraCount}개` : ""}
    </span>
  );
}

function AccountCard({
  a, canEdit, onEdit, onDelete, onCopy, onCopyPassword, onToggleActive,
}: {
  a: Account;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onCopyPassword: () => void;
  onToggleActive: () => void;
}) {
  const meta = CATEGORY_META[a.category];
  // 아이콘 해상 순서:
  //   0) 사용자가 업로드한 iconUrl 이 있으면 그대로 사용 (최우선)
  //   1) URL 이 있으면 그 도메인의 파비콘
  //   2) 서비스 이름에서 유명 브랜드 매칭 (instagram, microsoft 등) — 화이트리스트
  //   3) 서비스 이름을 ascii 슬러그로 바꿔 <slug>.com 추정 시도
  //   4) 그래도 실패하면 카테고리 이모지
  const host = useMemo(() => guessHost(a.url, a.serviceName), [a.url, a.serviceName]);
  const [iconErr, setIconErr] = useState(false);
  const iconSrc = !iconErr
    ? a.iconUrl || (host ? `https://www.google.com/s2/favicons?domain=${host}&sz=64` : null)
    : null;
  return (
    <div className={`panel p-4 relative transition-opacity ${a.active ? "" : "opacity-60"}`}>
      <div className="flex items-start gap-3">
        {/* 앱 아이콘 스타일 — SQUIRCLE(iOS 스퀘어클) 또는 CIRCLE(원형). 로고가 둥근 브랜드는 CIRCLE 로.
             이미지는 잘리지 않게 object-contain + 살짝 패딩 — 파비콘/업로드 로고가 찌그러지지 않도록. */}
        <div
          className="w-10 h-10 grid place-items-center flex-shrink-0 overflow-hidden ring-1 ring-black/5 shadow-sm"
          style={{
            borderRadius: a.iconShape === "CIRCLE" ? "9999px" : "22%",
            background: iconSrc
              ? "linear-gradient(180deg, var(--c-surface) 0%, var(--c-surface-3) 100%)"
              : `linear-gradient(180deg, ${meta.color} 0%, ${meta.color}dd 100%)`,
            color: "#fff",
          }}
        >
          {iconSrc ? (
            <img
              src={iconSrc}
              alt=""
              className="w-[78%] h-[78%] object-contain"
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setIconErr(true)}
            />
          ) : (
            <span className="text-lg leading-none">{meta.emoji}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[14px] font-extrabold text-ink-900 truncate">{a.serviceName}</div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-[11px] text-ink-500">{meta.label}</span>
                <ScopeBadge a={a} />
                {!a.active && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-ink-100 text-ink-500 border border-ink-200">
                    비활성
                  </span>
                )}
              </div>
            </div>
            {canEdit && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {/* 활성 토글 — 다른 페이지(슈퍼관리자 메뉴 관리 / 마이페이지 알림)와
                    동일한 inline-style 패턴으로 통일. 종전 Tailwind inline-block + align-middle
                    조합이 옆 버튼들의 baseline 정렬과 부딪혀 thumb 가 잘려 보이는 버그가 있었음. */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={a.active}
                  onClick={onToggleActive}
                  title={a.active ? "비활성화" : "활성화"}
                  style={{
                    position: "relative",
                    width: 36,
                    height: 20,
                    borderRadius: 999,
                    border: 0,
                    cursor: "pointer",
                    background: a.active ? "var(--c-brand)" : "var(--c-border-strong)",
                    transition: "background .18s ease",
                    flexShrink: 0,
                    padding: 0,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      top: 2,
                      left: a.active ? 18 : 2,
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: "#fff",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                      transition: "left .18s ease",
                    }}
                  />
                </button>
                <span className="h-5 w-px bg-ink-200" aria-hidden />
                <button className="btn-ghost !h-7 !px-2.5 text-[11px]" onClick={onEdit} title="편집">편집</button>
                <button className="btn-ghost !h-7 !px-2.5 text-[11px] text-danger" onClick={onDelete} title="삭제">삭제</button>
              </div>
            )}
          </div>

          <div className="mt-2.5 space-y-1.5 text-[12px]">
            {a.loginId && (
              <div className="flex items-center gap-1.5 text-ink-700">
                <span className="text-ink-400 w-14 flex-shrink-0">로그인</span>
                <span className="tabular truncate font-medium">{a.loginId}</span>
                <button className="btn-ghost !h-6 !px-2 text-[10px]" onClick={onCopy} title="복사">복사</button>
              </div>
            )}
            {a.hasPassword && (
              <div className="flex items-center gap-1.5 text-ink-700">
                <span className="text-ink-400 w-14 flex-shrink-0">비밀번호</span>
                <span className="tabular truncate font-medium text-ink-500">••••••••</span>
                <button
                  className="btn-ghost !h-6 !px-2 text-[10px]"
                  onClick={onCopyPassword}
                  title="비밀번호 복사 (본인 비번 재확인)"
                >
                  복사
                </button>
              </div>
            )}
            {a.url && (
              <div className="flex items-center gap-1.5 text-ink-700">
                <span className="text-ink-400 w-14 flex-shrink-0">URL</span>
                {/* href 는 http(s) 만 허용 — javascript:/data: 스킴 저장형 XSS 차단.
                    안전하지 않으면 링크 대신 평문으로만 노출(텍스트는 React 가 escape). */}
                {safeExternalUrl(a.url) ? (
                  <a href={safeExternalUrl(a.url)!} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline truncate">
                    {a.url}
                  </a>
                ) : (
                  <span className="truncate text-ink-500" title={a.url}>{a.url}</span>
                )}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-ink-700">
              <span className="text-ink-400 w-14 flex-shrink-0">담당자</span>
              {a.ownerUser ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="w-5 h-5 rounded-full grid place-items-center text-white text-[10px] font-bold overflow-hidden"
                    style={{ background: a.ownerUser.avatarUrl ? "transparent" : a.ownerUser.avatarColor }}
                  >
                    {a.ownerUser.avatarUrl ? (
                      <img src={a.ownerUser.avatarUrl} alt={a.ownerUser.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
                    ) : (
                      a.ownerUser.name[0]
                    )}
                  </span>
                  <span className="font-medium">{a.ownerUser.name}</span>
                  {a.ownerUser.team && <span className="text-ink-400 text-[11px]">· {a.ownerUser.team}</span>}
                </span>
              ) : a.ownerName ? (
                <span className="font-medium">{a.ownerName} <span className="text-ink-400 text-[11px]">· 외부</span></span>
              ) : (
                <span className="text-ink-400">미지정</span>
              )}
            </div>
            {a.notes && (
              <div className="mt-1.5 pt-1.5 border-t border-ink-100 text-ink-600 whitespace-pre-wrap break-words text-[11.5px]">{a.notes}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 팀 공유 다중 편집기 — 칩 + 입력창 + "+" 버튼. Enter/쉼표로도 추가. */
function MultiTeamEditor({
  teams, myTeam, onChange,
}: {
  teams: string[];
  myTeam: string;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  function add(raw: string) {
    const t = raw.trim();
    if (!t) return;
    if (teams.includes(t)) return;
    onChange([...teams, t]);
    setDraft("");
  }
  function remove(t: string) {
    onChange(teams.filter((x) => x !== t));
  }
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {teams.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full border text-[11px] font-semibold px-2 py-0.5 bg-brand-50 border-brand-200 text-brand-800 dark:bg-brand-500/15 dark:border-brand-400/30 dark:text-brand-200">
            {t}
            <button type="button" onClick={() => remove(t)} className="text-brand-600 hover:text-brand-900 dark:text-brand-300 dark:hover:text-brand-100" aria-label={`${t} 제거`}>×</button>
          </span>
        ))}
        {teams.length === 0 && <span className="text-[11px] text-ink-400">아직 추가된 팀이 없어요.</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          className="input flex-1"
          placeholder={myTeam ? `예: ${myTeam}` : "팀 이름"}
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && teams.length > 0) {
              // 입력란이 비어있을 때 백스페이스로 마지막 칩 제거.
              onChange(teams.slice(0, -1));
            }
          }}
        />
        <button type="button" className="btn-ghost !px-2.5 !py-1.5 text-[11px] font-bold" onClick={() => add(draft)}>
          + 추가
        </button>
      </div>
    </div>
  );
}

/** 프로젝트 공유 다중 편집기 — 선택된 프로젝트는 칩, 나머지는 드롭다운으로 추가. */
function MultiProjectEditor({
  selected, projects, onChange,
}: {
  selected: string[];
  projects: ProjectChip[];
  onChange: (next: string[]) => void;
}) {
  const available = projects.filter((p) => !selected.includes(p.id));
  function add(id: string) {
    if (!id || selected.includes(id)) return;
    onChange([...selected, id]);
  }
  function remove(id: string) {
    onChange(selected.filter((x) => x !== id));
  }
  const selectedChips = selected
    .map((id) => projects.find((p) => p.id === id))
    .filter(Boolean) as ProjectChip[];
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {selectedChips.map((p) => (
          <span key={p.id} className="inline-flex items-center gap-1 rounded-full border text-[11px] font-semibold px-2 py-0.5" style={{ background: `${p.color}18`, borderColor: `${p.color}55`, color: p.color }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
            {p.name}
            <button type="button" onClick={() => remove(p.id)} className="hover:opacity-70" aria-label={`${p.name} 제거`}>×</button>
          </span>
        ))}
        {selectedChips.length === 0 && <span className="text-[11px] text-ink-400">아직 선택된 프로젝트가 없어요.</span>}
      </div>
      {available.length > 0 && (
        <select
          className="input"
          value=""
          onChange={(e) => { add(e.target.value); e.currentTarget.value = ""; }}
        >
          <option value="">+ 프로젝트 추가…</option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}

function AccountModal({
  mode, form, setForm, users, projects, myTeam, saving, err, onClose, onSubmit,
}: {
  mode: "new" | "edit";
  form: FormState;
  setForm: (f: FormState) => void;
  users: DirUser[];
  projects: ProjectChip[];
  myTeam: string;
  saving: boolean;
  err: string | null;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const [showPw, setShowPw] = useState(false);
  const [iconUploading, setIconUploading] = useState(false);
  const [iconErr, setIconErr] = useState<string | null>(null);

  // 모달 미리보기용 — 저장 전에도 현재 선택이 어떻게 보일지 바로 확인.
  const previewHost = useMemo(
    () => guessHost(form.url.trim() || null, form.serviceName),
    [form.url, form.serviceName],
  );
  const previewSrc = form.iconUrl
    || (previewHost ? `https://www.google.com/s2/favicons?domain=${previewHost}&sz=64` : null);

  async function onPickIcon(file: File) {
    if (!file.type.startsWith("image/")) {
      setIconErr("이미지 파일만 업로드할 수 있어요.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setIconErr("10MB 이하 이미지를 사용해주세요.");
      return;
    }
    setIconUploading(true);
    setIconErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(apiUrl("/api/upload"), { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "업로드 실패");
      const json = await res.json();
      setForm({ ...form, iconUrl: json.url });
    } catch (e: any) {
      setIconErr(e?.message ?? "업로드 실패");
    } finally {
      setIconUploading(false);
    }
  }

  const scopeOptions: { v: Scope; label: string; hint: string }[] = [
    { v: "ALL", label: "전사", hint: "모든 구성원이 봅니다" },
    { v: "TEAM", label: "팀", hint: "같은 팀만 봅니다" },
    { v: "PROJECT", label: "프로젝트", hint: "프로젝트 멤버만 봅니다" },
  ];

  return (
    <div className="fixed inset-0 bg-ink-900/40 grid place-items-center p-4 z-50" onClick={onClose}>
      <div className="panel w-full max-w-lg shadow-pop" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="계정 편집">
        <div className="section-head">
          <div className="title">{mode === "new" ? "새 계정 추가" : "계정 편집"}</div>
          <button className="btn-icon" onClick={onClose} aria-label="닫기">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <form className="p-5 space-y-3 max-h-[75vh] overflow-auto" onSubmit={onSubmit}>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold text-ink-500">서비스 이름 *</span>
              <input
                className="input"
                placeholder='예: "AWS 프로덕션", "Vercel - hinest"'
                value={form.serviceName}
                maxLength={80}
                required
                autoFocus
                onChange={(e) => setForm({ ...form, serviceName: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold text-ink-500">카테고리</span>
              <select
                className="input"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
              >
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>{CATEGORY_META[c].emoji} {CATEGORY_META[c].label}</option>
                ))}
              </select>
            </label>
          </div>

          {/* 공개 범위 */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-ink-500">공개 범위</span>
            <div className="grid grid-cols-3 gap-1.5">
              {scopeOptions.map((o) => (
                <button
                  type="button"
                  key={o.v}
                  onClick={() => setForm({
                    ...form,
                    scope: o.v,
                    // TEAM 처음 선택 시 내 팀을 기본값으로 세팅. 이미 채워져 있으면 유지.
                    scopeTeams: o.v === "TEAM" && form.scopeTeams.length === 0 && myTeam
                      ? [myTeam]
                      : form.scopeTeams,
                  })}
                  className={`rounded-xl border px-2.5 py-2 text-left transition-all ${
                    form.scope === o.v
                      ? "border-brand-600 bg-brand-50 ring-1 ring-brand-300"
                      : "border-ink-200 bg-white hover:border-ink-300"
                  }`}
                >
                  <div className="text-[12px] font-extrabold text-ink-900">{o.label}</div>
                  <div className="text-[10px] text-ink-500 mt-0.5">{o.hint}</div>
                </button>
              ))}
            </div>
            {form.scope === "TEAM" && (
              <MultiTeamEditor
                teams={form.scopeTeams}
                myTeam={myTeam}
                onChange={(next) => setForm({ ...form, scopeTeams: next })}
              />
            )}
            {form.scope === "PROJECT" && (
              <MultiProjectEditor
                selected={form.scopeProjectIds}
                projects={projects}
                onChange={(next) => setForm({ ...form, scopeProjectIds: next })}
              />
            )}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-ink-500">로그인 ID / 이메일</span>
            <input
              className="input"
              placeholder="예: ops@hinest.com"
              value={form.loginId}
              maxLength={200}
              onChange={(e) => setForm({ ...form, loginId: e.target.value })}
            />
          </label>

          {/* 비밀번호 — 저장은 서버에서 AES-256-GCM 암호화. MFA 우회 및 키 탈취 위험 인지 전제. */}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-ink-500 flex items-center justify-between">
              <span>비밀번호 <span className="text-rose-600 font-normal">(암호화 저장)</span></span>
              {mode === "edit" && (
                <button
                  type="button"
                  className="text-[10px] font-bold text-ink-500 hover:text-rose-600 underline"
                  onClick={() => setForm({ ...form, clearPassword: !form.clearPassword, password: form.clearPassword ? form.password : "" })}
                >
                  {form.clearPassword ? "지우기 취소" : "저장된 비번 지우기"}
                </button>
              )}
            </span>
            <div className="relative">
              <input
                className="input pr-14"
                type={showPw ? "text" : "password"}
                autoComplete="new-password"
                placeholder={mode === "edit" ? "변경 시에만 입력 (비워두면 유지)" : "선택 — 비워두면 저장 안 함"}
                value={form.password}
                maxLength={256}
                disabled={form.clearPassword}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                disabled={form.clearPassword}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-bold text-ink-500 hover:text-ink-800 disabled:opacity-40"
                title={showPw ? "가리기" : "보기"}
              >
                {showPw ? "가리기" : "보기"}
              </button>
            </div>
            <span className="text-[10px] text-amber-700">
              ⚠️ 공용 크레덴셜만 — 개인 비번·2차 인증 백업 코드·root 키는 1Password 같은 전용 도구를 쓰세요.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-ink-500">콘솔 URL</span>
            <input
              className="input"
              type="url"
              placeholder="https://console.aws.amazon.com"
              value={form.url}
              maxLength={500}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
          </label>

          {/* 로고 — 기본은 URL/이름 기반 자동 추측(파비콘/이모지). 원하면 직접 이미지 업로드로 덮어쓴다. */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-ink-500">로고</span>
            <div className="flex items-center gap-2">
              <div
                className="w-12 h-12 grid place-items-center flex-shrink-0 overflow-hidden ring-1 ring-black/5 shadow-sm"
                style={{
                  borderRadius: form.iconShape === "CIRCLE" ? "9999px" : "22%",
                  background: previewSrc
                    ? "linear-gradient(180deg, var(--c-surface) 0%, var(--c-surface-3) 100%)"
                    : `linear-gradient(180deg, ${CATEGORY_META[form.category].color} 0%, ${CATEGORY_META[form.category].color}dd 100%)`,
                  color: "#fff",
                }}
              >
                {previewSrc ? (
                  <img src={previewSrc} alt="" className="w-[78%] h-[78%] object-contain" referrerPolicy="no-referrer" loading="lazy" decoding="async"/>
                ) : (
                  <span className="text-xl leading-none">{CATEGORY_META[form.category].emoji}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-ink-500 mb-1">
                  {form.iconUrl
                    ? "직접 업로드한 로고를 사용해요."
                    : previewHost
                      ? `자동 추측 중: ${previewHost}`
                      : "URL/서비스 이름으로 자동 추측 (실패 시 이모지)"}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* 모양 세그먼트 — 애플·인스타그램처럼 로고가 원형이면 CIRCLE 로 맞춰 잘림 없이 예쁘게. */}
                  <div className="inline-flex rounded-lg border border-ink-200 overflow-hidden text-[10px] font-bold">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, iconShape: "SQUIRCLE" })}
                      className={`px-2 py-1 ${form.iconShape === "SQUIRCLE" ? "bg-ink-900 text-white" : "bg-white text-ink-600"}`}
                      title="둥근 사각형 (앱 아이콘)"
                    >
                      ◻︎ 둥근 사각
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, iconShape: "CIRCLE" })}
                      className={`px-2 py-1 border-l border-ink-200 ${form.iconShape === "CIRCLE" ? "bg-ink-900 text-white" : "bg-white text-ink-600"}`}
                      title="원형"
                    >
                      ◯ 원형
                    </button>
                  </div>
                  <label className="btn-ghost !h-7 !px-2.5 text-[11px] cursor-pointer">
                    {iconUploading ? "업로드 중…" : "이미지 업로드"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={iconUploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) onPickIcon(f);
                      }}
                    />
                  </label>
                  {form.iconUrl && (
                    <button
                      type="button"
                      className="btn-ghost !h-7 !px-2.5 text-[11px] text-rose-600"
                      onClick={() => setForm({ ...form, iconUrl: "" })}
                    >
                      자동 추측으로 되돌리기
                    </button>
                  )}
                </div>
                {iconErr && <div className="text-[10px] text-rose-600 mt-1">{iconErr}</div>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold text-ink-500">담당자 (사내)</span>
              <select
                className="input"
                value={form.ownerUserId}
                onChange={(e) => setForm({ ...form, ownerUserId: e.target.value, ownerName: e.target.value ? "" : form.ownerName })}
              >
                <option value="">선택 안 함</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}{u.team ? ` · ${u.team}` : ""}{u.position ? ` · ${u.position}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold text-ink-500">담당자 (외부)</span>
              <input
                className="input"
                placeholder="사내 유저가 아닐 때 수기 입력"
                value={form.ownerName}
                maxLength={80}
                disabled={!!form.ownerUserId}
                onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-ink-500">메모</span>
            <textarea
              className="input"
              rows={3}
              placeholder="접근 방법, MFA 장치, 요금제 등 자유 메모"
              value={form.notes}
              maxLength={2000}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
            <span className="text-[10px] text-ink-400">⚠️ 메모 칸은 암호화되지 않아요. 비밀번호는 위 "비밀번호" 입력란에, 액세스키·API 토큰은 1Password 등 전용 도구에 두세요.</span>
          </label>

          {err && <div className="text-[12px] text-rose-600 p-2 rounded-lg bg-rose-50 border border-rose-200">{err}</div>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>취소</button>
            <button className="btn-primary" disabled={saving}>
              {saving ? "저장 중…" : (mode === "new" ? "추가" : "저장")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
