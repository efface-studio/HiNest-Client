import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, imgSrc, invalidateCache } from "../api";
import PageHeader from "../components/PageHeader";
import Portal from "../components/Portal";
import { downloadCSV, downloadXLSX, openPrintable, parseSheet, type TableColumn } from "../lib/exportTable";
import DatePicker from "../components/DatePicker";
import TimePicker from "../components/TimePicker";
import { confirmAsync, alertAsync, promptAsync } from "../components/ConfirmHost";
import { useAuth } from "../auth";

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  team?: string | null;
  position?: string | null;
  active: boolean;
  // 퇴사일 — 설정되어 있으면 퇴사자. 로그인은 active=false 로 이미 차단됨.
  resignedAt?: string | null;
  avatarColor?: string;
  avatarUrl?: string | null;
  createdAt: string;
  // HR 상세
  hrCode?: string | null;
  affiliation?: string | null;
  employeeNo?: string | null;
  workplace?: string | null;
  department?: string | null;
  jobDuty?: string | null;
  employmentType?: string | null;
  employmentCategory?: string | null;
  contractType?: string | null;
  birthDate?: string | null;
  gender?: string | null;
  disabilityType?: string | null;
  disabilityLevel?: string | null;
  hireDate?: string | null;
  phone?: string | null;
  note?: string | null;
  autoClockOutTime?: string | null;
  workStartTime?: string | null;
  workEndTime?: string | null;
  failedLoginCount?: number;
  lockedAt?: string | null;
};

// 나이 계산 (생년월일 기반)
function calcAge(birth?: string | null): number | "" {
  if (!birth) return "";
  const d = new Date(birth);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}
// 근속연수 (입사일 기반, 소수점 1자리)
function calcTenure(hire?: string | null): number | "" {
  if (!hire) return "";
  const d = new Date(hire);
  if (isNaN(d.getTime())) return "";
  const years = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
  return Math.max(0, Math.round(years * 10) / 10);
}

// 상세 뷰 select 옵션 — 고정 리스트. "기타" 선택 시 직접 입력 가능.
const EMPLOYMENT_TYPES = ["정규직", "계약직", "파견직", "인턴", "아르바이트"];
const EMPLOYMENT_CATEGORIES = ["무기계약", "유기계약", "일용직"];
const CONTRACT_TYPES = ["기간제", "무기계약직", "정규직"];
const GENDERS = ["남", "여"];
const DISABILITY_TYPES = ["지체장애", "청각장애", "시각장애", "뇌병변장애", "언어장애", "지적장애", "자폐성장애", "정신장애", "신장장애", "심장장애", "호흡기장애", "간장애", "안면장애", "장루·요루장애", "뇌전증장애"];
const DISABILITY_LEVELS = ["중증", "경증"];

// 엑셀/PDF 내보내기 컬럼 — 스크린샷 포맷 (권한/상태 제외).
const HR_EXPORT_COLUMNS: TableColumn<UserRow>[] = [
  { header: "HR번호", get: (u) => u.hrCode ?? "" },
  { header: "소속", get: (u) => u.affiliation ?? "" },
  { header: "사번", get: (u) => u.employeeNo ?? "" },
  { header: "근무지", get: (u) => u.workplace ?? "" },
  { header: "부서", get: (u) => u.department ?? u.team ?? "" },
  { header: "직무", get: (u) => u.jobDuty ?? "" },
  { header: "이름", get: (u) => u.name },
  { header: "직급", get: (u) => u.position ?? "" },
  { header: "고용형태", get: (u) => u.employmentType ?? "" },
  { header: "고용유형", get: (u) => u.employmentCategory ?? "" },
  { header: "계약형태", get: (u) => u.contractType ?? "" },
  { header: "생년월일", get: (u) => u.birthDate ?? "" },
  { header: "성별", get: (u) => u.gender ?? "" },
  { header: "나이", get: (u) => calcAge(u.birthDate) },
  { header: "장애유형", get: (u) => u.disabilityType ?? "" },
  { header: "장애정도", get: (u) => u.disabilityLevel ?? "" },
  { header: "입사일", get: (u) => u.hireDate ?? "" },
  { header: "근속", get: (u) => calcTenure(u.hireDate) },
  { header: "전화번호", get: (u) => u.phone ?? "" },
  { header: "비고", get: (u) => u.note ?? "" },
];

// 엑셀 헤더 → User 필드 매핑 (import 용)
const HR_IMPORT_HEADER_MAP: Record<string, string> = {
  "HR번호": "hrCode",
  "소속": "affiliation",
  "사번": "employeeNo",
  "근무지": "workplace",
  "부서": "department",
  "직무": "jobDuty",
  "이름": "name",
  "직급": "position",
  "고용형태": "employmentType",
  "고용유형": "employmentCategory",
  "계약형태": "contractType",
  "생년월일": "birthDate",
  "성별": "gender",
  "장애유형": "disabilityType",
  "장애정도": "disabilityLevel",
  "입사일": "hireDate",
  "전화번호": "phone",
  "비고": "note",
  "이메일": "email",
  "email": "email",
  "팀": "team",
};

/**
 * 엑셀 파일을 파싱해 /api/admin/users/import 로 업로드.
 * 헤더 매핑은 HR_IMPORT_HEADER_MAP 기준, 매칭 안 되는 컬럼은 무시.
 * 매칭 식별자(email/사번/HR번호) 중 하나는 반드시 있어야 서버가 업서트함.
 */
async function handleImport(
  e: React.ChangeEvent<HTMLInputElement>,
  reload: () => void | Promise<void>
) {
  const input = e.currentTarget;
  const file = input.files?.[0];
  // 같은 파일 재선택 시에도 onChange 가 다시 발화하도록 value 리셋
  input.value = "";
  if (!file) return;

  try {
    const raw = await parseSheet(file);
    if (raw.length === 0) {
      await alertAsync({ title: "업로드 실패", description: "빈 파일이거나 읽을 수 있는 행이 없어요." });
      return;
    }
    const rows = raw.map((r) => {
      const mapped: Record<string, string> = {};
      for (const [header, value] of Object.entries(r)) {
        const field = HR_IMPORT_HEADER_MAP[header];
        if (field && value) mapped[field] = value;
      }
      return mapped;
    });
    const ok = await confirmAsync({
      title: "HR 일괄 업로드",
      description: `${rows.length}행을 업로드할게요. 기존 유저의 HR 정보가 갱신돼요. 계속할까요?`,
      confirmLabel: "업로드",
    });
    if (!ok) return;
    const r = await api<{ updated: number; skipped: number; errors: string[] }>(
      "/api/admin/users/import",
      { method: "POST", json: { rows } }
    );
    let msg = `업데이트 ${r.updated}건 · 스킵 ${r.skipped}건`;
    if (r.errors?.length) msg += `\n\n${r.errors.join("\n")}`;
    await alertAsync({ title: "업로드 완료", description: msg });
    await reload();
  } catch (err: any) {
    alertAsync({ title: "업로드 실패", description: err?.message ?? String(err) });
  }
}
type Invite = {
  id: string;
  key: string;
  email?: string | null;
  name?: string | null;
  role: string;
  team?: string | null;
  position?: string | null;
  used: boolean;
  usedAt?: string | null;
  usedBy?: { name: string; email: string } | null;
  expiresAt?: string | null;
  createdAt: string;
};
type Team = { id: string; name: string; createdAt: string };
type Position = { id: string; name: string; rank: number; createdAt: string };

type Tab = "users" | "invites" | "teams" | "positions" | "ip";

// 내보내기 버튼에 쓰는 작은 브랜드 로고들. 외부 에셋 없이 inline SVG 로 둬서
// 번들 사이즈/네트워크 요청 영향 없음. 크기는 16px 고정 — 버튼 높이(32)에 맞춘 값.
function ExcelLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="0.5" y="0.5" width="15" height="15" rx="2" fill="#107C41" />
      <path
        d="M4.6 4.4 L7.2 8 L4.6 11.6 H6.3 L8.0 9.1 L9.7 11.6 H11.4 L8.8 8 L11.4 4.4 H9.7 L8.0 6.9 L6.3 4.4 Z"
        fill="#ffffff"
      />
    </svg>
  );
}
function CsvLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 1.5 A0.5 0.5 0 0 1 3.5 1 H10 L13 4 V14.5 A0.5 0.5 0 0 1 12.5 15 H3.5 A0.5 0.5 0 0 1 3 14.5 Z"
        fill="#64748B"
      />
      <path d="M10 1 V4 H13 Z" fill="#94A3B8" />
      <rect x="5" y="7" width="6" height="1" fill="#ffffff" />
      <rect x="5" y="9.2" width="6" height="1" fill="#ffffff" />
      <rect x="5" y="11.4" width="4" height="1" fill="#ffffff" />
    </svg>
  );
}
function PdfLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 1.5 A0.5 0.5 0 0 1 3.5 1 H10 L13 4 V14.5 A0.5 0.5 0 0 1 12.5 15 H3.5 A0.5 0.5 0 0 1 3 14.5 Z"
        fill="#DC2626"
      />
      <path d="M10 1 V4 H13 Z" fill="#F87171" />
      <text
        x="8"
        y="12"
        textAnchor="middle"
        fontSize="4.2"
        fontWeight="700"
        fontFamily="Arial, Helvetica, sans-serif"
        fill="#ffffff"
      >
        PDF
      </text>
    </svg>
  );
}

