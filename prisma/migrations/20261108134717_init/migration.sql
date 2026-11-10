-- CreateEnum
CREATE TYPE "StudentWorkPost" AS ENUM ('ATTENDANT_DUTY', 'FOOD_DISTRIBUTION', 'ATTENDANCE_LIAISON', 'HEALTH_LIAISON');

-- CreateEnum
CREATE TYPE "ResidencyStatus" AS ENUM ('NOT_HOUSED', 'RESIDENT', 'ON_LEAVE', 'CHECKED_OUT');

-- CreateEnum
CREATE TYPE "AssignmentKind" AS ENUM ('BED', 'FLOOR', 'EXTRA');

-- CreateEnum
CREATE TYPE "AssignmentEndReason" AS ENUM ('ROOM_CHANGE', 'FLOOR_TO_BED', 'CHECKOUT');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'ON_LEAVE');

-- CreateEnum
CREATE TYPE "ShiftType" AS ENUM ('REGULAR', 'EXTRA', 'COVER');

-- CreateEnum
CREATE TYPE "LeaveKind" AS ENUM ('DAILY', 'HOURLY');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING_SUPERVISOR', 'PENDING_MANAGER', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReportCategory" AS ENUM ('FOOD_RECEIPT', 'FOOD_DELIVERY', 'OFFICIAL_VISIT', 'UNEXPECTED_BEHAVIOR', 'OTHER');

