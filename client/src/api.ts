export async function api<T = any>(
  path: string,
  init: RequestInit & { json?: any } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.headers as any),
  };
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  // 미리보기 모드 — 실제 네트워크 X, 가짜 응답으로 단락.
  // 단순 window 플래그 외에 sessionStorage 까지 함께 검사 — 두 신호가 모두 \"1\" 일 때만 신뢰.
  // 책임자가 아닌 외부 스크립트(북마클릿 등)가 임의로 window 플래그만 켜는 사고를 막는다.
  let preview = false;
  if (typeof window !== "undefined" && (window as any).__HINEST_PREVIEW__ === true) {
    try { preview = sessionStorage.getItem("hinest:preview") === "1"; } catch {}
  }
  const res = preview
    ? await (await import("./lib/previewMock")).previewMockFetch(path, { ...init, json: init.json })
    : await fetch(path, {
        ...init,
        headers,
        body,
        credentials: "include",
      });
  if (!res.ok) {
    let msg = "요청 실패";
    let code: string | undefined;
    let data: any = undefined;
    try {
      data = await res.json();
      if (data?.error) msg = data.error;
      if (data?.code) code = data.code;
    } catch {}
    // 호출부에서 `e.status` / `e.code` / `e.data` 로 서버 신호를 확인할 수 있게 확장.
    // (예: 409 ALREADY_CHECKED_OUT → 재확인 모달 표시 후 force 재요청)
    const err = new Error(msg) as Error & { status?: number; code?: string; data?: any };
    err.status = res.status;
    err.code = code;
    err.data = data;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json();
  // GET 성공 응답은 캐시에 저장 — apiSWR 가 다음 방문 때 즉시 쓰도록.
  // 인증·개인 데이터가 섞여있어 sessionStorage (탭 단위, 로그아웃 시 닫히면 소멸) 사용.
  const method = (init.method ?? "GET").toUpperCase();
  if (method === "GET") writeCache(path, json);
  return json;
}

const CACHE_PREFIX = "hinest.swr:";

function cacheKey(path: string) {
  return `${CACHE_PREFIX}${path}`;
}

function writeCache(path: string, data: unknown) {
  try {
    sessionStorage.setItem(
      cacheKey(path),
      JSON.stringify({ t: Date.now(), data })
    );
  } catch {
    /* quota / disabled storage — 무시 */
  }
}

/**
 * 경로별 캐시 TTL.
 *
 * 아바타/이름/팀처럼 다른 사람이 서버에서 바꿀 수 있고 UI 전반에 박히는
 * 데이터가 들어있는 엔드포인트는 짧은 TTL 이 맞다. 10분 TTL 로 두면 내가
 * 프로필을 바꿔도 다른 사람 탭이 오래 열려 있으면 그 탭의 sessionStorage
 * 캐시가 옛 avatarUrl 을 계속 들고 있어서 "안 바뀌는 것처럼" 보임.
 *
 * 따라서 사용자 정보가 임베드되는 경로는 30초 TTL — SWR flash-less
 * 렌더 이점은 유지하면서 타인의 프로필 변경이 길어야 30초 안에 반영.
 */
const SHORT_TTL_PREFIXES = [
  "/api/users",
  "/api/me",
  "/api/chat",       // 메시지/룸에 sender.avatarUrl 임베드
  "/api/project",    // 멤버 리스트에 avatarUrl 임베드
  "/api/meeting",    // 작성자 avatar
  "/api/notice",     // 작성자 avatar
  "/api/notification",
];
function ttlForPath(path: string): number {
  for (const p of SHORT_TTL_PREFIXES) if (path.startsWith(p)) return 30 * 1000;
  return 10 * 60 * 1000;
}

function readCache<T>(path: string, maxAgeMs?: number): T | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(path));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t: number; data: T };
    if (Date.now() - parsed.t > (maxAgeMs ?? ttlForPath(path))) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * Stale-while-revalidate 헬퍼.
 * 캐시된 값이 있으면 즉시 onCached 로 전달 → UI 가 바로 렌더.
 * 동시에 네트워크 요청을 쏴서 새 값이 오면 onFresh 로 재렌더.
 * 에러는 onError 로. 인증 만료 등 onError 가 처리해야 함.
 * Fargate 배포에서 최초 방문 이후 API 응답 체감 속도를 크게 단축.
 *
 * 반환 Promise 는 "네트워크 완료" 시 resolve. await 해도 되지만 보통 fire-and-forget.
 */
export function apiSWR<T>(
  path: string,
  handlers: {
    onCached?: (data: T) => void;
    onFresh?: (data: T) => void;
    onError?: (err: Error) => void;
  }
): Promise<void> {
  const cached = readCache<T>(path);
  if (cached !== null && handlers.onCached) {
    // microtask 경계 — 호출부가 setState 등을 완료한 뒤 flush 되도록.
    queueMicrotask(() => handlers.onCached?.(cached));
  }
  return api<T>(path)
    .then((fresh) => handlers.onFresh?.(fresh))
    .catch((err: any) => handlers.onError?.(err instanceof Error ? err : new Error(String(err))));
}

/** 로그아웃 등에서 세션 캐시를 완전히 비울 때 사용. */
export function clearApiCache() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  } catch {
    /* noop */
  }
}

/**
 * 특정 경로의 캐시만 무효화 — POST/PATCH/DELETE 뒤에 GET 캐시를 버려서
 * 다음 방문 때 stale data 가 잠깐 보이는 flash 를 없앰.
 * pathPrefix 를 prefix 로 받으면 해당 prefix 로 시작하는 모든 경로를 비움
 * (예: "/api/meeting" → "/api/meeting", "/api/meeting?mine=1" 둘 다).
 */
export function invalidateCache(pathPrefix: string) {
  try {
    const prefix = cacheKey(pathPrefix);
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  } catch {
    /* noop */
  }
}
