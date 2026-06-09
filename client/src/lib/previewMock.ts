/**
 * 미리보기(데모) 모드 — 비로그인 방문자가 \"실제 사용 화면\"을 바로 둘러볼 수 있도록
 * /api/* 호출을 가짜 데이터로 단락(short-circuit)시킨다.
 *
 * 동작:
 *  - GET /api/<known> → 미리 정의된 fixture 응답
 *  - 기타 GET → 404 (컴포넌트가 빈 화면으로 graceful fall-through)
 *  - POST/PATCH/DELETE → 미리보기에선 차단(409). 호출부가 alert 띄움.
 *  - SSE(/notification/stream 등) → 절대 연결되지 않게 401 즉시 반환.
 */

const TODAY = new Date();
const ymd = TODAY.toISOString().slice(0, 10);
function iso(daysOffset: number, hour = 9, min = 0): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + daysOffset);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
}

/* ===== 가짜 사용자/팀 ===== */
const DEMO_ME = {
  id: "demo-user",
  email: "demo@hinest.app",
  name: "김데모",
  role: "ADMIN",
  team: "프로덕트팀",
  position: "팀장",
  avatarColor: "#3D54C4",
  avatarUrl: null,
  superAdmin: true,
  // 데모 사용자 = 일반 사용자 인상을 주기 위해 개발자 뱃지 제거.
  isDeveloper: false,
  employeeNo: "AD0000001",
  presenceStatus: null,
  presenceMessage: null,
  presenceUpdatedAt: null,
  workStartTime: "09:00",
  workEndTime: "18:00",
};

/* ===== 한국 회사 톤의 풍부한 데모 명단 — 8개 팀 / 6개 직급 / 사원 30명+ =====
 * 구성:
 *  - 임원/부장/팀장/매니저 약간 + 사원~대리 다수 → 진짜 회사처럼 피라미드 형태.
 *  - presenceStatus 와 avatarColor 는 결정론적 분배로 매 새로고침마다 동일.
 */
const DEMO_TEAMS = ["프로덕트팀", "디자인팀", "개발팀", "마케팅팀", "운영팀", "영업팀", "인사팀", "재무팀"];
const AVATAR_PALETTE = ["#3D54C4", "#16A34A", "#7C3AED", "#DB2777", "#F59E0B", "#0EA5E9", "#EF4444", "#0891B2", "#84CC16", "#F97316"];
const PRESENCE_CYCLE: (string | null)[] = ["AVAILABLE", null, "MEETING", "MEAL", "OUT", null, "AWAY"];
function pick<T>(arr: T[], i: number): T { return arr[i % arr.length]; }

// 임원/매니저 라인 (소수)
const LEADS = [
  { name: "이앨리스",  role: "MANAGER", team: "디자인팀",   position: "리드",   isDeveloper: false, presenceStatus: "AVAILABLE", presenceMessage: null },
  { name: "한이브",    role: "MANAGER", team: "운영팀",     position: "팀장",   isDeveloper: false, presenceStatus: "OUT",        presenceMessage: "외근" },
  { name: "박그레이스", role: "MANAGER", team: "개발팀",     position: "팀장",   isDeveloper: true,  presenceStatus: "MEETING",    presenceMessage: "스프린트 회의" },
  { name: "최마틴",    role: "MANAGER", team: "마케팅팀",   position: "팀장",   isDeveloper: false, presenceStatus: "AVAILABLE", presenceMessage: null },
  { name: "강레오",    role: "MANAGER", team: "영업팀",     position: "팀장",   isDeveloper: false, presenceStatus: "MEAL",       presenceMessage: null },
  { name: "윤소피아",  role: "MANAGER", team: "인사팀",     position: "팀장",   isDeveloper: false, presenceStatus: null,         presenceMessage: null },
  { name: "임도훈",    role: "ADMIN",   team: "재무팀",     position: "이사",   isDeveloper: false, presenceStatus: "MEETING",    presenceMessage: "이사회" },
];

// 대리·주임 (중간 라인)
const SENIORS = [
  { name: "오민준",   team: "개발팀",   position: "대리" },
  { name: "신유나",   team: "디자인팀", position: "대리" },
  { name: "권지호",   team: "프로덕트팀", position: "대리" },
  { name: "백수아",   team: "마케팅팀", position: "대리" },
  { name: "정하림",   team: "영업팀",   position: "대리" },
  { name: "조윤서",   team: "개발팀",   position: "주임" },
  { name: "남지훈",   team: "운영팀",   position: "주임" },
  { name: "유서연",   team: "재무팀",   position: "주임" },
];

// 사원 — 30명 (요청에 맞춰 조정)
const STAFF_NAMES = [
  "박밥", "최캐롤", "정데이브",
  "김지우", "이서연", "박민서", "최지유", "정하윤", "강지호", "조서윤",
  "윤예진", "임지안", "한서아", "오도윤", "신하준", "권시우", "백지민", "남수빈",
  "유주원", "장태윤", "전다은", "황현우", "송지아", "양은우", "구나윤", "노시은",
  "심예준", "차은서", "추민재",
];

function makeStaff(idx: number, name: string) {
  return {
    name,
    role: "MEMBER" as const,
    team: pick(DEMO_TEAMS, idx),
    position: idx % 7 === 0 ? "인턴" : "사원",
    isDeveloper: false,
    presenceStatus: pick(PRESENCE_CYCLE, idx),
    presenceMessage: null as string | null,
  };
}

function buildUsers() {
  const out: any[] = [DEMO_ME];
  let n = 0;
  // 리더진
  for (const l of LEADS) {
    n++;
    out.push({
      id: `u-lead-${n}`,
      email: `${(l.name || "user")}${n}@hinest.app`,
      avatarColor: pick(AVATAR_PALETTE, n),
      avatarUrl: null,
      presenceUpdatedAt: l.presenceStatus ? iso(0, 9 + (n % 8)) : null,
      ...l,
    });
  }
  // 시니어
  for (const s of SENIORS) {
    n++;
    out.push({
      id: `u-sr-${n}`,
      email: `${s.name}${n}@hinest.app`,
      role: "MEMBER" as const,
      isDeveloper: false,
      avatarColor: pick(AVATAR_PALETTE, n + 3),
      avatarUrl: null,
      presenceStatus: pick(PRESENCE_CYCLE, n),
      presenceMessage: null,
      presenceUpdatedAt: iso(0, 9 + (n % 9)),
      ...s,
    });
  }
  // 사원 (인턴 포함) — 30명+
  STAFF_NAMES.forEach((nm, i) => {
    n++;
    const base = makeStaff(i, nm);
    out.push({
      id: `u-mem-${n}`,
      email: `${nm}${n}@hinest.app`,
      avatarColor: pick(AVATAR_PALETTE, n + 5),
      avatarUrl: null,
      presenceUpdatedAt: base.presenceStatus ? iso(0, 9 + (n % 9)) : null,
      ...base,
    });
  });
  return out;
}

const DEMO_USERS = buildUsers();

/* ===== fixtures ===== */
function notices() {
  return {
    notices: [
      { id: "n1", title: "5월 전사 정기 미팅 일정 안내", content:
`5월 15일 (수) 오후 2시 ~ 4시 본사 1층 컨퍼런스홀에서 전사 정기 미팅을 진행합니다.

【 주요 안건 】
1) 1분기 재무 리포트 공유 — 임도훈 이사님
2) 프로덕트 v2 베타 결과 발표 — 이앨리스 리드
3) 여름 시즌 캠페인 킥오프 — 최마틴 팀장
4) Q&A · 자유 발언

【 안내 사항 】
· 외근/출장으로 참석이 어려우신 분은 사전에 한이브 팀장님께 알려주시기 바랍니다.
· 회의록은 당일 저녁까지 사내톡 #전사 채널에 공유됩니다.
· 음료 / 다과는 1층 카페에서 자유롭게 이용 가능합니다.`, createdAt: iso(-1, 10), pinned: true, author: { name: "이앨리스", isDeveloper: false } },
      { id: "n2", title: "여름 휴가 사용 가이드 — 6 ~ 8월", content:
`올해 여름 휴가는 6~8월 중 자유롭게 사용 가능합니다. 휴식의 질을 높이기 위해 5일 이상 연속 사용을 권장드립니다.

【 신청 방법 】
1) 전자결재 → 휴가 신청 → 시작일 / 종료일 / 사유 입력
2) 직속 상사가 1차 결재, 인사팀이 2차 결재
3) 부재 알림 — 본인 캘린더에 자동 표시되며, 팀원 캘린더에도 노출됩니다.

【 주의 】
· 출장 / 외근과 겹치는 일정은 미리 조율 부탁드립니다.
· 7월 말 ~ 8월 초는 신청이 몰릴 가능성이 있어 가능한 일찍 등록해 주세요.
· 잔여 연차는 인사팀 한이브 매니저에게 문의 가능합니다.`, createdAt: iso(-3, 14), pinned: false, author: { name: "한이브", isDeveloper: false } },
      { id: "n3", title: "5월 신규 입사자 환영 인사", content:
`이번 달 합류한 신규 입사자 4명을 소개합니다. 마주칠 때 반갑게 인사 부탁드려요!

· 김지우 (디자인팀 / 사원) — 모바일 인터페이스 / 모션 디자인 담당
· 이서연 (개발팀 / 사원) — 결재 / 알림 도메인
· 박민서 (마케팅팀 / 사원) — 콘텐츠 · 그로스
· 최지유 (디자인팀 / 사원) — 디자인 시스템 v2

각 팀에서 온보딩 메이트를 1명씩 지정해 첫 2주를 함께 합니다. 회식 / 사내 행사 적극 환영해 주세요!`, createdAt: iso(-5, 9), pinned: false, author: { name: "김데모", isDeveloper: false } },
      { id: "n4", title: "사무실 정수기 점검 예정 — 5/12 오전", content:
`5월 12일 (월) 오전 9시 ~ 10시 사무실 정수기 정기 점검이 진행됩니다.

【 영향 】
· 본사 1층 / 3층 정수기 1시간 동안 사용 불가
· 점검 후 필터 교체 완료 시점부터 정상 사용

【 대안 】
· 1층 카페에서 무료 음료 쿠폰 받아 이용 가능 (운영팀 좌석 옆 박스)
· 텀블러 지참하시면 카페 음료 100원 할인

불편을 드려 죄송하며, 양해 부탁드립니다 🙇‍♀️`, createdAt: iso(-6, 16), pinned: false, author: { name: "한이브", isDeveloper: false } },
    ],
  };
}

function schedule() {
  return {
    events: [
      { id: "e1", title: "🚀 스프린트 킥오프 — Sprint 12",
        content: "지난 스프린트 회고 + 이번 2주 우선순위 정렬. 결재 자동화 / 모바일 알림 / 디자인 시스템 v2.1 세 트랙 진행 예정.",
        location: "회의실 B",
        startAt: iso(0, 10),  endAt: iso(0, 11),  scope: "TEAM",    color: "#3B5CF0" },
      { id: "e2", title: "🎨 디자인 리뷰 — v2.1 컬러 토큰",
        content: "신규 톤 적용 화면 5종 검토. 표면 채도 +1 단계 / 텍스트 위계 점검.",
        location: "Figma + 회의실 C",
        startAt: iso(0, 14),  endAt: iso(0, 15),  scope: "TEAM",    color: "#7C3AED" },
      { id: "e3", title: "📊 전사 OKR 공유",
        content: "Q3 OKR 초안 발표 — 본부장 / 팀장 합류. 영상 회의 병행.",
        location: "본사 1층 컨퍼런스홀 + Zoom",
        startAt: iso(1, 11),  endAt: iso(1, 12),  scope: "COMPANY", color: "#16A34A" },
      { id: "e4", title: "☕ 1:1 (이앨리스 ↔ 김데모)",
        content: "다음 스프린트 인력 배분 / 디자인 시스템 v2.1 마이그레이션 일정 합의.",
        location: "1층 카페 (창가 자리)",
        startAt: iso(2, 15),  endAt: iso(2, 16),  scope: "PERSONAL",color: "#F59E0B" },
      { id: "e5", title: "🎬 프로덕트 데모 — 베타 v2",
        content: "베타 피드백 정리 + 변경 사항 시연. 라이브 스트리밍으로 외부 파트너에게 공개.",
        location: "본사 1층 컨퍼런스홀",
        startAt: iso(3, 13),  endAt: iso(3, 14),  scope: "COMPANY", color: "#DB2777" },
      { id: "e6", title: "🪞 스프린트 회고",
        content: "지난 2주 잘된 것 / 부족한 것 / 다음 액션. 익명 보드 미리 입력 부탁.",
        location: "회의실 B",
        startAt: iso(4, 16),  endAt: iso(4, 17),  scope: "TEAM",    color: "#3B5CF0" },
    ],
  };
}

function attendanceToday() {
  // 미리보기 진입 시 "정확히 3시간 38분 근무 중" 으로 보이게 — 현재 시각에서 빼서 checkIn 만든다.
  // 데모용으로 'X시간 Y분' 카운터가 그럴듯한 값(3:38)으로 떨어진다(고정 09:30 출근이면 시간대마다
  // 값이 0~10시간 사이로 튐). 퇴근 X = '근무 중' 상태.
  const WORKED_MIN = 3 * 60 + 38;
  const checkIn = new Date(Date.now() - WORKED_MIN * 60_000);
  return { attendance: { checkIn: checkIn.toISOString(), checkOut: null } };
}

const DEMO_MEETINGS = [
  { id: "m1", title: "프로덕트 정기 회의 (5/8)",  visibility: "ALL",     projectId: null, authorId: "u-lead-1", createdAt: iso(-2, 14), updatedAt: iso(-1, 16), author: { id: "u-lead-1", name: "이앨리스", avatarColor: "#16A34A", isDeveloper: false, avatarUrl: null }, project: null },
  { id: "m2", title: "신규 기능 스펙 정리",       visibility: "PROJECT", projectId: "p1", authorId: "u-lead-3", createdAt: iso(-4, 10), updatedAt: iso(-3, 11), author: { id: "u-lead-3", name: "박그레이스", avatarColor: "#7C3AED", isDeveloper: true,  avatarUrl: null }, project: { id: "p1", name: "HiNest v2", color: "#3B5CF0" } },
  { id: "m3", title: "5월 캠페인 브레인스토밍",   visibility: "ALL",     projectId: null, authorId: "u-lead-4", createdAt: iso(-6, 13), updatedAt: iso(-5, 14), author: { id: "u-lead-4", name: "최마틴", avatarColor: "#F59E0B", isDeveloper: false, avatarUrl: null }, project: null },
];

