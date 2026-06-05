import { randomUUID } from "node:crypto";
import { prisma } from "./db.js";
import { publish } from "./sse.js";
import { sendApnsToUser, sendApnsToUsers } from "./apns.js";

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
  /** 발신자 아바타 /uploads 상대경로 — 채팅 알림의 Communication Notification(아바타) 용. DB 저장 X, 푸시에만. */
  actorAvatarUrl?: string;
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

/** linkUrl 에서 ?room=<id> 추출. 채팅(DM/MENTION) 알림만 이 패턴을 가짐. */
function roomIdFromLink(linkUrl?: string | null): string | null {
  if (!linkUrl) return null;
  const m = /[?&]room=([^&]+)/.exec(linkUrl);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * (userId, roomId) 쌍 중 "이 방을 음소거한" 조합을 `${userId}:${roomId}` Set 으로 반환.
 * 음소거된 방의 채팅 알림은 APNs(폰 푸시) 만 건너뛴다 — 알림 레코드·SSE 는 그대로라
 * 미읽음 뱃지·실시간 채팅목록 갱신은 유지된다. 채팅 외 알림(roomId 없음) 은 항상 빈 결과.
 */
async function mutedApnsSet(targets: { userId: string; linkUrl?: string | null }[]): Promise<Set<string>> {
  const pairs = targets
    .map((t) => ({ userId: t.userId, roomId: roomIdFromLink(t.linkUrl) }))
    .filter((p): p is { userId: string; roomId: string } => !!p.roomId);
  if (!pairs.length) return new Set();
  const muted = await prisma.roomMember.findMany({
    where: {
      muted: true,
      roomId: { in: Array.from(new Set(pairs.map((p) => p.roomId))) },
      userId: { in: Array.from(new Set(pairs.map((p) => p.userId))) },
    },
    select: { roomId: true, userId: true },
  });
  return new Set(muted.map((m) => `${m.userId}:${m.roomId}`));
}

export async function notify(input: NotifyInput) {
  try {
    const map = await resolveDelivery([input.userId], input.type);
    const d = map.get(input.userId);
    if (d && !d.allowed) return;
    const created = await prisma.notification.create({ data: input });
    if (!d || d.allowPush) {
      publish(input.userId, "notification", created);
      // 방 음소거 시 APNs(폰 푸시) 만 생략 — 레코드/SSE 는 위에서 이미 보냄.
      let muted = false;
      const rid = roomIdFromLink(input.linkUrl);
      if (rid) {
        const mem = await prisma.roomMember.findUnique({
          where: { roomId_userId: { roomId: rid, userId: input.userId } },
          select: { muted: true },
        });
        muted = !!mem?.muted;
      }
      // 원격 푸시(iOS APNs) — fire-and-forget. 미설정/토큰없음이면 내부 no-op.
      if (!muted) void sendApnsToUser(input.userId, { title: input.title, body: input.body, linkUrl: input.linkUrl, groupId: rid ?? undefined });
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

    // createMany 는 ID를 반환 안 한다. 예전엔 createdAt 시간창으로 방금 만든 행을 되짚었는데,
    // 동시에 도는 다른 배치가 같은 유저의 창을 오염시켜 "유저당 1건만" 추려 푸시 → 같은 유저에게
    // 거의 동시에 온 두 알림 중 하나의 실시간 SSE/APNs 가 누락됐다(레코드는 남아 다음 새로고침엔 보임).
    // 근본 수정: 각 행의 id 를 미리 생성해 넣고, 그 id 들로 정확히 되짚어 "전부" 푸시한다.
    const rows = filtered.map((i) => ({ ...i, id: randomUUID() as string }));
    await prisma.notification.createMany({ data: rows });
    const created = await prisma.notification.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
    // 음소거된 방의 채팅 알림은 APNs(폰 푸시) 만 생략 — 한 번에 조회.
    const mutedSet = await mutedApnsSet(
      created.map((n) => ({ userId: n.userId, linkUrl: n.linkUrl }))
    );
    // 아바타(actorAvatarUrl)는 Notification 컬럼이 아니라 입력에만 있으므로 id 로 되짚는다.
    const inputById = new Map(rows.map((r) => [r.id, r]));
    const apnsTargets: { userId: string; payload: { title: string; body?: string; linkUrl?: string; groupId?: string; senderName?: string; senderAvatarPath?: string } }[] = [];
    for (const n of created) {
      if (pushFlag.get(`${n.userId}:${n.type as NotifyType}`) === false) continue;
      publish(n.userId, "notification", n);
      const rid = roomIdFromLink(n.linkUrl);
      if (!(rid && mutedSet.has(`${n.userId}:${rid}`))) {
        // 채팅(DM/MENTION)만 Communication Notification(발신자 아바타) 대상. 결재/공지 등은 일반 알림.
        const isChat = n.type === "DM" || n.type === "MENTION";
        const inp = inputById.get(n.id);
        apnsTargets.push({
          userId: n.userId,
          payload: {
            title: n.title, body: n.body ?? undefined, linkUrl: n.linkUrl ?? undefined, groupId: rid ?? undefined,
            ...(isChat ? { senderName: n.actorName ?? undefined, senderAvatarPath: inp?.actorAvatarUrl ?? undefined } : {}),
          },
        });
      }
    }
    // 원격 푸시(iOS APNs) — fire-and-forget. pushToken 조회를 1회로 묶어 일괄 발송. 미설정/토큰없음이면 내부 no-op.
    void sendApnsToUsers(apnsTargets);
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