export default function AdminPage() {
  // 새로고침해도 현재 탭 유지되도록 URL 쿼리로 동기화.
  const [sp, setSp] = useSearchParams();
  const tab = (["users", "invites", "teams", "positions", "ip"].includes(sp.get("tab") ?? "")
    ? (sp.get("tab") as Tab)
    : "users") as Tab;
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(sp);
    if (t === "users") next.delete("tab");
    else next.set("tab", t);
    setSp(next, { replace: true });
  };
  const [users, setUsers] = useState<UserRow[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);

  // 권한/팀 변경 연타 시 이전 reload() 응답이 나중에 도착해 최신 상태를 덮는 레이스 방지.
  // 언마운트 후 setState 호출도 동시에 막음.
  const aliveRef = useRef(true);
  const reloadTokenRef = useRef(0);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  async function loadCommon() {
    const myToken = ++reloadTokenRef.current;
    const [u, i, t, p] = await Promise.all([
      api<{ users: UserRow[] }>("/api/admin/users"),
      api<{ keys: Invite[] }>("/api/admin/invites"),
      api<{ teams: Team[] }>("/api/admin/teams"),
      api<{ positions: Position[] }>("/api/admin/positions"),
    ]);
    // 최신 호출이 아니거나 언마운트됐으면 무시.
    if (!aliveRef.current || myToken !== reloadTokenRef.current) return;
    setUsers(u.users);
    setInvites(i.keys);
    setTeams(t.teams);
    setPositions(p.positions);
  }

  useEffect(() => { loadCommon(); }, []);

  const TABS: { key: Tab; label: string; count: number; icon: JSX.Element }[] = [
    { key: "users", label: "구성원", count: users.length, icon: <UsersIcon /> },
    { key: "invites", label: "초대키", count: invites.filter((k) => !k.used).length, icon: <KeyIcon /> },
    { key: "teams", label: "팀", count: teams.length, icon: <TeamIcon /> },
    { key: "positions", label: "직급", count: positions.length, icon: <RankIcon /> },
    { key: "ip", label: "출근 IP", count: 0, icon: <RankIcon /> },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="관리"
        title="관리자"
        description="구성원·초대키·팀·직급을 관리합니다."
      />

      {/* 통계 — 모바일·iPad 는 한 줄 요약, 데스크톱은 카드 */}
      <div className="md:hidden flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-500 mb-4">
        <span className="font-bold text-ink-900">구성원 {users.length}</span>
        <span className="text-ink-300">·</span>
        <span>활성 <b className="text-ink-800 font-bold">{users.filter((u) => u.active).length}</b></span>
        <span className="text-ink-300">·</span>
        <span>팀 <b className="text-ink-800 font-bold">{teams.length}</b></span>
        <span className="text-ink-300">·</span>
        <span>직급 <b className="text-ink-800 font-bold">{positions.length}</b></span>
        <span className="text-ink-300">·</span>
        <span>미사용 초대키 <b className="text-ink-800 font-bold">{invites.filter((k) => !k.used).length}</b></span>
      </div>
      <div className="hidden md:grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="전체 구성원" value={users.length} sub={`활성 ${users.filter((u) => u.active).length}명`} />
        <StatCard label="미사용 초대키" value={invites.filter((k) => !k.used).length} sub={`총 ${invites.length}건 발급`} />
        <StatCard label="팀" value={teams.length} sub="전사 팀 수" />
        <StatCard label="직급" value={positions.length} sub="전사 직급 수" />
      </div>

      {/* 탭 — 모바일에서 좌우 스와이프 스크롤. touch-action:pan-x 로 세로 페이지 스크롤과 충돌 차단,
           -webkit-overflow-scrolling:touch 로 iOS momentum, scrollbar 숨겨 깔끔하게.
           w-max 는 min-w-max 와 달리 inline 컨테이너에서도 안정적으로 자식 폭 확보. */}
      <div
        className="hinest-x-scroll mb-5 border-b border-ink-150 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0"
        style={{ touchAction: "pan-x", WebkitOverflowScrolling: "touch" }}
      >
        <div className="flex items-center gap-1 w-max">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`group relative inline-flex items-center gap-2 px-4 h-[40px] text-[13px] font-bold transition whitespace-nowrap ${
                tab === t.key ? "text-ink-900" : "text-ink-500 hover:text-ink-800"
              }`}
            >
              <span className={tab === t.key ? "text-brand-500" : "text-ink-400 group-hover:text-ink-600"}>{t.icon}</span>
              {t.label}
              <span className="ml-0.5 text-[11px] text-ink-400 tabular font-semibold">{t.count}</span>
              {tab === t.key && (
                <span className="absolute -bottom-px left-2 right-2 h-[2px] bg-brand-500 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {tab === "users" && <UsersTab users={users} teams={teams} positions={positions} reload={loadCommon} />}
      {tab === "invites" && <InvitesTab invites={invites} teams={teams} positions={positions} reload={loadCommon} />}
      {tab === "teams" && <TeamsTab teams={teams} reload={loadCommon} />}
      {tab === "positions" && <PositionsTab positions={positions} reload={loadCommon} />}
      {tab === "ip" && <AttendanceIpTab />}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="panel p-4">
      <div className="text-[11px] font-bold text-ink-500 uppercase tracking-[0.06em]">{label}</div>
      <div className="text-[26px] font-extrabold text-ink-900 mt-1.5 tabular" style={{ letterSpacing: "-0.03em" }}>
        {value.toLocaleString()}
      </div>
      <div className="text-[11px] text-ink-500 mt-0.5">{sub}</div>
    </div>
  );
}