function meetings() {
  return { meetings: DEMO_MEETINGS };
}

/* ===== TipTap JSON 헬퍼 — 회의록 본문 작성용 ===== */
type TipTapNode = any;
const t  = (text: string, ...marks: string[]): TipTapNode => ({ type: "text", text, ...(marks.length ? { marks: marks.map((m) => ({ type: m })) } : {}) });
const tH = (text: string, color: string): TipTapNode => ({ type: "text", text, marks: [{ type: "highlight", attrs: { color } }] });
const tL = (text: string, href: string): TipTapNode => ({ type: "text", text, marks: [{ type: "link", attrs: { href, target: "_blank", rel: "noopener" } }] });
const p   = (...kids: TipTapNode[]): TipTapNode => ({ type: "paragraph", content: kids.length ? kids : [{ type: "text", text: "" }] });
const h   = (level: 1 | 2 | 3, ...kids: TipTapNode[]): TipTapNode => ({ type: "heading", attrs: { level }, content: kids });
const li  = (...kids: TipTapNode[]): TipTapNode => ({ type: "listItem", content: kids });
const ul  = (...items: TipTapNode[]): TipTapNode => ({ type: "bulletList", content: items });
const ol  = (...items: TipTapNode[]): TipTapNode => ({ type: "orderedList", content: items });
const tk  = (checked: boolean, ...kids: TipTapNode[]): TipTapNode => ({ type: "taskItem", attrs: { checked }, content: kids });
const tkl = (...items: TipTapNode[]): TipTapNode => ({ type: "taskList", content: items });
const cb  = (language: string, code: string): TipTapNode => ({ type: "codeBlock", attrs: { language }, content: [{ type: "text", text: code }] });
const bq  = (...kids: TipTapNode[]): TipTapNode => ({ type: "blockquote", content: kids });
const hr  = (): TipTapNode => ({ type: "horizontalRule" });
const mention = (id: string, label: string): TipTapNode => ({ type: "mention", attrs: { id, label } });

const MEETING_BODIES: Record<string, TipTapNode> = {
  m1: {
    type: "doc",
    content: [
      h(1, t("프로덕트 정기 회의 — 5월 8일")),
      p(t("일시 ", "bold"), t("· 5월 8일 (목) 14:00 ~ 15:30  "), t("· 회의실 B", "italic")),
      p(t("참석 ", "bold"), mention("u-lead-1", "이앨리스"), t(" "), mention("u-lead-3", "박그레이스"), t(" "), mention("u-lead-4", "최마틴"), t(" "), mention(DEMO_ME.id, "김데모")),
      hr(),
      h(2, t("📋 안건")),
      ol(
        li(p(t("지난 주 마일스톤 회고"))),
        li(p(t("v2 베타 피드백 정리"))),
        li(p(t("다음 스프린트 우선순위 조정"))),
        li(p(t("Q3 OKR 초안 검토"))),
      ),
      h(2, t("✅ 결정 사항")),
      ul(
        li(p(t("베타 사용자 ", "bold"), tH("30% 추가 모집", "#FEF3C7"), t(" — 이번 주 안에 시작"))),
        li(p(t("v2 정식 런칭은 ", "bold"), t("6월 2주차", "italic"), t(" 로 확정"))),
        li(p(t("디자인 시스템 마이그레이션을 v2.1 로 미루기로 합의"))),
      ),
      bq(p(t("\"속도보다는 첫 인상이 중요하다\" — 베타 피드백 키워드 정리에서 가장 많이 나온 의견."))),
      h(2, t("🎯 액션 아이템")),
      tkl(
        tk(true,  p(t("베타 만족도 설문 v2 발송 (")), p(mention("u-lead-1", "이앨리스"))),
        tk(false, p(t("로딩 화면 스켈레톤 톤 통일 — "), mention("u-lead-3", "박그레이스"))),
        tk(false, p(t("Q3 OKR 초안 작성 — "), mention(DEMO_ME.id, "김데모"), t(" / 5/12 까지"))),
        tk(false, p(t("마케팅 협업 미팅 잡기 — "), mention("u-lead-4", "최마틴"))),
      ),
      h(2, t("📊 현재 메트릭")),
      ul(
        li(p(t("주간 활성 사용자 ", "bold"), t("1,240명", "code"), t(" (전주 대비 +18%)"))),
        li(p(t("평균 응답 시간 ", "bold"), t("184ms", "code"), t(" / 목표 200ms"))),
        li(p(t("신규 가입 전환율 ", "bold"), tH("23%", "#D1FAE5"), t(" — 사상 최고"))),
      ),
      h(2, t("📎 참고 링크")),
      p(tL("v2 베타 피드백 보드", "https://example.com/feedback"), t(" / "), tL("Q3 OKR 템플릿", "https://example.com/okr")),
      hr(),
      p(t("다음 회의: ", "bold"), t("5월 15일 (목) 14:00 — 같은 자리.")),
    ],
  },
  m2: {
    type: "doc",
    content: [
      h(1, t("신규 기능 스펙 — 결재 자동화 v1")),
      bq(p(t("자주 쓰는 결재(출장/지출/구매)를 한 번에 만드는 ", "bold"), t("템플릿 + 자동 결재선 추천"), t(" 기능. 5월 말 베타 목표."))),
      h(2, t("📐 요구사항")),
      ul(
        li(p(t("결재 템플릿 5종 기본 제공 (출장/지출/구매/외근/연차)"))),
        li(p(t("이전 신청 패턴 기반 ", "italic"), t("결재선 자동 추천", "bold"))),
        li(p(t("Slack/사내톡 멘션으로 진행 상황 알림"))),
        li(p(t("모바일에서도 동일하게 작동"))),
      ),
      h(2, t("🔌 API 스펙 (초안)")),
      cb("ts", `// 결재 템플릿 목록
GET /api/approval/templates
→ { templates: [{ id, name, type, fields, suggestedReviewers }] }

// 자동 결재선 추천
POST /api/approval/suggest-line
body: { type: "TRIP", amount?: number, projectId?: string }
→ { reviewers: [{ id, name, reason }] }

// 템플릿으로 신청
POST /api/approval
body: { templateId, data }`),
      h(2, t("⏱ 마일스톤")),
      tkl(
        tk(true,  p(t("DB 스키마 ApprovalTemplate / SuggestionRule 추가"))),
        tk(true,  p(t("템플릿 5종 시드 데이터 작성"))),
        tk(false, p(t("자동 결재선 추천 알고리즘 구현 — "), mention("u-lead-3", "박그레이스"))),
        tk(false, p(t("프론트 결재 신청 화면에 템플릿 선택 UI 추가"))),
        tk(false, p(t("QA + 베타 그룹 테스트 (5월 4주차)"))),
        tk(false, p(t("정식 배포 (6월 1주차)"))),
      ),
      h(2, t("⚠️ 리스크 / 미정 사항")),
      ul(
        li(p(t("자동 추천 정확도 ", "bold"), tH("70% 미만이면 베타 연기", "#FEE2E2"), t(" 결정"))),
        li(p(t("기존 결재선 즐겨찾기와 UX 충돌 가능 — 우선순위 합의 필요"))),
      ),
      hr(),
      p(t("다음 점검: 5월 15일 정기 회의에서 진행률 공유.")),
    ],
  },
  m3: {
    type: "doc",
    content: [
      h(1, t("5월 캠페인 브레인스토밍")),
      p(t("여름 시즌 SNS · 바이럴 캠페인 아이디어 발산. 후속 액션은 ", "italic"), t("5/15", "bold"), t(" 까지 정리.")),
      h(2, t("🌟 핵심 키워드")),
      p(tH("간결함", "#FEF3C7"), t(" · "), tH("일상의 작은 변화", "#D1FAE5"), t(" · "), tH("동료의 한 마디", "#DBEAFE")),
      h(2, t("💡 떠오른 아이디어")),
      ul(
        li(p(t("\"우리 팀의 5분 회의\"", "bold"), t(" — 임직원 인터뷰 시리즈"))),
        li(p(t("\"오늘 하루 1줄\"", "bold"), t(" — 사용자가 매일 짧은 회고를 남기는 챌린지"))),
        li(p(t("템플릿 갤러리", "bold"), t(" — 회의록/일지 템플릿 무료 공유 마이크로사이트"))),
        li(p(t("디자이너 토크", "bold"), t(" — 스펙 작성 → 디자인 → 출시까지의 비하인드 콘텐츠"))),
      ),
      h(2, t("📅 채널별 액션")),
      tkl(
        tk(false, p(t("Instagram Reels — 주 2회, 30초 이내"))),
        tk(false, p(t("YouTube Shorts — 인터뷰 시리즈 (월 4편)"))),
        tk(false, p(t("LinkedIn — 디자이너 토크 장문 포스팅"))),
        tk(false, p(t("X(Twitter) — 템플릿 갤러리 트위터 카드"))),
        tk(false, p(t("팀 블로그 — 키워드별 매주 1편"))),
      ),
      h(2, t("📎 참고")),
      p(tL("벤치마킹 무드보드", "https://example.com/moodboard"), t(" · "), tL("브랜드 컬러 가이드", "https://example.com/brand")),
      bq(p(t("\"광고처럼 만들지 말자.\" — "), mention("u-lead-4", "최마틴"))),
      hr(),
      p(t("다음 미팅: 5월 13일 (월) 11:00 — 액션별 owner 확정.")),
    ],
  },
};

/* 회의록 수정 이력 — 미리보기에선 회의록 별 2개씩 가짜 이력. */
function meetingRevisions(id: string) {
  const me = { id: DEMO_ME.id, name: DEMO_ME.name };
  const alice = { id: "u-lead-1", name: "이앨리스" };
  const grace = { id: "u-lead-3", name: "박그레이스" };
  const author = id === "m1" ? alice : id === "m2" ? grace : { id: "u-lead-4", name: "최마틴" };
  const body = MEETING_BODIES[id] ?? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] };
  return [
    { id: `${id}-rev2`, title: (DEMO_MEETINGS.find((m) => m.id === id)?.title ?? "회의록") + "",   content: body, createdAt: iso(-1, 16, 30), author: me },
    { id: `${id}-rev1`, title: "회의록 (초안)", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "초안 — 안건만 정리" }] }] }, createdAt: iso(-2, 14), author },
  ];
}

function meetingDetail(id: string) {
  const base = DEMO_MEETINGS.find((m) => m.id === id) ?? DEMO_MEETINGS[0];
  const body = MEETING_BODIES[base.id] ?? { type: "doc", content: [p(t("(빈 회의록)"))] };
  return {
    meeting: {
      ...base,
      content: body,
      viewers: [],
      revisions: [],
      revisedFrom: null,
    },
  };
}

function journalsList() {
  const me = { name: DEMO_ME.name };
  const J = (n: number, title: string, content: string) => ({
    id: `j${-n}`,
    date: iso(n).slice(0, 10),
    title,
    content,
    createdAt: iso(n, 18),
    updatedAt: iso(n, 18),
    user: me,
  });
  return {
    journals: [
      J(0, "오늘 — 결재 자동화 PR + 베타 피드백 정리",
`■ 한 일
- 결재 자동화 v1 스펙 PR 리뷰 (#231) — 댓글 6개 달았고 1차 승인 처리.
  · API 스펙 (POST /approval/suggest-line) 입력값 검증 보강 요청
  · 자동 추천 알고리즘 \`recommendReviewers()\` 의 fallback 케이스 (이전 신청 0건) 명시
  · 마이그레이션 스크립트가 기존 신청 데이터에 대한 backfill 누락 → 추가 부탁 코멘트
- 베타 사용자 피드백 정리 (총 18건 → 4단계 우선순위)
  · P0(즉시): 모바일 알림 누락 1건 — 이미 핫픽스 머지됨
  · P1(이번 스프린트): 회의록 검색 인덱싱 누락, 결재 댓글 알림 누락 2건
  · P2(다음 스프린트): 디자인 톤 일관성, 키보드 단축키 부족 등 8건
  · P3(백로그): UI 디테일 7건
- 박그레이스님과 1:1 (30분)
  · 다음 스프린트 인력 배분 — 결재 자동화 2명 / 모바일 알림 SLA 1명 / 디자인 시스템 v2.1 1명
  · 신규 입사자 (이서연 사원) 온보딩 메이트로 박그레이스님 매칭
- Q3 OKR 초안 1/3 작성 (목표 3개 중 1개 완성)

■ 막힌 것
- 자동 결재선 추천 정확도 측정용 데이터셋이 부족 — 지난 6개월 결재 신청 + 실제 결재선 매칭 정답이 필요한데 결재선 즐겨찾기가 도입된 게 3개월 전이라 절반은 비어 있음. 운영팀(한이브 매니저)과 협의해 수기 라벨링 가능 여부 확인 필요.

■ 내일
- Q3 OKR 초안 마무리 (오전 2시간)
- 마케팅팀 캠페인 협업 미팅 (14:00, 광화문)
- 결재 자동화 v1 베타 그룹 선정 (10명 내외, 다양한 직급 분포 고려)
- 디자인 시스템 v2.1 마이그레이션 일정 이앨리스님과 합의`),
      J(-1, "수요일",
`■ 한 일
- v2 베타 모니터링 — 평균 응답 시간 184ms (목표 200ms 이내, 안정)
- 회의록 검색 인덱싱 도입 PR 머지 (#229)
- 신규 입사자 온보딩 문서 v3 검토

■ 메모
- 베타 사용자 만족도 설문 v2 발송 → 24시간 내 응답률 41%`),
      J(-2, "화요일",
`■ 한 일
- 결재 자동화 마일스톤 정리 — 5월 4주 베타, 6월 1주 정식
- 사내톡 메시지 필터링 정책 회의
- 인사팀과 휴가 자동 연동 케이스 합의

■ 내일
- 결재 자동화 v1 스펙 마무리`),
      J(-3, "월요일",
`■ 한 일
- 주간 회고 — 지난 주 OKR 진척률 72%
- 디자인 시스템 v2.1 보류 결정 사유 정리

■ 메모
- 다음 스프린트는 결재 자동화에 집중`),
      J(-7, "지난 주 회고",
`■ 잘 된 것
- v2 베타 첫 주 안정적 운영 — 사고 0건
- 신규 가입 전환율 23% (사상 최고)

■ 부족했던 것
- 모바일 채팅 알림 누락 이슈 — 발견 후 회복까지 5시간

■ 다음 주
- 결재 자동화 스펙 확정
- 모바일 알림 SLA 모니터링 추가`),
    ],
  };
}

