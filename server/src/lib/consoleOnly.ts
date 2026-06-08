/**
 * 개발자 콘솔 전용 계정 판별.
 *
 * 일부 계정(예: xixn2@efface.dev)은 "진짜 개발자 페이지 전용" 계정이라, 회사 앱(일반 페이지:
 * 팀원·공지·문서함 등)엔 들어가지 못하고 오직 운영 콘솔(/super-admin)만 사용해야 한다.
 *
 * 식별 기준 (둘 중 하나라도 매치 + 콘솔 권한 보유):
 *   1) 이메일 allowlist      — CONSOLE_ONLY_EMAILS (쉼표 구분, 기본 비어있음)
 *   2) 이메일 도메인 allowlist — CONSOLE_ONLY_DOMAINS (기본 "efface.dev" = 개발 스튜디오 도메인)
 *
 * 안전장치: superAdmin / platformAdmin 이 아닌 계정은 절대 콘솔 전용으로 묶지 않는다
 * (혹시 일반 사용자가 같은 도메인 이메일을 쓰더라도 회사 앱에서 쫓겨나지 않도록).
 *
 * 환경변수로 덮어쓸 수 있어, 코드 수정/배포 없이 대상 계정을 추가/변경할 수 있다.
 */

function parseList(v: string | undefined, fallback: string): string[] {
  return (v ?? fallback)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const CONSOLE_ONLY_EMAILS = parseList(process.env.CONSOLE_ONLY_EMAILS, "");
const CONSOLE_ONLY_DOMAINS = parseList(process.env.CONSOLE_ONLY_DOMAINS, "efface.dev");

export function isConsoleOnlyUser(u: {
  email?: string | null;
  superAdmin?: boolean | null;
  platformAdmin?: boolean | null;
}): boolean {
  if (!u?.email) return false;
  // 콘솔 권한이 없는 계정은 대상에서 제외 — 일반 사용자가 잘못 갇히는 일 방지.
  if (!u.superAdmin && !u.platformAdmin) return false;
  const email = u.email.toLowerCase();
  if (CONSOLE_ONLY_EMAILS.includes(email)) return true;
  const domain = email.split("@")[1] ?? "";
  return CONSOLE_ONLY_DOMAINS.includes(domain);
}