/* ===================== Users ===================== */
function UsersTab({
  users, teams, positions, reload,
}: { users: UserRow[]; teams: Team[]; positions: Position[]; reload: () => void }) {
  const { user: me } = useAuth();
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  // "resigned" 는 퇴사자(resignedAt != null) 만 — 재직 중 inactive 와 구분.
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive" | "resigned">("active");
  const [attendanceTarget, setAttendanceTarget] = useState<UserRow | null>(null);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [resignTarget, setResignTarget] = useState<UserRow | null>(null);
  // 기본 뷰(컴팩트) ↔ 상세 뷰(엑셀 포맷 전 컬럼)
  const [view, setView] = useState<"basic" | "detail">("basic");

  const nav = useNavigate();
  const [updateErr, setUpdateErr] = useState<string | null>(null);

  async function update(id: string, data: any) {
    setUpdateErr(null);
    try {
      await api(`/api/admin/users/${id}`, { method: "PATCH", json: data });
      reload();
    } catch (e: any) {
      const msg: string = e?.message ?? "변경에 실패했습니다.";
      // 역할 변경은 개발자 step-up 세션이 필요함. 안내 + 이동 유도.
      if (msg.includes("비밀번호 재확인") || msg.includes("SUPER_STEPUP")) {
        setUpdateErr("역할 변경은 개발자 세션이 필요합니다. /super-admin 에서 비밀번호 재확인 후 다시 시도해주세요.");
        const ok = await confirmAsync({
          title: "개발자 재인증",
          description: "역할 변경은 개발자 재인증이 필요해요.\n지금 개발자 페이지로 이동할까요?",
          confirmLabel: "이동",
        });
        if (ok) nav("/super-admin");
      } else {
        setUpdateErr(msg);
      }
      // UI 의 select 를 원래 값으로 되돌리기 위해 reload.
      reload();
    }
  }
  async function remove(id: string) {
    const ok = await confirmAsync({
      title: "구성원 삭제",
      description: "정말 삭제할까요? 모든 관련 데이터가 삭제돼요.",
      tone: "danger",
      confirmLabel: "삭제",
    });
    if (!ok) return;
    try {
      await api(`/api/admin/users/${id}`, { method: "DELETE" });
      reload();
    } catch (e: any) {
      setUpdateErr(e?.message ?? "삭제에 실패했습니다.");
    }
  }

  const filtered = useMemo(() => {
    let arr = users;
    if (roleFilter) arr = arr.filter((u) => u.role === roleFilter);
    // 재직/비활성/퇴사 구분:
    //  - active: 재직 중(resignedAt 없고 active=true)
    //  - inactive: 임시 비활성(active=false 지만 resignedAt 없는 경우)
    //  - resigned: 퇴사자(resignedAt 있음) — 'all' 에서는 기본 노출에서 제외해 어드민이 일부러 봐야 보이게.
    if (activeFilter === "active") arr = arr.filter((u) => u.active && !u.resignedAt);
    else if (activeFilter === "inactive") arr = arr.filter((u) => !u.active && !u.resignedAt);
    else if (activeFilter === "resigned") arr = arr.filter((u) => !!u.resignedAt);
    else arr = arr.filter((u) => !u.resignedAt); // 'all' 은 재직 중(활성+비활성) 전원
    const k = q.trim().toLowerCase();
    if (k) arr = arr.filter((u) =>
      u.name.toLowerCase().includes(k) ||
      u.email.toLowerCase().includes(k) ||
      (u.team ?? "").toLowerCase().includes(k) ||
      (u.position ?? "").toLowerCase().includes(k)
    );
    return arr;
  }, [users, q, roleFilter, activeFilter]);

  return (
    <div className="panel p-0 overflow-hidden">
      {updateErr && (
        <div className="px-5 py-2.5 bg-red-50 border-b border-red-100 text-[12px] font-semibold text-red-700 flex items-start gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0">
            <circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" />
          </svg>
          <div className="flex-1">{updateErr}</div>
          <button onClick={() => setUpdateErr(null)} className="text-red-500 hover:text-red-700">닫기</button>
        </div>
      )}
      <div className="section-head flex-wrap">
        <div className="title">
          구성원 목록 <span className="text-ink-400 font-medium tabular ml-1">{filtered.length}</span>
          <BulkUnlockButton users={users} onUnlocked={reload} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 기본/상세 뷰 토글 — 상세(HR 전 컬럼)는 데스크톱 전용이라 모바일에선 숨김 */}
          <div className="tabs hidden sm:flex">
            {(["basic", "detail"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`tab ${view === v ? "tab-active" : ""}`}
                title={v === "detail" ? "HR 상세 정보 전 컬럼 보기" : "기본 구성원 뷰"}
              >
                {v === "basic" ? "기본" : "상세"}
              </button>
            ))}
          </div>
          {/* 엑셀 일괄 업로드 — 내부 검토중이라 일단 비노출. 다시 열 땐 이 블록 주석 해제.
          <span className="mx-1 h-4 w-px bg-ink-200 hidden sm:block" />
          <label
            className="btn-ghost !h-[32px] !px-3 text-[12px] cursor-pointer"
            title="엑셀(.xlsx) 파일로 HR 정보 일괄 업데이트 (email/사번/HR번호 기준 매칭)"
          >
            업로드
            <input
              type="file"
              className="hidden"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => handleImport(e, reload)}
            />
          </label>
          */}
          <span className="mx-1 h-4 w-px bg-ink-200 hidden sm:block" />
          {/* 현재 필터/검색 결과 기준으로 내보내기 — 권한/상태는 앱 UI 전용이므로 제외. */}
          <button
            type="button"
            className="btn-ghost !h-[32px] !px-3 text-[12px] inline-flex items-center gap-1.5"
            onClick={() => {
              const stamp = new Date().toISOString().slice(0, 10);
              downloadXLSX(`hinest-구성원목록-${stamp}`, filtered, HR_EXPORT_COLUMNS, "구성원");
            }}
            title="현재 필터된 목록을 엑셀(.xlsx) 파일로 저장"
          >
            <ExcelLogo />
            Excel
          </button>
          <button
            type="button"
            className="btn-ghost !h-[32px] !px-3 text-[12px] inline-flex items-center gap-1.5"
            onClick={() => {
              const stamp = new Date().toISOString().slice(0, 10);
              downloadCSV(`hinest-구성원목록-${stamp}`, filtered, HR_EXPORT_COLUMNS);
            }}
            title="CSV 파일로 저장 (범용)"
          >
            <CsvLogo />
            CSV
          </button>
          <button
            type="button"
            className="btn-ghost !h-[32px] !px-3 text-[12px] inline-flex items-center gap-1.5"
            onClick={() => {
              openPrintable("HiNest · 구성원 목록", filtered, HR_EXPORT_COLUMNS, {
                subtitle: `${roleFilter || "전체 권한"} · ${activeFilter === "active" ? "재직" : activeFilter === "inactive" ? "비활성" : activeFilter === "resigned" ? "퇴사" : "전체"}${q ? ` · 검색: "${q}"` : ""}`,
              });
            }}
            title="인쇄 창을 열어 PDF 로 저장"
          >
            <PdfLogo />
            PDF
          </button>
          <span className="mx-1 h-4 w-px bg-ink-200 hidden sm:block" />
          <input className="input text-[12px] h-[32px] w-full sm:w-[200px]" placeholder="이름·이메일·팀 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input text-[12px] h-[32px] w-full sm:w-[120px]" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">모든 권한</option>
            <option value="ADMIN">ADMIN</option>
            <option value="MANAGER">MANAGER</option>
            <option value="MEMBER">MEMBER</option>
          </select>
          <div className="tabs">
            {(["active", "inactive", "resigned"] as const).map((v) => (
              <button key={v} onClick={() => setActiveFilter(v)} className={`tab ${activeFilter === v ? "tab-active" : ""}`}>
                {v === "active" ? "재직" : v === "inactive" ? "비활성" : `퇴사 ${users.filter((u) => u.resignedAt).length}`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "detail" && (
        <DetailUserTable rows={filtered} positions={positions} update={update} remove={remove} />
      )}
      {view === "basic" && (<>
      {/* 데스크톱(md+): 인라인 편집 테이블. iPad portrait 는 모바일 카드로 보낸다. */}
      <div className="overflow-x-auto hidden md:block">
      <table className="pro" style={{ minWidth: 720 }}>
        <thead>
          <tr>
            <th style={{ width: "30%" }}>구성원</th>
            <th style={{ width: "16%" }}>직급</th>
            <th style={{ width: "18%" }}>팀</th>
            <th style={{ width: "13%" }}>권한</th>
            <th style={{ width: "15%" }}>상태</th>
            <th style={{ width: "8%", textAlign: "right" }}></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((u) => {
            const roleClass =
              u.role === "ADMIN" ? "role-admin"
              : u.role === "MANAGER" ? "role-manager"
              : "role-member";
            const positionInList = !u.position || positions.some((p) => p.name === u.position);
            const teamInList = !u.team || teams.some((t) => t.name === u.team);
            return (
              <tr key={u.id}>
                <td className="cell-primary">
                  <div className="flex items-center gap-3">
                    <UserAvatar name={u.name} color={u.avatarColor ?? "#3D54C4"} imageUrl={u.avatarUrl ?? null} />
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold text-ink-900 truncate">{u.name}</div>
                      <div className="text-[11px] text-ink-500 truncate tabular">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td data-label="직급">
                  <select
                    className={`ghost-select ${!u.position ? "placeholder" : ""}`}
                    value={u.position ?? ""}
                    onChange={(e) => update(u.id, { position: e.target.value || null })}
                    title={!positionInList ? "현재 직급은 목록에서 제거된 항목입니다" : undefined}
                    style={!positionInList ? { fontStyle: "italic", opacity: 0.7 } : undefined}
                  >
                    <option value="">직급 없음</option>
                    {positions.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                    {u.position && !positionInList && (
                      <option value={u.position}>{u.position} · 사용안함</option>
                    )}
                  </select>
                </td>
                <td data-label="팀">
                  <select
                    className={`ghost-select ${!u.team ? "placeholder" : ""}`}
                    value={u.team ?? ""}
                    onChange={(e) => update(u.id, { team: e.target.value || null })}
                    title={!teamInList ? "현재 팀은 목록에서 제거된 항목입니다" : undefined}
                    style={!teamInList ? { fontStyle: "italic", opacity: 0.7 } : undefined}
                  >
                    <option value="">팀 없음</option>
                    {teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                    {u.team && !teamInList && (
                      <option value={u.team}>{u.team} · 사용안함</option>
                    )}
                  </select>
                </td>
                <td data-label="권한">
                  <select
                    className={`ghost-select role-select ${roleClass}`}
                    value={u.role}
                    onChange={(e) => update(u.id, { role: e.target.value })}
                  >
                    <option value="MEMBER">MEMBER</option>
                    <option value="MANAGER">MANAGER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </td>
                <td data-label="상태">
                  {u.resignedAt ? (
                    <span className="chip-gray" title={`퇴사일 ${new Date(u.resignedAt).toLocaleDateString("ko-KR")}`}>
                      <span className="badge-dot" style={{ background: "#F97316" }} />
                      퇴사 · {new Date(u.resignedAt).toLocaleDateString("ko-KR", { year: "2-digit", month: "numeric", day: "numeric" })}
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        if (u.id === me?.id && u.active) {
                          alertAsync({ title: "본인 계정은 비활성화할 수 없어요", description: "다른 관리자에게 처리를 요청하거나, 퇴사 처리를 사용하세요." });
                          return;
                        }
                        update(u.id, { active: !u.active });
                      }}
                      className={u.active ? "chip-green" : "chip-gray"}
                      title={u.id === me?.id && u.active ? "본인 계정은 비활성화 불가" : undefined}
                      style={u.id === me?.id && u.active ? { cursor: "not-allowed", opacity: 0.85 } : undefined}
                    >
                      <span className="badge-dot" style={{ background: u.active ? "#16A34A" : "#8E959E" }} />
                      {u.active ? "Active" : "Inactive"}
                    </button>
                  )}
                </td>
                <td className="cell-actions" style={{ textAlign: "right" }}>
                  <button className="btn-icon" title="상세 정보 편집" onClick={() => setEditTarget(u)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
                    </svg>
                  </button>
                  <button className="btn-icon" title="출근 기록 수정" onClick={() => setAttendanceTarget(u)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" />
                    </svg>
                  </button>
                  <button
                    className="btn-icon"
                    title={u.resignedAt ? "퇴사 정보 수정" : "퇴사 처리"}
                    onClick={() => setResignTarget(u)}
                    style={u.resignedAt ? { color: "#3D54C4" } : { color: "#F97316" }}
                  >
                    {u.resignedAt ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 12a9 9 0 1 0 3-6.7" />
                        <path d="M3 4v5h5" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M16 17l5-5-5-5" />
                        <path d="M21 12H9" />
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      </svg>
                    )}
                  </button>
                  <button className="btn-icon" title="삭제" onClick={() => remove(u.id)}>
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6} className="cell-full">
                <EmptyState title="구성원이 없습니다" description="초대키를 발급해 팀원을 추가해보세요." />
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
      {/* 모바일·iPad(<md): 깔끔한 구성원 카드 — 탭하면 상세 편집(권한·상태 포함) */}
      <div className="md:hidden flex flex-col gap-2">
        {filtered.map((u) => (
          <button
            key={u.id}
            onClick={() => setEditTarget(u)}
            className="flex items-center gap-3 w-full text-left rounded-2xl border border-ink-150 bg-[var(--c-surface)] px-3.5 py-3 active:opacity-70 transition"
          >
            <UserAvatar name={u.name} color={u.avatarColor ?? "#3D54C4"} imageUrl={u.avatarUrl ?? null} size={46} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[15px] font-bold text-ink-900 truncate">{u.name}</span>
                {u.team && <span className="chip-gray text-[11px] flex-shrink-0">{u.team}</span>}
              </div>
              <div className="text-[12px] text-ink-500 truncate mt-0.5">
                {u.position ? `${u.position} · ` : ""}{u.email}
              </div>
            </div>
            <MemberStatusPill u={u} />
          </button>
        ))}
        {filtered.length === 0 && (
          <EmptyState title="구성원이 없습니다" description="초대키를 발급해 팀원을 추가해보세요." />
        )}
      </div>
      </>)}
      {attendanceTarget && (
        <AttendanceEditModal
          user={attendanceTarget}
          onClose={() => setAttendanceTarget(null)}
          onSaved={() => { setAttendanceTarget(null); reload(); }}
        />
      )}
      {editTarget && (
        <UserDetailEditModal
          user={editTarget}
          teams={teams}
          positions={positions}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); reload(); }}
        />
      )}
      {resignTarget && (
        <ResignModal
          user={resignTarget}
          onClose={() => setResignTarget(null)}
          onDone={() => { setResignTarget(null); reload(); }}
        />
      )}
    </div>
  );
}

/* ===== 퇴사 처리 / 복직 모달 =====
 * - 퇴사: 캘린더로 퇴사일 선택 + 본인 비밀번호 재확인 → 서버에서 active=false + resignedAt 세팅.
 * - 복직: 비밀번호만 재확인 → resignedAt=null + active=true.
 * - 캘린더는 앱 전반에서 쓰는 DatePicker 를 그대로 재사용 (일정 페이지와 동일).
 */
function ResignModal({
  user, onClose, onDone,
}: { user: UserRow; onClose: () => void; onDone: () => void }) {
  const isResigned = !!user.resignedAt;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [date, setDate] = useState<string>(
    isResigned && user.resignedAt ? (user.resignedAt.slice(0, 10)) : todayStr
  );
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const origDate = isResigned && user.resignedAt ? user.resignedAt.slice(0, 10) : "";
  const dateChanged = date !== origDate;

  // 퇴사 처리/퇴사일 정정은 resign, 복직은 unresign. 이미 퇴사자여도 resign 을 다시 호출하면
  // 서버가 resignedAt 만 새 날짜로 갱신한다(active 는 그대로 false) → 퇴사일 정정 경로.
  async function run(kind: "resign" | "unresign") {
    setErr(null);
    if (!password) { setErr("비밀번호를 입력해주세요."); return; }
    if (kind === "resign" && !date) { setErr("퇴사일을 선택해주세요."); return; }
    setSaving(true);
    try {
      if (kind === "unresign") {
        await api(`/api/admin/users/${user.id}/unresign`, { method: "POST", json: { password } });
      } else {
        await api(`/api/admin/users/${user.id}/resign`, { method: "POST", json: { password, resignedAt: date } });
      }
      onDone();
    } catch (e: any) {
      const code = e?.body?.error;
      if (code === "BAD_PASSWORD") setErr("비밀번호가 일치하지 않습니다.");
      else if (code === "SELF_RESIGN") setErr("본인 계정은 퇴사 처리할 수 없습니다.");
      else if (code === "SUPER_ADMIN_TARGET") setErr("이 계정은 퇴사 처리할 수 없습니다.");
      else setErr(e?.message || "처리 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Portal>
    <div className="fixed inset-0 bg-black/40 grid place-items-center z-50 modal-safe" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold">{isResigned ? "퇴사 정보 수정" : "퇴사 처리"}</h3>
          <button onClick={onClose} className="btn-ghost btn-xs">닫기</button>
        </div>
        <div className="text-[12px] text-ink-600 mb-4">
          {user.name} · {user.email}
        </div>

        <div className="space-y-3">
          <div>
            <label className="field-label">퇴사일</label>
            <DatePicker value={date} onChange={(v) => setDate(v)} />
          </div>
          {isResigned ? (
            <div className="p-2.5 rounded-md bg-slate-50 border border-ink-100 text-[11.5px] text-ink-600">
              날짜를 바꾸고 <b>퇴사일 저장</b>을 누르면 퇴사일만 정정됩니다. <b>복직 처리</b>하면 로그인이 다시 허용되고 퇴사 기록이 삭제됩니다.
            </div>
          ) : (
            <div className="p-2.5 rounded-md bg-amber-50 border border-amber-200 text-[11.5px] text-amber-800">
              퇴사 처리 시 해당 계정의 로그인이 즉시 차단됩니다. HR 기록은 보존됩니다.
            </div>
          )}
        </div>

        <div className="mt-4">
          <label className="field-label">본인 계정 비밀번호 재확인</label>
          <input
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호를 입력해주세요"
            autoComplete="current-password"
            onKeyDown={(e) => { if (e.key === "Enter" && (!isResigned || dateChanged)) run("resign"); }}
            disabled={saving}
          />
        </div>

        {err && (
          <div className="mt-3 text-[12px] text-rose-600">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button className="btn-ghost btn-xs" onClick={onClose} disabled={saving}>취소</button>
          {isResigned ? (
            <>
              <button
                className="btn-ghost btn-xs"
                onClick={() => run("unresign")}
                disabled={saving}
              >
                {saving ? "처리 중..." : "복직 처리"}
              </button>
              <button
                className="btn-primary btn-xs"
                onClick={() => run("resign")}
                disabled={saving || !dateChanged}
                title={dateChanged ? undefined : "변경된 퇴사일이 없습니다"}
              >
                {saving ? "처리 중..." : "퇴사일 저장"}
              </button>
            </>
          ) : (
            <button
              className="btn-primary btn-xs"
              style={{ background: "#F97316", borderColor: "#F97316" }}
              onClick={() => run("resign")}
              disabled={saving}
            >
              {saving ? "처리 중..." : "퇴사 처리"}
            </button>
          )}
        </div>
      </div>
    </div>
    </Portal>
  );
}

/* ===== 상세 정보 편집 모달 — HR 전 필드 입력 ===== */
/**
 * 관리자가 한 유저의 HR 상세 정보를 폼으로 편집.
 * - 섹션: 조직 정보 / 개인 정보 / 고용 정보 / 기타
 * - 생년월일/입사일은 date picker, 성별/장애정도는 select, 나머지는 text
 * - 저장 시 변경된 필드만 PATCH
 */
function UserDetailEditModal({
  user, teams, positions, onClose, onSaved,
}: {
  user: UserRow;
  teams: Team[];
  positions: Position[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // 편집 가능한 필드 초기값 — null 은 "" 로 통일.
  const init = {
    name: user.name ?? "",
    role: user.role ?? "MEMBER",
    hrCode: user.hrCode ?? "",
    affiliation: user.affiliation ?? "",
    employeeNo: user.employeeNo ?? "",
    workplace: user.workplace ?? "",
    department: user.department ?? "",
    team: user.team ?? "",
    position: user.position ?? "",
    jobDuty: user.jobDuty ?? "",
    employmentType: user.employmentType ?? "",
    employmentCategory: user.employmentCategory ?? "",
    contractType: user.contractType ?? "",
    hireDate: user.hireDate ?? "",
    birthDate: user.birthDate ?? "",
    gender: user.gender ?? "",
    phone: user.phone ?? "",
    disabilityType: user.disabilityType ?? "",
    disabilityLevel: user.disabilityLevel ?? "",
    note: user.note ?? "",
    autoClockOutTime: user.autoClockOutTime ?? "",
    workStartTime: user.workStartTime ?? "",
    workEndTime: user.workEndTime ?? "",
  };
  const [form, setForm] = useState(init);
  const [active, setActive] = useState(user.active);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof init>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setSaving(true);
    try {
      // 변경된 필드만 모아 전송, 빈 문자열은 null.
      const diff: Record<string, string | null> = {};
      for (const k of Object.keys(init) as (keyof typeof init)[]) {
        if (form[k] !== init[k]) diff[k] = form[k].trim() === "" ? null : form[k].trim();
      }
      // 상태(활성/비활성)는 boolean — 변경됐으면 함께 전송.
      if (active !== user.active) (diff as any).active = active;
      if (Object.keys(diff).length > 0) {
        await api(`/api/admin/users/${user.id}`, { method: "PATCH", json: diff });
      }
      onSaved();
    } catch (e: any) {
      alertAsync({ title: "저장 실패", description: e?.message ?? String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Portal>
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center modal-safe z-50" onClick={onClose}>
      <div
        className="card w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 pb-3 border-b border-ink-100">
          <UserAvatar name={user.name} color={user.avatarColor ?? "#3D54C4"} imageUrl={user.avatarUrl ?? null} />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold text-ink-900 truncate">{user.name} · 상세 정보</div>
            <div className="text-[11px] text-ink-500 tabular truncate">{user.email}</div>
          </div>
          <span className="text-[11px] text-ink-400">나이 {calcAge(form.birthDate) || "-"} · 근속 {calcTenure(form.hireDate) || "-"}년</span>
        </div>

        <div className="overflow-auto py-4 space-y-5 flex-1">
          <Section title="권한 · 상태">
            <Field label="권한">
              <select className="input" value={form.role} onChange={(e) => set("role", e.target.value)}>
                <option value="MEMBER">MEMBER</option>
                <option value="MANAGER">MANAGER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </Field>
            <Field label="상태">
              {user.resignedAt ? (
                <div className="text-[13px] text-ink-500 h-[38px] flex items-center">퇴사 처리됨 (변경은 데스크톱에서)</div>
              ) : (
                <div className="flex gap-2 h-[38px] items-center">
                  <button type="button" onClick={() => setActive(true)} className={`tab ${active ? "tab-active" : ""}`}>재직</button>
                  <button type="button" onClick={() => setActive(false)} className={`tab ${!active ? "tab-active" : ""}`}>비활성</button>
                </div>
              )}
            </Field>
          </Section>
          <Section title="조직 정보">
            {/* 서버 zod(admin.ts updateUserSchema) 상한 500자와 맞춤 — UI 피드백 목적. */}
            <Field label="HR번호"><input className="input" value={form.hrCode} onChange={(e) => set("hrCode", e.target.value)} placeholder="daiso_worker46" maxLength={500} /></Field>
            <Field label="소속"><input className="input" value={form.affiliation} onChange={(e) => set("affiliation", e.target.value)} placeholder="다이소" maxLength={500} /></Field>
            <Field label="사번"><input className="input" value={form.employeeNo} onChange={(e) => set("employeeNo", e.target.value)} placeholder="AD6156258" maxLength={500} /></Field>
            <Field label="근무지"><input className="input" value={form.workplace} onChange={(e) => set("workplace", e.target.value)} placeholder="본사" maxLength={500} /></Field>
            <Field label="부서"><input className="input" value={form.department} onChange={(e) => set("department", e.target.value)} placeholder="서비스지원" maxLength={500} /></Field>
            <Field label="팀">
              <select className="input" value={form.team} onChange={(e) => set("team", e.target.value)}>
                <option value="">(없음)</option>
                {teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                {form.team && !teams.some((t) => t.name === form.team) && (
                  <option value={form.team}>{form.team} · 사용안함</option>
                )}
              </select>
            </Field>
            <Field label="직급">
              <select className="input" value={form.position} onChange={(e) => set("position", e.target.value)}>
                <option value="">(없음)</option>
                {positions.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                {form.position && !positions.some((p) => p.name === form.position) && (
                  <option value={form.position}>{form.position} · 사용안함</option>
                )}
              </select>
            </Field>
            <Field label="직무"><input className="input" value={form.jobDuty} onChange={(e) => set("jobDuty", e.target.value)} placeholder="예: QA" maxLength={500} /></Field>
          </Section>

          <Section title="고용 정보">
            <Field label="고용형태">
              <SelectOrEtc options={EMPLOYMENT_TYPES} value={form.employmentType} onChange={(v) => set("employmentType", v)} placeholder="(선택)" />
            </Field>
            <Field label="고용유형">
              <SelectOrEtc options={EMPLOYMENT_CATEGORIES} value={form.employmentCategory} onChange={(v) => set("employmentCategory", v)} placeholder="(선택)" />
            </Field>
            <Field label="계약형태">
              <SelectOrEtc options={CONTRACT_TYPES} value={form.contractType} onChange={(v) => set("contractType", v)} placeholder="(선택)" />
            </Field>
            <Field label="입사일"><DatePicker variant="input" value={form.hireDate} onChange={(v) => set("hireDate", v)} /></Field>
            <Field label="자동 퇴근 시간">
              {/* 오른쪽 '기준 근무 시각'의 출근/퇴근 서브라벨과 입력칸 높이를 맞추기 위한 빈 줄 */}
              <div className="text-[11px] font-bold mb-1 select-none" aria-hidden="true">&nbsp;</div>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <TimePicker value={form.autoClockOutTime} onChange={(v) => set("autoClockOutTime", v)} placeholder="(미설정)" />
                </div>
                {form.autoClockOutTime && (
                  <button
                    type="button"
                    className="btn-ghost btn-xs"
                    onClick={() => set("autoClockOutTime", "")}
                    title="자동 퇴근 해제"
                  >
                    해제
                  </button>
                )}
              </div>
              <div className="text-[11px] text-ink-500 mt-1">
                설정된 시간(KST)이 되면 오늘 출근한 기록이 자동으로 퇴근 처리돼요.
              </div>
            </Field>
            <Field label="기준 근무 시각">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[11px] font-bold text-ink-500 mb-1">출근</div>
                  <TimePicker value={form.workStartTime} onChange={(v) => set("workStartTime", v)} placeholder="(기본 09:00)" />
                </div>
                <div>
                  <div className="text-[11px] font-bold text-ink-500 mb-1">퇴근</div>
                  <TimePicker value={form.workEndTime} onChange={(v) => set("workEndTime", v)} placeholder="(기본 18:00)" />
                </div>
              </div>
              {(form.workStartTime || form.workEndTime) && (
                <button
                  type="button"
                  className="btn-ghost btn-xs mt-2"
                  onClick={() => { set("workStartTime", ""); set("workEndTime", ""); }}
                >
                  기본값으로 되돌리기
                </button>
              )}
              <div className="text-[11px] text-ink-500 mt-1.5">
                개요 페이지의 근무 진행률 바가 이 시간을 기준으로 표시돼요. 비워두면 기본 09:00 / 18:00.
              </div>
            </Field>
          </Section>

          <Section title="개인 정보">
            <Field label="이름"><input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={200} /></Field>
            <Field label="생년월일"><DatePicker variant="input" value={form.birthDate} onChange={(v) => set("birthDate", v)} /></Field>
            <Field label="성별">
              <select className="input" value={form.gender} onChange={(e) => set("gender", e.target.value)}>
                <option value="">(없음)</option>
                <option>남</option>
                <option>여</option>
              </select>
            </Field>
            <Field label="전화번호"><input className="input" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="010-0000-0000" maxLength={40} /></Field>
            <Field label="장애유형"><input className="input" value={form.disabilityType} onChange={(e) => set("disabilityType", e.target.value)} placeholder="예: 청각장애" maxLength={500} /></Field>
            <Field label="장애정도">
              <select className="input" value={form.disabilityLevel} onChange={(e) => set("disabilityLevel", e.target.value)}>
                <option value="">(없음)</option>
                <option>중증</option>
                <option>경증</option>
              </select>
            </Field>
          </Section>

          <Section title="기타" cols={1}>
            <Field label="비고">
              <textarea
                className="input min-h-[72px]"
                value={form.note}
                onChange={(e) => set("note", e.target.value)}
                placeholder="자유 메모"
                maxLength={5_000}
              />
            </Field>
          </Section>

          <Section title="보안" cols={1}>
            <SecurityBlock user={user} onChanged={onSaved} />
          </Section>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-ink-100">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>취소</button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

function Section({ title, children, cols = 2 }: { title: string; children: React.ReactNode; cols?: 1 | 2 | 3 }) {
  const grid = cols === 1 ? "grid-cols-1" : cols === 3 ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2";
  return (
    <div>
      <div className="text-[12px] font-bold text-ink-600 mb-2">{title}</div>
      <div className={`grid ${grid} gap-3`}>{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label text-[11px] text-ink-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

/* ===== 상세 폼 전용: 프리셋 + 기타(직접 입력) 콤보 =====
 * value 가 options 에 있으면 select 에서 해당 옵션 표시.
 * options 에 없는 값(비어있지 않은 경우)이면 "기타" 로 간주해 아래 text input 노출.
 * - 사용자가 드롭다운에서 "기타" 선택 → 빈 문자열로 전환하고 입력란 활성화.
 * - 사용자가 "(선택)" 으로 비우려면 첫 옵션 선택.
 */
function SelectOrEtc({
  options, value, onChange, placeholder,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const inList = !value || options.includes(value);
  // 기타 모드: 값이 있는데 옵션에 없거나, 사용자가 방금 기타를 고른 경우
  const [etc, setEtc] = useState<boolean>(!inList);
  // value 가 외부에서 바뀌면 inList 재판단
  useEffect(() => {
    if (value && !options.includes(value)) setEtc(true);
    else if (!value) setEtc(false);
  }, [value, options]);

  return (
    <div className="space-y-1.5">
      <select
        className="input"
        value={etc ? "__etc__" : (value || "")}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__etc__") {
            setEtc(true);
            onChange("");
          } else {
            setEtc(false);
            onChange(v);
          }
        }}
      >
        <option value="">{placeholder ?? "(선택)"}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
        <option value="__etc__">기타 (직접 입력)</option>
      </select>
      {etc && (
        <input
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="직접 입력"
          maxLength={500}
          autoFocus
        />
      )}
    </div>
  );
}

/* ===== 상세 리스트 뷰 — 엑셀 포맷 그대로 전 컬럼 ===== */
/**
 * 가로 스크롤 가능한 HR 상세 테이블.
 * 각 셀은 인라인 편집(blur 시 저장) — 관리자가 바로 수정 가능.
 * 나이/근속은 생년월일/입사일에서 자동 계산되는 읽기 전용 컬럼.
 */
function DetailUserTable({
  rows,
  positions,
  update,
  remove,
}: {
  rows: UserRow[];
  positions: Position[];
  update: (id: string, data: any) => Promise<void>;
  remove: (id: string) => Promise<void>;
}) {
  // 편집 가능한 필드만 정의. 나이/근속은 계산 컬럼.
  const fields: { key: keyof UserRow; label: string; width: number }[] = [
    { key: "hrCode", label: "HR번호", width: 120 },
    { key: "affiliation", label: "소속", width: 100 },
    { key: "employeeNo", label: "사번", width: 110 },
    { key: "workplace", label: "근무지", width: 90 },
    { key: "department", label: "부서", width: 110 },
    { key: "jobDuty", label: "직무", width: 110 },
    { key: "name", label: "이름", width: 110 },
    { key: "position", label: "직급", width: 140 },
    { key: "employmentType", label: "고용형태", width: 120 },
    { key: "employmentCategory", label: "고용유형", width: 120 },
    { key: "contractType", label: "계약형태", width: 130 },
    { key: "birthDate", label: "생년월일", width: 170 },
    { key: "gender", label: "성별", width: 60 },
    { key: "disabilityType", label: "장애유형", width: 100 },
    { key: "disabilityLevel", label: "장애정도", width: 80 },
    { key: "hireDate", label: "입사일", width: 170 },
    { key: "phone", label: "전화번호", width: 160 },
    { key: "note", label: "비고", width: 140 },
  ];

  return (
    // 모바일에서 테이블(min-width 2000px) 이 부모 flex 컨테이너를 밀어내 전체 페이지가
    // 가로 스크롤되던 문제 해결:
    //   1) w-full max-w-full 로 wrapper 를 뷰포트 폭에 단단히 고정
    //   2) overflow-x-auto 로 테이블만 가로 스크롤
    //   3) -webkit-overflow-scrolling: touch 로 모바일 관성 스크롤
    <div className="w-full max-w-full overflow-x-auto overflow-y-visible" style={{ WebkitOverflowScrolling: "touch" }}>
      <table className="pro pro-grid pro-grid-fixed" style={{ minWidth: 2000, tableLayout: "fixed" }}>
        <thead>
          <tr>
            {fields.slice(0, 6).map((f) => (
              <th key={f.key as string} style={{ width: f.width, minWidth: f.width }}>{f.label}</th>
            ))}
            <th style={{ width: 110, minWidth: 110 }}>이름</th>
            <th style={{ width: 140, minWidth: 140 }}>직급</th>
            {fields.slice(8, 12).map((f) => (
              <th key={f.key as string} style={{ width: f.width, minWidth: f.width }}>{f.label}</th>
            ))}
            <th style={{ width: 80, minWidth: 80 }}>성별</th>
            <th style={{ width: 60, minWidth: 60 }}>나이</th>
            {fields.slice(13, 16).map((f) => (
              <th key={f.key as string} style={{ width: f.width, minWidth: f.width }}>{f.label}</th>
            ))}
            <th style={{ width: 60, minWidth: 60 }}>근속</th>
            <th style={{ width: 160, minWidth: 160 }}>전화번호</th>
            <th style={{ width: 140, minWidth: 140 }}>비고</th>
            <th style={{ width: 50, minWidth: 50, textAlign: "right" }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id}>
              <DetailCell u={u} k="hrCode" update={update} />
              <DetailCell u={u} k="affiliation" update={update} />
              <DetailCell u={u} k="employeeNo" update={update} />
              <DetailCell u={u} k="workplace" update={update} />
              <DetailCell u={u} k="department" update={update} />
              <DetailCell u={u} k="jobDuty" update={update} />
              <DetailCell u={u} k="name" update={update} />
              <SelectCell u={u} k="position" options={positions.map((p) => p.name)} update={update} />
              <SelectCell u={u} k="employmentType" options={EMPLOYMENT_TYPES} update={update} />
              <SelectCell u={u} k="employmentCategory" options={EMPLOYMENT_CATEGORIES} update={update} />
              <SelectCell u={u} k="contractType" options={CONTRACT_TYPES} update={update} />
              <DateCell u={u} k="birthDate" update={update} />
              <SelectCell u={u} k="gender" options={GENDERS} update={update} />
              <td className="text-[12px] tabular text-ink-600">{calcAge(u.birthDate)}</td>
              <SelectCell u={u} k="disabilityType" options={DISABILITY_TYPES} update={update} />
              <SelectCell u={u} k="disabilityLevel" options={DISABILITY_LEVELS} update={update} />
              <DateCell u={u} k="hireDate" update={update} />
              <td className="text-[12px] tabular text-ink-600">{calcTenure(u.hireDate)}</td>
              <DetailCell u={u} k="phone" update={update} />
              <DetailCell u={u} k="note" update={update} />
              <td style={{ textAlign: "right" }}>
                <button className="btn-icon" title="삭제" onClick={() => remove(u.id)}>
                  <TrashIcon />
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={21}>
                <EmptyState title="구성원이 없습니다" description="엑셀 업로드로 일괄 등록하거나 초대키를 발급해보세요." />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 날짜 셀 — 일정 페이지와 같은 디자인의 DatePicker 팝오버 사용.
 * 값은 "YYYY-MM-DD" 문자열로 저장.
 */
function DateCell({
  u, k, update,
}: {
  u: UserRow;
  k: keyof UserRow;
  update: (id: string, data: any) => Promise<void>;
}) {
  const raw = (u[k] as string | null | undefined) ?? "";
  return (
    <td className="p-0">
      <DatePicker
        value={raw}
        onChange={(v) => {
          if (v === raw) return;
          update(u.id, { [k]: v || null });
        }}
      />
    </td>
  );
}

/**
 * 선택형 셀 — 주어진 옵션 중 하나를 고르거나 "기타" 선택 시 직접 입력.
 * 현재 값이 옵션에 없으면 자동으로 "기타" 모드로 진입해 편집 가능.
 */
function SelectCell({
  u, k, options, update,
}: {
  u: UserRow;
  k: keyof UserRow;
  options: string[];
  update: (id: string, data: any) => Promise<void>;
}) {
  const raw = (u[k] as string | null | undefined) ?? "";
  // 옵션에 없으면서 값이 있으면 "기타(custom)" 모드
  const isCustom = raw !== "" && !options.includes(raw);
  const [mode, setMode] = useState<"select" | "custom">(isCustom ? "custom" : "select");
  const [custom, setCustom] = useState<string>(isCustom ? raw : "");

  useEffect(() => {
    const next = raw !== "" && !options.includes(raw);
    setMode(next ? "custom" : "select");
    setCustom(next ? raw : "");
  }, [raw, options.join("|")]);

  async function onSelectChange(val: string) {
    if (val === "__OTHER__") {
      setMode("custom");
      // 직접 입력 대기 — 값은 아직 저장하지 않음.
      return;
    }
    setMode("select");
    setCustom("");
    if (val !== raw) await update(u.id, { [k]: val || null });
  }

  async function saveCustom() {
    const next = custom.trim();
    if (next === raw) return;
    await update(u.id, { [k]: next || null });
  }

  if (mode === "custom") {
    return (
      <td className="p-0">
        <div className="flex items-center gap-1 px-1">
          <input
            className="w-full min-w-0 bg-transparent border-0 focus:bg-[color:var(--c-surface)] text-[color:var(--c-text)] focus:outline-none focus:ring-1 focus:ring-brand-400 rounded text-[12px] px-1 py-1.5"
            value={custom}
            placeholder="직접 입력"
            autoFocus
            onChange={(e) => setCustom(e.target.value)}
            onBlur={saveCustom}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
              if (e.key === "Escape") { setMode("select"); setCustom(""); }
            }}
          />
          <button
            type="button"
            className="text-[11px] text-ink-400 hover:text-ink-700"
            title="선택 목록으로 돌아가기"
            onClick={() => { setMode("select"); setCustom(""); update(u.id, { [k]: null }); }}
          >
            ✕
          </button>
        </div>
      </td>
    );
  }
  return (
    <td className="p-0" title={raw || undefined}>
      <select
        className="w-full min-w-0 bg-transparent border-0 focus:bg-[color:var(--c-surface)] text-[color:var(--c-text)] focus:outline-none focus:ring-1 focus:ring-brand-400 rounded text-[12px] px-1 py-1.5 truncate"
        value={raw}
        onChange={(e) => onSelectChange(e.target.value)}
      >
        <option value="">(없음)</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value="__OTHER__">기타…</option>
      </select>
    </td>
  );
}

/**
 * 인라인 편집 셀 — blur 시 값이 바뀌었으면 PATCH.
 * 빈 문자열은 null 로 보내 DB 에서 정리.
 */
function DetailCell({
  u, k, update, placeholder, type,
}: {
  u: UserRow;
  k: keyof UserRow;
  update: (id: string, data: any) => Promise<void>;
  placeholder?: string;
  type?: "text" | "date";
}) {
  const raw = (u[k] as string | null | undefined) ?? "";
  const [v, setV] = useState<string>(String(raw));
  // 외부에서 값이 바뀌면(리로드 후) 로컬 값도 맞춤
  useEffect(() => { setV(String(raw)); }, [raw]);

  return (
    <td className="p-0" title={raw || undefined}>
      <input
        type={type ?? "text"}
        // padding 을 최소화해 좁은 컬럼에서도 10자 날짜가 잘리지 않도록.
        className="w-full min-w-0 bg-transparent border-0 focus:bg-[color:var(--c-surface)] text-[color:var(--c-text)] focus:outline-none focus:ring-1 focus:ring-brand-400 rounded text-[12px] px-1 py-1.5 tabular"
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const next = v.trim();
          if (next === (raw ?? "")) return;
          update(u.id, { [k]: next || null });
        }}
      />
    </td>
  );
}

/* ===== 출근 기록 수정 모달 ===== */
function AttendanceEditModal({
  user, onClose, onSaved,
}: { user: UserRow; onClose: () => void; onSaved: () => void }) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [date, setDate] = useState(todayStr);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState<{ checkIn: string | null; checkOut: string | null }>({ checkIn: null, checkOut: null });

  // ISO → "HH:mm"
  const isoToHM = (iso: string | null | undefined): string => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  // 해당 날짜 기록 로드 — 실제 DB 값을 가져와서 input 에 미리 채움.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await api<{ attendance: { checkIn: string | null; checkOut: string | null } | null }>(
          `/api/admin/users/${user.id}/attendance?date=${date}`
        );
        if (cancelled) return;
        const a = res.attendance;
        setLoaded({ checkIn: a?.checkIn ?? null, checkOut: a?.checkOut ?? null });
        setCheckIn(isoToHM(a?.checkIn));
        setCheckOut(isoToHM(a?.checkOut));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [date, user.id]);

  const currentStatus: "IN" | "OFF" | "NONE" = loaded.checkOut ? "OFF" : loaded.checkIn ? "IN" : "NONE";
  const statusLabel = currentStatus === "IN" ? "출근중" : currentStatus === "OFF" ? "퇴근" : "미출근";
  const statusColor = currentStatus === "IN" ? "#16A34A" : currentStatus === "OFF" ? "#8E959E" : "#D97706";

  const timeToISO = (hm: string): string | null => {
    if (!hm) return null;
    const [h, m] = hm.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    const [Y, M, D] = date.split("-").map(Number);
    return new Date(Y, M - 1, D, h, m, 0, 0).toISOString();
  };

  async function save() {
    setSaving(true);
    try {
      const body: any = { date };
      body.checkIn = checkIn ? timeToISO(checkIn) : null;
      body.checkOut = checkOut ? timeToISO(checkOut) : null;
      await api(`/api/admin/users/${user.id}/attendance`, { method: "PATCH", json: body });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function applyQuick(action: "IN_NOW" | "OUT_NOW" | "RESET_IN" | "CLEAR_OUT" | "ALL_CLEAR") {
    setSaving(true);
    try {
      const now = new Date();
      const nowISO = new Date(
        Number(date.slice(0, 4)),
        Number(date.slice(5, 7)) - 1,
        Number(date.slice(8, 10)),
        now.getHours(),
        now.getMinutes(),
      ).toISOString();
      let body: any = { date };
      if (action === "IN_NOW")      body = { date, checkIn: nowISO, checkOut: null };
      if (action === "OUT_NOW")     body = { date, checkOut: nowISO };
      if (action === "RESET_IN")    body = { date, checkIn: nowISO, checkOut: null }; // 퇴근 상태 → 다시 출근
      if (action === "CLEAR_OUT")   body = { date, checkOut: null };                   // 퇴근 취소 → 출근중 복귀
      if (action === "ALL_CLEAR")   body = { date, checkIn: null, checkOut: null };
      await api(`/api/admin/users/${user.id}/attendance`, { method: "PATCH", json: body });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Portal>
    <div className="fixed inset-0 bg-black/40 grid place-items-center z-50 modal-safe" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold">출근 기록 수정</h3>
          <button onClick={onClose} className="btn-ghost btn-xs">닫기</button>
        </div>
        <div className="text-[12px] text-ink-600 mb-4">
          {user.name} · {user.email}
        </div>

        {/* 현재 상태 요약 박스 */}
        <div className="rounded-xl p-3 mb-4 flex items-center gap-3"
          style={{ background: statusColor + "14", border: `1px solid ${statusColor}33` }}>
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: statusColor }} />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-extrabold" style={{ color: statusColor }}>
              {loading ? "기록 로드중…" : `현재 상태 — ${statusLabel}`}
            </div>
            <div className="text-[11px] text-ink-600 mt-0.5 tabular">
              출근 {isoToHM(loaded.checkIn) || "—"} · 퇴근 {isoToHM(loaded.checkOut) || "—"}
            </div>
          </div>
        </div>

        {/* 원클릭 상태 토글 */}
        <div>
          <div className="field-label mb-1.5">빠른 변경</div>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {currentStatus !== "IN" && (
              <button className="btn-ghost btn-xs justify-center" disabled={saving}
                onClick={() => applyQuick(currentStatus === "OFF" ? "RESET_IN" : "IN_NOW")}
                style={{ color: "#16A34A" }}>
                ▶ {currentStatus === "OFF" ? "다시 출근(지금)" : "출근 처리(지금)"}
              </button>
            )}
            {currentStatus === "IN" && (
              <button className="btn-ghost btn-xs justify-center" disabled={saving}
                onClick={() => applyQuick("OUT_NOW")} style={{ color: "#8E959E" }}>
                ■ 퇴근 처리(지금)
              </button>
            )}
            {currentStatus === "OFF" && (
              <button className="btn-ghost btn-xs justify-center" disabled={saving}
                onClick={() => applyQuick("CLEAR_OUT")} style={{ color: "#D97706" }}>
                ↩ 퇴근 취소(출근중으로)
              </button>
            )}
            {currentStatus !== "NONE" && (
              <button className="btn-ghost btn-xs justify-center" disabled={saving}
                onClick={() => applyQuick("ALL_CLEAR")} style={{ color: "#DC2626" }}>
                × 미출근으로 초기화
              </button>
            )}
          </div>
        </div>

        {/* 수동 입력 */}
        <div className="space-y-3">
          <div>
            <label className="field-label">날짜</label>
            <DatePicker value={date} onChange={(v) => setDate(v)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">출근 시각</label>
              <TimePicker value={checkIn} onChange={setCheckIn} disabled={loading} />
            </div>
            <div>
              <label className="field-label">퇴근 시각</label>
              <TimePicker value={checkOut} onChange={setCheckOut} disabled={loading} />
            </div>
          </div>
          <div className="text-[11px] text-ink-500">
            시각을 비우고 저장하면 해당 필드가 지워집니다.
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button className="btn-ghost btn-xs" onClick={onClose} disabled={saving}>취소</button>
          <button className="btn-primary btn-xs" onClick={save} disabled={saving || loading}>
            수동 입력 저장
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

function UserAvatar({ name, color, imageUrl, size = 36 }: { name: string; color: string; imageUrl?: string | null; size?: number }) {
  return (
    <div className="rounded-full grid place-items-center text-white font-extrabold flex-shrink-0 overflow-hidden"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36), background: imageUrl ? "transparent" : color, letterSpacing: "-0.02em" }}>
      {imageUrl ? (
        <img src={imgSrc(imageUrl)} alt={name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
      ) : (
        name?.[0] ?? "?"
      )}
    </div>
  );
}

/** 모바일 구성원 카드용 상태 뱃지 — 재직(green) / 비활성(gray) / 퇴사(gray). */
function MemberStatusPill({ u }: { u: UserRow }) {
  if (u.resignedAt) return <span className="chip-gray text-[11px] flex-shrink-0">퇴사</span>;
  if (!u.active) return <span className="chip-gray text-[11px] flex-shrink-0">비활성</span>;
  return <span className="chip-green text-[11px] flex-shrink-0">재직</span>;
}

/* ===================== Invites ===================== */
function InvitesTab({
  invites, teams, positions, reload,
}: { invites: Invite[]; teams: Team[]; positions: Position[]; reload: () => void }) {
  const [form, setForm] = useState({
    email: "", name: "", role: "MEMBER", team: "", position: "", expiresInDays: 7,
  });
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await api<{ key: Invite }>("/api/admin/invites", {
      method: "POST",
      json: { ...form, expiresInDays: Number(form.expiresInDays) || undefined },
    });
    setCreatedKey(res.key.key);
    setForm({ email: "", name: "", role: "MEMBER", team: "", position: "", expiresInDays: 7 });
    reload();
  }

  async function remove(id: string) {
    const ok = await confirmAsync({
      title: "초대키 삭제",
      description: "이 초대키를 삭제할까요?",
      tone: "danger",
      confirmLabel: "삭제",
    });
    if (!ok) return;
    await api(`/api/admin/invites/${id}`, { method: "DELETE" });
    reload();
  }

  function copy(k: string) {
    navigator.clipboard.writeText(k);
    setCreatedKey(k);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* 발급 폼 */}
      <div className="lg:col-span-2 panel p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 grid place-items-center">
            <KeyIcon />
          </div>
          <div>
            <div className="h-sub">새 초대키 발급</div>
            <div className="t-caption">입사자에게 전달해 가입시키세요.</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">이름</label>
              {/* admin.ts inviteSchema name z.string().min(1).max(200) 과 맞춤. */}
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="홍길동" maxLength={200} />
            </div>
            <div>
              <label className="field-label">권한</label>
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="MEMBER">MEMBER</option>
                <option value="MANAGER">MANAGER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </div>
          </div>
          <div>
            <label className="field-label">이메일 / 사내 ID <span className="text-ink-500 font-normal">(선택 · 고정)</span></label>
            <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" maxLength={200} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">팀</label>
              <select className="input" value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })}>
                <option value="">—</option>
                {teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">직급</label>
              <select className="input" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}>
                <option value="">—</option>
                {positions.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="field-label">만료 (일)</label>
            <input type="number" className="input" value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: Number(e.target.value) })} />
          </div>
          <button className="btn-primary btn-lg w-full">초대키 발급하기</button>
        </form>

        {createdKey && (
          <div className="mt-5 p-4 rounded-xl border-2 border-brand-200 bg-brand-50">
            <div className="text-[11px] font-extrabold text-brand-700 uppercase tracking-[0.08em] mb-2">새 초대키</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 font-mono text-[14px] font-bold break-all text-ink-900">{createdKey}</div>
              <button className="btn-primary btn-xs" onClick={() => copy(createdKey)}>
                {copied ? "✓ 복사됨" : "복사"}
              </button>
            </div>
            <div className="text-[11px] text-brand-700 mt-2">이 키를 받은 사람만 /signup 에서 가입할 수 있어요.</div>
          </div>
        )}
      </div>

      {/* 목록 */}
      <div className="lg:col-span-3 panel p-0 overflow-hidden">
        <div className="section-head">
          <div className="title">초대키 목록 <span className="text-ink-400 font-medium tabular ml-1">{invites.length}</span></div>
        </div>
        <div className="overflow-x-auto">
        <table className="pro pro-cards" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th>키</th>
              <th>대상</th>
              <th>권한 · 팀 · 직급</th>
              <th>상태</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invites.map((k) => {
              const expired = !k.used && k.expiresAt && new Date(k.expiresAt) < new Date();
              return (
                <tr key={k.id}>
                  <td className="cell-primary">
                    <div className="flex items-center gap-2">
                      <button onClick={() => copy(k.key)} className="font-mono text-[12px] font-bold text-ink-900 hover:text-brand-600" title="클릭하여 복사">
                        {k.key}
                      </button>
                    </div>
                  </td>
                  <td data-label="대상">
                    <div className="text-[13px] font-bold text-ink-900">{k.name ?? "—"}</div>
                    <div className="text-[11px] text-ink-500 truncate tabular">{k.email ?? "이메일 제한 없음"}</div>
                  </td>
                  <td data-label="권한·팀·직급">
                    <div className="flex flex-wrap gap-1 items-center">
                      <span className="chip-gray">{k.role}</span>
                      {k.team && <span className="chip-blue">{k.team}</span>}
                      {k.position && <span className="chip-brand">{k.position}</span>}
                    </div>
                  </td>
                  <td data-label="상태">
                    {k.used ? (
                      <div>
                        <span className="chip-gray">사용완료</span>
                        {k.usedBy && <div className="text-[11px] text-ink-500 mt-1">{k.usedBy.name}</div>}
                      </div>
                    ) : expired ? (
                      <span className="chip-red">만료</span>
                    ) : (
                      <span className="chip-green">
                        <span className="badge-dot" style={{ background: "#16A34A" }} /> Active
                      </span>
                    )}
                  </td>
                  <td className="cell-actions" style={{ textAlign: "right" }}>
                    <button className="btn-icon" title="삭제" onClick={() => remove(k.id)}>
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              );
            })}
            {invites.length === 0 && (
              <tr>
                <td colSpan={5} className="cell-full">
                  <EmptyState title="발급된 초대키가 없어요" description="좌측에서 새 초대키를 발급해보세요." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

/* ===================== Teams ===================== */
function TeamsTab({ teams, reload }: { teams: Team[]; reload: () => void }) {
  const [name, setName] = useState("");
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api("/api/admin/teams", { method: "POST", json: { name: name.trim() } });
      setName("");
      reload();
    } catch (e: any) { alertAsync({ title: "생성 실패", description: e.message }); }
  }
  async function rename(t: Team) {
    const n = await promptAsync({
      title: "팀 이름 변경",
      placeholder: "새 이름",
      defaultValue: t.name,
      confirmLabel: "변경",
    });
    if (!n || n.trim() === t.name) return;
    try {
      await api(`/api/admin/teams/${t.id}`, { method: "PATCH", json: { name: n.trim() } });
      reload();
    } catch (e: any) { alertAsync({ title: "변경 실패", description: e.message }); }
  }
  async function remove(t: Team) {
    const ok = await confirmAsync({
      title: "팀 삭제",
      description: `'${t.name}' 팀을 삭제할까요?`,
      tone: "danger",
      confirmLabel: "삭제",
    });
    if (!ok) return;
    try {
      await api(`/api/admin/teams/${t.id}`, { method: "DELETE" });
      reload();
    } catch (e: any) { alertAsync({ title: "삭제 실패", description: e.message }); }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <div className="lg:col-span-2 panel p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 grid place-items-center">
            <TeamIcon />
          </div>
          <div>
            <div className="h-sub">새 팀 생성</div>
            <div className="t-caption">전사 조직 단위를 관리합니다.</div>
          </div>
        </div>
        <form onSubmit={add} className="space-y-3">
          <div>
            <label className="field-label">팀 이름</label>
            {/* admin.ts capName 80자 상한과 맞춤. */}
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 개발, 디자인, 경영지원" maxLength={80} />
          </div>
          <button className="btn-primary btn-lg w-full">팀 생성</button>
        </form>
      </div>

      <div className="lg:col-span-3 panel p-0 overflow-hidden">
        <div className="section-head">
          <div className="title">팀 목록 <span className="text-ink-400 font-medium tabular ml-1">{teams.length}</span></div>
        </div>
        <div className="divide-y divide-ink-100">
          {teams.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-ink-25">
              <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-700 grid place-items-center text-[13px] font-extrabold">
                {t.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-bold text-ink-900">{t.name}</div>
                <div className="text-[11px] text-ink-500 tabular">생성 {new Date(t.createdAt).toLocaleDateString("ko-KR")}</div>
              </div>
              <button className="btn-ghost btn-xs" onClick={() => rename(t)}>이름 변경</button>
              <button className="btn-icon" title="삭제" onClick={() => remove(t)}>
                <TrashIcon />
              </button>
            </div>
          ))}
          {teams.length === 0 && <EmptyState title="생성된 팀이 없어요" description="좌측에서 첫 팀을 만들어보세요." />}
        </div>
      </div>
    </div>
  );
}

/* ===================== Positions ===================== */
function PositionsTab({ positions, reload }: { positions: Position[]; reload: () => void }) {
  const [name, setName] = useState("");
  // 서버 리스트 반영 + 드래그 중 낙관적 재정렬을 위한 로컬 상태.
  const [list, setList] = useState<Position[]>(positions);
  useEffect(() => {
    setList(positions);
  }, [positions]);

  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    try {
      await api("/api/admin/positions", { method: "POST", json: { name: n } });
      invalidateCache("/api/admin/positions"); // 조직도(OrgChart)가 보는 캐시 무효화
      setName("");
      reload();
    } catch (e: any) { alertAsync({ title: "생성 실패", description: e.message }); }
  }
  async function rename(p: Position, newName: string) {
    await api(`/api/admin/positions/${p.id}`, { method: "PATCH", json: { name: newName } });
    invalidateCache("/api/admin/positions");
    reload();
  }
  async function remove(p: Position) {
    const ok = await confirmAsync({
      title: "직급 삭제",
      description: `'${p.name}' 직급을 삭제할까요?`,
      tone: "danger",
      confirmLabel: "삭제",
    });
    if (!ok) return;
    try {
      await api(`/api/admin/positions/${p.id}`, { method: "DELETE" });
      invalidateCache("/api/admin/positions");
      reload();
    } catch (e: any) { alertAsync({ title: "삭제 실패", description: e.message }); }
  }

  async function persistOrder(next: Position[]) {
    try {
      await api("/api/admin/positions/reorder", { method: "POST", json: { ids: next.map((p) => p.id) } });
      invalidateCache("/api/admin/positions");
    } catch (e: any) {
      alertAsync({ title: "정렬 저장 실패", description: e.message });
      reload(); // 서버 상태로 복구
    }
  }

  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const from = list.findIndex((p) => p.id === dragId);
    const to = list.findIndex((p) => p.id === targetId);
    if (from < 0 || to < 0) return;
    const next = list.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setList(next);
    void persistOrder(next);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <div className="lg:col-span-2 panel p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 grid place-items-center">
            <RankIcon />
          </div>
          <div>
            <div className="h-sub">새 직급 생성</div>
            <div className="t-caption">새 직급은 목록 맨 아래에 추가돼요. 순서는 드래그로 바꿀 수 있어요.</div>
          </div>
        </div>
        <form onSubmit={add} className="space-y-3">
          <div>
            <label className="field-label">직급명</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 사원, 대리, 과장, 팀장, 이사"
              maxLength={80}
            />
          </div>
          <button className="btn-primary btn-lg w-full" disabled={!name.trim()}>직급 생성</button>
        </form>
      </div>

      <div className="lg:col-span-3 panel p-0 overflow-hidden">
        <div className="section-head">
          <div className="title">
            직급 목록 <span className="text-ink-400 font-medium tabular ml-1">{list.length}</span>
          </div>
          <div className="t-caption">위로 드래그할수록 상위 직급</div>
        </div>
        <div className="divide-y divide-ink-100">
          {list.map((p, i) => {
            const isDragging = dragId === p.id;
            const isOver = overId === p.id && dragId && dragId !== p.id;
            return (
              <div
                key={p.id}
                draggable
                onDragStart={(e) => {
                  setDragId(p.id);
                  e.dataTransfer.effectAllowed = "move";
                  // Firefox 는 setData 가 없으면 드래그가 아예 시작 안 됨.
                  e.dataTransfer.setData("text/plain", p.id);
                }}
                onDragOver={(e) => {
                  if (!dragId || dragId === p.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overId !== p.id) setOverId(p.id);
                }}
                onDragLeave={() => {
                  if (overId === p.id) setOverId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onDrop(p.id);
                  setDragId(null);
                  setOverId(null);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
                className={`flex items-center gap-3 px-5 py-3.5 transition-colors ${
                  isDragging ? "opacity-50" : "hover:bg-ink-25"
                } ${isOver ? "bg-brand-50 ring-1 ring-inset ring-brand-300" : ""}`}
              >
                <span className="text-ink-300 cursor-grab active:cursor-grabbing select-none" title="드래그해서 순서 바꾸기">
                  <DragHandleIcon />
                </span>
                <span className="w-7 h-7 rounded-lg bg-ink-50 text-ink-600 grid place-items-center text-[12px] font-bold tabular">
                  {i + 1}
                </span>
                <input
                  className="input text-[13px] h-[32px] font-bold flex-1"
                  defaultValue={p.name}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== p.name) rename(p, v);
                  }}
                />
                <div className="text-[11px] text-ink-500 tabular w-[88px] text-right hidden sm:block">
                  {new Date(p.createdAt).toLocaleDateString("ko-KR")}
                </div>
                <button className="btn-icon" title="삭제" onClick={() => remove(p)}>
                  <TrashIcon />
                </button>
              </div>
            );
          })}
          {list.length === 0 && <EmptyState title="생성된 직급이 없어요" description="좌측에서 첫 직급을 만들어보세요." />}
        </div>
      </div>
    </div>
  );
}

function DragHandleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}