/* ===== 전자결재 데모 ===== */
function demoApprovalsAll() {
  const meReq = { id: DEMO_ME.id, name: DEMO_ME.name, avatarColor: DEMO_ME.avatarColor, avatarUrl: null, position: DEMO_ME.position, team: DEMO_ME.team };
  const reviewers = [
    { id: "u-lead-1", name: "이앨리스",   avatarColor: "#16A34A", avatarUrl: null, position: "리드" },
    { id: "u-lead-7", name: "임도훈",     avatarColor: "#3D54C4", avatarUrl: null, position: "이사" },
    { id: "u-lead-3", name: "박그레이스", avatarColor: "#7C3AED", avatarUrl: null, position: "팀장" },
  ];
  const step = (n: number, who: typeof reviewers[number], status: "PENDING"|"APPROVED"|"REJECTED"|"SKIPPED", actedAt?: string|null, comment?: string|null) =>
    ({ id: `s${n}-${Math.random().toString(36).slice(2, 6)}`, order: n, status, comment: comment ?? null, actedAt: actedAt ?? null, reviewer: who });
  return [
    { id: "ap1", type: "TRIP" as const, title: "부산 KT 본사 미팅 동행 — 5/15 ~ 5/16",
      content: `[목적]
KT 본사와 v2 베타 도입 협의 (의사결정자 미팅).

[일정]
- 5/15 (수) 09:00 김포 → 김해 / 11:00 KT 본사 미팅 / 18:00 호텔 체크인
- 5/16 (목) 10:00 후속 미팅 / 14:00 김해 → 김포 복귀

[비용 추산]
- 항공 왕복 (김포-김해, 평일): 180,000
- 호텔 1박 (이비스 부산역): 110,000
- 식비 / 교통 (현지): 30,000
- 합계: 320,000원

[기대 효과]
연간 계약 규모 약 4억원 / 협업 마일스톤 합의.`,
      status: "PENDING" as const, startDate: iso(7).slice(0,10), endDate: iso(8).slice(0,10), amount: 320000, createdAt: iso(-1, 11),
      requester: meReq, steps: [step(1, reviewers[0], "APPROVED", iso(-1, 14), "출장 일정 확인했습니다. 자료 준비 잘 부탁드려요."), step(2, reviewers[1], "PENDING")], currentReviewerId: reviewers[1].id },
    { id: "ap2", type: "PURCHASE" as const, title: "재택 근무 셋업 — 무선 키보드 / 마우스",
      content: `[필요 사유]
주 2회 재택 전환에 따른 표준 키트 구매.

[품목]
- Logitech MX Keys (텐키리스, USB-C, 다중 페어링): 1
- Logitech MX Master 3S (3 디바이스 동시 페어링): 1

[금액] 86,000원 (쿠팡 정가 대비 18% 할인 적용)
[구매처] 쿠팡 (영수증 첨부)`,
      status: "APPROVED" as const, amount: 86000, createdAt: iso(-3, 9),
      requester: meReq, steps: [step(1, reviewers[0], "APPROVED", iso(-3, 10), "재택 표준 키트 정책에 부합."), step(2, reviewers[1], "APPROVED", iso(-3, 13), "승인합니다.")], currentReviewerId: undefined },
    { id: "ap3", type: "EXPENSE" as const, title: "외부 컨퍼런스 참가 — Next.js Conf 2026",
      content: `[일정]
5/30 (금) 22:00 ~ 5/31 (토) 03:00 (한국시간) 온라인 라이브 + 다시보기.

[금액] 120,000원
- 컨퍼런스 티켓 (얼리버드): 100,000
- 야간 식비 (도시락 + 음료): 20,000

[기대]
v2 의 SSR / RSC 전략 점검 + 신기능 데모 / Vercel 발표 동향 파악.`,
      status: "REJECTED" as const, amount: 120000, createdAt: iso(-5, 14),
      requester: meReq, steps: [step(1, reviewers[0], "APPROVED", iso(-5, 15), "내용 OK."), step(2, reviewers[1], "REJECTED", iso(-4, 10), "올해 교육 예산 소진 — 다음 분기에 다시 신청 부탁드립니다. 영상 다시보기는 회사 계정으로 별도 구독 가능하니 그쪽 활용해 주세요.")], currentReviewerId: undefined },
    { id: "ap4", type: "OFFSITE" as const, title: "광화문 고객사 외근 — Q3 캠페인 킥오프",
      content: `[일정] 5/12 (월) 14:00 ~ 17:00
[장소] 광화문 D-Tower (○○○ 마케팅사)
[참석] 박민서 (단독)

[목적]
Q3 캠페인 킥오프 — 채널별 액션 / 일정 / KPI 합의.

[복귀]
미팅 종료 후 사무실 미복귀, 곧장 퇴근.`,
      status: "PENDING" as const, startDate: iso(2).slice(0,10), endDate: iso(2).slice(0,10), createdAt: iso(0, 9),
      requester: { id: "u-mem-12", name: "박민서", avatarColor: "#F59E0B", avatarUrl: null, position: "사원", team: "마케팅팀" },
      steps: [step(1, { id: DEMO_ME.id, name: DEMO_ME.name, avatarColor: DEMO_ME.avatarColor, avatarUrl: null, position: DEMO_ME.position }, "PENDING")], currentReviewerId: DEMO_ME.id },
    { id: "ap5", type: "GENERAL" as const, title: "재택 근무 신청 — 5/20 하루",
      content: `[일자] 5/20 (수)
[사유] 이사 — 가구 / 가전 배송 수령 필요.

[근무]
- 09:00 ~ 18:00 평소대로 근무
- 사내톡 / 회의 정상 참여
- 피크 미팅 없는 시간대 (12 ~ 14시) 잠시 자리 비울 수 있음 — 사전에 팀에 공유 예정.

[참고]
이번 한 번만 신청, 정기 재택은 별도 결재로 진행 예정.`,
      status: "PENDING" as const, startDate: iso(10).slice(0,10), endDate: iso(10).slice(0,10), createdAt: iso(0, 13),
      requester: { id: "u-mem-3", name: "최지유", avatarColor: "#7C3AED", avatarUrl: null, position: "사원", team: "디자인팀" },
      steps: [step(1, { id: DEMO_ME.id, name: DEMO_ME.name, avatarColor: DEMO_ME.avatarColor, avatarUrl: null, position: DEMO_ME.position }, "PENDING")], currentReviewerId: DEMO_ME.id },
  ];
}

function approvals(p?: string) {
  const m = (p ?? "").match(/scope=([^&]+)/);
  const scope = m?.[1] ?? "mine";
  const list = demoApprovalsAll();
  if (scope === "pending") return { approvals: list.filter((a) => a.status === "PENDING" && a.currentReviewerId === DEMO_ME.id) };
  if (scope === "mine")    return { approvals: list.filter((a) => a.requester.id === DEMO_ME.id) };
  return { approvals: list };
}

/* ===== 데모 프로젝트 ===== */
const DEMO_PROJECTS = [
  { id: "p1", name: "HiNest v2",
    description:
`차세대 사내 협업 플랫폼 리뉴얼.

[목표]
- 회의록 / 결재 / 채팅 한 곳에서 끊김 없이.
- 모바일에서도 데스크톱과 동일한 흐름 (단축키 / 알림 포함).
- 운영 메트릭 P95 응답 200ms 이하 유지.

[로드맵]
- M1 (5월): 결재 자동화 v1 베타
- M2 (6월): 모바일 알림 SLA 도입 + 디자인 시스템 v2.1
- M3 (7월): 정식 런칭 + 외부 파트너 도입`,
    color: "#3B5CF0", status: "ACTIVE" as const,   createdById: DEMO_ME.id, createdAt: iso(-90), updatedAt: iso(-1) },
  { id: "p4", name: "마케팅 Q3 캠페인",
    description:
`여름 시즌 SNS · 바이럴 캠페인 (6 ~ 8월 운영).

[핵심 키워드]
간결함 / 일상의 작은 변화 / 동료의 한 마디.

[채널]
- Instagram Reels: 주 2회, 30초 이내
- YouTube Shorts: 인터뷰 시리즈 (월 4편)
- LinkedIn: 디자이너 / 엔지니어 토크 장문 포스팅
- X (Twitter): 템플릿 갤러리 카드

[KPI]
- 신규 가입 전환율 +3pp
- SNS 팔로워 +20%`,
    color: "#DB2777", status: "ACTIVE" as const,   createdById: "u-lead-4", createdAt: iso(-30), updatedAt: iso(-1) },
  { id: "p5", name: "사내 자료 정리",
    description:
`레거시 문서 마이그레이션 스프린트 (완료).

[배경]
2024 ~ 2025년 사이 부서별 산재되어 있던 운영 / 정책 문서를 사내 문서함으로 통합.

[성과]
- 마이그레이션 완료: 482건 (의도적 폐기 64건 별도)
- 분류 / 태깅 / 권한 재설정 완료
- 검색 인덱싱 도입 — 전체 문서 평균 응답 80ms

[보관]
스프린트 자체는 종료(아카이브). 신규 문서는 일상 워크플로로 흡수됨.`,
    color: "#7C3AED", status: "ARCHIVED" as const, createdById: "u-lead-2", createdAt: iso(-180), updatedAt: iso(-60) },
];

function projectList() { return { projects: DEMO_PROJECTS }; }

/* ===== 프로젝트별 QA / 이벤트 데모 ===== */
const _qaUser = (id: string, name: string, color: string) => ({ id, name, avatarColor: color, avatarUrl: null, position: null, team: null });
const _grace = _qaUser("u-lead-3", "박그레이스", "#7C3AED");
const _alice = _qaUser("u-lead-1", "이앨리스",   "#16A34A");
const _bob   = _qaUser("u-mem-1",  "박밥",       "#7C3AED");
const _me    = _qaUser(DEMO_ME.id, DEMO_ME.name, DEMO_ME.avatarColor);
const _yuna   = _qaUser("u-sr-9",  "신유나", "#0EA5E9"); // p1 멤버 · 디자인팀 대리
const _yunseo = _qaUser("u-sr-13", "조윤서", "#7C3AED"); // p1 멤버 · 개발팀 주임

function projectQa(projectId: string) {
  if (projectId === "p1") {
    // HiNest v2 — 베타 운영 중 발견된 이슈 / 개선
    return [
      { id: "qa1", projectId, title: "모바일에서 결재 댓글 알림 누락", note: "iOS 17.4 + 결재 댓글 작성 시 신청자에게 푸시 알림이 가지 않음. APN payload 확인 필요.",
        screen: "모바일 / 결재 상세", platform: "IOS" as const, assigneeId: _grace.id, status: "IN_PROGRESS" as const, priority: "HIGH" as const, sortOrder: 1, dueDate: iso(3).slice(0, 10),
        createdAt: iso(-2, 11), updatedAt: iso(-1, 14), resolvedAt: null, createdBy: _alice, resolvedBy: null, assignee: _grace, attachments: [] },
      { id: "qa2", projectId, title: "회의록 검색 한글 자모 분리 시 매칭 안 됨", note: "사용자가 '서지' 검색 시 '서지완' 결과는 나오지만 '서지'(자소 단위) 단독 입력엔 0건. 인덱싱 토크나이저 검토.",
        screen: "회의록 / 검색", platform: "WEB" as const, assigneeId: _bob.id, status: "BUG" as const, priority: "NORMAL" as const, sortOrder: 2, dueDate: iso(7).slice(0, 10),
        createdAt: iso(-4, 10), updatedAt: iso(-3, 16), resolvedAt: null, createdBy: _grace, resolvedBy: null, assignee: _bob, attachments: [] },
      { id: "qa3", projectId, title: "다크 모드에서 알림 드롭다운 흐림", note: "안 읽은 항목 배경에 brand-50/30 가 사용돼 다크모드에선 회보라 톤. color-mix 솔리드로 교체.",
        screen: "알림 드롭다운", platform: "WEB" as const, assigneeId: _alice.id, status: "DONE" as const, priority: "LOW" as const, sortOrder: 3, dueDate: null,
        createdAt: iso(-7, 9), updatedAt: iso(-5, 18), resolvedAt: iso(-5, 18), createdBy: _me, resolvedBy: _alice, assignee: _alice, attachments: [] },
      { id: "qa4", projectId, title: "결재 자동 추천 정확도 측정 데이터셋 부족", note: "지난 6개월 신청 + 결재선 매칭 정답이 절반만 라벨링됨. 운영팀과 수기 라벨링 일정 합의 필요.",
        screen: "결재 / 자동 추천", platform: "OTHER" as const, assigneeId: _me.id, status: "ON_HOLD" as const, priority: "HIGH" as const, sortOrder: 4, dueDate: iso(14).slice(0, 10),
        createdAt: iso(-1, 17), updatedAt: iso(0, 9), resolvedAt: null, createdBy: _grace, resolvedBy: null, assignee: _me, attachments: [] },
      { id: "qa5", projectId, title: "키보드 단축키 ⌘K 가이드 부족", note: "신규 사용자 절반이 검색 단축키 존재 자체를 모름. 첫 진입 시 1회 노출되는 hints 추가 검토.",
        screen: "전역 검색", platform: "WEB" as const, assigneeId: null, status: "BUG" as const, priority: "LOW" as const, sortOrder: 5, dueDate: null,
        createdAt: iso(-3, 13), updatedAt: iso(-3, 13), resolvedAt: null, createdBy: _alice, resolvedBy: null, assignee: null, attachments: [] },
    ];
  }
  if (projectId === "p4") {
    return [
      { id: "qa-c1", projectId, title: "Reels 30초 컷 가이드라인 정리", note: "음악·자막·화면 비율 표준. 디자이너 / 영상 외주에 공유.",
        screen: null, platform: "OTHER" as const, assigneeId: _alice.id, status: "IN_PROGRESS" as const, priority: "NORMAL" as const, sortOrder: 1, dueDate: iso(5).slice(0, 10),
        createdAt: iso(-2, 14), updatedAt: iso(-1, 16), resolvedAt: null, createdBy: _qaUser("u-lead-4", "최마틴", "#F59E0B"), resolvedBy: null, assignee: _alice, attachments: [] },
      { id: "qa-c2", projectId, title: "LinkedIn 디자이너 토크 1편 게시", note: "박그레이스님 인터뷰 정리 → 5/20 게시.",
        screen: null, platform: "OTHER" as const, assigneeId: _qaUser("u-lead-4", "최마틴", "#F59E0B").id, status: "BUG" as const, priority: "HIGH" as const, sortOrder: 2, dueDate: iso(10).slice(0, 10),
        createdAt: iso(-1, 11), updatedAt: iso(0, 9), resolvedAt: null, createdBy: _qaUser("u-lead-4", "최마틴", "#F59E0B"), resolvedBy: null, assignee: _qaUser("u-lead-4", "최마틴", "#F59E0B"), attachments: [] },
    ];
  }
  return []; // p5 (archived) — 비움
}

