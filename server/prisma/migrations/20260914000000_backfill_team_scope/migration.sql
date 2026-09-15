-- scope=TEAM 인데 scopeTeam 이 비어 있는 전역 문서/폴더 백필.
-- req.user 에 team 이 없어 생성 시 scopeTeam 이 항상 null 로 저장되던 버그(#1129)의 잔여 데이터 복구.
-- 작성자의 현재 소속 팀으로 채운다. 작성자 팀이 없으면(null) 그대로 두어 이후에도 작성자/ADMIN 만 본다.
UPDATE "Document" d
SET "scopeTeam" = u."team"
FROM "User" u
WHERE d."authorId" = u."id"
  AND d."scope" = 'TEAM'
  AND d."scopeTeam" IS NULL
  AND d."projectId" IS NULL
  AND u."team" IS NOT NULL;

UPDATE "Folder" f
SET "scopeTeam" = u."team"
FROM "User" u
WHERE f."authorId" = u."id"
  AND f."scope" = 'TEAM'
  AND f."scopeTeam" IS NULL
  AND f."projectId" IS NULL
  AND u."team" IS NOT NULL;