/* ===================== Shared ===================== */
function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="py-14 text-center">
      <div className="mx-auto w-12 h-12 rounded-2xl bg-ink-100 grid place-items-center mb-3">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8E959E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7h18M3 12h18M3 17h10" />
        </svg>
      </div>
      <div className="text-[13px] font-bold text-ink-800">{title}</div>
      <div className="text-[12px] text-ink-500 mt-1">{description}</div>
    </div>
  );
}

/* Icons */
function UsersIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>;
}
function KeyIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7.5" cy="15.5" r="4.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" />
  </svg>;
}
function TeamIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M10 4v16" />
  </svg>;
}
function RankIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9 12 3l6 6" /><path d="M12 3v18" /><path d="M6 15l6 6 6-6" />
  </svg>;
}
function TrashIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>;
}

/* =================== 일괄 잠금 해제 — 헤더에 표시 =================== */

/**
 * 잠긴 계정이 1명 이상일 때만 표시되는 작은 버튼.
 * 클릭 → 확인 모달 → /api/admin/users/unlock-all → reload.
 */
function BulkUnlockButton({ users, onUnlocked }: { users: UserRow[]; onUnlocked: () => void }) {
  const [busy, setBusy] = useState(false);
  const lockedCount = users.filter((u) => !!u.lockedAt).length;
  if (lockedCount === 0) return null;

  async function run() {
    const ok = await confirmAsync({
      title: `잠긴 계정 ${lockedCount}건을 모두 풀까요?`,
      description: "각 계정의 로그인 실패 카운트도 0 으로 초기화됩니다. 감사 로그에 기록돼요.",
      confirmLabel: "전체 해제",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; count: number }>("/api/admin/users/unlock-all", { method: "POST" });
      await alertAsync({ title: `${r.count}건 해제됨`, description: "다음 로그인부터 정상 시도 가능합니다." });
      onUnlocked();
    } catch (e: any) {
      alertAsync({ title: "해제 실패", description: e?.message ?? String(e) });
    } finally { setBusy(false); }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="ml-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold transition disabled:opacity-60"
      style={{
        background: "color-mix(in srgb, var(--c-danger) 12%, transparent)",
        color: "var(--c-danger)",
        border: "1px solid color-mix(in srgb, var(--c-danger) 28%, transparent)",
      }}
      title={`잠긴 계정 ${lockedCount}건 일괄 해제`}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="11" width="16" height="9" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 7-2.6" />
      </svg>
      {busy ? "해제 중…" : `잠긴 계정 ${lockedCount}건 일괄 해제`}
    </button>
  );
}

