import { prisma } from "./db.js";
import { publish } from "./sse.js";
import { sendApnsToUser } from "./apns.js";

export type NotifyType =
  | "NOTICE"
  | "DM"
  | "APPROVAL_REQUEST"
  | "APPROVAL_REVIEW"
  | "MENTION"
  | "SYSTEM";

export interface NotifyInput {
  userId: string;
  type: NotifyType;
  title: string;
  body?: string;
  linkUrl?: string;
  actorName?: string;
  actorColor?: string;
}

/**
 * 유저 환경설정을 읽어 { allowed, allowPush } 를 결정.
 * - prefs[type] === false 면 알림 생성 자체를 스킵.
 * - DND 시간대 (현재 시각이 [dndStart, dndEnd) 안이면) 생성은 하되 SSE push 만 스킵 → 벨 기록은 남음.
 */
async function resolveDelivery(userIds: string[], type: NotifyType): Promise<Map<string, { allowed: boolean; allowPush: boolean }>> {
  const out = new Map<string, { allowed: boolean; allowPush: boolean }>();
  userIds.forEach((id) => out.set(id, { allowed: true, allowPush: true }));
  if (!userIds.length) return out;
  const rows = await prisma.notificationPref.findMany({ where: { userId: { in: userIds } } });
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const inDnd = (start?: string | null, end?: string | null) => {
    if (!start || !end) return false;
    // end 가 start 보다 작으면 자정을 넘는 구간.
    if (start <= end) return hhmm >= start && hhmm < end;
    return hhmm >= start || hhmm < end;
  };
  for (const r of rows) {
    const prefs = (r.prefs ?? {}) as Record<string, boolean>;
    const allowed = prefs[type] !== false; // 기본 허용 — 명시적 false 일 때만 스킵
    const allowPush = allowed && !inDnd(r.dndStart, r.dndEnd);
    out.set(r.userId, { allowed, allowPush });
  }
  return out;
}

export async function notify(input: NotifyInput) {
  try {
    const map = await resolveDelivery([input.userId], input.type);
    const d = map.get(input.userId);
    if (d && !d.allowed) return;
    const created = await prisma.notification.create({ data: input });
    if (!d || d.allowPush) {
      publish(input.userId, "notification", created);
      // 원격 푸시(iOS APNs) — fire-and-forget. 미설정/토큰없음이면 내부 no-op.
      void sendApnsToUser(input.userId, { title: input.title, body: input.body, linkUrl: input.linkUrl });
    }
  } catch (e) {
    console.error("notify failed", e);
  }
}

export async function notifyMany(inputs: NotifyInput[]) {
  if (!inputs.length) return;
  try {
    // 타입별로 그룹화 — 한 번의 resolveDelivery 호출로 유저별 환경설정을 검사.
    const byType = new Map<NotifyType, NotifyInput[]>();
    for (const i of inputs) {
      if (!byType.has(i.type)) byType.set(i.type, []);
      byType.get(i.type)!.push(i);
    }
    const filtered: NotifyInput[] = [];
    const pushFlag = new Map<string, boolean>(); // userId:type → allowPush
    for (const [type, arr] of byType) {
      const map = await resolveDelivery(arr.map((x) => x.userId), type);
      for (const i of arr) {
        const d = map.get(i.userId);
        if (d && !d.allowed) continue;
        filtered.push(i);
        pushFlag.set(`${i.userId}:${type}`, !d || d.allowPush);
      }
    }
    if (!filtered.length) return;

    // createMany 는 ID를 반환 안 하므로 시간 범위로 방금 만든 레코드만 골라온다.
    // take: filtered.length 로 top-N 을 쓰면, 고빈도 알림 상황에서 동시에 발생한 다른 배치가
    // 창(window)을 밀어내 해당 유저의 SSE push 가 누락되는 레이스가 있었음. 1 ms 여유를 빼서
    // createdAt 의 초단위 절단/클럭 드리프트를 보정.
    const since = new Date(Date.now() - 1);
    await prisma.notification.createMany({ data: filtered });
    const byUser = new Map<string, NotifyInput>();
    for (const i of filtered) byUser.set(i.userId, i);
    const fresh = await prisma.notification.findMany({
      where: {
        userId: { in: Array.from(byUser.keys()) },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
    });
    // user별로 가장 최근 1건만 푸시.
    const picked = new Map<string, (typeof fresh)[number]>();
    for (const n of fresh) {
      if (!picked.has(n.userId)) picked.set(n.userId, n);
    }
    for (const [uid, n] of picked) {
      if (pushFlag.get(`${uid}:${n.type as NotifyType}`) !== false) {
        publish(uid, "notification", n);
        // 원격 푸시(iOS APNs) — fire-and-forget. 미설정/토큰없음이면 내부 no-op.
        void sendApnsToUser(uid, { title: n.title, body: n.body ?? undefined, linkUrl: n.linkUrl ?? undefined });
      }
    }
  } catch (e) {
    console.error("notifyMany failed", e);
  }
}

/** 전사 공지 — 총관리자 제외 모든 활성 유저에게 발송 */
export async function notifyAllUsers(
  tpl: Omit<NotifyInput, "userId">,
  excludeUserId?: string
) {
  const users = await prisma.user.findMany({
    where: { active: true, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
    select: { id: true },
  });
  await notifyMany(
    users.map((u) => ({ ...tpl, userId: u.id }))
  );
}
