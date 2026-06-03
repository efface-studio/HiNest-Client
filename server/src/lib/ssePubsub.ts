import pg from "pg";
import { randomUUID } from "node:crypto";
import { prisma } from "./db.js";

/**
 * SSE 멀티 인스턴스 팬아웃 — Postgres LISTEN/NOTIFY.
 *
 * 문제: sse.ts 의 클라이언트 맵은 프로세스 메모리라, Fargate 가 태스크를 N개 띄우면
 * 알림을 만든 요청(태스크 A)과 대상 유저의 SSE 커넥션(태스크 B)이 서로 다른 태스크에
 * 있을 때 publish 가 로컬에서 대상을 못 찾아 실시간 전달이 누락된다 → 클라가 90초
 * 폴링으로 떨어져 "알림이 느림"으로 체감(데스크톱). ALB 스티키로도 못 고친다(트리거
 * 유저 ≠ 대상 유저).
 *
 * 해결: publish 시 pg_notify 로 한 채널에 브로드캐스트하고, 모든 태스크가 LISTEN 하다가
 * 자기 인스턴스에서 보낸 게 아니면 로컬 클라이언트로 전달한다. Redis 불필요(기존 Postgres
 * 재사용 → 추가 비용 0).
 *
 * 무회귀 설계: 로컬 전달(deliverLocal)은 그대로 즉시 수행하고, cross-instance 는 순수
 * 추가분이다. pg/LISTEN 이 실패하거나(pooler 등) NOTIFY 가 막혀도 동작은 "현재(폴링)"로
 * 안전하게 떨어질 뿐 더 나빠지지 않는다.
 *
 * 주의: LISTEN 은 세션 모드 커넥션이 필요하다. 운영 DATABASE_URL 이 PgBouncer 트랜잭션
 * 풀러를 가리키면 LISTEN 이 동작하지 않을 수 있다(이 경우 cross-instance 는 폴링 폴백).
 * 보내는 쪽(pg_notify)은 풀러에서도 정상 동작한다.
 */

const CHANNEL = "sse_events";
export const INSTANCE_ID = randomUUID();
const MAX_PAYLOAD_BYTES = 7000; // pg_notify 한도 8000B 보다 여유

type Deliver = (userId: string, event: string, data: unknown) => void;
let onDeliver: Deliver | null = null;
let listenClient: pg.Client | null = null;
let connecting = false;

/** 서버 기동 시 1회 호출 — 로컬 전달 콜백을 받아 LISTEN 을 시작한다. */
export function initSsePubsub(deliver: Deliver): void {
  onDeliver = deliver;
  void connectListen();
}

async function connectListen(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url || connecting || listenClient) return;
  connecting = true;
  try {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    await c.query(`LISTEN ${CHANNEL}`);
    c.on("notification", (msg) => {
      if (!msg.payload || !onDeliver) return;
      try {
        const m = JSON.parse(msg.payload) as { origin: string; userId: string; event: string; data: unknown };
        if (m.origin === INSTANCE_ID) return; // 같은 인스턴스 → 이미 로컬 전달함(중복 방지)
        onDeliver(m.userId, m.event, m.data);
      } catch {
        /* 잘못된 payload 무시 */
      }
    });
    const reconnect = (why: string) => {
      console.error("[sse] LISTEN 연결 끊김 — 재연결 예약:", why);
      listenClient = null;
      connecting = false;
      setTimeout(() => void connectListen(), 5000);
    };
    c.on("error", (e) => reconnect((e as Error)?.message || "error"));
    c.on("end", () => reconnect("end"));
    listenClient = c;
    connecting = false;
    console.log(`[sse] cross-instance LISTEN 연결됨 (instance ${INSTANCE_ID.slice(0, 8)})`);
  } catch (e) {
    connecting = false;
    console.error("[sse] LISTEN 연결 실패 — 재시도 예약:", (e as Error)?.message || e);
    setTimeout(() => void connectListen(), 5000);
  }
}

/** 다른 인스턴스들에게 이 이벤트를 브로드캐스트(pg_notify). 로컬 전달은 sse.publish 가 이미 함. */
export function publishCrossInstance(userId: string, event: string, data: unknown): void {
  try {
    const payload = JSON.stringify({ origin: INSTANCE_ID, userId, event, data });
    // 8KB 한도 — 너무 큰 이벤트는 cross-instance 생략(로컬은 이미 전달됨, 타 인스턴스는 폴링 폴백).
    if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) return;
    void prisma.$executeRaw`SELECT pg_notify(${CHANNEL}, ${payload})`.catch(() => {});
  } catch {
    /* 직렬화 실패 등 무시 — 로컬 전달은 이미 됨 */
  }
}