/* =================== 보안 블록 (잠금 상태 + 비밀번호 재설정) =================== */

function SecurityBlock({ user, onChanged }: { user: UserRow; onChanged: () => void }) {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = !!user.lockedAt;
  const fails = user.failedLoginCount ?? 0;

  async function unlock() {
    setBusy(true);
    try {
      await api(`/api/admin/users/${user.id}/unlock`, { method: "POST" });
      await alertAsync({ title: "잠금 해제됨", description: "다음 로그인부터 정상 시도 가능합니다." });
      onChanged();
    } catch (e: any) {
      alertAsync({ title: "해제 실패", description: e?.message ?? String(e) });
    } finally { setBusy(false); }
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw1.length < 8) { alertAsync({ title: "8자 이상이어야 합니다" }); return; }
    if (pw1 !== pw2) { alertAsync({ title: "비밀번호 확인이 일치하지 않습니다" }); return; }
    if (!(await confirmAsync({ title: `${user.name}님의 비밀번호 재설정`, description: "기존 비밀번호로는 더 이상 로그인할 수 없게 됩니다. 사용자에게 새 비밀번호를 안전한 채널로 전달해 주세요." }))) return;
    setBusy(true);
    try {
      await api(`/api/admin/users/${user.id}/reset-password`, {
        method: "POST",
        json: { newPassword: pw1 },
      });
      setPw1(""); setPw2("");
      await alertAsync({ title: "비밀번호 변경됨", description: "잠금 상태도 자동으로 해제됐어요." });
      onChanged();
    } catch (err: any) {
      alertAsync({ title: "변경 실패", description: err?.message ?? String(err) });
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      {/* 잠금 상태 */}
      <div
        className="rounded-lg p-3.5 border"
        style={{
          background: locked ? "rgba(220,38,38,0.08)" : "var(--c-surface-3)",
          borderColor: locked ? "rgba(220,38,38,0.25)" : "var(--c-border)",
        }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="w-2 h-2 rounded-full" style={{ background: locked ? "var(--c-danger)" : "var(--c-success)" }} />
          <span className="text-[13px] font-extrabold text-ink-900">
            {locked ? "잠긴 계정" : "정상"}
          </span>
          <span className="text-[11.5px] text-ink-500">
            로그인 실패 {fails} / 5회
            {locked && user.lockedAt && ` · ${new Date(user.lockedAt).toLocaleString("ko-KR")} 잠김`}
          </span>
          {locked && (
            <button
              type="button"
              className="btn-ghost btn-xs ml-auto"
              onClick={unlock}
              disabled={busy}
            >
              잠금 해제
            </button>
          )}
        </div>
        <div className="text-[11px] text-ink-500 mt-1.5 leading-relaxed">
          비밀번호 5회 연속 오류 시 자동 잠금됩니다. 관리자가 명시적으로 해제할 때까지 로그인이 차단돼요.
        </div>
      </div>

      {/* 비밀번호 재설정 */}
      <form onSubmit={resetPassword} className="rounded-lg p-3.5 border" style={{ borderColor: "var(--c-border)" }}>
        <div className="text-[13px] font-extrabold text-ink-900 mb-2.5">비밀번호 재설정</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="password"
            className="input"
            placeholder="새 비밀번호 (8자 이상)"
            value={pw1}
            onChange={(e) => setPw1(e.target.value)}
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
          />
          <input
            type="password"
            className="input"
            placeholder="새 비밀번호 확인"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
          />
        </div>
        <div className="flex items-center gap-2 mt-2">
          <div className="text-[11px] text-ink-500 flex-1 leading-relaxed">
            저장 시 잠금 상태도 함께 해제됩니다. 사용자에게는 안전한 채널(사내톡 DM 등)로만 전달하세요.
          </div>
          <button type="submit" className="btn-primary btn-xs" disabled={busy || !pw1 || pw1 !== pw2}>
            변경
          </button>
        </div>
      </form>
    </div>
  );
}


/* ===================== Attendance IP Restrict ===================== */
function AttendanceIpTab() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [items, setItems] = useState<{ id: string; cidr: string; label: string | null; createdAt: string }[]>([]);
  const [clientIp, setClientIp] = useState<string | null>(null);
  const [cidrInput, setCidrInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api<{
        enabled: boolean;
        allowedIps: { id: string; cidr: string; label: string | null; createdAt: string }[];
        clientIp: string | null;
      }>("/api/admin/attendance-ip");
      setEnabled(res.enabled);
      setItems(res.allowedIps);
      setClientIp(res.clientIp);
    } catch (e: any) {
      alertAsync({ title: "불러오기 실패", description: e?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function toggle(next: boolean) {
    setEnabled(next);
    try {
      await api("/api/admin/attendance-ip", { method: "PATCH", json: { enabled: next } });
    } catch (e: any) {
      setEnabled(!next);
      alertAsync({ title: "변경 실패", description: e?.message ?? String(e) });
    }
  }

  async function add(useMyIp = false) {
    const cidr = useMyIp ? (clientIp ? `${clientIp}/32` : "") : cidrInput.trim();
    if (!cidr) { alertAsync({ title: "IP 를 입력하세요", description: "예: 203.241.45.67 또는 192.168.1.0/24" }); return; }
    setAdding(true);
    try {
      const res = await api<{ ok: boolean; item: typeof items[number] }>("/api/admin/attendance-ip", {
        method: "POST",
        json: { cidr, label: useMyIp ? "내 현재 위치" : (labelInput.trim() || undefined) },
      });
      setItems((arr) => [...arr, res.item]);
      setCidrInput(""); setLabelInput("");
    } catch (e: any) {
      alertAsync({ title: "추가 실패", description: e?.message ?? String(e) });
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string) {
    const ok = await confirmAsync({
      title: "이 IP 를 화이트리스트에서 제거할까요?",
      description: "이 IP 에서는 더 이상 출근 처리가 안 돼요.",
      tone: "danger",
      confirmLabel: "제거",
    });
    if (!ok) return;
    const prev = items;
    setItems((arr) => arr.filter((x) => x.id !== id));
    try { await api(`/api/admin/attendance-ip/${id}`, { method: "DELETE" }); }
    catch (e: any) { setItems(prev); alertAsync({ title: "제거 실패", description: e?.message ?? String(e) }); }
  }

  return (
    <div className="space-y-5">
      <div className="panel p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[15px] font-extrabold text-ink-900">출근 IP 제한</div>
            <div className="text-[12.5px] text-ink-500 mt-1 leading-relaxed">
              켜면 등록한 IP 에서만 출근 처리할 수 있어요. 사무실 인터넷에서만 출근을 허용하고 싶을 때 사용.
              플랫폼/슈퍼 관리자는 이 제한과 무관하게 출근 가능합니다.
            </div>
          </div>
          <label className="flex items-center gap-2 select-none cursor-pointer">
            <input type="checkbox" className="accent-brand-500 w-5 h-5" checked={enabled}
              onChange={(e) => toggle(e.target.checked)} disabled={loading} />
            <span className="text-[13px] font-bold text-ink-800">사용</span>
          </label>
        </div>
      </div>

      <div className="panel p-5">
        <div className="text-[13px] font-bold text-ink-800 mb-3">허용 IP 추가</div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <label className="field-label">IP 또는 CIDR</label>
            <input className="input" placeholder="203.241.45.67 또는 192.168.1.0/24"
              value={cidrInput} onChange={(e) => setCidrInput(e.target.value)} maxLength={64} />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="field-label">라벨 (선택)</label>
            <input className="input" placeholder="예: 본사 사무실"
              value={labelInput} onChange={(e) => setLabelInput(e.target.value)} maxLength={60} />
          </div>
          <button className="btn-primary" disabled={adding || !cidrInput.trim()} onClick={() => add(false)}>추가</button>
          {clientIp && (
            <button className="btn-ghost" disabled={adding} onClick={() => add(true)} title={`현재 ${clientIp}`}>
              내 현재 IP 추가 ({clientIp})
            </button>
          )}
        </div>
      </div>

      <div className="panel p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100">
          <div className="text-[13px] font-bold text-ink-800">허용 IP 목록 <span className="text-ink-400 tabular ml-1">{items.length}</span></div>
          {!enabled && <span className="chip-amber text-[11px]">사용 꺼짐</span>}
        </div>
        {loading ? (
          <div className="px-4 py-8 text-center text-[13px] text-ink-500">불러오는 중…</div>
        ) : items.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-ink-500">
            등록된 IP 가 없어요. 위에서 추가하세요.
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {items.map((it) => (
              <li key={it.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-ink-900 truncate">{it.cidr}</div>
                  <div className="text-[11.5px] text-ink-500 truncate">
                    {it.label ? <span>{it.label} · </span> : null}{new Date(it.createdAt).toLocaleString("ko-KR")}
                  </div>
                </div>
                <button className="btn-icon" title="삭제" onClick={() => remove(it.id)}>
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
