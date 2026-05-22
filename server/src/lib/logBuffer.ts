/**
 * 인메모리 서버 로그 링버퍼 — 총관리자 콘솔에서 보기 위한 용도.
 *
 * 처리:
 *  - console.log/info/warn/error 를 monkey-patch 해서 들어오는 라인을 동시에 버퍼에 적재.
 *  - HTTP 액세스 로그도 미들웨어에서 push.
 *  - 메모리 절약을 위해 최대 2000줄 유지(가장 오래된 것부터 버림).
 *  - 프로세스 재기동 시 초기화 — 디스크 영속화 없음.
 */

export type LogLevel = "info" | "warn" | "error" | "http";

export type LogEntry = {
  ts: number; // epoch ms
  level: LogLevel;
  msg: string;
};

// in-memory 링버퍼 크기.
// 비용/메모리 관점:
//   각 항목은 평균 200B (시각 + 레벨 + 메시지). MAX 9999 일 땐 약 2MB 가 ECS task
//   RSS 에 상주. 운영 시 superadmin 콘솔에서 보는 윈도우는 보통 500~1000줄이고,
//   2000줄 이상은 grep 으로 보는 게 더 빠름. 2000 으로 줄여 컨테이너 메모리 여유를 확보.
//   (장기 보관은 CloudWatch — 이건 어디까지나 실시간 뷰어용.)
const MAX = 2000;
const buf: LogEntry[] = [];

// 한 줄 상한도 2000자로 축소 — stack trace 한 덩어리도 충분히 들어가고, 그 이상은
// 메시지가 큰 객체 dump 라 보통 의미보단 노이즈. CloudWatch 비용 + RSS 둘 다 절감.
function pushEntry(level: LogLevel, msg: string) {
  buf.push({ ts: Date.now(), level, msg: msg.length > 2000 ? msg.slice(0, 2000) + "…" : msg });
  if (buf.length > MAX) buf.splice(0, buf.length - MAX);
}

export function getLogs(opts: { since?: number; level?: LogLevel; q?: string; limit?: number } = {}): LogEntry[] {
  const limit = Math.min(9999, Math.max(1, opts.limit ?? 500));
  let arr = buf;
  if (opts.since) arr = arr.filter((e) => e.ts > opts.since!);
  if (opts.level) arr = arr.filter((e) => e.level === opts.level);
  if (opts.q) {
    const k = opts.q.toLowerCase();
    arr = arr.filter((e) => e.msg.toLowerCase().includes(k));
  }
  // 최근 N 만 반환.
  return arr.slice(-limit);
}

export function pushHttpLog(line: string) {
  pushEntry("http", line);
}

/* ===== 에러 이벤트 (Sentry-lite) =====
 * 5xx 응답을 잡아 stack hash 기준으로 그루핑. 중복 스택은 카운터·last_seen 만 갱신.
 * 인메모리 — 프로세스 재시작 시 초기화. 외부 Sentry 가 진짜 답이지만, 사내툴 규모엔 이걸로 충분.
 */
export type ErrorEvent = {
  ts: number;
  status: number;
  method: string;
  path: string;
  message: string;
  stack: string;
  userId: string | null;
  ua: string | null;
  ip: string | null;
};

export type ErrorGroup = {
  hash: string;
  message: string;
  topFrame: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  paths: string[];
  userIds: string[];
  recent: ErrorEvent[];
};

const MAX_EVENTS = 4000;
const events: ErrorEvent[] = [];
const groups = new Map<string, ErrorGroup>();

/** 에러 메시지 + 첫 스택 프레임으로 8자 hash. 동일 에러는 같은 그룹. */
function hashKey(message: string, stack: string): { hash: string; topFrame: string } {
  const top = (stack.split("\n").find((l) => l.trim().startsWith("at ")) ?? "").trim();
  const seed = `${message}|${top}`;
  // 단순 djb2 — 충돌은 무시할 수준이고 의존성 없음.
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h) ^ seed.charCodeAt(i);
  return { hash: (h >>> 0).toString(16).slice(0, 8), topFrame: top };
}

export function pushErrorEvent(ev: ErrorEvent) {
  events.push(ev);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);

  const { hash, topFrame } = hashKey(ev.message, ev.stack);
  const g = groups.get(hash);
  if (g) {
    g.count++;
    g.lastSeen = ev.ts;
    if (!g.paths.includes(ev.path) && g.paths.length < 20) g.paths.push(ev.path);
    if (ev.userId && !g.userIds.includes(ev.userId) && g.userIds.length < 50) g.userIds.push(ev.userId);
    g.recent.unshift(ev);
    if (g.recent.length > 10) g.recent.pop();
  } else {
    groups.set(hash, {
      hash,
      message: ev.message.slice(0, 300),
      topFrame: topFrame.slice(0, 240),
      count: 1,
      firstSeen: ev.ts,
      lastSeen: ev.ts,
      paths: [ev.path],
      userIds: ev.userId ? [ev.userId] : [],
      recent: [ev],
    });
  }
}

export function getErrorGroups(opts: { userId?: string; sinceMs?: number } = {}): ErrorGroup[] {
  const since = opts.sinceMs ? Date.now() - opts.sinceMs : 0;
  let arr = Array.from(groups.values());
  if (since) arr = arr.filter((g) => g.lastSeen >= since);
  if (opts.userId) arr = arr.filter((g) => g.userIds.includes(opts.userId!));
  return arr.sort((a, b) => b.lastSeen - a.lastSeen);
}

export function getErrorGroup(hash: string): ErrorGroup | null {
  return groups.get(hash) ?? null;
}

export function clearErrorGroups() {
  groups.clear();
  events.length = 0;
}

let installed = false;

/** 한 번만 호출 — console 메서드를 가로채 버퍼에 동기화 적재.
 *  원래 stdout 동작은 유지(서버 콘솔/Cloudwatch 도 그대로 쓰임). */
export function installConsoleHook() {
  if (installed) return;
  installed = true;
  const origLog = console.log.bind(console);
  const origInfo = console.info.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  function fmt(args: any[]): string {
    return args
      .map((a) => {
        if (typeof a === "string") return a;
        try {
          return JSON.stringify(a, replaceCircular(), 2);
        } catch {
          return String(a);
        }
      })
      .join(" ");
  }

  console.log = (...args: any[]) => {
    pushEntry("info", fmt(args));
    origLog(...args);
  };
  console.info = (...args: any[]) => {
    pushEntry("info", fmt(args));
    origInfo(...args);
  };
  console.warn = (...args: any[]) => {
    pushEntry("warn", fmt(args));
    origWarn(...args);
  };
  console.error = (...args: any[]) => {
    pushEntry("error", fmt(args));
    origError(...args);
  };
}

/** JSON.stringify 순환 참조 안전망. */
function replaceCircular() {
  const seen = new WeakSet();
  return (_key: string, value: any) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  };
}
