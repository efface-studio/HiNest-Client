import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { getHiddenPositions, excludeHidden } from "../lib/hiddenPositions.js";

const router = Router();
router.use(requireAuth);

/**
 * 글로벌 검색. 결과는 섹션별로 묶어서 반환.
 * - people : 유저 (총관리자는 제외)
 * - notices
 * - events (내가 볼 수 있는)
 * - documents
 * - messages (내가 멤버인 방만)
 */
router.get("/", async (req, res) => {
  const u = (req as any).user;
  const raw = String(req.query.q ?? "").trim();
  // 검색어는 실무상 20자 내외. 과도한 길이는 여러 테이블에 LIKE '%...%' 로 들어가
  // DB 를 쥐어짜는 DoS 벡터가 되므로 128자로 자름.
  // (UI 도 maxLength=80 이라서 일반 경로는 영향 없음.)
  const q = raw.length > 128 ? raw.slice(0, 128) : raw;
  if (q.length < 1) return res.json({ q, results: {} });

  const isAdmin = u.role === "ADMIN";

  // meUser, myProjectIds, myRoomIds 를 병렬로 미리 조회 — 순차 DB 왕복 3회 → 1회.
  const [meUser, projectMems, myRoomMems] = await Promise.all([
    prisma.user.findUnique({ where: { id: u.id }, select: { id: true, team: true } }),
    isAdmin
      ? Promise.resolve([] as { projectId: string }[])
      : prisma.projectMember.findMany({ where: { userId: u.id }, select: { projectId: true } }),
    // roomId IN (...) 방식으로 chatMessage 필터 — members.some 은 correlated subquery 라 느림.
    prisma.roomMember.findMany({ where: { userId: u.id }, select: { roomId: true } }),
  ]);

  const myProjectIds = projectMems.map((m) => m.projectId);
  const myRoomIds = myRoomMems.map((m) => m.roomId);

  // 일정(TEAM) — 빈 team 을 "매칭" 으로 만들지 않도록 team 이 있을 때만 clause 추가.
  const eventOr: any[] = [
    { scope: "COMPANY" },
    { scope: "PERSONAL", createdBy: u.id },
    { scope: "TARGETED", createdBy: u.id },
    { scope: "TARGETED", targetUserIds: { contains: u.id } },
  ];
  if (meUser?.team) eventOr.push({ scope: "TEAM", team: meUser.team });
  const docScopeOr: any[] = isAdmin
    ? [{}]
    : [
        // 내가 만든 건 무조건 보임
        { authorId: u.id },
        // 프로젝트 멤버인 프로젝트의 문서
        { projectId: { in: myProjectIds.length ? myProjectIds : ["__none__"] } },
        // 전체 공개
        { scope: "ALL", projectId: null },
        // 팀 공개 — 내 팀과 일치할 때만
        ...(meUser?.team ? [{ scope: "TEAM", scopeTeam: meUser.team, projectId: null }] : []),
        // 사용자지정 — scopeUserIds 에 내가 포함
        { scope: "CUSTOM", scopeUserIds: { contains: u.id }, projectId: null },
      ];

  // Postgres 의 Prisma `contains` 는 기본이 case-sensitive LIKE — "Login" 을 쳤을 때 "login"
  // 제목의 공지/메시지가 빠져 검색 UX 가 안 맞는 이슈가 있었음. mode:"insensitive" 로 전환해
  // ILIKE 를 쓰도록 변경 (모든 필드 공통 적용).
  const ic = { contains: q, mode: "insensitive" as const };

  // 회의록 접근권: ADMIN 은 전체, 일반 유저는 (ALL) ∪ (내가 작성) ∪ (SPECIFIC viewer) ∪ (PROJECT 내가 멤버)
  const meetingWhere: any = isAdmin
    ? {}
    : {
        OR: [
          { visibility: "ALL" },
          { authorId: u.id },
          { visibility: "SPECIFIC", viewers: { some: { userId: u.id } } },
          { visibility: "PROJECT", projectId: { in: myProjectIds.length ? myProjectIds : ["__none__"] } },
        ],
      };

  // 숨김 직급(테스트 계정 등) 사용자는 검색 결과에서 제외(본인은 항상 포함).
  const hidden = await getHiddenPositions(u.companyId);
  const [people, notices, events, documents, messages, meetings, approvals, projects] = await Promise.all([
    prisma.user.findMany({
      where: {
        active: true,
        OR: [{ superAdmin: false }, { id: u.id }],
        AND: [
          {
            OR: [
              { name: ic },
              { email: ic },
              { team: ic },
              { position: ic },
            ],
          },
        ],
        ...excludeHidden(hidden, { exceptId: u.id }),
      },
      take: 8,
      select: { id: true, name: true, email: true, team: true, position: true, avatarColor: true, isDeveloper: true, avatarUrl: true },
    }),
    prisma.notice.findMany({
      where: {
        deletedAt: null,
        OR: [{ title: ic }, { content: ic }],
      },
      take: 8,
      orderBy: { createdAt: "desc" },
      include: { author: { select: { name: true } } },
    }),
    prisma.event.findMany({
      where: {
        AND: [
          { OR: eventOr },
          { OR: [{ title: ic }, { content: ic }] },
        ],
      },
      take: 8,
      orderBy: { startAt: "desc" },
    }),
    prisma.document.findMany({
      where: {
        AND: [
          { deletedAt: null },
          { OR: [{ title: ic }, { description: ic }, { tags: ic }] },
          { OR: docScopeOr },
        ],
      },
      take: 8,
      orderBy: { updatedAt: "desc" },
      include: { author: { select: { name: true } }, folder: { select: { name: true } } },
    }),
    // roomId: { in: myRoomIds } 는 (roomId, createdAt) 인덱스를 바로 사용.
    // room.members.some 은 correlated subquery 라 인덱스를 활용 못하고 느림.
    prisma.chatMessage.findMany({
      where: {
        deletedAt: null,
        roomId: { in: myRoomIds.length ? myRoomIds : ["__none__"] },
        content: ic,
      },
      take: 8,
      orderBy: { createdAt: "desc" },
      include: {
        sender: { select: { name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } },
        room: { select: { id: true, name: true, type: true } },
      },
    }),
    // 회의록 — 제목으로만 매칭 (content 는 JSONB 라 단순 LIKE 가 안 되고 비용도 큼).
    prisma.meeting.findMany({
      where: {
        AND: [{ deletedAt: null }, { title: ic }, meetingWhere],
      },
      take: 8,
      orderBy: { updatedAt: "desc" },
      include: {
        author: { select: { name: true } },
      },
    }),
    // 결재 — 내가 신청자이거나 결재자/참조자로 보이는 문서만.
    prisma.approval.findMany({
      where: {
        AND: [
          { OR: [{ title: ic }, { content: ic }] },
          isAdmin
            ? {}
            : {
                OR: [
                  { requesterId: u.id },
                  { steps: { some: { reviewerId: u.id } } },
                ],
              },
        ],
      },
      take: 6,
      orderBy: { createdAt: "desc" },
      include: { requester: { select: { name: true } } },
    }),
    // 프로젝트 — 내가 멤버인 것만(ADMIN 전체).
    prisma.project.findMany({
      where: {
        AND: [
          { OR: [{ name: ic }, { description: ic }] },
          isAdmin ? {} : { members: { some: { userId: u.id } } },
        ],
      },
      take: 6,
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, description: true, color: true, status: true },
    }),
  ]);

  res.json({
    q,
    results: { people, notices, events, documents, messages, meetings, approvals, projects },
  });
});

export default router;
