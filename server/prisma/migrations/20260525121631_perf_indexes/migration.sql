-- 성능 최적화 인덱스 (Wave 1)
--
-- AuditLog: writeLog() 가 매 액션마다 INSERT 하는데 운영자가 "특정 사용자 활동"
-- "최근 LOGIN_FAIL" 같은 조회를 자주 함. 단일 createdAt 인덱스만 있던 시절엔
-- userId / action 필터가 풀스캔으로 떨어져 row 수 늘어날수록 admin 페이지 timeout.
CREATE INDEX "AuditLog_userId_createdAt_idx"
  ON "AuditLog"("userId", "createdAt" DESC);

CREATE INDEX "AuditLog_action_createdAt_idx"
  ON "AuditLog"("action", "createdAt" DESC);

-- Document: 폴더별 / 작성자별 조회 패턴. 기존 (projectId, updatedAt) 만으론
-- 일반 문서함의 폴더 트리 탐색이 풀스캔.
CREATE INDEX "Document_folderId_deletedAt_idx"
  ON "Document"("folderId", "deletedAt");

CREATE INDEX "Document_authorId_updatedAt_idx"
  ON "Document"("authorId", "updatedAt" DESC);
