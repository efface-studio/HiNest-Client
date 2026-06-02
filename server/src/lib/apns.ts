import http2 from "node:http2";
import { readFileSync } from "node:fs";
import jwt from "jsonwebtoken";
import { prisma } from "./db.js";

/**
 * APNs(Apple Push Notification service) 원격 푸시 발송 헬퍼.
 *
 * 의존성을 더 늘리지 않기 위해 Node 내장 http2 + 기존 jsonwebtoken(ES256) 만 사용한다.
 * (apn/node-apn 같은 외부 패키지 불필요)
 *
 * 환경 변수:
 *   APNS_KEY         필수 — .p8 키 내용(PEM) 또는 파일 경로.
 *                    env 에 PEM 을 통째로 넣을 땐 줄바꿈이 "\n" 으로 이스케이프되어 들어오므로 복원한다.
 *   APNS_KEY_ID      필수 — .p8 키의 Key ID (10자, 예: "ABC123DEFG")
 *   APNS_TEAM_ID     필수 — Apple Developer Team ID (10자)
 *   APNS_BUNDLE_ID   선택 — 앱 번들 ID. 기본 "efface.hinest.ios" (apns-topic 로 사용)
 *   APNS_PRODUCTION  선택 — "1"/"true" 면 운영 게이트웨이, 아니면 샌드박스.
 *
 * 미설정 시: apnsEnabled() 가 false 를 반환하고 sendApnsToUser() 는 조용히 no-op.
 * → 키가 없는 환경(로컬·개발)에서도 서버가 정상 동작하고, 알림 흐름을 막지 않는다.
 *
 * APNs 인증: 토큰 기반(JWT). iss=TeamID, kid=KeyID, ES256 서명.
 * 토큰은 20~60분마다 갱신해야 하므로 ~50분 캐시한다.
 */

const KEY_RAW = process.env.APNS_KEY;
const KEY_ID = process.env.APNS_KEY_ID;
const TEAM_ID = process.env.APNS_TEAM_ID;
const BUNDLE_ID = process.env.APNS_BUNDLE_ID || "efface.hinest.ios";
const PRODUCTION = /^(1|true|yes)$/i.test(process.env.APNS_PRODUCTION || "");
const HOST = PRODUCTION ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";

export function apnsEnabled(): boolean {
  return Boolean(KEY_RAW && KEY_ID && TEAM_ID);
}

/** .p8 키를 PEM 문자열로 해석. env 에 직접 넣었으면 \n 복원, 아니면 파일 경로로 보고 읽는다. */
let _key: string | null = null;
function loadKey(): string {
  if (_key) return _key;
  const raw = (KEY_RAW || "").trim();
  if (raw.includes("BEGIN PRIVATE KEY")) {
    // env 에 PEM 을 통째로 넣은 경우 — 이스케이프된 줄바꿈 복원
    _key = raw.replace(/\\n/g, "\n");
  } else {
    // 파일 경로로 간주
    _key = readFileSync(raw, "utf8");
  }
  return _key;
}

/** APNs 인증 JWT (ES256). 50분 캐시. */
let _token: { jwt: string; at: number } | null = null;
function authToken(): string {
  const now = Date.now();
  if (_token && now - _token.at < 50 * 60 * 1000) return _token.jwt;
  const signed = jwt.sign({ iss: TEAM_ID }, loadKey(), {
    algorithm: "ES256",
    keyid: KEY_ID,
  });
  _token = { jwt: signed, at: now };
  return signed;
}

/** http2 세션 재사용 — 끊기거나 닫혔으면 새로 연결. */
let _session: http2.ClientHttp2Session | null = null;
function getSession(): http2.ClientHttp2Session {
  if (_session && !_session.closed && !_session.destroyed) return _session;
  const s = http2.connect(HOST);
  // 에러 시 세션 핸들 비워 다음 호출에서 재연결되게 함. (리스너 미등록 시 throw 로 프로세스가 죽을 수 있음)
  s.on("error", (e) => {
    console.error("apns http2 session error", (e as Error)?.message || e);
    if (_session === s) _session = null;
  });
  s.on("close", () => {
    if (_session === s) _session = null;
  });
  _session = s;
  return s;
}

