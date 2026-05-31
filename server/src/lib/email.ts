import { SESClient, SendEmailCommand, SendRawEmailCommand } from "@aws-sdk/client-ses";

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
  /**
   * 답장 받을 주소(addr-spec, ASCII). 설정하면 수신자가 "답장"을 눌렀을 때
   * 발신주소(no-reply)가 아니라 이 주소로 회신이 간다. 예: 발송한 담당자 이메일.
   */
  replyTo?: string;
  /** replyTo 표시 이름(선택). 비-ASCII(한글)도 헤더에서 안전하게 인코딩된다. */
  replyToName?: string;
};

/**
 * 주소 헤더 값 구성(Reply-To 등). 이름이 있으면 `=?UTF-8?B?..?= <email>`,
 * 없으면 bare email. encoded-word 는 ASCII 라 raw MIME / SES 양쪽에서 안전.
 */
function formatAddressHeader(email: string, name?: string): string {
  return name ? `${encodeHeaderUtf8(name)} <${email}>` : email;
}

export async function sendEmail(payload: EmailPayload): Promise<{ ok: boolean; messageId?: string; reason?: string }> {
  if (!FROM) {
    logFallback(payload, "SES_FROM_ADDRESS 미설정");
    return { ok: false, reason: "SES_FROM_ADDRESS not configured" };
  }
  try {
    const cmd = new SendEmailCommand({
      Source: FROM,
      Destination: { ToAddresses: [payload.to] },
      ...(payload.replyTo
        ? { ReplyToAddresses: [formatAddressHeader(payload.replyTo, payload.replyToName)] }
        : {}),
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

export type EmailAttachment = {
  /** ASCII 파일명 권장 — 비-ASCII 는 안전 문자로 치환된다. */
  filename: string;
  /** 순수 base64(데이터 URI 접두어 없음). */
  contentBase64: string;
  /** MIME 타입 — 기본 application/pdf. */
  contentType?: string;
};

/**
 * 첨부 포함 메일 발송 — SendRawEmailCommand 로 직접 MIME 을 만들어 보낸다.
 * 첨부가 없으면 일반 sendEmail 경로로 위임(코드 중복 없음).
 * sendEmail 과 동일하게 실패해도 throw 하지 않고 {ok:false}; 본문은 절대 로그 안 함.
 */
export async function sendEmailWithAttachment(
  payload: EmailPayload & { attachments?: EmailAttachment[] },
): Promise<{ ok: boolean; messageId?: string; reason?: string }> {
  const attachments = payload.attachments ?? [];
  if (attachments.length === 0) return sendEmail(payload);

  if (!FROM) {
    logFallback(payload, "SES_FROM_ADDRESS 미설정");
    return { ok: false, reason: "SES_FROM_ADDRESS not configured" };
  }
  try {
    const raw = buildRawMime(FROM, payload, attachments);
    const cmd = new SendRawEmailCommand({
      Destinations: [payload.to],
      RawMessage: { Data: new TextEncoder().encode(raw) },
    });
    const r = await ses().send(cmd);
    return { ok: true, messageId: r.MessageId };
  } catch (e: any) {
    logFallback(payload, `SES raw error: ${e?.message ?? String(e)}`);
    return { ok: false, reason: e?.message ?? String(e) };
  }
}

/* ===== MIME 빌더 (첨부 메일용) ===== */

const CRLF = "\r\n";

function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

/** base64 문자열을 76자마다 CRLF 로 접는다(RFC 2045). */
function foldBase64(s: string): string {
  const lines: string[] = [];
  for (let i = 0; i < s.length; i += 76) lines.push(s.slice(i, i + 76));
  return lines.join(CRLF);
}

/**
 * 헤더용 UTF-8 인코딩(RFC 2047 encoded-word).
 * 멀티바이트 경계가 안 깨지게 ~45바이트 이하로 쪼개 각각 =?UTF-8?B?..?= 로.
 */
function encodeHeaderUtf8(s: string): string {
  // 순수 ASCII 면 그대로(가독성).
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  const enc = new TextEncoder();
  const chunks: string[] = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of s) {
    const n = enc.encode(ch).length;
    if (curBytes + n > 45 && cur) {
      chunks.push(cur);
      cur = "";
      curBytes = 0;
    }
    cur += ch;
    curBytes += n;
  }
  if (cur) chunks.push(cur);
  return chunks.map((c) => `=?UTF-8?B?${b64(c)}?=`).join(`${CRLF} `);
}

/** 첨부 파일명 — ASCII 안전 문자만. 경로/따옴표/제어문자 제거, 비면 기본값. */
function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\r\n\t]+/g, "_")
    .replace(/[^\x20-\x7E]+/g, "")
    .trim();
  return cleaned || "attachment.pdf";
}

function buildRawMime(
  from: string,
  payload: EmailPayload,
  attachments: EmailAttachment[],
): string {
  const rand = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const mixed = `mixed_${rand()}`;
  const alt = `alt_${rand()}`;

  const head = [
    `From: ${from}`,
    `To: ${payload.to}`,
    ...(payload.replyTo
      ? [`Reply-To: ${formatAddressHeader(payload.replyTo, payload.replyToName)}`]
      : []),
    `Subject: ${encodeHeaderUtf8(payload.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
  ].join(CRLF);

  // 본문 파트 — html 있으면 alternative(text+html), 없으면 text 단독.
  // 한글 본문 안전하게 base64 인코딩.
  let bodyPart: string;
  if (payload.html) {
    bodyPart =
      `Content-Type: multipart/alternative; boundary="${alt}"${CRLF}${CRLF}` +
      `--${alt}${CRLF}` +
      `Content-Type: text/plain; charset=UTF-8${CRLF}` +
      `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
      `${foldBase64(b64(payload.text))}${CRLF}${CRLF}` +
      `--${alt}${CRLF}` +
      `Content-Type: text/html; charset=UTF-8${CRLF}` +
      `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
      `${foldBase64(b64(payload.html))}${CRLF}${CRLF}` +
      `--${alt}--`;
  } else {
    bodyPart =
      `Content-Type: text/plain; charset=UTF-8${CRLF}` +
      `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
      foldBase64(b64(payload.text));
  }

  const segments: string[] = [head, "", `--${mixed}`, bodyPart];
  for (const att of attachments) {
    const ct = att.contentType || "application/pdf";
    const name = sanitizeFilename(att.filename);
    segments.push(`--${mixed}`);
    segments.push(
      `Content-Type: ${ct}; name="${name}"${CRLF}` +
        `Content-Disposition: attachment; filename="${name}"${CRLF}` +
        `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
        foldBase64(att.contentBase64),
    );
  }
  segments.push(`--${mixed}--`);
  return segments.join(CRLF);
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