function projectWebhooks(projectId: string) {
  if (projectId === "p1") {
    return [
      { id: "wh1", projectId, name: "GitHub — push / PR 알림", url: "https://hooks.slack.com/services/T01/B02/<masked>", secret: "wh_••••••", events: ["push", "pull_request", "issues"], active: true,  lastDeliveredAt: iso(0, 11, 12), createdAt: iso(-60), createdBy: { id: _grace.id, name: "박그레이스" } },
      { id: "wh2", projectId, name: "Datadog — P1 알람",       url: "https://app.datadoghq.com/integrations/slack/webhook/<masked>", secret: "wh_••••••", events: ["alert.triggered"], active: true,  lastDeliveredAt: iso(-1, 9, 30), createdAt: iso(-50), createdBy: { id: _me.id,  name: DEMO_ME.name } },
      { id: "wh3", projectId, name: "Vercel — 배포 완료",       url: "https://hooks.slack.com/services/T01/B03/<masked>", secret: "wh_••••••", events: ["deploy.success", "deploy.failure"], active: false, lastDeliveredAt: iso(-7, 13, 0), createdAt: iso(-90), createdBy: { id: _me.id,  name: DEMO_ME.name } },
    ];
  }
  if (projectId === "p4") {
    return [
      { id: "wh-c1", projectId, name: "Instagram Graph API — Reels 인사이트", url: "https://graph.facebook.com/<page-id>/insights", secret: "wh_••••••", events: ["impressions.daily"], active: true, lastDeliveredAt: iso(-1, 22, 0), createdAt: iso(-20), createdBy: { id: _qaUser("u-lead-4", "최마틴", "#F59E0B").id, name: "최마틴" } },
    ];
  }
  return [];
}

function projectEvents(projectId: string) {
  if (projectId === "p1") {
    return [
      /* ── 기존 마일스톤 ───────────────────────────────────── */
      { id: "pe1", projectId, title: "결재 자동화 베타 그룹 선정",   description: "10명 내외, 직급 분포 고려. 신청자 중 결재 빈도 상·중·하 골고루 선정해 추천 정확도 편향 방지.", startAt: iso(2, 10),  endAt: iso(2, 11),  allDay: false, color: "#3B5CF0", assigneeIds: _me.id, createdById: _me.id, completed: false, completedAt: null, completedById: null },
      { id: "pe2", projectId, title: "v2 베타 1차 회고",            description: "3주 운영 후 회고. 채택률·반려율·문의 인입 추이 리뷰 후 다음 마일스톤 합의.", startAt: iso(5, 14),  endAt: iso(5, 16),  allDay: false, color: "#3B5CF0", assigneeIds: null, createdById: _alice.id, completed: false, completedAt: null, completedById: null },
      { id: "pe3", projectId, title: "디자인 시스템 v2.1 마이그레이션", description: "전 화면 컬러 토큰 일괄 갱신. 라이트/다크/브랜드 3모드 동시 적용 + 회귀 스크린샷 대조.", startAt: iso(7, 9),   endAt: iso(9, 18),  allDay: true,  color: "#7C3AED", assigneeIds: `${_alice.id},${_yuna.id}`, createdById: _alice.id, completed: false, completedAt: null, completedById: null },
      { id: "pe4", projectId, title: "정식 런칭 D-day",             description: "공식 발표 + 외부 파트너 도입 시작. 보도자료·인앱 공지·고객지원 매크로 동시 오픈.", startAt: iso(45, 10), endAt: iso(45, 11), allDay: false, color: "#DB2777", assigneeIds: null, createdById: _me.id, completed: false, completedAt: null, completedById: null },
      { id: "pe5", projectId, title: "회의록 검색 인덱싱 도입",      description: "한글 자모 분리 토크나이저 적용 + 검색 응답 80ms 목표. 동의어 사전 200개 등록.", startAt: iso(-3, 14), endAt: iso(-3, 18), allDay: false, color: "#16A34A", assigneeIds: _yunseo.id, createdById: _grace.id, completed: true, completedAt: iso(-3, 18), completedById: _grace.id },

      /* ── 지난 일정 (완료) ─────────────────────────────────── */
      { id: "pe6",  projectId, title: "v2 베타 킥오프 & 범위 확정",    description: "베타 성공지표 합의 — 결재 자동화 채택률 60%, 회의록 검색 만족도 4.0/5.0. 프로덕트·디자인·개발 합동.", startAt: iso(-12, 10), endAt: iso(-12, 12), allDay: false, color: "#3B5CF0", assigneeIds: `${_me.id},${_alice.id},${_grace.id}`, createdById: _me.id, completed: true, completedAt: iso(-12, 12), completedById: _me.id },
      { id: "pe7",  projectId, title: "스프린트 13 회고",             description: "벨로시티 38pt 달성. 액션아이템 3건 — 추천 데이터셋 보강 / QA 자동화 / 디자인 토큰 정리.", startAt: iso(-11, 14), endAt: iso(-11, 15), allDay: false, color: "#7C3AED", assigneeIds: `${_grace.id},${_me.id}`, createdById: _grace.id, completed: true, completedAt: iso(-11, 15), completedById: _grace.id },
      { id: "pe8",  projectId, title: "결재선 추천 학습 데이터셋 라벨링", description: "지난 6개월 결재 신청·실제 결재선 매칭 정답 수기 라벨링. 운영팀 협조로 2,400건 확보.", startAt: iso(-8, 9), endAt: iso(-7, 18), allDay: true, color: "#F59E0B", assigneeIds: _yunseo.id, createdById: _grace.id, completed: true, completedAt: iso(-7, 18), completedById: _yunseo.id },
      { id: "pe9",  projectId, title: "디자인 토큰 1차 정리 (라이트 모드)", description: "본문·라벨·코드블록 위계 재정의. Figma 변수 → CSS 변수 매핑표 동봉.", startAt: iso(-7, 15), endAt: iso(-7, 17), allDay: false, color: "#16A34A", assigneeIds: `${_alice.id},${_yuna.id}`, createdById: _alice.id, completed: true, completedAt: iso(-7, 17), completedById: _alice.id },
      { id: "pe10", projectId, title: "주간 스탠드업",                description: "지난주 진행 / 이번주 계획 / 블로커 공유 (15분).", startAt: iso(-6, 9, 30), endAt: iso(-6, 9, 45), allDay: false, color: "#3B5CF0", assigneeIds: null, createdById: _me.id, completed: true, completedAt: iso(-6, 10), completedById: _me.id },
      { id: "pe11", projectId, title: "보안 리뷰 — 세션 토큰 저장 방식 점검", description: "컴플라이언스 점검. httpOnly·SameSite 재확인, 만료·재발급 정책 조정.", startAt: iso(-5, 14), endAt: iso(-5, 16), allDay: false, color: "#DC2626", assigneeIds: _grace.id, createdById: _grace.id, completed: true, completedAt: iso(-5, 16), completedById: _grace.id },
      { id: "pe12", projectId, title: "베타 사용자 심층 인터뷰 (3명)",  description: "온보딩 마찰 구간 / 결재선 추천 신뢰도 / 검색 체감 속도 청취. 녹취 정리본 문서함 업로드.", startAt: iso(-4, 16), endAt: iso(-4, 18), allDay: false, color: "#0EA5E9", assigneeIds: _me.id, createdById: _me.id, completed: true, completedAt: iso(-4, 18), completedById: _me.id },
      { id: "pe13", projectId, title: "6월 1주차 플래닝 & OKR 동기화",  description: "6월 마일스톤 확정 — v2.1 마이그레이션, 베타 2차 회고, RC1 빌드.", startAt: iso(-1, 10), endAt: iso(-1, 11), allDay: false, color: "#3B5CF0", assigneeIds: `${_me.id},${_alice.id},${_grace.id}`, createdById: _me.id, completed: true, completedAt: iso(-1, 11), completedById: _me.id },

      /* ── 이번 주 · 예정 ───────────────────────────────────── */
      { id: "pe14", projectId, title: "데일리 스탠드업",              description: "오늘 작업·블로커 공유 (15분).", startAt: iso(0, 9, 30), endAt: iso(0, 9, 45), allDay: false, color: "#3B5CF0", assigneeIds: null, createdById: _me.id, completed: false, completedAt: null, completedById: null },
      { id: "pe15", projectId, title: "결재 자동화 베타 온보딩 세션",   description: "베타 그룹 대상 결재선 추천·자동 분기 기능 데모 + Q&A. 슬라이드 + 라이브 데모.", startAt: iso(1, 14), endAt: iso(1, 15, 30), allDay: false, color: "#3B5CF0", assigneeIds: `${_me.id},${_alice.id}`, createdById: _me.id, completed: false, completedAt: null, completedById: null },
      { id: "pe16", projectId, title: "디자인 시스템 v2.1 토큰 리뷰",   description: "채도 상향안(이앨리스 제안) 반영 여부 검토. 다크모드 대비비 영향 확인.", startAt: iso(1, 16, 30), endAt: iso(1, 17, 30), allDay: false, color: "#7C3AED", assigneeIds: `${_alice.id},${_grace.id}`, createdById: _alice.id, completed: false, completedAt: null, completedById: null },
      { id: "pe17", projectId, title: "회의록 검색 정확도 측정 리뷰",   description: "자모 토크나이저 적용 후 재현율/응답속도 측정. 목표 80ms 달성 여부 점검.", startAt: iso(3, 11), endAt: iso(3, 12), allDay: false, color: "#16A34A", assigneeIds: _yunseo.id, createdById: _yunseo.id, completed: false, completedAt: null, completedById: null },
      { id: "pe18", projectId, title: "스프린트 14 리뷰 & 데모",       description: "이번 스프린트 산출물 데모: 결재 자동 분기, 검색 인덱싱, 토큰 마이그레이션 착수.", startAt: iso(3, 15), endAt: iso(3, 16, 30), allDay: false, color: "#7C3AED", assigneeIds: _grace.id, createdById: _grace.id, completed: false, completedAt: null, completedById: null },
      { id: "pe19", projectId, title: "스프린트 15 플래닝",           description: "RC1 빌드까지의 백로그 산정. QA·접근성·성능 항목 우선순위 조정.", startAt: iso(6, 10), endAt: iso(6, 11, 30), allDay: false, color: "#7C3AED", assigneeIds: `${_grace.id},${_me.id}`, createdById: _grace.id, completed: false, completedAt: null, completedById: null },
      { id: "pe20", projectId, title: "결재 자동화 A/B 테스트 셋업",    description: "추천 결재선 자동 적용군 vs 수동군 분리. 채택률·반려율 수집 파이프라인 구성.", startAt: iso(6, 14), endAt: iso(6, 16), allDay: false, color: "#F59E0B", assigneeIds: _yunseo.id, createdById: _grace.id, completed: false, completedAt: null, completedById: null },
      { id: "pe21", projectId, title: "QA 리그레션 1차 — 결재·문서함",  description: "v2.1 토큰 적용 후 핵심 플로우 회귀 점검. 결재 상신→승인, 문서 권한 범위.", startAt: iso(8, 11), endAt: iso(8, 13), allDay: false, color: "#F59E0B", assigneeIds: _yunseo.id, createdById: _grace.id, completed: false, completedAt: null, completedById: null },
      { id: "pe22", projectId, title: "v2 베타 2차 회고",             description: "3주 운영 지표 리뷰 + 다음 마일스톤 합의. NPS·채택률·이슈 인입 추이 비교.", startAt: iso(10, 14), endAt: iso(10, 16), allDay: false, color: "#3B5CF0", assigneeIds: _alice.id, createdById: _me.id, completed: false, completedAt: null, completedById: null },
      { id: "pe23", projectId, title: "디자인 시스템 v2.1 QA Freeze",  description: "토큰 변경 동결 — 이후 변경은 핫픽스 절차로만 진행.", startAt: iso(10, 9), endAt: iso(10, 18), allDay: true, color: "#16A34A", assigneeIds: `${_alice.id},${_yuna.id}`, createdById: _alice.id, completed: false, completedAt: null, completedById: null },
      { id: "pe24", projectId, title: "접근성 점검 (WCAG 2.1 AA)",     description: "키보드 내비게이션·대비비·스크린리더 레이블 점검. 결재/문서/검색 우선.", startAt: iso(13, 10), endAt: iso(13, 12), allDay: false, color: "#16A34A", assigneeIds: `${_alice.id},${_yuna.id}`, createdById: _alice.id, completed: false, completedAt: null, completedById: null },
      { id: "pe25", projectId, title: "운영 대시보드 알람 임계치 튜닝",  description: "Datadog P1 알람 오탐 감소 — 에러율·지연 임계치 재조정. 온콜 페이지 룰 정비.", startAt: iso(13, 15), endAt: iso(13, 16), allDay: false, color: "#0D9488", assigneeIds: _grace.id, createdById: _grace.id, completed: false, completedAt: null, completedById: null },
      { id: "pe26", projectId, title: "보안 모의침투 점검 (외부 업체)",  description: "외부 보안업체 1일 점검. 인증/세션/권한 경계 위주. 결과는 리포트로 수령.", startAt: iso(14, 11), endAt: iso(14, 13), allDay: false, color: "#DC2626", assigneeIds: _grace.id, createdById: _me.id, completed: false, completedAt: null, completedById: null },
      { id: "pe27", projectId, title: "릴리스 후보 RC1 빌드",          description: "유니버설 빌드 산출 + 내부 배포. 스모크 테스트 통과 후 베타 채널 승격.", startAt: iso(15, 9), endAt: iso(15, 18), allDay: true, color: "#7C3AED", assigneeIds: `${_grace.id},${_yunseo.id}`, createdById: _grace.id, completed: false, completedAt: null, completedById: null },
      { id: "pe28", projectId, title: "고객지원팀 핸드오프 교육",       description: "v2.1 변경점·FAQ·알려진 이슈 공유. 지원 매크로/도움말 링크 업데이트.", startAt: iso(16, 14), endAt: iso(16, 15, 30), allDay: false, color: "#0EA5E9", assigneeIds: _me.id, createdById: _me.id, completed: false, completedAt: null, completedById: null },
      { id: "pe29", projectId, title: "성능 부하 테스트 (k6)",         description: "동시 500세션 시나리오 — 결재 목록·검색·SSE 알림 부하. p95 응답 300ms 목표.", startAt: iso(17, 10), endAt: iso(17, 12), allDay: false, color: "#0D9488", assigneeIds: _grace.id, createdById: _grace.id, completed: false, completedAt: null, completedById: null },
      { id: "pe30", projectId, title: "코드 프리즈 (Code Freeze)",     description: "릴리스 브랜치 동결. 이후 머지는 릴리스 매니저 승인 필요.", startAt: iso(20, 9), endAt: iso(20, 18), allDay: true, color: "#DB2777", assigneeIds: null, createdById: _grace.id, completed: false, completedAt: null, completedById: null },
      { id: "pe31", projectId, title: "릴리스 노트 & 도움말 센터 작성",  description: "v2.1 변경점 사용자용 정리 + 도움말 센터 신규 항목 3건. 스크린샷 갱신.", startAt: iso(21, 11), endAt: iso(21, 13), allDay: false, color: "#CA8A04", assigneeIds: _me.id, createdById: _me.id, completed: false, completedAt: null, completedById: null },
      { id: "pe32", projectId, title: "앱스토어/웹 배포 점검 회의",      description: "웹(Vercel) 자동 배포 흐름 + macOS 앱 심사 자료 상태 점검. 배포 체크리스트 확정.", startAt: iso(22, 14), endAt: iso(22, 15), allDay: false, color: "#0EA5E9", assigneeIds: `${_me.id},${_grace.id}`, createdById: _me.id, completed: false, completedAt: null, completedById: null },
      { id: "pe33", projectId, title: "최종 Go/No-Go 릴리스 점검",     description: "품질 게이트 종합 — QA·성능·보안·접근성 통과 여부로 출시 결정.", startAt: iso(23, 15), endAt: iso(23, 16), allDay: false, color: "#DB2777", assigneeIds: `${_me.id},${_alice.id},${_grace.id}`, createdById: _me.id, completed: false, completedAt: null, completedById: null },
      { id: "pe34", projectId, title: "월간 OKR 점검 & 6월 회고",      description: "6월 OKR 달성도 리뷰 + 7월 핵심 결과 초안. 베타→정식 전환 준비 상황 공유.", startAt: iso(27, 10), endAt: iso(27, 11, 30), allDay: false, color: "#3B5CF0", assigneeIds: _me.id, createdById: _me.id, completed: false, completedAt: null, completedById: null },
      { id: "pe35", projectId, title: "v2.1 프로덕션 소프트 배포",      description: "전사 점진 배포(10%→50%→100%). 롤백 절차·모니터링 대기조 지정.", startAt: iso(28, 16), endAt: iso(28, 17), allDay: false, color: "#DB2777", assigneeIds: `${_grace.id},${_me.id}`, createdById: _grace.id, completed: false, completedAt: null, completedById: null },

      /* ── 로드맵 (다음 달) ─────────────────────────────────── */
      { id: "pe36", projectId, title: "출시 직후 모니터링 강화 주간",    description: "배포 직후 3일 집중 모니터링. 에러·문의 인입 실시간 추적, 핫픽스 대기조 운영.", startAt: iso(29, 9), endAt: iso(31, 18), allDay: true, color: "#DC2626", assigneeIds: `${_grace.id},${_yunseo.id}`, createdById: _grace.id, completed: false, completedAt: null, completedById: null },
      { id: "pe37", projectId, title: "파트너사 도입 온보딩 (1차)",      description: "외부 파트너 2개사 워크스페이스 셋업 + 관리자 교육. 데이터 마이그레이션 가이드 전달.", startAt: iso(35, 14), endAt: iso(35, 15, 30), allDay: false, color: "#0EA5E9", assigneeIds: _me.id, createdById: _me.id, completed: false, completedAt: null, completedById: null },
      { id: "pe38", projectId, title: "정식 런칭 리허설 / 시나리오 점검", description: "런칭 당일 타임라인·공지·장애 대응 시나리오 드라이런. 역할별 R&R 확정.", startAt: iso(41, 10), endAt: iso(41, 12), allDay: false, color: "#DB2777", assigneeIds: `${_grace.id},${_me.id}`, createdById: _me.id, completed: false, completedAt: null, completedById: null },
      { id: "pe39", projectId, title: "런칭 회고 & Q3 로드맵 수립",      description: "런칭 지표 회고(채택률·리텐션·NPS) + Q3 우선순위. 멀티테넌트 확장 논의.", startAt: iso(52, 9), endAt: iso(52, 18), allDay: true, color: "#3B5CF0", assigneeIds: `${_me.id},${_alice.id},${_grace.id}`, createdById: _me.id, completed: false, completedAt: null, completedById: null },
    ];
  }
  if (projectId === "p4") {
    return [
      { id: "pe-c1", projectId, title: "Reels 1편 촬영", description: "본사 1층 카페에서 짧은 인터뷰 + B-roll.", startAt: iso(3, 14),  endAt: iso(3, 17),  allDay: false, color: "#DB2777", assigneeIds: _qaUser("u-lead-4", "최마틴", "#F59E0B").id, createdById: _qaUser("u-lead-4", "최마틴", "#F59E0B").id, completed: false, completedAt: null, completedById: null },
      { id: "pe-c2", projectId, title: "LinkedIn 디자이너 토크 게시", description: "박그레이스님 편 — 디자인 시스템 v2 비하인드.", startAt: iso(10, 10), endAt: iso(10, 11), allDay: false, color: "#0EA5E9", assigneeIds: _alice.id, createdById: _qaUser("u-lead-4", "최마틴", "#F59E0B").id, completed: false, completedAt: null, completedById: null },
    ];
  }
  return [];
}

