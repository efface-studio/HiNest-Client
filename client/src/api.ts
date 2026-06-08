/**
 * API 오리진. 일반 웹/데스크톱(Electron) 빌드에서는 빈 문자열 → 기존처럼 상대경로
 * 그대로 (동작 변화 없음). Capacitor 네이티브 빌드에서는 웹 자산이
 * capacitor://localhost 에서 로드돼 상대경로가 서버에 닿지 않으므로, 빌드시
 * VITE_API_BASE 로 절대 오리진(예: https://nest.hi-vits.com)을 주입한다.
 */
import { getAuthToken } from "./lib/authToken";

export const API_BASE: string =
  ((import.meta as any).env?.VITE_API_BASE as string | undefined)?.replace(/\/+$/, "") ?? "";

/** 상대 API/자산 경로를 현재 빌드에 맞는 절대 URL 로. 절대 URL 은 그대로 통과. */
export function apiUrl(path: string): string {
  if (!API_BASE) return path;
  if (/^[a-z]+:\/\//i.test(path)) return path;
  return path.startsWith("/") ? API_BASE + path : path;
}

/**
 * 네이티브 앱이면 저장된 세션 토큰을 Authorization 헤더로 반환, 아니면 빈 객체.
 * iOS WebView 의 cross-site 쿠키가 ITP 에 막히는 문제를 우회 — 쿠키 대신 Bearer 로 인증.
 * 웹/데스크톱은 토큰이 없으므로 빈 객체 → 기존 쿠키 인증 그대로.
 */
export function authHeaders(): Record<string, string> {
  const t = getAuthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * 인증이 필요한 raw fetch — 파일 업로드/다운로드처럼 api() 의 JSON 처리를 거치지 않는 호출용.
 * apiUrl 변환 + credentials + 네이티브 토큰 헤더를 한 곳에서 보장하고 Response 를 그대로 반환한다.
 * (네이티브에서 쿠키가 안 붙어 업로드가 401 나던 문제를 막는다.)
 */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers: { ...authHeaders(), ...(init.headers as Record<string, string> | undefined) },
  });
}

/**
 * <img>/<video> 처럼 헤더를 못 싣는 태그의 src 변환 — 주로 /uploads 이미지(아바타·첨부).
 *
 * 두 가지를 해결한다:
 *  1) 상대경로(/uploads/..)를 절대 URL 로 — 네이티브 WebView(origin https://localhost)에선
 *     상대경로가 자기 origin 으로 새서 안 닿으므로 apiUrl 로 API 오리진을 붙인다.
 *  2) 네이티브면 ?token=<jwt> 를 덧붙인다 — /uploads 는 requireAuth 인데 <img> 는 헤더를
 *     못 싣고 네이티브 쿠키는 ITP 에 막히므로, 쿼리 토큰으로 인증한다(서버가 허용·로그 마스킹).
 *
 * 절대 URL(http/https)·data:·blob: 은 그대로 통과. 웹/데스크톱은 토큰이 없어 기존과 동일.
 */
export function imgSrc(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  const abs = apiUrl(url);
  const t = getAuthToken(); // 네이티브에서만 값이 있음
  if (!t) return abs;
  return abs + (abs.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(t);
}

const _inflight = new Map<string, Promise<any>>();

/**
 * 동일 GET 동시 호출 합치기(in-flight dedup). 한 화면 + 열린 모달이 같은 엔드포인트(예: /api/users)를
 * 동시에 요청하면 fetch 가 1번만 나가고 결과를 공유한다(React 18 StrictMode 이중 호출도 1회로).
 * 커스텀 signal(취소 의도)·요청 바디·미리보기 모드는 제외 — 각자 독립 실행. 실제 fetch 로직은
 * 아래 apiInner 그대로(무변경) — 이 래퍼는 합치기만 담당.
 */
export async function api<T = any>(
  path: string,
  init: RequestInit & { json?: any } = {}
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  let previewOn = false;
  if (typeof window !== "undefined" && (window as any).__HINEST_PREVIEW__ === true) {
    try { previewOn = sessionStorage.getItem("hinest:preview") === "1"; } catch {}
  }
  const dedupable = method === "GET" && !init.signal && init.json === undefined && !init.body && !previewOn;
  if (!dedupable) return apiInner<T>(path, init);
  const existing = _inflight.get(path);
  if (existing) return existing as Promise<T>;
  const p = apiInner<T>(path, init);
  _inflight.set(path, p);
  p.finally(() => { if (_inflight.get(path) === p) _inflight.delete(path); });
  return p;
}

async function apiInner<T = any>(
  path: string,
  init: RequestInit & { json?: any } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    ...authHeaders(),
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
  // 네트워크 지연·끊김 시 UI 가 무한 대기하지 않도록 타임아웃(기본 30초)을 건다.
  // 호출부가 자체 signal 을 주면 그대로 존중하고 타임아웃은 적용하지 않는다.
  // 느린 작업(예: 대용량 CSV 임포트)은 init.timeoutMs 로 늘리거나 0 으로 끌 수 있다.
  const timeoutMs = (init as any).timeoutMs ?? 30_000;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let signal = init.signal ?? undefined;
  if (!signal && typeof AbortController !== "undefined" && timeoutMs > 0) {
    const ac = new AbortController();
    signal = ac.signal;
    timeoutId = setTimeout(() => ac.abort(), timeoutMs);
  }
  let res: Response;
  try {
    res = preview
      ? await (await import("./lib/previewMock")).previewMockFetch(path, { ...init, json: init.json })
      : await fetch(apiUrl(path), {
          ...init,
          headers,
          body,
          credentials: "include",
          signal,
        });
  } catch (e: any) {
    // 타임아웃(abort)·오프라인·DNS 실패 등 fetch 단계 오류를 사용자 친화 메시지로 변환.
    // (그대로 두면 "Failed to fetch" 가 노출되고 무한 로딩처럼 보인다.)
    const aborted = e?.name === "AbortError";
    const nerr = new Error(
      aborted
        ? "요청 시간이 초과됐어요. 네트워크 상태를 확인하고 다시 시도해주세요."
        : "네트워크에 연결할 수 없어요. 연결을 확인해주세요.",
    ) as Error & { status?: number; code?: string };
    nerr.code = aborted ? "TIMEOUT" : "NETWORK";
    throw nerr;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
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
    // 세션 만료/무효(401) — 인증 엔드포인트 자체(로그인 실패·세션 복원 등)가 아니면 전역으로
    // 알려 AuthProvider 가 로그아웃 처리(→ /login)하게 한다. 페이지 사용 중 세션이 끊겼는데
    // 호출부가 catch{} 로 삼켜 빈 화면·stale 데이터로 방치되던 문제를 근본 해결.
    //
    // 단, SUPER_STEPUP_REQUIRED(총관리자 재인증 필요)는 "세션 만료"가 아니라 "step-up 재인증
    // 필요"다 — 예: 사내톡 감사 진입, 역할 변경. 이걸 로그아웃으로 처리하면 chat log 비번을 맞춰도
    // step-up 쿠키가 만료/부재일 때 튕겨버린다. 이 코드의 401 은 전역 로그아웃에서 제외하고,
    // 호출부(패널)가 자체적으로 재인증을 유도하도록 둔다.
    if (
      res.status === 401 &&
      typeof window !== "undefined" &&
      code !== "SUPER_STEPUP_REQUIRED" &&
      !path.startsWith("/api/auth") &&
      !path.startsWith("/api/me")
    ) {
      try { window.dispatchEvent(new Event("hinest:unauthorized")); } catch {}
    }
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
