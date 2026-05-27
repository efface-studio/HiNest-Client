-- 문서 메모 기능: Document 와 DocumentRevision 에 TipTap JSON 컨텐츠 컬럼 추가.
-- content IS NULL  → 기존 파일/링크 문서 (하위 호환).
-- content IS NOT NULL → 메모(리치텍스트) 타입 문서.

ALTER TABLE "Document" ADD COLUMN "content" JSONB;

ALTER TABLE "DocumentRevision" ADD COLUMN "content" JSONB;
