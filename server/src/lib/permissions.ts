import { prisma } from "./db.js";

/**
 * 역할(role) 별 기능 권한 — 카탈로그(코드) + 오버라이드(DB).
 *
 * 카탈로그의 \`defaults\` 가 출고 시 기본값. 관리자가 SuperAdmin 페이지에서
 * 켜고 끄면 \`RolePermission\` row 가 생성/갱신되어 default 를 덮어쓴다.
 *
 * 사용:
 *   import { hasPermission } from "../lib/permissions.js";
 *   if (!(await hasPermission(u.role, "meeting.delete.any"))) return res.status(403)...
 */

export type Role = "ADMIN" | "MANAGER" | "MEMBER";

export type PermKey =
  // 일정
  | "schedule.create"
  | "schedule.create.company"      // 전사 일정
  | "schedule.create.team"         // 팀 일정
  | "schedule.edit.any"
  | "schedule.delete.any"
  // 회의록
  | "meeting.create"
  | "meeting.edit.any"
  | "meeting.delete.any"
  | "meeting.visibility.all"       // 전사 공개로 작성
  // 공지
  | "notice.create"
  | "notice.edit.any"
  | "notice.delete.any"
  | "notice.pin"
  // 결재
  | "approval.create"
  | "approval.review"
  | "approval.cancel.any"
  // 근태/휴가
  | "attendance.edit.own"
  | "attendance.edit.any"
  | "leave.request"
  | "leave.approve"
  // 업무일지
  | "journal.create"
  | "journal.view.team"
  | "journal.view.all"
  // 지출
  | "expense.create"
  | "expense.approve"
  | "expense.view.team"
  | "expense.view.all"
  // 문서
  | "document.create"
  | "document.edit.any"
  | "document.delete.any"
  | "document.share.link"
  // 채팅
  | "chat.room.create"
  | "chat.room.kick"
  | "chat.audit"                   // 사내톡 감사 (개발자 전용 권장)
  // 프로젝트
  | "project.create"
  | "project.edit.any"
  | "project.delete.any"
  | "project.member.manage"
  // 사용자/조직
  | "user.invite"
  | "user.edit"
  | "user.deactivate"
  | "user.role.change"
  | "user.team.change"
  | "directory.edit"
  // 서비스 계정/카드
  | "service-account.manage"
  | "card.manage"
  // 알림/시스템
  | "notice.broadcast"
  | "snippet.share"
  | "upload.unlimited"
  | "admin.access";                // /admin (관리자) 페이지 진입

type Group =
  | "일정" | "회의록" | "공지" | "결재" | "근태·휴가" | "업무일지"
  | "지출·카드" | "문서" | "채팅" | "프로젝트" | "사용자·조직" | "기타";

type Catalog = {
  key: PermKey;
  label: string;
  group: Group;
  defaults: Record<Role, boolean>;
  /** UI 에서 숨김 — 개발자 전용 / 직접 토글하면 안 되는 키. hasPermission() 평가는 정상 동작. */
  hidden?: boolean;
};

