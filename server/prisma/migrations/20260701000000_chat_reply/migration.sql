-- 채팅 답장(인용) — ChatMessage 자기참조 replyToId. 추가형 nullable 컬럼.
-- 원본이 하드삭제되면 SET NULL(소프트삭제는 deletedAt 이라 관계 유지). 비파괴적.

ALTER TABLE "ChatMessage" ADD COLUMN "replyToId" TEXT;

CREATE INDEX "ChatMessage_replyToId_idx" ON "ChatMessage"("replyToId");

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