/* ===== 문서함 데모 ===== */
function demoFolders() {
  return [
    { id: "f1", name: "회사 운영", parentId: null, createdAt: iso(-180), scope: "ALL" as const, scopeTeam: null, scopeUserIds: null },
    { id: "f2", name: "개발 자료", parentId: null, createdAt: iso(-120), scope: "TEAM" as const, scopeTeam: "개발팀", scopeUserIds: null },
    { id: "f3", name: "디자인 리소스", parentId: null, createdAt: iso(-90),  scope: "TEAM" as const, scopeTeam: "디자인팀", scopeUserIds: null },
    { id: "f4", name: "내 메모", parentId: null, createdAt: iso(-30),  scope: "PRIVATE" as const, scopeTeam: null, scopeUserIds: null },
  ];
}
function demoDocs() {
  const meAuthor = { name: DEMO_ME.name, avatarColor: DEMO_ME.avatarColor, avatarUrl: null };
  return [
    { id: "d1", title: "복리후생 가이드 v3 — 2026 개정",
      description: "연차 / 식대 / 교육비 / 자기계발 / 헬스 케어 / 경조사 정책 종합. 2026년 1월 개정안 반영본. 신규 입사자도 첫 주에 한 번 정독 권장.",
      folderId: "f1", fileUrl: null, fileName: null, fileType: null, fileSize: null, tags: "HR,복리후생,2026개정",
      scope: "ALL"     as const, scopeTeam: null, scopeUserIds: null, createdAt: iso(-60), updatedAt: iso(-3), author: meAuthor, folder: { name: "회사 운영" } },
    { id: "d2", title: "신규 입사자 온보딩 체크리스트 (1 ~ 2주차)",
      description: "Day 1 환경 셋업 / Day 2~5 도메인 학습 / 2주차 첫 PR 머지 까지의 단계별 체크리스트. 메이트 매칭 가이드 포함.",
      folderId: "f1", fileUrl: null, fileName: null, fileType: null, fileSize: null, tags: "온보딩,HR,체크리스트",
      scope: "ALL"     as const, scopeTeam: null, scopeUserIds: null, createdAt: iso(-40), updatedAt: iso(-10), author: meAuthor, folder: { name: "회사 운영" } },
    { id: "d3", title: "API 컨벤션 — REST · 에러 · 페이지네이션",
      description: "리소스 네이밍 / 동사 사용 / 에러 코드 (4xx / 5xx) / 페이지네이션 (cursor vs offset) / 버전 관리 정책. 전 백엔드 코드 리뷰 시 1차 기준.",
      folderId: "f2", fileUrl: null, fileName: null, fileType: null, fileSize: null, tags: "개발,API,컨벤션",
      scope: "TEAM"    as const, scopeTeam: "개발팀", scopeUserIds: null, createdAt: iso(-90), updatedAt: iso(-5),
      author: { name: "박그레이스", avatarColor: "#7C3AED", avatarUrl: null }, folder: { name: "개발 자료" } },
    { id: "d4", title: "디자인 시스템 v2 — Figma 컬러 / 타이포 토큰",
      description: "Light / Dark / Brand 3 모드 컬러 토큰. 본문 / 라벨 / 코드 블록 타이포 위계. CSS 변수 매핑표 동봉.",
      folderId: "f3", fileUrl: null, fileName: null, fileType: null, fileSize: null, tags: "디자인,토큰,Figma",
      scope: "TEAM"    as const, scopeTeam: "디자인팀", scopeUserIds: null, createdAt: iso(-50), updatedAt: iso(-1),
      author: { name: "이앨리스", avatarColor: "#16A34A", avatarUrl: null }, folder: { name: "디자인 리소스" } },
    { id: "d5", title: "주간 업무 보고 템플릿 — 한 일 / 막힌 것 / 다음",
      description: "매주 금요일 17시 까지 작성 / 공유. 한 일 (체크리스트), 막힌 것 (도움 요청), 다음 주 계획 3블록 구성.",
      folderId: null, fileUrl: null, fileName: null, fileType: null, fileSize: null, tags: "템플릿,주간보고",
      scope: "ALL"     as const, scopeTeam: null, scopeUserIds: null, createdAt: iso(-20), updatedAt: iso(-7), author: meAuthor, folder: null },
    { id: "d6", title: "내 회고 노트 (주간 모음)",
      description: "매주 금요일 작성하는 개인 회고. KPT 형식 (Keep / Problem / Try). 분기 말 OKR 회고 원본 데이터로 활용.",
      folderId: "f4", fileUrl: null, fileName: null, fileType: null, fileSize: null, tags: "회고,KPT,개인",
      scope: "PRIVATE" as const, scopeTeam: null, scopeUserIds: null, createdAt: iso(-15), updatedAt: iso(0), author: meAuthor, folder: { name: "내 메모" } },
  ];
}

/* ===== 사내톡 데모 =====
 *  - DM (이앨리스), 팀방(개발팀), 전사 공지방 3개
 *  - 메시지: 텍스트 / 이모지 / 코드 / 이미지 / 반응 */
function chatRooms() {
  const me = { id: DEMO_ME.id, name: DEMO_ME.name, avatarColor: DEMO_ME.avatarColor, avatarUrl: null };
  const alice = { id: "u-lead-1", name: "이앨리스",   avatarColor: "#16A34A", avatarUrl: null };
  const grace = { id: "u-lead-3", name: "박그레이스", avatarColor: "#7C3AED", avatarUrl: null };
  return [
    { id: "r1", name: "이앨리스", type: "DIRECT" as const,
      members: [{ user: me }, { user: alice }],
      messages: [{ content: "👍 확인했습니다 — 내일 보고 드릴게요!", createdAt: iso(0, 14, 32), kind: "TEXT" as const, senderId: alice.id }],
    },
    { id: "r2", name: "개발팀", type: "TEAM" as const,
      members: [{ user: me }, { user: grace }, { user: { id: "u-mem-1", name: "박밥", avatarColor: "#7C3AED", avatarUrl: null } }],
      messages: [{ content: "(이미지)", createdAt: iso(0, 11, 5), kind: "IMAGE" as const, senderId: grace.id }],
    },
    { id: "r3", name: "전사 공지", type: "GROUP" as const,
      members: [{ user: me }, { user: alice }, { user: grace }],
      messages: [{ content: "5/15 정수기 점검 안내드립니다.", createdAt: iso(-1, 9, 30), kind: "TEXT" as const, senderId: "u-lead-2" }],
    },
  ];
}

