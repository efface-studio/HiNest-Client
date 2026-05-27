import { PrismaClient } from "@prisma/client";

/**
 * PrismaClient 는 싱글턴으로 관리. 모듈이 여러 번 임포트돼도 연결 풀은 하나만 유지.
 *
 * 커넥션 풀 크기: 기본값(10)을 Fargate task 단위로 조정.
 * - RDS(PostgreSQL) 기본 max_connections = 100.
 * - Fargate 태스크가 3개 뜨면 3 * N 연결. pgBouncer 없이 직접 연결이므로 5로 보수적 설정.
 * - DATABASE_URL 에 ?connection_limit=X&pool_timeout=20 으로도 설정 가능.
 *   환경변수를 그대로 쓰는 경우엔 아래 datasources 오버라이드가 우선됩니다.
 */
const CONNECTION_LIMIT = Number(process.env.DB_POOL_SIZE ?? "5");

/** Slow query 경고 임계값 (ms). 환경변수로 조정. 기본 500ms. */
const SLOW_QUERY_MS = Number(process.env.PRISMA_SLOW_QUERY_MS ?? "500");

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
        ? `${process.env.DATABASE_URL}${process.env.DATABASE_URL.includes("?") ? "&" : "?"}connection_limit=${CONNECTION_LIMIT}&pool_timeout=20`
        : undefined,
    },
  },
  // Prisma 의 "query" 이벤트를 받아 임계값 초과 쿼리만 골라 로깅.
  // production 에서도 켜둠 — slow query 1개당 한 줄이라 비용 영향 없고, 인덱스 누락
  // 탐지가 가장 빠른 방법.
  log: [
    { emit: "event", level: "query" },
    { emit: "stdout", level: "warn" },
    { emit: "stdout", level: "error" },
  ],
});

// "query" 이벤트: { query, params, duration, target } — duration 은 ms.
//   - target=quaint 등 내부 라이브러리 호출은 무시.
//   - 비밀번호 해시 등 민감한 값을 stderr 에 남기지 않도록 params 는 안 찍는다.
(prisma as any).$on("query", (e: any) => {
  if (typeof e?.duration === "number" && e.duration >= SLOW_QUERY_MS) {
    const q = String(e.query ?? "").slice(0, 200);
    console.warn(`[prisma:slow] ${e.duration}ms ${q}${q.length >= 200 ? "…" : ""}`);
  }
});
