/**
 * FCM(Firebase Cloud Messaging) 원격 푸시 발송 헬퍼 — 안드로이드용.
 *
 * iOS 의 lib/apns.ts 와 "동일한 아키텍처" 를 미러링한다:
 *   - 기기토큰은 PushToken 모델에 platform="android" 로 저장(클라가 /api/push/register 로 보냄).
 *   - notify.ts 가 sendFcmToUser/sendFcmToUsers 를 fire-and-forget 으로 호출(APNs 와 병행).
 *   - 자격증명 미설정이면 fcmEnabled()=false, 발송 함수는 조용히 no-op(앱·기존 APNs 무영향).
 *
 * 인증: FCM HTTP v1 API 는 서비스 계정 OAuth2 access token 이 필요하다.
 *   서비스 계정 JSON(Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 비공개 키 생성)에서
 *   project_id / client_email / private_key 를 env 로 받아, RS256 JWT 를 만들어
 *   oauth2.googleapis.com/token 에서 access token 으로 교환(50분 캐시) 후
 *   fcm.googleapis.com/v1/projects/<id>/messages:send 로 POST.
 *
 * 필요한 env (셋 다 있어야 활성):
 *   FCM_PROJECT_ID     Firebase 프로젝트 id (예: hinest-xxxx)
 *   FCM_CLIENT_EMAIL   서비스 계정 이메일 (...@....iam.gserviceaccount.com)
 *   FCM_PRIVATE_KEY    서비스 계정 비공개 키(PEM). env 엔 \n 이스케이프돼 들어와도 복원함.
 *  (또는 FCM_SERVICE_ACCOUNT_JSON 에 서비스계정 JSON 전체를 넣어도 됨.)
 */
import jwt from "jsonwebtoken";
import { prisma } from "./db.js";

function readServiceAccount(): { projectId: string; clientEmail: string; privateKey: string } | null {
  const json = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (json) {
    try {
      const o = JSON.parse(json);
      if (o.project_id && o.client_email && o.private_key) {
        return { projectId: o.project_id, clientEmail: o.client_email, privateKey: String(o.private_key).replace(/\\n/g, "\n") };
      }
    } catch { /* fall through */ }
  }
  const projectId = process.env.FCM_PROJECT_ID;
  const clientEmail = process.env.FCM_CLIENT_EMAIL;
  const privateKey = process.env.FCM_PRIVATE_KEY;
  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, "\n") };
  }
  return null;
}

const SA = readServiceAccount();

export function fcmEnabled(): boolean {
  return SA != null;
}