function chatMessages(roomId: string) {
  const me     = { id: DEMO_ME.id, name: DEMO_ME.name, avatarColor: DEMO_ME.avatarColor, avatarUrl: null };
  const alice  = { id: "u-lead-1", name: "이앨리스",   avatarColor: "#16A34A", avatarUrl: null };
  const grace  = { id: "u-lead-3", name: "박그레이스", avatarColor: "#7C3AED", avatarUrl: null };
  const eve    = { id: "u-lead-2", name: "한이브",     avatarColor: "#0EA5E9", avatarUrl: null };
  const bob    = { id: "u-mem-1", name: "박밥",         avatarColor: "#7C3AED", avatarUrl: null };
  const m = (id: string, sender: any, content: string, opts: any = {}) => ({
    id, content, kind: "TEXT" as const, createdAt: opts.at ?? iso(0, 11),
    sender, reactions: opts.reactions ?? [], ...opts,
  });

  if (roomId === "r1") {
    // DM with 이앨리스 — 텍스트 + 코드 + 이미지 + 반응
    return [
      m("m1-1",  alice, "오늘 베타 피드백 정리한 거 보셨나요? 👀",          { at: iso(0, 11, 2) }),
      m("m1-2",  me,    "네 방금 확인했어요! 우선순위 4단계 정리 좋네요 💯", { at: iso(0, 11, 4),
        reactions: [{ userId: alice.id, emoji: "❤️", user: { name: "이앨리스" } }] }),
      m("m1-3",  alice, "혹시 이 화면 톤 너무 회색 같지 않아요?",            { at: iso(0, 11, 12) }),
      m("m1-4",  alice, "참고용 스크린샷이에요",                              { at: iso(0, 11, 12) }),
      m("m1-5",  alice, "scrn-2026-05-08.png", {
        at: iso(0, 11, 13), kind: "IMAGE",
        fileUrl: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=720&q=70",
        fileName: "scrn-2026-05-08.png", fileType: "image/png", fileSize: 184_300,
      }),
      m("m1-6",  me,    "확실히 좀 더 채도 올려도 될 것 같아요. 디자인 시스템 v2.1 에 반영하시죠.", { at: iso(0, 11, 18) }),
      m("m1-7",  alice, "엇 좋아요. 혹시 토큰 적용 코드 어디서 바꾸는지 알려주실 수 있나요?", { at: iso(0, 11, 25) }),
      m("m1-8",  me, "이 부분이에요 ↓", { at: iso(0, 11, 27) }),
      m("m1-9",  me,
`\`\`\`ts
// client/src/theme/tokens.ts
export const tokens = {
  surface: {
    base:    "var(--c-surface-1)",
    raised:  "var(--c-surface-2)",
    overlay: "rgba(15,23,42,0.04)",
  },
  text: {
    primary:   "var(--c-text-1)",
    secondary: "var(--c-text-2)",
    muted:     "var(--c-text-3)",
  },
};
\`\`\`
이 파일에서 \`surface\` 채도만 한 단계 올리면 전반적으로 따뜻해져요.`,
        { at: iso(0, 11, 27),
          reactions: [
            { userId: alice.id, emoji: "🙏", user: { name: "이앨리스" } },
            { userId: grace.id, emoji: "👀", user: { name: "박그레이스" } },
          ] }),
      m("m1-10", alice, "감사합니다 🙏 오늘 안에 PR 올려둘게요!", { at: iso(0, 11, 35) }),
      m("m1-11", me,    "👍",  { at: iso(0, 11, 36) }),
      m("m1-12", alice, "+ 스프린트 회고 시점 맞춰서 v2.1 같이 묶어서 가는 거 어떠세요?", { at: iso(0, 14, 25) }),
      m("m1-13", me,    "좋습니다. 박그레이스님께도 공유드릴게요.",  { at: iso(0, 14, 30) }),
      m("m1-14", alice, "👍 확인했습니다 — 내일 보고 드릴게요!",     { at: iso(0, 14, 32),
        reactions: [{ userId: me.id, emoji: "🙌", user: { name: DEMO_ME.name } }] }),
    ];
  }

  if (roomId === "r2") {
    // 팀방 — 코드 공유 + 이미지 + 다중 반응
    return [
      m("m2-1", grace, "어제 이슈 났던 결재 리스트 N+1 쿼리 잡았습니다 🔥", { at: iso(-1, 16, 0),
        reactions: [{ userId: me.id, emoji: "🎉", user: { name: DEMO_ME.name } }, { userId: bob.id, emoji: "🔥", user: { name: "박밥" } }] }),
      m("m2-2", grace,
`\`\`\`ts
// before
const list = await prisma.approval.findMany({ ... });
for (const a of list) a.steps = await prisma.approvalStep.findMany({ where: { approvalId: a.id } });

// after — include 한 번에
const list = await prisma.approval.findMany({
  ...,
  include: { steps: { orderBy: { order: "asc" }, include: { reviewer: true } } },
});
\`\`\``, { at: iso(-1, 16, 1) }),
      m("m2-3", bob,   "헐 5초 → 80ms 됐는데요 😱",  { at: iso(-1, 16, 4),
        reactions: [{ userId: grace.id, emoji: "😎", user: { name: "박그레이스" } }] }),
      m("m2-4", me,    "오 좋네요. 운영 메트릭에도 반영해주시면 감사 🙏", { at: iso(-1, 16, 8) }),
      m("m2-5", bob,   "차트로 확인했어요!", { at: iso(0, 11, 0) }),
      m("m2-6", bob,   "perf-2026-05-09.png", {
        at: iso(0, 11, 5), kind: "IMAGE",
        fileUrl: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=720&q=70",
        fileName: "perf-2026-05-09.png", fileType: "image/png", fileSize: 92_400,
        reactions: [
          { userId: grace.id, emoji: "🚀", user: { name: "박그레이스" } },
          { userId: me.id,    emoji: "👏", user: { name: DEMO_ME.name } },
        ],
      }),
    ];
  }

  // 전사 공지방 — 운영팀 한이브가 주로 공지
  return [
    m("m3-1", eve,   "5월 15일 (수) 09:00 ~ 10:00 본사 1층 / 3층 정수기 정기 점검이 진행됩니다. 잠시 사용이 어려우니 양해 부탁드려요 🙏", { at: iso(-1, 9, 30),
      reactions: [{ userId: alice.id, emoji: "👌", user: { name: "이앨리스" } }, { userId: grace.id, emoji: "👍", user: { name: "박그레이스" } }, { userId: me.id, emoji: "🙏", user: { name: DEMO_ME.name } }] }),
    m("m3-2", eve,   "본사 1층 카페에서 무료 음료 쿠폰 배포 중입니다 ☕ 운영팀 좌석 옆 박스에서 1인 1매씩 가져가세요!", { at: iso(0, 9, 5),
      reactions: [{ userId: me.id, emoji: "🙌", user: { name: DEMO_ME.name } }, { userId: grace.id, emoji: "☕", user: { name: "박그레이스" } }] }),
    m("m3-3", eve,   "신규 입사자 4명이 합류했어요 — 김지우 / 이서연 / 박민서 / 최지유 님 환영합니다 🎉 마주칠 때 따뜻하게 인사해 주세요!", { at: iso(0, 10, 12),
      reactions: [
        { userId: alice.id, emoji: "🎉", user: { name: "이앨리스" } },
        { userId: grace.id, emoji: "🎉", user: { name: "박그레이스" } },
        { userId: me.id, emoji: "👋", user: { name: DEMO_ME.name } },
      ] }),
    m("m3-4", { id: "u-lead-7", name: "임도훈", avatarColor: "#3D54C4", avatarUrl: null }, "1분기 재무 결산 미팅 자료 공유드립니다. 5/15 전사 미팅에서 핵심만 발표할 예정이고, 상세 내역은 첨부 PDF 참고해 주세요.",
      { at: iso(0, 13, 40),
        reactions: [{ userId: alice.id, emoji: "📊", user: { name: "이앨리스" } }, { userId: me.id, emoji: "👀", user: { name: DEMO_ME.name } }] }),
    m("m3-5", eve,   "이번 달 사내 동호회 모집 안내드립니다 🏃‍♂️ 러닝 / 보드게임 / 독서 — 자세한 신청 링크는 사내 위키에 있어요!",
      { at: iso(0, 15, 0),
        reactions: [{ userId: grace.id, emoji: "🏃", user: { name: "박그레이스" } }] }),
  ];
}

/* ===== 근태 / 휴가 데모 =====
 *  - 이번 달 평일에 09:00 출근 / 18:00 퇴근. 며칠은 야근(20시), 며칠은 일찍(17시).
 *  - 주말은 빈 행. 오늘은 출근만(퇴근 안 찍음). */
function demoMonthAttendance() {
  const today = new Date(TODAY);
  const y = today.getFullYear();
  const m = today.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const out: any[] = [];
  for (let day = 1; day <= last; day++) {
    const d = new Date(y, m, day);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // 주말 skip
    const date = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const isToday = day === today.getDate();
    const isFuture = day > today.getDate();
    if (isFuture) continue;

    // 출근은 09:00 (변동 ±10분), 퇴근은 18:00~20:00 사이 결정.
    const checkIn = new Date(d); checkIn.setHours(9, (day * 7) % 11, 0, 0);
    const variant = day % 5;
    const checkOut = new Date(d);
    if (variant === 0) checkOut.setHours(20, 15, 0, 0);   // 야근
    else if (variant === 1) checkOut.setHours(17, 30, 0, 0); // 일찍
    else checkOut.setHours(18, 5 + (day % 12), 0, 0);

    out.push({
      id: `att-${date}`,
      date,
      checkIn: checkIn.toISOString(),
      checkOut: isToday ? null : checkOut.toISOString(),
    });
  }
  return out;
}

function demoLeaves(all: boolean) {
  const me = { name: DEMO_ME.name, team: DEMO_ME.team };
  const others = [
    { name: "이앨리스",   team: "디자인팀" },
    { name: "박그레이스", team: "개발팀" },
    { name: "한이브",     team: "운영팀" },
  ];
  const my: any[] = [
    { id: "lv1", userId: DEMO_ME.id, type: "ANNUAL", startDate: iso(-14).slice(0, 10), endDate: iso(-14).slice(0, 10), reason: "개인 사유",            status: "APPROVED", user: me },
    { id: "lv2", userId: DEMO_ME.id, type: "HALF",   startDate: iso(7).slice(0, 10),   endDate: iso(7).slice(0, 10),   reason: "병원 진료 (오후)",     status: "PENDING",  user: me },
    { id: "lv3", userId: DEMO_ME.id, type: "ANNUAL", startDate: iso(21).slice(0, 10),  endDate: iso(23).slice(0, 10),  reason: "여름 휴가",             status: "PENDING",  user: me },
  ];
  if (!all) return my;
  return [
    ...my,
    { id: "lv4", userId: "u-lead-1", type: "ANNUAL", startDate: iso(-2).slice(0, 10),  endDate: iso(-2).slice(0, 10),  reason: "결혼식 참석",           status: "APPROVED", user: others[0] },
    { id: "lv5", userId: "u-lead-3", type: "SICK",   startDate: iso(-5).slice(0, 10),  endDate: iso(-5).slice(0, 10),  reason: "감기",                  status: "APPROVED", user: others[1] },
    { id: "lv6", userId: "u-lead-2", type: "ANNUAL", startDate: iso(10).slice(0, 10),  endDate: iso(12).slice(0, 10),  reason: "가족 여행",             status: "PENDING",  user: others[2] },
    { id: "lv7", userId: "u-lead-3", type: "OFFSITE",startDate: iso(2).slice(0, 10),   endDate: iso(2).slice(0, 10),   reason: "외근 (고객사 미팅)",   status: "APPROVED", user: others[1] },
  ];
}

/* ===== 법인카드 지출 데모 ===== */
function demoExpenses() {
  return [
    { id: "ex1", userId: DEMO_ME.id,  usedAt: iso(0, 12, 30),  merchant: "스타벅스 강남역점",   category: "식비",   amount:  18000, memo: "프로덕트팀 주간 미팅 (참석 4명) — 아이스 아메리카노 4잔",  receiptUrl: null, status: "PENDING",  user: { name: DEMO_ME.name,  team: DEMO_ME.team } },
    { id: "ex2", userId: "u-lead-1",  usedAt: iso(-1, 13, 10), merchant: "본죽 역삼점",          category: "식비",   amount:  12500, memo: "디자인 시스템 v2.1 마감 야근 식대 (단품 1)",                  receiptUrl: null, status: "APPROVED", user: { name: "이앨리스",     team: "디자인팀" } },
    { id: "ex3", userId: DEMO_ME.id,  usedAt: iso(-1, 19, 15), merchant: "카카오T 블루",          category: "교통",   amount:  14300, memo: "외근 복귀 (광화문 → 본사). 늦은 시간 대중교통 단절로 택시 이용", receiptUrl: null, status: "APPROVED", user: { name: DEMO_ME.name,  team: DEMO_ME.team } },
    { id: "ex4", userId: "u-lead-3",  usedAt: iso(-2, 11, 0),  merchant: "쿠팡",                   category: "비품",   amount:  86000, memo: "재택 근무 셋업 — Logitech MX Keys + MX Master 3S 세트 (재택 표준 키트)", receiptUrl: null, status: "APPROVED", user: { name: "박그레이스",   team: "개발팀" } },
    { id: "ex5", userId: "u-lead-4",  usedAt: iso(-3, 18, 30), merchant: "더미식 한정식",         category: "접대",   amount: 240000, memo: "Q3 캠페인 협업사 미팅 (참석 6명, 4코스 한정식 + 음료). 사후 보고서 별첨", receiptUrl: null, status: "APPROVED", user: { name: "최마틴",       team: "마케팅팀" } },
    { id: "ex6", userId: DEMO_ME.id,  usedAt: iso(-4, 20, 0),  merchant: "Notion Inc.",            category: "업무",   amount:  18000, memo: "Notion Pro 1인 월 구독 — 회의록 / 스펙 작성 협업",          receiptUrl: null, status: "APPROVED", user: { name: DEMO_ME.name,  team: DEMO_ME.team } },
    { id: "ex7", userId: "u-lead-2",  usedAt: iso(-5, 9, 30),  merchant: "GS25 본사점",            category: "식비",   amount:   4800, memo: "전사 미팅 준비 시간 — 직원 4명 샌드위치 / 음료",            receiptUrl: null, status: "APPROVED", user: { name: "한이브",       team: "운영팀" } },
    { id: "ex8", userId: DEMO_ME.id,  usedAt: iso(-7, 14, 20), merchant: "Figma Inc.",             category: "업무",   amount:  20000, memo: "Pro 시트 1인 추가 — 신규 입사자(이서연) 합류로 디자인 협업 자리 확보", receiptUrl: null, status: "APPROVED", user: { name: DEMO_ME.name,  team: DEMO_ME.team } },
  ];
}

