-- Position 에 hidden 플래그 추가. 이 직급에 속한 사용자는 디렉터리·조직도 등
-- 사용자 목록에서 제외된다(본인 활동은 정상). NOT NULL + DEFAULT false 라 비파괴적.
ALTER TABLE "Position" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;