export const PERMISSION_CATALOG: Catalog[] = [
  { key: "schedule.create",         label: "일정 작성",                group: "일정",      defaults: { ADMIN: true,  MANAGER: true,  MEMBER: true  } },
  { key: "schedule.create.team",    label: "팀 일정 등록",             group: "일정",      defaults: { ADMIN: true,  MANAGER: true,  MEMBER: true  } },
  { key: "schedule.create.company", label: "전사 일정 등록",           group: "일정",      defaults: { ADMIN: true,  MANAGER: true,  MEMBER: false } },
  { key: "schedule.edit.any",       label: "다른 사람 일정 편집",       group: "일정",      defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },
  { key: "schedule.delete.any",     label: "다른 사람 일정 삭제",       group: "일정",      defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },

  { key: "meeting.create",          label: "회의록 작성",              group: "회의록",    defaults: { ADMIN: true,  MANAGER: true,  MEMBER: true  } },
  { key: "meeting.edit.any",        label: "다른 사람 회의록 편집",     group: "회의록",    defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },
  { key: "meeting.delete.any",      label: "다른 사람 회의록 삭제",     group: "회의록",    defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },
  { key: "meeting.visibility.all",  label: "전사 공개로 회의록 작성",   group: "회의록",    defaults: { ADMIN: true,  MANAGER: true,  MEMBER: false } },

  { key: "notice.create",           label: "공지 작성",                group: "공지",      defaults: { ADMIN: true,  MANAGER: true,  MEMBER: false } },
  { key: "notice.edit.any",         label: "다른 사람 공지 편집",       group: "공지",      defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },
  { key: "notice.delete.any",       label: "다른 사람 공지 삭제",       group: "공지",      defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },
  { key: "notice.pin",              label: "공지 상단 고정",            group: "공지",      defaults: { ADMIN: true,  MANAGER: true,  MEMBER: false } },
  { key: "notice.broadcast",        label: "전사 알림 보내기",          group: "공지",      defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },

  { key: "approval.create",         label: "결재 신청",                group: "결재",      defaults: { ADMIN: true,  MANAGER: true,  MEMBER: true  } },
  { key: "approval.review",         label: "결재자 지정 가능 (남이 나를 결재자로)", group: "결재", defaults: { ADMIN: true,  MANAGER: true,  MEMBER: false } },
  { key: "approval.cancel.any",     label: "다른 사람 결재 취소",       group: "결재",      defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },

  { key: "attendance.edit.own",     label: "내 출퇴근 직접 수정",       group: "근태·휴가", defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },
  { key: "attendance.edit.any",     label: "다른 사람 출퇴근 수정",     group: "근태·휴가", defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },
  { key: "leave.request",           label: "휴가 신청",                group: "근태·휴가", defaults: { ADMIN: true,  MANAGER: true,  MEMBER: true  } },
  { key: "leave.approve",           label: "휴가 승인",                group: "근태·휴가", defaults: { ADMIN: true,  MANAGER: true,  MEMBER: false } },

  { key: "journal.create",          label: "업무일지 작성",            group: "업무일지",  defaults: { ADMIN: true,  MANAGER: true,  MEMBER: true  } },
  { key: "journal.view.team",       label: "팀원 업무일지 열람",        group: "업무일지",  defaults: { ADMIN: true,  MANAGER: true,  MEMBER: false } },
  { key: "journal.view.all",        label: "전사 업무일지 열람",        group: "업무일지",  defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },

  { key: "expense.create",          label: "지출 등록",                group: "지출·카드", defaults: { ADMIN: true,  MANAGER: true,  MEMBER: true  } },
  { key: "expense.approve",         label: "지출 승인",                group: "지출·카드", defaults: { ADMIN: true,  MANAGER: true,  MEMBER: false } },
  { key: "expense.view.team",       label: "팀 지출 열람",             group: "지출·카드", defaults: { ADMIN: true,  MANAGER: true,  MEMBER: false } },
  { key: "expense.view.all",        label: "전사 지출 열람",           group: "지출·카드", defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },
  { key: "card.manage",             label: "법인카드 관리",            group: "지출·카드", defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },

  { key: "document.create",         label: "문서 작성/업로드",          group: "문서",      defaults: { ADMIN: true,  MANAGER: true,  MEMBER: true  } },
  { key: "document.edit.any",       label: "다른 사람 문서 편집",       group: "문서",      defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },
  { key: "document.delete.any",     label: "다른 사람 문서 삭제",       group: "문서",      defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },
  { key: "document.share.link",     label: "외부 공유 링크 발급",       group: "문서",      defaults: { ADMIN: true,  MANAGER: true,  MEMBER: false } },

  { key: "chat.room.create",        label: "채팅방 생성",              group: "채팅",      defaults: { ADMIN: true,  MANAGER: true,  MEMBER: true  } },
  { key: "chat.room.kick",          label: "채팅방 멤버 추방",          group: "채팅",      defaults: { ADMIN: true,  MANAGER: true,  MEMBER: false } },
  { key: "chat.audit",              label: "사내톡 감사 접근",          group: "채팅",      defaults: { ADMIN: false, MANAGER: false, MEMBER: false }, hidden: true }, // 개발자 stepup 전용 — UI 노출 X

  { key: "project.create",          label: "프로젝트 생성",            group: "프로젝트",  defaults: { ADMIN: true,  MANAGER: true,  MEMBER: true  } },
  { key: "project.edit.any",        label: "다른 사람 프로젝트 편집",   group: "프로젝트",  defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },
  { key: "project.delete.any",      label: "다른 사람 프로젝트 삭제",   group: "프로젝트",  defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },
  { key: "project.member.manage",   label: "프로젝트 멤버 추가/제거",   group: "프로젝트",  defaults: { ADMIN: true,  MANAGER: true,  MEMBER: false } },

  { key: "user.invite",             label: "초대 키 발급",             group: "사용자·조직", defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },
  { key: "user.edit",               label: "사용자 정보 편집",          group: "사용자·조직", defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },
  { key: "user.deactivate",         label: "사용자 비활성화/퇴사 처리", group: "사용자·조직", defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },
  { key: "user.role.change",        label: "사용자 역할 변경",          group: "사용자·조직", defaults: { ADMIN: false, MANAGER: false, MEMBER: false } }, // 개발자 stepup 만
  { key: "user.team.change",        label: "사용자 팀 변경",            group: "사용자·조직", defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },
  { key: "directory.edit",          label: "조직도 편집",              group: "사용자·조직", defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },
  { key: "admin.access",            label: "관리자 페이지 접근",        group: "사용자·조직", defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },

  { key: "service-account.manage",  label: "서비스 계정 관리",          group: "기타",      defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },
  { key: "snippet.share",           label: "스니펫 공유",              group: "기타",      defaults: { ADMIN: true,  MANAGER: true,  MEMBER: true  } },
  { key: "upload.unlimited",        label: "대용량 업로드 허용",        group: "기타",      defaults: { ADMIN: true,  MANAGER: false, MEMBER: false } },
];

