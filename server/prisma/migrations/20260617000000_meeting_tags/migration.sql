-- 회의록에 태그 추가 (메모 Document.tags 와 동일한 쉼표 구분 문자열). 추가형 nullable 컬럼.
ALTER TABLE "Meeting" ADD COLUMN "tags" TEXT;