/* ===== 서비스 계정 데모 ===== */
function demoAccounts() {
  const me = { id: DEMO_ME.id, name: DEMO_ME.name, avatarColor: DEMO_ME.avatarColor, avatarUrl: null };
  const proj = (id: string) => {
    const p = DEMO_PROJECTS.find((x) => x.id === id);
    return p ? { id: p.id, name: p.name, color: p.color } : null;
  };
  const base = (over: any) => ({
    loginId: over.loginId ?? "team@hinest.app",
    url: over.url ?? null,
    notes: over.notes ?? null,
    scope: over.scope ?? "ALL",
    scopeTeam: null,
    scopeTeams: over.scopeTeams ?? [],
    projectId: over.projectId ?? null,
    projectIds: over.projectId ? [over.projectId] : [],
    project: over.projectId ? proj(over.projectId) : null,
    ownerUser: me,
    ownerName: DEMO_ME.name,
    iconUrl: null,
    iconShape: "SQUIRCLE" as const,
    active: true,
    hasPassword: true,
    createdBy: { id: DEMO_ME.id, name: DEMO_ME.name },
    createdAt: iso(-30),
    updatedAt: iso(-1),
    ...over,
  });
  return [
    base({ id: "sa1", serviceName: "AWS Console",      category: "CLOUD",   loginId: "ops@hinest.app",     url: "https://aws.amazon.com",
      notes: "ECS / RDS / S3 운영 계정. 루트는 별도로 1Password 에 분리. MFA 필수." }),
    base({ id: "sa2", serviceName: "Vercel",           category: "HOSTING", loginId: "deploy@hinest.app",  url: "https://vercel.com",          projectId: "p1",
      notes: "프론트 정적 호스팅. main push 시 자동 배포. 환경변수는 Vercel 대시보드에서만 관리." }),
    base({ id: "sa3", serviceName: "GitHub Org",        category: "VCS",     loginId: "github-bot",         url: "https://github.com",
      notes: "Org 단위 SSO 활성. 시드 IP 화이트리스트 적용 — 사무실 / 재택 IP 만 push 가능." }),
    base({ id: "sa4", serviceName: "Stripe",           category: "PAYMENT", loginId: "billing@hinest.app", url: "https://dashboard.stripe.com", scope: "TEAM", scopeTeams: ["재무팀"],
      notes: "결제 / 환불 / 영수증 발급 전용. 권한은 재무팀만 — 다른 팀 접근 시 즉시 알림." }),
    base({ id: "sa5", serviceName: "Cloudflare",       category: "DOMAIN",  loginId: "ops@hinest.app",     url: "https://dash.cloudflare.com",
      notes: "DNS / WAF / CDN. R2 버킷 보조용으로 일부 자료 보관. API Token 은 별도 회전 6개월 주기." }),
    base({ id: "sa6", serviceName: "Google Workspace", category: "EMAIL",   loginId: "admin@hinest.app",   url: "https://admin.google.com",
      notes: "전사 이메일 + Drive. 비활성 계정 정리 분기별 자동화. 외부 공유 정책: 도메인 외 차단." }),
    base({ id: "sa7", serviceName: "Datadog",          category: "MONITOR", loginId: "ops@hinest.app",     url: "https://app.datadoghq.com",   projectId: "p1",
      notes: "APM / 로그 수집 / 알람 채널. 알람 라우팅: P1 → on-call PagerDuty / P2 ↓ Slack #ops." }),
    base({ id: "sa8", serviceName: "OpenAI Platform",  category: "AI",      loginId: "team@hinest.app",    url: "https://platform.openai.com", projectId: "p1",
      notes: "LLM 사용 — 회의록 요약 / 결재 자동 추천. 월 사용량 한도 알림 80% 시 자동 통보." }),
    base({ id: "sa9", serviceName: "RDS Postgres",     category: "DB",      loginId: "hinest",             url: null,
      notes: "운영 DB. 자격증명은 Secrets Manager / Parameter Store 에 분리 보관. IAM 회전 6개월 주기. 백업: 일 1회 자동 + 분기 1회 수동 검증." }),
    base({ id: "sa10", serviceName: "Sentry",          category: "MONITOR", loginId: "ops@hinest.app",     url: "https://sentry.io",
      notes: "에러 트래킹 보조용. 자체 Error Dashboard 도 있지만 Sentry 가 다중 프로젝트 / 알림 정책에 강함." }),
    base({ id: "sa11", serviceName: "1Password",       category: "OTHER",   loginId: "vault@hinest.app",   url: "https://1password.com",
      notes: "팀 비밀번호 / 시크릿 보관소. 모든 새 서비스 등록 후 즉시 1Password 에도 백업 등록." }),
  ];
}
function projectDetail(id: string) {
  const p = DEMO_PROJECTS.find((x) => x.id === id) ?? DEMO_PROJECTS[0];
  // 프로젝트별 멤버 구성을 다르게 — 진짜 회사 프로젝트처럼.
  let pickIds: string[];
  let creatorId: string = DEMO_ME.id;
  if (id === "p1") {
    // HiNest v2 — 본인(OWNER) + 디자인/개발 리드 + 사원 6명
    pickIds = [DEMO_ME.id, "u-lead-1", "u-lead-3", "u-mem-1", "u-mem-2", "u-mem-3", "u-sr-9", "u-sr-13"];
    creatorId = DEMO_ME.id;
  } else if (id === "p4") {
    // Q3 캠페인 — 마케팅 리드(OWNER) + 디자인 리드 + 마케팅 사원
    pickIds = ["u-lead-4", "u-lead-1", "u-mem-4", "u-mem-7", "u-mem-12"];
    creatorId = "u-lead-4";
  } else {
    // 사내 자료 정리 (보관)
    pickIds = ["u-lead-2", DEMO_ME.id, "u-mem-15", "u-mem-18"];
    creatorId = "u-lead-2";
  }
  const members = pickIds.map((uid, i) => {
    const u = DEMO_USERS.find((x) => x.id === uid) ?? DEMO_USERS[0];
    const role = i === 0 ? "OWNER" : i === 1 ? "MANAGER" : "MEMBER";
    return {
      id: `m-${id}-${i}`,
      userId: u.id,
      role,
      user: { id: u.id, name: u.name, avatarColor: u.avatarColor, avatarUrl: null, isDeveloper: (u as any).isDeveloper ?? false, position: u.position, team: u.team, email: u.email },
    };
  });
  const creator = DEMO_USERS.find((x) => x.id === creatorId) ?? DEMO_ME;
  return {
    project: {
      ...p,
      createdBy: { id: creator.id, name: creator.name },
      members,
    },
  };
}
function approvalCounts() {
  const list = demoApprovalsAll();
  const pending = list.filter((a) => a.status === "PENDING" && a.currentReviewerId === DEMO_ME.id).length;
  const mine = list.filter((a) => a.status === "PENDING" && a.requester.id === DEMO_ME.id).length;
  return { pending, mine };
}
function notificationList() { return { notifications: [], unread: 0 }; }
function featureFlags() { return { flags: {} }; }
function teams() { return { teams: DEMO_TEAMS }; }
function navConfig() { return { items: [] }; }

// 플랫폼 운영 콘솔(회사 가입 관리) 데모 데이터 — 상태별로 골고루 둬 재디자인을 미리 볼 수 있게.
function demoCompanies(): any[] {
  const now = Date.now();
  const ago = (days: number) => new Date(now - days * 86400000).toISOString();
  return [
    { id: "co_efface",  name: "efface",    status: "PENDING",   contactName: "서지완", contactEmail: "xixn2@efface.dev",   contactPhone: "010-6286-0063", bizRegNo: "123-45-67890", createdAt: ago(0),   _count: { users: 0 } },
    { id: "co_acme",    name: "Acme Corp", status: "PENDING",   contactName: "이지은", contactEmail: "ops@acme.io",        contactPhone: "010-1111-2222", bizRegNo: "777-11-00099", createdAt: ago(1),   _count: { users: 0 } },
    { id: "co_hinest",  name: "HiNest",    status: "ACTIVE",    contactName: "김데모", contactEmail: "admin@hinest.app",   contactPhone: "02-1234-5678",  bizRegNo: "220-88-12345", createdAt: ago(120), approvedAt: ago(118), _count: { users: 24 } },
    { id: "co_globex",  name: "Globex",    status: "SUSPENDED", contactName: "박준형", contactEmail: "it@globex.co.kr",                                   bizRegNo: "501-22-33445", createdAt: ago(60),  approvedAt: ago(55),  _count: { users: 8 } },
    { id: "co_initech", name: "Initech",   status: "REJECTED",  contactName: "최민수", contactEmail: "biz@initech.com",   rejectedReason: "사업자 정보 확인 불가",                  createdAt: ago(30),  _count: { users: 0 } },
  ];
}
function platformCompanies(p?: string) {
  const m = (p ?? "").match(/[?&]status=([A-Z]+)/);
  const all = demoCompanies();
  return { companies: m ? all.filter((c) => c.status === m[1]) : all };
}
function platformSummary() {
  const summary: Record<string, number> = { PENDING: 0, ACTIVE: 0, SUSPENDED: 0, REJECTED: 0 };
  for (const c of demoCompanies()) summary[c.status]++;
  return { summary };
}