const ALL_KEYS = new Set(PERMISSION_CATALOG.map((p) => p.key));

/* 인메모리 캐시 — 60s. RolePermission row 가 바뀌면 evictPermissionCache(). */
let _cache: { rows: { role: string; permKey: string; enabled: boolean }[]; exp: number } | null = null;
const TTL = 60_000;

async function getOverrides() {
  if (_cache && _cache.exp > Date.now()) return _cache.rows;
  const rows = await prisma.rolePermission.findMany({
    select: { role: true, permKey: true, enabled: true },
  });
  _cache = { rows, exp: Date.now() + TTL };
  return rows;
}

export function evictPermissionCache() { _cache = null; }

/** role 의 특정 권한 활성 여부. row 가 없으면 catalog default. */
export async function hasPermission(role: string, key: PermKey): Promise<boolean> {
  if (!ALL_KEYS.has(key)) return false;
  const r = role as Role;
  const overrides = await getOverrides();
  const found = overrides.find((o) => o.role === r && o.permKey === key);
  if (found) return found.enabled;
  const cat = PERMISSION_CATALOG.find((c) => c.key === key);
  return cat?.defaults[r] ?? false;
}

/** 모든 role × key 에 대한 현재 effective 매트릭스 — 관리 화면이 한 번에 표시할 때. */
export async function getEffectiveMatrix(): Promise<Record<Role, Record<PermKey, boolean>>> {
  const overrides = await getOverrides();
  const out: any = { ADMIN: {}, MANAGER: {}, MEMBER: {} };
  for (const c of PERMISSION_CATALOG) {
    for (const r of ["ADMIN", "MANAGER", "MEMBER"] as const) {
      const ov = overrides.find((o) => o.role === r && o.permKey === c.key);
      out[r][c.key] = ov ? ov.enabled : c.defaults[r];
    }
  }
  return out;
}