export interface ApnsPayload {
  title: string;
  body?: string;
  /** 앱 아이콘 배지 숫자. */
  badge?: number;
  /** 사운드. 기본 "default". */
  sound?: string;
  /** 탭 시 이동할 인앱 경로(클라이언트가 읽어 라우팅). */
  linkUrl?: string;
  /** 동일 스레드 묶음용 식별자(예: DM 방 id). */
  threadId?: string;
}

interface SendResult {
  token: string;
  status: number;
  /** APNs 가 준 실패 사유(JSON body 의 reason). 성공이면 undefined. */
  reason?: string;
}

/** 단일 기기 토큰에 발송. http2 스트림 1건 = 요청 1건. */
function sendOne(deviceToken: string, payload: ApnsPayload): Promise<SendResult> {
  return new Promise((resolve) => {
    const aps: Record<string, unknown> = {
      alert: { title: payload.title, ...(payload.body ? { body: payload.body } : {}) },
      sound: payload.sound || "default",
    };
    if (typeof payload.badge === "number") aps.badge = payload.badge;
    const bodyObj: Record<string, unknown> = { aps };
    if (payload.linkUrl) bodyObj.linkUrl = payload.linkUrl;
    const body = Buffer.from(JSON.stringify(bodyObj));

    let session: http2.ClientHttp2Session;
    try {
      session = getSession();
    } catch (e) {
      resolve({ token: deviceToken, status: 0, reason: (e as Error)?.message || "session error" });
      return;
    }

    const headers: Record<string, string> = {
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${authToken()}`,
      "apns-topic": BUNDLE_ID,
      "apns-push-type": "alert",
      "apns-priority": "10",
    };
    if (payload.threadId) headers["apns-collapse-id"] = payload.threadId.slice(0, 64);

    let req: http2.ClientHttp2Stream;
    try {
      req = session.request(headers);
    } catch (e) {
      resolve({ token: deviceToken, status: 0, reason: (e as Error)?.message || "request error" });
      return;
    }

    let status = 0;
    let raw = "";
    req.on("response", (h) => {
      status = Number(h[":status"]) || 0;
    });
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      let reason: string | undefined;
      if (status !== 200 && raw) {
        try {
          reason = (JSON.parse(raw) as { reason?: string }).reason;
        } catch {
          /* 비-JSON 응답 무시 */
        }
      }
      resolve({ token: deviceToken, status, reason });
    });
    req.on("error", (e) => {
      resolve({ token: deviceToken, status: 0, reason: (e as Error)?.message || "stream error" });
    });

    req.write(body);
    req.end();
  });
}

/** 토큰이 영구 무효임을 뜻하는 응답 — 즉시 정리(prune)한다. */
function isDeadToken(r: SendResult): boolean {
  if (r.status === 410) return true; // Unregistered (마지막 비활성 시각 헤더 동반)
  return r.reason === "BadDeviceToken" || r.reason === "Unregistered" || r.reason === "DeviceTokenNotForTopic";
}

/**
 * 한 유저의 모든 iOS 기기로 푸시 발송.
 * - 미설정/토큰 없음 → no-op.
 * - 성공 토큰은 lastUsedAt 갱신, 죽은 토큰은 삭제.
 * - 어떤 예외도 호출부(알림 생성 흐름)로 던지지 않는다.
 */
export async function sendApnsToUser(userId: string, payload: ApnsPayload): Promise<void> {
  if (!apnsEnabled()) return;
  try {
    const tokens = await prisma.pushToken.findMany({
      where: { userId, platform: "ios" },
      select: { token: true },
    });
    if (!tokens.length) return;

    const results = await Promise.all(tokens.map((t) => sendOne(t.token, payload)));

    const dead = results.filter(isDeadToken).map((r) => r.token);
    const ok = results.filter((r) => r.status === 200).map((r) => r.token);

    if (dead.length) {
      await prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
    }
    if (ok.length) {
      await prisma.pushToken.updateMany({
        where: { token: { in: ok } },
        data: { lastUsedAt: new Date() },
      });
    }

    // 그 외 실패(예: 인증 오류·일시 장애)는 토큰을 지우지 않고 로그만 남긴다.
    const other = results.filter((r) => r.status !== 200 && !isDeadToken(r));
    if (other.length) {
      console.error(
        "apns send partial failure",
        other.map((r) => ({ status: r.status, reason: r.reason })),
      );
    }
  } catch (e) {
    console.error("sendApnsToUser failed", (e as Error)?.message || e);
  }
}
