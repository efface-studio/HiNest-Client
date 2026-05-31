-- 멀티테넌시 2단계: 테넌트 소유 모델 전체에 companyId 행수준 격리 컬럼 추가.
-- 기존 단일 회사 데이터는 모두 기본 회사(company_default)에 귀속시킨다.
-- companyId 는 NULL 허용 — 런타임 $extends 확장이 요청 컨텍스트의 companyId 를 자동 주입한다.
-- FK 는 걸지 않는다(스키마에 관계 필드 없음) — 회사는 하드 삭제하지 않으므로 고아행 위험 없음.

-- AddColumn: 테넌트 소유 테이블에 companyId 추가
ALTER TABLE "Project" ADD COLUMN "companyId" TEXT;
ALTER TABLE "ProjectQaItem" ADD COLUMN "companyId" TEXT;
ALTER TABLE "ProjectQaAttachment" ADD COLUMN "companyId" TEXT;
ALTER TABLE "WebhookChannel" ADD COLUMN "companyId" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN "companyId" TEXT;
ALTER TABLE "ProjectMember" ADD COLUMN "companyId" TEXT;
ALTER TABLE "ProjectEvent" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Event" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Leave" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Attendance" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Journal" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Notice" ADD COLUMN "companyId" TEXT;
ALTER TABLE "NoticeReaction" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Pin" ADD COLUMN "companyId" TEXT;
ALTER TABLE "NotificationPref" ADD COLUMN "companyId" TEXT;
ALTER TABLE "DocumentShareLink" ADD COLUMN "companyId" TEXT;
ALTER TABLE "FolderShareLink" ADD COLUMN "companyId" TEXT;
ALTER TABLE "ShareLinkAccess" ADD COLUMN "companyId" TEXT;
ALTER TABLE "ApprovalTemplate" ADD COLUMN "companyId" TEXT;
ALTER TABLE "ApprovalLineFavorite" ADD COLUMN "companyId" TEXT;
ALTER TABLE "ApprovalComment" ADD COLUMN "companyId" TEXT;
ALTER TABLE "MeetingRevision" ADD COLUMN "companyId" TEXT;
ALTER TABLE "DocumentRevision" ADD COLUMN "companyId" TEXT;
ALTER TABLE "ChatRoom" ADD COLUMN "companyId" TEXT;
ALTER TABLE "RoomMember" ADD COLUMN "companyId" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "companyId" TEXT;
ALTER TABLE "MessageReaction" ADD COLUMN "companyId" TEXT;
ALTER TABLE "CardExpense" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Folder" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Document" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Payslip" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Approval" ADD COLUMN "companyId" TEXT;
ALTER TABLE "ApprovalStep" ADD COLUMN "companyId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Meeting" ADD COLUMN "companyId" TEXT;
ALTER TABLE "MeetingAttachment" ADD COLUMN "companyId" TEXT;
ALTER TABLE "MeetingViewer" ADD COLUMN "companyId" TEXT;
ALTER TABLE "ServiceAccount" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Snippet" ADD COLUMN "companyId" TEXT;
ALTER TABLE "InviteKey" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Team" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Position" ADD COLUMN "companyId" TEXT;

-- Backfill: 기존 모든 행을 기본 회사에 귀속 (재실행 안전)
UPDATE "Project" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "ProjectQaItem" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "ProjectQaAttachment" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "WebhookChannel" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "WebhookEvent" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "ProjectMember" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "ProjectEvent" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "Event" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "Leave" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "Attendance" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "Journal" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "Notice" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "NoticeReaction" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "Pin" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "NotificationPref" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "DocumentShareLink" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "FolderShareLink" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "ShareLinkAccess" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "ApprovalTemplate" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "ApprovalLineFavorite" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "ApprovalComment" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "MeetingRevision" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "DocumentRevision" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "ChatRoom" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "RoomMember" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "ChatMessage" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "MessageReaction" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "CardExpense" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "Notification" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "Folder" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "Document" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "Payslip" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "Approval" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "ApprovalStep" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "AuditLog" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "Meeting" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "MeetingAttachment" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "MeetingViewer" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "ServiceAccount" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "Snippet" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "InviteKey" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "Team" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;
UPDATE "Position" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;

-- Team/Position: 전역 유니크(name) → 회사별 유니크(companyId, name) 로 전환
DROP INDEX "Team_name_key";
DROP INDEX "Position_name_key";