-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('SUBMITTED', 'REVIEWED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "ConcernType" AS ENUM ('BEHAVIOR_CHANGE', 'SELF_HARM', 'OTHER');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('NORMAL', 'URGENT');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'SCHEDULED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RequestKind" AS ENUM ('REPAIR', 'EQUIPMENT');

-- CreateEnum
CREATE TYPE "RepairCategory" AS ENUM ('BUILDING', 'MECHANICAL', 'ELECTRICAL', 'COOLING_HEATING');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'IN_PROGRESS', 'FIXED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AttachmentEntity" AS ENUM ('MAINTENANCE', 'DORM_REPORT');

-- CreateEnum
CREATE TYPE "ChecklistReportStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MissionStatus" AS ENUM ('ASSIGNED', 'DONE');

-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('NONE', 'PENDING', 'SENDING', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('SCHEDULED', 'QUEUED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecipientType" AS ENUM ('USER', 'STUDENT');

-- AlterTable
ALTER TABLE "University" ADD COLUMN     "disabledFeatures" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedLogins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isStudentWorker" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "smsOptOut" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "workerPost" "StudentWorkPost";

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "registeredDormitoryId" TEXT,
    "nationalId" TEXT NOT NULL,
    "studentNumber" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "fatherName" TEXT,
    "gender" "Gender" NOT NULL,
    "phone" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "major" TEXT,
    "status" "ResidencyStatus" NOT NULL DEFAULT 'NOT_HOUSED',
    "smsOptOut" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "dormitoryId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "bedId" TEXT,
    "kind" "AssignmentKind" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" "AssignmentEndReason",
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "activeStudentKey" TEXT,
    "activeBedKey" TEXT,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentLeave" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedReturnAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "StudentLeave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "dormitoryId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "dormitoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "type" "ShiftType" NOT NULL DEFAULT 'REGULAR',
    "note" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffPresence" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dormitoryId" TEXT NOT NULL,
    "shiftId" TEXT,
    "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkOutAt" TIMESTAMP(3),
    "unscheduled" BOOLEAN NOT NULL DEFAULT false,
    "handoverFromUserId" TEXT,
    "handoverNote" TEXT,

    CONSTRAINT "StaffPresence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "dormitoryId" TEXT,
    "requesterId" TEXT NOT NULL,
    "kind" "LeaveKind" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "status" "LeaveStatus" NOT NULL,
    "supervisorId" TEXT,
    "supervisorAt" TIMESTAMP(3),
    "supervisorNote" TEXT,
    "managerId" TEXT,
    "managerAt" TIMESTAMP(3),
    "managerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DormReport" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "dormitoryId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "category" "ReportCategory" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "mealType" "MealType",
    "quantity" INTEGER,
    "visitorName" TEXT,
    "studentId" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DormReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "dormitoryId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "concernType" "ConcernType" NOT NULL,
    "urgency" "Urgency" NOT NULL DEFAULT 'NORMAL',
    "narrative" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'SUBMITTED',
    "supervisorId" TEXT,
    "supervisorAt" TIMESTAMP(3),
    "supervisorNote" TEXT,
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "counselingNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PsychologistSchedule" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "dormitoryId" TEXT NOT NULL,
    "psychologistName" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PsychologistSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceRequest" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "dormitoryId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "kind" "RequestKind" NOT NULL,
    "category" "RepairCategory",
    "title" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'SUBMITTED',
    "estimatedCost" DECIMAL(16,0),
    "actualCost" DECIMAL(16,0),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "fromStatus" "MaintenanceStatus",
    "toStatus" "MaintenanceStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "dormitoryId" TEXT,
    "entity" "AttachmentEntity" NOT NULL,
    "entityId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistTemplate" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "dormitoryId" TEXT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistReport" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "dormitoryId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "ChecklistReportStatus" NOT NULL DEFAULT 'SUBMITTED',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistResult" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL,
    "note" TEXT,

    CONSTRAINT "ChecklistResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mission" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "dormitoryId" TEXT,
    "assigneeId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" "MissionStatus" NOT NULL DEFAULT 'ASSIGNED',
    "doneAt" TIMESTAMP(3),
    "resultNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageBatch" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "senderRole" "Role" NOT NULL,
    "body" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL,
    "sms" BOOLEAN NOT NULL,
    "audience" JSONB NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "status" "BatchStatus" NOT NULL,
    "totalRecipients" INTEGER NOT NULL,
    "smsRecipients" INTEGER NOT NULL DEFAULT 0,
    "smsParts" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(16,0),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageRecipient" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "recipientType" "RecipientType" NOT NULL,
    "userId" TEXT,
    "studentId" TEXT,
    "dormitoryId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "renderedBody" TEXT NOT NULL,
    "smsStatus" "SmsStatus" NOT NULL DEFAULT 'NONE',
    "providerMessageId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "statusChecks" INTEGER NOT NULL DEFAULT 0,
    "statusCheckedAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Student_universityId_status_idx" ON "Student"("universityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Student_universityId_nationalId_key" ON "Student"("universityId", "nationalId");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_activeStudentKey_key" ON "Assignment"("activeStudentKey");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_activeBedKey_key" ON "Assignment"("activeBedKey");

-- CreateIndex
CREATE INDEX "Assignment_dormitoryId_endedAt_idx" ON "Assignment"("dormitoryId", "endedAt");

-- CreateIndex
CREATE INDEX "Assignment_roomId_endedAt_idx" ON "Assignment"("roomId", "endedAt");

-- CreateIndex
CREATE INDEX "Assignment_studentId_idx" ON "Assignment"("studentId");

-- CreateIndex
CREATE INDEX "StudentLeave_studentId_idx" ON "StudentLeave"("studentId");

-- CreateIndex
CREATE INDEX "AttendanceRecord_dormitoryId_date_idx" ON "AttendanceRecord"("dormitoryId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_studentId_date_key" ON "AttendanceRecord"("studentId", "date");

-- CreateIndex
CREATE INDEX "Shift_dormitoryId_startsAt_idx" ON "Shift"("dormitoryId", "startsAt");

-- CreateIndex
CREATE INDEX "Shift_userId_startsAt_idx" ON "Shift"("userId", "startsAt");

-- CreateIndex
CREATE INDEX "StaffPresence_dormitoryId_checkInAt_idx" ON "StaffPresence"("dormitoryId", "checkInAt");

-- CreateIndex
CREATE INDEX "StaffPresence_userId_checkInAt_idx" ON "StaffPresence"("userId", "checkInAt");

-- CreateIndex
CREATE INDEX "LeaveRequest_universityId_status_idx" ON "LeaveRequest"("universityId", "status");

-- CreateIndex
CREATE INDEX "LeaveRequest_dormitoryId_status_idx" ON "LeaveRequest"("dormitoryId", "status");

-- CreateIndex
CREATE INDEX "LeaveRequest_requesterId_idx" ON "LeaveRequest"("requesterId");

-- CreateIndex
CREATE INDEX "DormReport_dormitoryId_occurredAt_idx" ON "DormReport"("dormitoryId", "occurredAt");

-- CreateIndex
CREATE INDEX "DormReport_universityId_status_idx" ON "DormReport"("universityId", "status");

-- CreateIndex
CREATE INDEX "Referral_universityId_status_idx" ON "Referral"("universityId", "status");

-- CreateIndex
CREATE INDEX "Referral_dormitoryId_status_idx" ON "Referral"("dormitoryId", "status");

-- CreateIndex
CREATE INDEX "Referral_reportedById_idx" ON "Referral"("reportedById");

-- CreateIndex
CREATE INDEX "PsychologistSchedule_dormitoryId_startsAt_idx" ON "PsychologistSchedule"("dormitoryId", "startsAt");

-- CreateIndex
CREATE INDEX "PsychologistSchedule_universityId_startsAt_idx" ON "PsychologistSchedule"("universityId", "startsAt");

-- CreateIndex
CREATE INDEX "MaintenanceRequest_universityId_status_idx" ON "MaintenanceRequest"("universityId", "status");

-- CreateIndex
CREATE INDEX "MaintenanceRequest_dormitoryId_status_idx" ON "MaintenanceRequest"("dormitoryId", "status");

-- CreateIndex
CREATE INDEX "MaintenanceEvent_requestId_createdAt_idx" ON "MaintenanceEvent"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_entity_entityId_idx" ON "Attachment"("entity", "entityId");

-- CreateIndex
CREATE INDEX "ChecklistTemplate_universityId_idx" ON "ChecklistTemplate"("universityId");

-- CreateIndex
CREATE INDEX "ChecklistReport_dormitoryId_date_idx" ON "ChecklistReport"("dormitoryId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistReport_templateId_reporterId_date_key" ON "ChecklistReport"("templateId", "reporterId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistResult_reportId_itemId_key" ON "ChecklistResult"("reportId", "itemId");

-- CreateIndex
CREATE INDEX "Mission_universityId_status_idx" ON "Mission"("universityId", "status");

-- CreateIndex
CREATE INDEX "Mission_assigneeId_status_idx" ON "Mission"("assigneeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_universityId_name_key" ON "MessageTemplate"("universityId", "name");

-- CreateIndex
CREATE INDEX "MessageBatch_universityId_createdAt_idx" ON "MessageBatch"("universityId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageBatch_senderId_createdAt_idx" ON "MessageBatch"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageBatch_status_scheduledAt_idx" ON "MessageBatch"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "MessageRecipient_batchId_idx" ON "MessageRecipient"("batchId");

-- CreateIndex
CREATE INDEX "MessageRecipient_smsStatus_nextAttemptAt_idx" ON "MessageRecipient"("smsStatus", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "MessageRecipient_userId_createdAt_idx" ON "MessageRecipient"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageRecipient_dormitoryId_idx" ON "MessageRecipient"("dormitoryId");

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentLeave" ADD CONSTRAINT "StudentLeave_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_dormitoryId_fkey" FOREIGN KEY ("dormitoryId") REFERENCES "Dormitory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPresence" ADD CONSTRAINT "StaffPresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPresence" ADD CONSTRAINT "StaffPresence_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DormReport" ADD CONSTRAINT "DormReport_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsychologistSchedule" ADD CONSTRAINT "PsychologistSchedule_dormitoryId_fkey" FOREIGN KEY ("dormitoryId") REFERENCES "Dormitory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_dormitoryId_fkey" FOREIGN KEY ("dormitoryId") REFERENCES "Dormitory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceEvent" ADD CONSTRAINT "MaintenanceEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaintenanceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistReport" ADD CONSTRAINT "ChecklistReport_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistReport" ADD CONSTRAINT "ChecklistReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistResult" ADD CONSTRAINT "ChecklistResult_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ChecklistReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistResult" ADD CONSTRAINT "ChecklistResult_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ChecklistItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageRecipient" ADD CONSTRAINT "MessageRecipient_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MessageBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageRecipient" ADD CONSTRAINT "MessageRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
