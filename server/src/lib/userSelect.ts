import { Prisma } from "@prisma/client";

/**
 * 아바타/이름 표시에 쓰는 공통 User select.
 * 여러 라우트(chat·approval·meeting·document·project·snippet·dispatch 등)에 똑같이
 * 복제돼 있던 select 블록을 한 곳으로 모은 것. 필드셋이 동일한 곳만 이걸로 치환했다
 * (email 포함/순서 상이/ id 없음 변형은 그대로 둠). `satisfies` 로 결과 타입 추론 보존.
 */
export const USER_AVATAR_SELECT = {
  id: true,
  name: true,
  avatarColor: true,
  isDeveloper: true,
  avatarUrl: true,
} satisfies Prisma.UserSelect;

/** 위 + 직급/팀 — 부서 표시가 필요한 곳(결재 요청자, 채팅 멤버 등). */
export const USER_AVATAR_SELECT_ORG = {
  id: true,
  name: true,
  avatarColor: true,
  isDeveloper: true,
  avatarUrl: true,
  position: true,
  team: true,
} satisfies Prisma.UserSelect;