-- CreateIndex: companyId 조회 인덱스
CREATE INDEX "Project_companyId_idx" ON "Project"("companyId");
CREATE INDEX "ProjectQaItem_companyId_idx" ON "ProjectQaItem"("companyId");
CREATE INDEX "ProjectQaAttachment_companyId_idx" ON "ProjectQaAttachment"("companyId");
CREATE INDEX "WebhookChannel_companyId_idx" ON "WebhookChannel"("companyId");
CREATE INDEX "WebhookEvent_companyId_idx" ON "WebhookEvent"("companyId");
CREATE INDEX "ProjectMember_companyId_idx" ON "ProjectMember"("companyId");
CREATE INDEX "ProjectEvent_companyId_idx" ON "ProjectEvent"("companyId");
CREATE INDEX "Event_companyId_idx" ON "Event"("companyId");
CREATE INDEX "Leave_companyId_idx" ON "Leave"("companyId");
CREATE INDEX "Attendance_companyId_idx" ON "Attendance"("companyId");
CREATE INDEX "Journal_companyId_idx" ON "Journal"("companyId");
CREATE INDEX "Notice_companyId_idx" ON "Notice"("companyId");
CREATE INDEX "NoticeReaction_companyId_idx" ON "NoticeReaction"("companyId");
CREATE INDEX "Pin_companyId_idx" ON "Pin"("companyId");
CREATE INDEX "NotificationPref_companyId_idx" ON "NotificationPref"("companyId");
CREATE INDEX "DocumentShareLink_companyId_idx" ON "DocumentShareLink"("companyId");
CREATE INDEX "FolderShareLink_companyId_idx" ON "FolderShareLink"("companyId");
CREATE INDEX "ShareLinkAccess_companyId_idx" ON "ShareLinkAccess"("companyId");
CREATE INDEX "ApprovalTemplate_companyId_idx" ON "ApprovalTemplate"("companyId");
CREATE INDEX "ApprovalLineFavorite_companyId_idx" ON "ApprovalLineFavorite"("companyId");
CREATE INDEX "ApprovalComment_companyId_idx" ON "ApprovalComment"("companyId");
CREATE INDEX "MeetingRevision_companyId_idx" ON "MeetingRevision"("companyId");
CREATE INDEX "DocumentRevision_companyId_idx" ON "DocumentRevision"("companyId");
CREATE INDEX "ChatRoom_companyId_idx" ON "ChatRoom"("companyId");
CREATE INDEX "RoomMember_companyId_idx" ON "RoomMember"("companyId");
CREATE INDEX "ChatMessage_companyId_idx" ON "ChatMessage"("companyId");
CREATE INDEX "MessageReaction_companyId_idx" ON "MessageReaction"("companyId");
CREATE INDEX "CardExpense_companyId_idx" ON "CardExpense"("companyId");
CREATE INDEX "Notification_companyId_idx" ON "Notification"("companyId");
CREATE INDEX "Folder_companyId_idx" ON "Folder"("companyId");
CREATE INDEX "Document_companyId_idx" ON "Document"("companyId");
CREATE INDEX "Payslip_companyId_idx" ON "Payslip"("companyId");
CREATE INDEX "Approval_companyId_idx" ON "Approval"("companyId");
CREATE INDEX "ApprovalStep_companyId_idx" ON "ApprovalStep"("companyId");
CREATE INDEX "AuditLog_companyId_idx" ON "AuditLog"("companyId");
CREATE INDEX "Meeting_companyId_idx" ON "Meeting"("companyId");
CREATE INDEX "MeetingAttachment_companyId_idx" ON "MeetingAttachment"("companyId");
CREATE INDEX "MeetingViewer_companyId_idx" ON "MeetingViewer"("companyId");
CREATE INDEX "ServiceAccount_companyId_idx" ON "ServiceAccount"("companyId");
CREATE INDEX "Snippet_companyId_idx" ON "Snippet"("companyId");
CREATE INDEX "InviteKey_companyId_idx" ON "InviteKey"("companyId");

-- CreateIndex: 회사별 유니크
CREATE UNIQUE INDEX "Team_companyId_name_key" ON "Team"("companyId", "name");
CREATE UNIQUE INDEX "Position_companyId_name_key" ON "Position"("companyId", "name");