/** 경로별 매처 — 위에서 아래로 검사하므로 **세부 경로 → 일반 경로** 순서. */
const HANDLERS: { test: (p: string) => boolean; data: (p?: string) => any }[] = [
  /* === 본인 / 인증 === */
  { test: (p) => p === "/api/me",                      data: () => ({ user: DEMO_ME, impersonator: null }) },
  { test: (p) => p === "/api/me/presence",             data: () => ({ presenceStatus: null, presenceMessage: null, presenceUpdatedAt: null }) },
  { test: (p) => p.startsWith("/api/version"),         data: () => ({ version: "preview" }) },
  // 미리보기에서 개발자 페이지 열람 허용 — step-up 게이트를 통과시킨다 (active=true).
  { test: (p) => p === "/api/auth/super-session",      data: () => ({ active: true, expiresAt: Date.now() + 60 * 60 * 1000 }) },

  /* === 플랫폼 운영 (회사 가입 관리) — 세부(summary) 먼저 === */
  { test: (p) => p.startsWith("/api/platform/companies/summary"), data: platformSummary },
  { test: (p) => p.startsWith("/api/platform/companies"),         data: platformCompanies },

  /* === 사용자 / 디렉토리 === */
  { test: (p) => p.startsWith("/api/users/teams"),     data: teams },
  { test: (p) => p.startsWith("/api/users/presence"),  data: () => ({ users: DEMO_USERS.map((u) => ({ id: u.id, presenceStatus: u.presenceStatus, presenceMessage: u.presenceMessage, workStatus: "IN" })) }) },
  { test: (p) => p === "/api/users" || p.startsWith("/api/users?"), data: () => {
      const enriched = DEMO_USERS.map((u, i) => ({
        ...u,
        active: true,
        workStatus: i === 0 ? "IN" : i % 3 === 0 ? "NONE" : "IN",
        checkIn: i === 0 ? attendanceToday().attendance.checkIn : null,
        checkOut: null,
        leaveType: null,
      }));
      return { users: enriched };
    } },
  { test: (p) => p.startsWith("/api/users/"),          data: () => ({ user: DEMO_USERS[1] }) },

  /* === 공지 === */
  { test: (p) => /^\/api\/notice\/[^/?]+\/reactions/.test(p), data: () => ({ reactions: [] }) },
  { test: (p) => /^\/api\/notice\/[^/?]+(?:\?|$)/.test(p),    data: (p?: string) => {
      const id = (p ?? "").replace(/^\/api\/notice\//, "").split(/[/?]/)[0];
      const list = notices().notices;
      return { notice: list.find((n) => n.id === id) ?? list[0] };
    } },
  { test: (p) => p.startsWith("/api/notice"),          data: notices },

  /* === 일정 === */
  { test: (p) => /^\/api\/schedule\/[^/?]+/.test(p),   data: () => ({ event: schedule().events[0] }) },
  { test: (p) => p.startsWith("/api/schedule"),        data: schedule },

  /* === 출퇴근 / 휴가 === */
  { test: (p) => p === "/api/attendance/today",        data: attendanceToday },
  { test: (p) => p.startsWith("/api/attendance/leave"), data: (p?: string) => ({ leaves: demoLeaves(/\?all=1/.test(p ?? "")) }) },
  { test: (p) => p.startsWith("/api/attendance/month"), data: () => ({ attendances: demoMonthAttendance() }) },
  { test: (p) => p.startsWith("/api/attendance"),       data: () => ({ attendances: demoMonthAttendance(), leaves: demoLeaves(false) }) },

  /* === 회의록 === */
  { test: (p) => p.startsWith("/api/meeting/mentionable"),                data: () => ({ users: DEMO_USERS.slice(0, 8).map((u) => ({ id: u.id, name: u.name, avatarColor: u.avatarColor })) }) },
  { test: (p) => /^\/api\/meeting\/[^/?]+\/revisions/.test(p),            data: (p?: string) => ({ revisions: meetingRevisions((p ?? "").match(/\/api\/meeting\/([^/?]+)/)?.[1] ?? "m1") }) },
  { test: (p) => /^\/api\/meeting\/[^/?]+(?:\?|$)/.test(p),               data: (p?: string) => meetingDetail((p ?? "").replace(/^\/api\/meeting\//, "").split(/[/?]/)[0]) },
  { test: (p) => p.startsWith("/api/meeting"),                            data: meetings },

  /* === 업무일지 === */
  { test: (p) => /^\/api\/journal\/[^/?]+/.test(p),    data: (p?: string) => {
      const id = (p ?? "").replace(/^\/api\/journal\//, "").split(/[/?]/)[0];
      const list = journalsList().journals;
      return { journal: list.find((j) => j.id === id) ?? list[0] };
    } },
  { test: (p) => p.startsWith("/api/journal"),         data: journalsList },

  /* === 결재 === */
  { test: (p) => p === "/api/approval/counts",         data: approvalCounts },
  { test: (p) => /^\/api\/approval\/[^/?]+/.test(p),   data: (p?: string) => {
      const id = (p ?? "").replace(/^\/api\/approval\//, "").split(/[/?]/)[0];
      const a = demoApprovalsAll().find((x) => x.id === id) ?? demoApprovalsAll()[0];
      return { approval: { ...a, comments: [], revisions: [], revisedFrom: null } };
    } },
  { test: (p) => p.startsWith("/api/approval-extras/lines"),     data: () => ({ lines: [] }) },
  { test: (p) => p.startsWith("/api/approval-extras/templates"), data: () => ({ templates: [] }) },
  { test: (p) => p.startsWith("/api/approval-extras"),           data: () => ({}) },
  { test: (p) => p.startsWith("/api/approval"),                  data: approvals },

  /* === 알림 === */
  { test: (p) => p.startsWith("/api/notification/prefs"), data: () => ({ prefs: {}, dndStart: null, dndEnd: null }) },
  { test: (p) => p.startsWith("/api/notification"),       data: notificationList },

  /* === 채팅 === */
  { test: (p) => /\/api\/chat\/rooms\/[^/]+\/messages/.test(p), data: (p?: string) => {
      const m = (p ?? "").match(/\/rooms\/([^/]+)\/messages/);
      return { messages: chatMessages(m?.[1] ?? "r1"), readStates: [] };
    } },
  { test: (p) => p.startsWith("/api/chat/search"),     data: () => ({ hits: [] }) },
  { test: (p) => p.startsWith("/api/chat/rooms"),      data: () => ({ rooms: chatRooms() }) },
  { test: (p) => p.startsWith("/api/chat"),            data: () => ({ rooms: chatRooms() }) },

  /* === 문서함 === */
  { test: (p) => /^\/api\/document\/[^/?]+\/revisions/.test(p), data: () => ({ revisions: [] }) },
  { test: (p) => p.startsWith("/api/document/folders"),  data: () => ({ folders: demoFolders() }) },
  { test: (p) => p.startsWith("/api/document/projects"), data: () => ({ projects: DEMO_PROJECTS.map((x) => ({ id: x.id, name: x.name, color: x.color })) }) },
  { test: (p) => /^\/api\/document\/[^/?]+/.test(p),     data: (p?: string) => {
      const id = (p ?? "").replace(/^\/api\/document\//, "").split(/[/?]/)[0];
      const d = demoDocs().find((x) => x.id === id) ?? demoDocs()[0];
      return { document: d };
    } },
  { test: (p) => p.startsWith("/api/document"),          data: () => ({ documents: demoDocs(), folders: demoFolders() }) },

  /* === 지출 / 카드 === */
  { test: (p) => /^\/api\/expense\/[^/?]+/.test(p),    data: (p?: string) => {
      const id = (p ?? "").replace(/^\/api\/expense\//, "").split(/[/?]/)[0];
      const list = demoExpenses();
      return { expense: list.find((e) => e.id === id) ?? list[0] };
    } },
  { test: (p) => p.startsWith("/api/expense"),         data: () => {
      const list = demoExpenses();
      return { expenses: list, totalAmount: list.reduce((a, e) => a + e.amount, 0) };
    } },

  /* === 프로젝트 === */
  { test: (p) => /^\/api\/project\/[^/?]+\/events/.test(p),  data: (p?: string) => ({ events: projectEvents((p ?? "").match(/\/api\/project\/([^/?]+)/)?.[1] ?? "p1") }) },
  { test: (p) => /^\/api\/project\/[^/?]+\/qa/.test(p),      data: (p?: string) => ({ items: projectQa((p ?? "").match(/\/api\/project\/([^/?]+)/)?.[1] ?? "p1") }) },
  { test: (p) => /^\/api\/project\/[^/?]+\/webhook/.test(p), data: (p?: string) => ({ channels: projectWebhooks((p ?? "").match(/\/api\/project\/([^/?]+)/)?.[1] ?? "p1") }) },
  { test: (p) => /^\/api\/project\/[^/?]+\/member/.test(p),  data: () => ({ members: [] }) },
  { test: (p) => /^\/api\/project\/[^/?]+(?:\?|$)/.test(p),  data: (p?: string) => projectDetail((p ?? "").replace(/^\/api\/project\//, "").split(/[/?]/)[0]) },
  { test: (p) => p.startsWith("/api/project"),               data: projectList },

  /* === 서비스 계정 === */
  { test: (p) => p.startsWith("/api/service-accounts/projects"), data: () => ({ projects: DEMO_PROJECTS.map((p) => ({ id: p.id, name: p.name, color: p.color })) }) },
  { test: (p) => /^\/api\/service-accounts\/[^/?]+/.test(p), data: () => ({ account: demoAccounts()[0] }) },
  { test: (p) => p.startsWith("/api/service-accounts"),  data: () => ({ accounts: demoAccounts() }) },

  /* === 스니펫 / 핀 / 프로필 === */
  { test: (p) => p.startsWith("/api/snippet/search"),  data: () => ({ snippets: [] }) },
  { test: (p) => p.startsWith("/api/snippet"),         data: () => ({ snippets: [] }) },
  { test: (p) => p.startsWith("/api/pins"),            data: () => ({ pins: [] }) },
  { test: (p) => p.startsWith("/api/profile"),         data: () => ({ user: DEMO_ME }) },

  /* === Feature Flags / 네비 === */
  { test: (p) => p.startsWith("/api/feature-flags"),   data: featureFlags },
  { test: (p) => p.startsWith("/api/nav"),             data: navConfig },

  /* === 검색 / 미리보기 / 공유링크 === */
  { test: (p) => p.startsWith("/api/search"),          data: () => ({ users: [], notices: [], events: [], documents: [], messages: [], meetings: [], approvals: [] }) },
  { test: (p) => p.startsWith("/api/unfurl"),          data: () => ({ url: null, title: null, description: null, image: null }) },
  { test: (p) => p.startsWith("/api/share-links"),     data: () => ({ links: [] }) },
  { test: (p) => p.startsWith("/api/folder-share-links"), data: () => ({ links: [] }) },
  { test: (p) => p.startsWith("/api/public-share"),    data: () => ({ ok: false, error: "preview" }) },

  /* === 관리자 페이지 === */
  { test: (p) => p.startsWith("/api/admin/invites"),        data: () => ({ keys: [] }) },
  { test: (p) => p.startsWith("/api/admin/teams"),          data: () => ({ teams: DEMO_TEAMS.map((t, i) => ({ id: `t${i}`, name: t, createdAt: iso(-30) })) }) },
  { test: (p) => p.startsWith("/api/admin/positions"),      data: () => ({ positions: ["이사", "팀장", "리드", "대리", "주임", "사원", "인턴"].map((n, i) => ({ id: `p${i}`, name: n, rank: i, createdAt: iso(-30) })) }) },
  { test: (p) => p.startsWith("/api/admin/users"),          data: () => ({ users: DEMO_USERS.map((u) => ({ ...u, active: true, createdAt: iso(-90) })) }) },
  { test: (p) => p.startsWith("/api/admin/nav-visibility"), data: () => ({ items: [] }) },
  { test: (p) => p.startsWith("/api/admin/logs"),           data: () => ({ logs: [
      { id: "log1", action: "LOGIN",               target: DEMO_ME.email, detail: "sid=demo",            ip: "211.234.0.0", createdAt: iso(0, 9, 12),  user: { name: DEMO_ME.name, email: DEMO_ME.email } },
      { id: "log2", action: "MEETING_CREATE",      target: "m1",          detail: "5월 둘째 주 정기 회의", ip: "211.234.0.0", createdAt: iso(0, 10, 30), user: { name: DEMO_ME.name, email: DEMO_ME.email } },
      { id: "log3", action: "APPROVAL_APPROVE",    target: "a2",          detail: "외근 신청",            ip: "121.88.0.0",  createdAt: iso(-1, 15, 5), user: { name: "이앨리스", email: "alice@hinest.app" } },
      { id: "log4", action: "USER_UNLOCK",         target: "u-staff-3",   detail: "계정 잠금 해제",        ip: "211.234.0.0", createdAt: iso(-1, 11, 20),user: { name: DEMO_ME.name, email: DEMO_ME.email } },
      { id: "log5", action: "FEATURE_FLAG_UPDATE", target: "chat-v2",     detail: "enabled=true",        ip: "211.234.0.0", createdAt: iso(-2, 16, 40),user: { name: DEMO_ME.name, email: DEMO_ME.email } },
    ] }) },
  /* SuperAdmin(개발자) 영역 — 미리보기에서도 열람 가능. 데모 데이터로 채운다. */
  { test: (p) => p.startsWith("/api/admin/2fa-policy"),     data: () => ({ policies: [], users: [] }) },
  { test: (p) => p.startsWith("/api/admin/feature-flags"),  data: () => ({ flags: [
      { id: "ff1", key: "chat-v2",        description: "사내톡 v2 — 코드블록·이모지 반응", enabled: true,  updatedAt: iso(-2, 16, 40) },
      { id: "ff2", key: "meeting-attach", description: "회의록 파일·링크 첨부",           enabled: true,  updatedAt: iso(-1, 11, 0) },
      { id: "ff3", key: "preview-mode",   description: "로그인 없이 둘러보기",            enabled: true,  updatedAt: iso(-5, 9, 0) },
      { id: "ff4", key: "new-dashboard",  description: "개편된 개요 대시보드 (실험)",      enabled: false, updatedAt: iso(-8, 14, 20) },
    ] }) },
  { test: (p) => p.startsWith("/api/admin/audit"),          data: () => ({ logs: [], actions: [] }) },
  { test: (p) => p.startsWith("/api/admin/health"),         data: () => ({ ok: true, ts: Date.now(), checks: {
      database: { ok: true, latencyMs: 12 },
      redis:    { ok: true, latencyMs: 3 },
      storage:  { ok: true, latencyMs: 41, detail: "S3 · ap-northeast-2" },
      email:    { ok: true, latencyMs: 88, detail: "SES" },
    } }) },
  { test: (p) => p.startsWith("/api/admin/sessions"),       data: () => ({ sessions: [
      { id: "sess1", userId: DEMO_ME.id, ua: "Chrome 125 · macOS",        ip: "211.234.0.0", createdAt: iso(0, 9, 12),  lastSeenAt: iso(0, 14, 3),  revokedAt: null,         user: { id: DEMO_ME.id, name: DEMO_ME.name, email: DEMO_ME.email } },
      { id: "sess2", userId: DEMO_ME.id, ua: "HiNest Desktop · Windows",  ip: "211.234.0.0", createdAt: iso(-1, 18, 40),lastSeenAt: iso(-1, 21, 2), revokedAt: null,         user: { id: DEMO_ME.id, name: DEMO_ME.name, email: DEMO_ME.email } },
      { id: "sess3", userId: "u-lead-1", ua: "Safari · iPhone",           ip: "121.88.0.0",  createdAt: iso(-2, 8, 0),  lastSeenAt: iso(-2, 8, 30), revokedAt: iso(-2, 9, 0),user: { id: "u-lead-1", name: "이앨리스", email: "alice@hinest.app" } },
    ] }) },
  { test: (p) => p.startsWith("/api/admin/api-tokens"),     data: () => ({ tokens: [] }) },
  { test: (p) => p.startsWith("/api/admin/role-permissions"), data: () => ({ catalog: [], matrix: {} }) },
  { test: (p) => p.startsWith("/api/admin/server-logs"),    data: () => ({ logs: [] }) },
  { test: (p) => p.startsWith("/api/admin/api-spec"),       data: () => ({ routes: [] }) },
  { test: (p) => p.startsWith("/api/admin/errors"),         data: () => ({ groups: [] }) },
  { test: (p) => p.startsWith("/api/admin/rate-rules"),     data: () => ({ rules: [] }) },
  { test: (p) => p.startsWith("/api/admin/ip-blocks"),      data: () => ({ blocks: [] }) },
  { test: (p) => p.startsWith("/api/admin/trash"),          data: () => ({ meeting: [], document: [], journal: [], notice: [] }) },
  { test: (p) => p.startsWith("/api/admin"),                data: () => ({}) },
];

/** 미리보기 모드에서 api.ts 가 호출하는 진입점. */
export function previewMockFetch(path: string, init: RequestInit & { json?: any }): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();

  // 쓰기 작업은 차단 — 데모 데이터는 변경 불가.
  if (method !== "GET" && method !== "HEAD") {
    return Promise.resolve(jsonResponse(403, { error: "미리보기 모드에선 변경할 수 없어요. 가입 후 사용해 보세요." }));
  }

  const handler = HANDLERS.find((h) => h.test(path));
  if (handler) {
    return Promise.resolve(jsonResponse(200, handler.data(path)));
  }
  // 매처 없는 경로는 빈 객체로 graceful — 컴포넌트가 빈 상태로 렌더.
  return Promise.resolve(jsonResponse(200, {}));
}

function jsonResponse(status: number, body: any): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// 미리보기 플래그·활성화/비활성화 API 는 경량 모듈 previewFlag.ts 로 이동했다(번들 분리).
// 이 모듈(목 데이터 ~95KB)은 미리보기가 실제 활성일 때만 동적 로드된다.
// 아래 installNetworkPatches/uninstallNetworkPatches 는 previewFlag 가 지연 호출한다.

let _origFetch: typeof fetch | null = null;
let _origEventSource: typeof EventSource | null = null;

/* ---- 보안 ----
 *  api() 만 미리보기로 단락하면 직접 fetch / EventSource 를 쓰는 코드(파일 업로드, SSE 등) 가
 *  실제 서버로 노출된다. enablePreview() 시점에 window 레벨에서 monkey-patch 해 /api/* 진출을 막는다.
 *  - fetch: /api/* 면 mock 응답, 외부 URL(이미지 등) 은 그대로 통과
 *  - EventSource: /api/* 라면 즉시 close 되는 더미 객체, 외부는 통과 */
export function installNetworkPatches() {
  if (typeof window === "undefined") return;
  if (!_origFetch) {
    _origFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      // 동일 출처 절대 URL (https://hinest.app/api/...) 도 잡도록 location.origin 기준으로 비교.
      let path = url;
      try {
        const parsed = new URL(url, window.location.origin);
        if (parsed.origin === window.location.origin) path = parsed.pathname + parsed.search;
      } catch { /* relative URL 그대로 */ }
      if (path.startsWith("/api/")) {
        return previewMockFetch(path, { method: init?.method, headers: init?.headers as any });
      }
      return _origFetch!(input as any, init);
    }) as typeof fetch;
  }
  if (!_origEventSource && typeof EventSource !== "undefined") {
    _origEventSource = EventSource;
    // /api/* 로 가는 SSE 는 실제 서버에 연결되지 않게 더미 객체 반환.
    (window as any).EventSource = function PreviewEventSource(url: string) {
      if (typeof url === "string" && url.startsWith("/api/")) {
        const stub: any = {
          url, readyState: 2, // CLOSED
          withCredentials: false,
          onopen: null, onmessage: null, onerror: null,
          addEventListener() {}, removeEventListener() {}, close() {}, dispatchEvent() { return false; },
        };
        return stub;
      }
      return new _origEventSource!(url as any);
    };
    // 정적 상수 유지 (CONNECTING/OPEN/CLOSED).
    (window as any).EventSource.CONNECTING = 0;
    (window as any).EventSource.OPEN = 1;
    (window as any).EventSource.CLOSED = 2;
  }
}

export function uninstallNetworkPatches() {
  if (typeof window === "undefined") return;
  if (_origFetch) { window.fetch = _origFetch; _origFetch = null; }
  if (_origEventSource) { (window as any).EventSource = _origEventSource; _origEventSource = null; }
}
