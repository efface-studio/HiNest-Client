import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

/**
 * 메일 발송 헬퍼 — AWS SES 사용.
 *
 * 환경 변수:
 *   SES_FROM_ADDRESS   필수 — 발신 주소 (verified identity). 예: "HiNest <no-reply@nest.hi-vits.com>"
 *   AWS_REGION         기본 ap-northeast-2
 *   AWS_ACCESS_KEY_ID  / AWS_SECRET_ACCESS_KEY 또는 ECS Task Role
 *
 * 운영 사전 조건:
 *   1) SES 콘솔에서 발신 도메인(또는 단일 이메일) 을 verify
 *   2) Production access 받기 (샌드박스 상태에선 verified recipient 에게만 보낼 수 있음)
 *   3) Task Role 에 ses:SendEmail / ses:SendRawEmail 권한 부여
 *
 * Fallback 동작:
 *   SES_FROM_ADDRESS 가 없거나 SES 호출이 실패하면 서버 콘솔에 실패 메타만 남긴다.
 *   본문(text/html)에는 비밀번호 재설정 토큰 같은 비밀이 들어가므로 절대 로그에 찍지 않는다.
 *   (이전 구현은 p.text 를 통째로 console.error 로 흘렸고, installConsoleHook 이 인메모리
 *    버퍼에 적재해 /api/admin/server-logs 와 CloudWatch 양쪽에 토큰이 평문으로 노출됐었음.)
 */

const FROM = process.env.SES_FROM_ADDRESS;
const REGION = process.env.AWS_REGION || "ap-northeast-2";

let _ses: SESClient | null = null;
function ses() {
  if (_ses) return _ses;
  _ses = new SESClient({ region: REGION });
  return _ses;
}

export type EmailPayload = {
  to: string;
  subject: string;
  /** 일반 텍스트 본문 — 클라이언트가 HTML 을 못 렌더할 때 fallback. */
  text: string;
  /** HTML 본문 — 가능하면 동봉. 없으면 text 만 보냄. */
  html?: string;
};

export async function sendEmail(payload: EmailPayload): Promise<{ ok: boolean; messageId?: string; reason?: string }> {
  if (!FROM) {
    logFallback(payload, "SES_FROM_ADDRESS 미설정");
    return { ok: false, reason: "SES_FROM_ADDRESS not configured" };
  }
  try {
    const cmd = new SendEmailCommand({
      Source: FROM,
      Destination: { ToAddresses: [payload.to] },
      Message: {
        Subject: { Data: payload.subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: payload.text, Charset: "UTF-8" },
          ...(payload.html ? { Html: { Data: payload.html, Charset: "UTF-8" } } : {}),
        },
      },
    });
    const r = await ses().send(cmd);
    return { ok: true, messageId: r.MessageId };
  } catch (e: any) {
    // SES 호출 실패해도 throw 하지 않음 — 호출 측이 사용자에게 동일한 응답을 줘서
    // "이 이메일이 가입되어 있는가" 를 노출하지 않게 하려는 것. 대신 콘솔에 강하게 남김.
    logFallback(payload, `SES error: ${e?.message ?? String(e)}`);
    return { ok: false, reason: e?.message ?? String(e) };
  }
}

/**
 * 이메일 해시 — to 주소 자체도 PII 라 로그에 직접 안 남김.
 *   domain 은 그대로(스팸/도메인 별 발송 실패 진단용), 로컬파트는 짧은 해시로.
 */
function hashEmailForLog(addr: string): string {
  const at = addr.lastIndexOf("@");
  const local = at >= 0 ? addr.slice(0, at) : addr;
  const domain = at >= 0 ? addr.slice(at + 1) : "?";
  let h = 0;
  for (let i = 0; i < local.length; i++) h = (h * 33 + local.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}@${domain}`;
}

function logFallback(p: EmailPayload, reason: string) {
  // 운영자가 CloudWatch 에서 검색하기 좋은 마커.
  // 본문(text/html)에는 reset 토큰 등 비밀이 들어있어 절대로 찍지 않는다.
  console.error(
    "[EMAIL_FALLBACK] reason=%s to=%s subject=%s",
    reason,
    hashEmailForLog(p.to),
    p.subject,
  );
}