/** OAuth2 access token (firebase.messaging 스코프). 50분 캐시. */
let _token: { access: string; at: number } | null = null;
async function accessToken(): Promise<string | null> {
  if (!SA) return null;
  const now = Date.now();
  if (_token && now - _token.at < 50 * 60 * 1000) return _token.access;
  const iat = Math.floor(now / 1000);
  const assertion = jwt.sign(
    {
      iss: SA.clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat,
      exp: iat + 3600,
    },
    SA.privateKey,
    { algorithm: "RS256" },
  );
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(assertion)}`,
    });
    if (!res.ok) {
      console.error("fcm oauth token failed", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) return null;
    _token = { access: data.access_token, at: now };
    return data.access_token;
  } catch (e) {
    console.error("fcm oauth error", (e as Error)?.message || e);
    return null;
  }
}

export interface FcmPayload {
  title: string;
  body?: string;
  /** 알림 탭 시 이동할 앱 내 경로(예: "/notice/abc"). data.linkUrl 로 전달돼 클라가 라우팅. */
  linkUrl?: string;
  /** 동일 스레드 묶음(예: 채팅방 id) — Android collapseKey 로 사용. */
  groupId?: string;
}

/** 단일 FCM 토큰으로 1건 발송. 반환: "ok" | "dead"(토큰 무효 → 정리 대상) | "err". */
async function sendOne(token: string, payload: FcmPayload, access: string): Promise<"ok" | "dead" | "err"> {
  const message: any = {
    token,
    notification: { title: payload.title, ...(payload.body ? { body: payload.body } : {}) },
    data: { ...(payload.linkUrl ? { linkUrl: payload.linkUrl } : {}) },
    android: {
      priority: "HIGH",
      notification: { channelId: "default", ...(payload.groupId ? { tag: payload.groupId } : {}) },
      ...(payload.groupId ? { collapseKey: payload.groupId } : {}),
    },
  };
  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${SA!.projectId}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (res.ok) return "ok";
    // 404 UNREGISTERED / 400 INVALID_ARGUMENT(잘못된 토큰) → 죽은 토큰으로 보고 정리.
    if (res.status === 404 || res.status === 400) {
      const txt = (await res.text()).slice(0, 300);
      if (/UNREGISTERED|INVALID_ARGUMENT|registration-token-not-registered/i.test(txt)) return "dead";
      console.error("fcm send 4xx", res.status, txt);
      return "err";
    }
    console.error("fcm send failed", res.status);
    return "err";
  } catch (e) {
    console.error("fcm send error", (e as Error)?.message || e);
    return "err";
  }
}

/** 한 유저의 모든 안드로이드 기기로 푸시. 미설정/토큰없음이면 no-op. */
export async function sendFcmToUser(userId: string, payload: FcmPayload): Promise<void> {
  if (!SA) return;
  const access = await accessToken();
  if (!access) return;
  const tokens = await prisma.pushToken.findMany({ where: { userId, platform: "android" }, select: { token: true } });
  if (!tokens.length) return;
  const dead: string[] = [];
  const ok: string[] = [];
  await Promise.all(
    tokens.map(async (t) => {
      const r = await sendOne(t.token, payload, access);
      if (r === "dead") dead.push(t.token);
      else if (r === "ok") ok.push(t.token);
    }),
  );
  if (dead.length) await prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
  if (ok.length) await prisma.pushToken.updateMany({ where: { token: { in: ok } }, data: { lastUsedAt: new Date() } });
}

/** 여러 유저에게 일괄 발송 — pushToken 조회 1회로 묶음(APNs sendApnsToUsers 와 동일 패턴). */
export async function sendFcmToUsers(items: { userId: string; payload: FcmPayload }[]): Promise<void> {
  if (!SA || !items.length) return;
  const access = await accessToken();
  if (!access) return;
  const userIds = [...new Set(items.map((i) => i.userId))];
  const rows = await prisma.pushToken.findMany({
    where: { userId: { in: userIds }, platform: "android" },
    select: { token: true, userId: true },
  });
  if (!rows.length) return;
  const byUser = new Map<string, FcmPayload>(items.map((i) => [i.userId, i.payload]));
  const dead: string[] = [];
  const ok: string[] = [];
  await Promise.all(
    rows.map(async (row) => {
      const payload = byUser.get(row.userId);
      if (!payload) return;
      const r = await sendOne(row.token, payload, access);
      if (r === "dead") dead.push(row.token);
      else if (r === "ok") ok.push(row.token);
    }),
  );
  if (dead.length) await prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
  if (ok.length) await prisma.pushToken.updateMany({ where: { token: { in: ok } }, data: { lastUsedAt: new Date() } });
}

/**
 * 진단 — 본인 안드로이드 토큰으로 테스트 FCM 을 실제 발송하고 결과를 돌려준다.
 * apns.ts 의 apnsDiag 와 동일 계약(enabled/tokens/results)으로, /api/push/diag 가
 * iOS(APNs)·Android(FCM) 양쪽을 한 번에 진단할 수 있게 한다. 본인 토큰만 대상이라 안전.
 */
export async function fcmDiag(userId: string): Promise<{
  enabled: boolean;
  projectId: string | null;
  tokens: number;
  results: { token: string; status: number; reason?: string }[];
  note?: string;
}> {
  const base = { enabled: SA != null, projectId: SA?.projectId ?? null };
  if (!SA) {
    return { ...base, tokens: 0, results: [], note: "FCM 미설정 — 서버 env FCM_SERVICE_ACCOUNT_JSON(또는 FCM_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY) 확인" };
  }
  const access = await accessToken();
  if (!access) {
    return { ...base, tokens: 0, results: [], note: "FCM OAuth 액세스 토큰 발급 실패 — 서비스 계정 키 값 확인" };
  }
  const tokens = await prisma.pushToken.findMany({ where: { userId, platform: "android" }, select: { token: true } });
  if (!tokens.length) {
    return { ...base, tokens: 0, results: [], note: "등록된 Android 토큰 없음 — 알림 권한 허용 + 앱 재실행(또는 google-services.json/VITE_ANDROID_FCM 미포함 빌드)" };
  }
  const payload: FcmPayload = { title: "테스트 알림", body: "푸시 진단 테스트입니다.", linkUrl: "/" };
  const results = await Promise.all(
    tokens.map(async (t) => {
      const r = await sendOne(t.token, payload, access);
      const status = r === "ok" ? 200 : r === "dead" ? 410 : 500;
      return { token: t.token.slice(0, 10) + "…", status, reason: r };
    }),
  );
  return { ...base, tokens: tokens.length, results };
}
