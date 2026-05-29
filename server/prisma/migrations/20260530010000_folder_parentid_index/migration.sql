-- 폴더 트리 탐색 성능 인덱스
--
-- document.ts 의 collectFolderSubtree(BFS) 와 폴더 ZIP 다운로드 walk() 가
-- prisma.folder.findMany({ where: { parentId } }) 를 트리 레벨/노드마다 호출한다.
-- Folder 에는 @@index([projectId]) 만 있어 parentId 조회가 매번 풀스캔이었다.
CREATE INDEX "Folder_parentId_idx" ON "Folder"("parentId");
