-- ChatRoom 에 createdById 추가 — 그룹방 삭제 권한 판정용.
-- 1) 컬럼 추가 (NULL 허용 — legacy row 호환)
ALTER TABLE "ChatRoom" ADD COLUMN "createdById" TEXT;

-- 2) 인덱스 — "내가 만든 방" 조회 패턴
CREATE INDEX "ChatRoom_createdById_idx" ON "ChatRoom"("createdById");

-- 3) FK — User 삭제 시 방은 살리되 작성자 정보만 NULL
ALTER TABLE "ChatRoom"
  ADD CONSTRAINT "ChatRoom_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) 기존 GROUP/TEAM 방 백필 — 가장 먼저 가입한(RoomMember.id 사전순 = 생성 순)
--    멤버를 "추정 생성자" 로 설정. DIRECT 방은 두 명 모두 있으므로 의미 없음(스킵).
--    legacy row 가 많지 않다면 NULL 로 둬도 무방 — UI 에서 ADMIN 만 삭제 가능.
--    여기선 가능한 best-effort 로 채워 사용자 경험을 살려둠.
UPDATE "ChatRoom" cr
SET "createdById" = sub.user_id
FROM (
  SELECT DISTINCT ON ("roomId") "roomId", "userId" AS user_id
  FROM "RoomMember"
  ORDER BY "roomId", "id" ASC
) sub
WHERE cr.id = sub."roomId"
  AND cr."createdById" IS NULL
  AND cr.type IN ('GROUP', 'TEAM');
