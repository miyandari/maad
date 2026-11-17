-- CreateEnum
CREATE TYPE "RequestScope" AS ENUM ('ROOM', 'DORMITORY');

-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('PRAISE', 'SUGGESTION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MaintenanceStatus" ADD VALUE 'PENDING_REP';
ALTER TYPE "MaintenanceStatus" ADD VALUE 'PENDING_SUPERVISOR';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'STUDENT';

-- DropForeignKey
ALTER TABLE "MaintenanceRequest" DROP CONSTRAINT "MaintenanceRequest_requestedById_fkey";

-- AlterTable
ALTER TABLE "MaintenanceRequest" ADD COLUMN     "rejectedByRep" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requestedByStudentId" TEXT,
ADD COLUMN     "roomId" TEXT,
ADD COLUMN     "scope" "RequestScope" NOT NULL DEFAULT 'DORMITORY',
ADD COLUMN     "supporters" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "urgent" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "requestedById" DROP NOT NULL;

-- CreateTable
CREATE TABLE "RequestSupport" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestSupport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentOtp" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentOtp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouncilRep" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "dormitoryId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "appointedById" TEXT NOT NULL,

    CONSTRAINT "CouncilRep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffFeedback" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "dormitoryId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "kind" "FeedbackKind" NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequestSupport_requestId_studentId_key" ON "RequestSupport"("requestId", "studentId");

-- CreateIndex
CREATE INDEX "StudentOtp_studentId_createdAt_idx" ON "StudentOtp"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "CouncilRep_dormitoryId_endedAt_idx" ON "CouncilRep"("dormitoryId", "endedAt");

-- CreateIndex
CREATE INDEX "CouncilRep_studentId_idx" ON "CouncilRep"("studentId");

-- CreateIndex
CREATE INDEX "StaffFeedback_universityId_createdAt_idx" ON "StaffFeedback"("universityId", "createdAt");

-- CreateIndex
CREATE INDEX "StaffFeedback_targetUserId_idx" ON "StaffFeedback"("targetUserId");

-- AddForeignKey
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestSupport" ADD CONSTRAINT "RequestSupport_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaintenanceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
