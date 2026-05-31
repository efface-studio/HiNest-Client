import { PrismaClient } from "@prisma/client";
import { getTenant } from "./tenant.js";

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

const base = new PrismaClient({
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
(base as any).$on("query", (e: any) => {
  if (typeof e?.duration === "number" && e.duration >= SLOW_QUERY_MS) {
    const q = String(e.query ?? "").slice(0, 200);
    console.warn(`[prisma:slow] ${e.duration}ms ${q}${q.length >= 200 ? "…" : ""}`);
  }
});

/**
 * 테넌트 소유 모델 — 회사(companyId) 단위로 행수준 격리되는 테이블의 집합.
 * 아래 확장이 요청 컨텍스트(lib/tenant.ts)의 companyId 를 읽어
 *   - read  : where 에 companyId 를 병합 (다른 회사 행은 안 보임)
 *   - write : create 시 data 에 companyId 주입, update/delete 는 where 로 자기 회사로 제한
 * 를 자동 적용한다.
 *
 * 여기 없는 모델(Company, Session, 인증·인프라·플랫폼 설정 등)은 전역으로 두어 스코프하지 않는다.
 * findUnique/update/delete 에 비유니크 필드(companyId)를 더하는 것은 Prisma 5.x 의
 * extendedWhereUnique(GA) 덕에 그대로 허용된다.
 */
const TENANT_MODELS = new Set<string>([
  "User",
  "Project",
  "ProjectQaItem",
  "ProjectQaAttachment",
  "WebhookChannel",
  "WebhookEvent",
  "ProjectMember",
  "ProjectEvent",
  "Event",
  "Leave",
  "Attendance",
  "Journal",
  "Notice",
  "NoticeReaction",
  "Pin",
  "NotificationPref",
  "DocumentShareLink",
  "FolderShareLink",
  "ShareLinkAccess",
  "ApprovalTemplate",
  "ApprovalLineFavorite",
  "ApprovalComment",
  "MeetingRevision",
  "DocumentRevision",
  "ChatRoom",
  "RoomMember",
  "ChatMessage",
  "MessageReaction",
  "CardExpense",
  "Notification",
  "Folder",
  "Document",
  "Payslip",
  "Approval",
  "ApprovalStep",
  "AuditLog",
  "Meeting",
  "MeetingAttachment",
  "MeetingViewer",
  "ServiceAccount",
  "Snippet",
  "InviteKey",
  "Team",
  "Position",
]);

/**
 * 테넌트 스코프 확장이 적용된 Prisma 클라이언트. 코드 전반은 그대로 `prisma` 를 임포트해 쓰면 된다.
 *
 * 주의: `$extends` 의 query 훅은 top-level 연산만 가로챈다. 부모 create 안의 nested relation
 * create(예: project.create({ data: { members: { create: [...] } } }))는 자식 행에
 * companyId 가 자동 주입되지 않으므로, 그런 사이트는 호출부에서 명시적으로 넣어야 한다.
 */
export const prisma = base.$extends({
  name: "tenant-scope",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const ctx = getTenant();
        // 컨텍스트 없음 / 우회(플랫폼·잡) / 회사 미상 / 전역 모델 → 스코프 미적용.
        if (!ctx || ctx.bypass || !ctx.companyId || !TENANT_MODELS.has(model)) {
          return query(args);
        }
        const companyId = ctx.companyId;
        const a = args as any;
        switch (operation) {
          case "findUnique":
          case "findUniqueOrThrow":
          case "findFirst":
          case "findFirstOrThrow":
          case "findMany":
          case "count":
          case "aggregate":
          case "groupBy":
          case "update":
          case "updateMany":
          case "delete":
          case "deleteMany":
            a.where = { ...(a.where ?? {}), companyId };
            break;
          case "create":
            a.data = { ...(a.data ?? {}), companyId };
            break;
          case "createMany":
          case "createManyAndReturn":
            a.data = Array.isArray(a.data)
              ? a.data.map((d: any) => ({ ...d, companyId }))
              : { ...(a.data ?? {}), companyId };
            break;
          case "upsert":
            a.where = { ...(a.where ?? {}), companyId };
            a.create = { ...(a.create ?? {}), companyId };
            break;
        }
        return query(a);
      },
    },
  },
});
