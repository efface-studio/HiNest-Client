import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 테넌트(회사) 요청 컨텍스트 — 멀티테넌시 행수준 격리의 핵심.
 *
 * requireAuth 가 요청마다 이 컨텍스트를 깐 채로 핸들러를 실행하고,
 * lib/db.ts 의 Prisma `$extends` 확장이 매 쿼리에서 이 값을 읽어
 * 테넌트 소유 모델에 companyId 필터(read)/주입(write)을 자동 적용한다.
 *
 *  - companyId : 현재 요청 사용자의 소속 회사. 이 회사 데이터만 보이고 쓰인다.
 *  - bypass    : 플랫폼 운영자(platformAdmin)나 시스템 잡처럼 테넌트를 가로질러야 하는
 *                경우 true. true 면 어떤 스코프도 적용하지 않는다.
 *
 * 컨텍스트가 아예 없으면(=잡/스크립트/인증 이전) 스코프를 적용하지 않는다.
 * 로그인·회사가입·공유링크·웹훅 등 인증 이전 경로는 토큰/이메일 등으로 자기 책임 하에
 * 직접 조회하기 때문이다.
 */
export interface TenantContext {
  companyId: string | null;
  bypass: boolean;
}

const storage = new AsyncLocalStorage<TenantContext>();

/** 주어진 테넌트 컨텍스트 안에서 fn 을 실행. 내부의 모든 Prisma 쿼리가 자동 스코프된다. */
export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** 현재 요청의 테넌트 컨텍스트. 없으면 undefined (=비스코프). */
export function getTenant(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * 명시적 크로스테넌트 블록 — 시스템 잡/운영자 작업에서 한 구간만 스코프를 해제한다.
 * 이미 컨텍스트가 깔린 요청 안에서도 이 구간만큼은 전사(全社) 조회가 필요할 때 사용.
 */
export function runUnscoped<T>(fn: () => T): T {
  return storage.run({ companyId: null, bypass: true }, fn);
}
