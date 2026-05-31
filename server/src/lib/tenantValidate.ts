import { prisma } from "./db.js";

/**
 * body 로 들어온 userId 목록이 모두 "현재 테넌트(회사)" 소속 실제 사용자인지 검증.
 *
 * 왜 필요한가:
 *   Prisma $extends 자동 스코프는 "쓰는 행"의 companyId 만 주입할 뿐, 사용자가 보낸
 *   외래 userId(결재자·방 멤버·일정 대상자)가 같은 회사인지는 검사하지 않는다. 또한
 *   nested create 와 SSE publish(userId, ...) 는 companyId 필터를 우회한다. 따라서 타
 *   회사 userId 를 끼워 넣으면 ① 그 사용자에게 실시간 알림/메시지가 전달되거나
 *   ② companyId 가 어긋난 고아 행(멤버십/결재 스텝)이 생겨 테넌트 경계가 깨진다.
 *
 * 어떻게 검증하나:
 *   findMany 자체가 자동 스코프되어 현재 회사 사용자만 돌려준다 → 타 회사/미존재 id 는
 *   결과에서 빠지므로 "고유 입력 개수 == 조회 결과 개수" 가 곧 "전원 같은 회사" 를 의미.
 *   (입력은 내부에서 dedupe 하므로 호출부 중복 제거 여부와 무관하게 정확.)
 *
 * 반환: 비어 있거나 전원 같은 회사면 true, 하나라도 타 회사/미존재면 false.
 */
export async function allSameCompanyUsers(ids: string[]): Promise<boolean> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return true;
  const found = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true },
  });
  return found.length === unique.length;
}
