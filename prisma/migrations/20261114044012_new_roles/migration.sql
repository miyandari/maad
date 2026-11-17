/*
  Warnings:

  - You are about to drop the `PsychologistSchedule` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'PSYCHOLOGIST';
ALTER TYPE "Role" ADD VALUE 'FACILITIES';
ALTER TYPE "Role" ADD VALUE 'GENERAL_AFFAIRS';

-- DropForeignKey
ALTER TABLE "PsychologistSchedule" DROP CONSTRAINT "PsychologistSchedule_dormitoryId_fkey";

-- AlterTable
ALTER TABLE "MaintenanceRequest" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedToId" TEXT;

-- AlterTable
ALTER TABLE "Referral" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedPsychologistId" TEXT,
ADD COLUMN     "supervisorFeedback" TEXT;

-- AlterTable
ALTER TABLE "StaffPresence" ADD COLUMN     "scheduleId" TEXT;

-- DropTable
DROP TABLE "PsychologistSchedule";

-- CreateTable
CREATE TABLE "PsychSchedule" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "dormitoryId" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "validFrom" DATE,
    "validTo" DATE,
    "location" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PsychSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralSession" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "heldAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "recommendation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PsychSchedule_universityId_isActive_idx" ON "PsychSchedule"("universityId", "isActive");

-- CreateIndex
CREATE INDEX "PsychSchedule_psychologistId_idx" ON "PsychSchedule"("psychologistId");

-- CreateIndex
CREATE INDEX "PsychSchedule_dormitoryId_idx" ON "PsychSchedule"("dormitoryId");

-- CreateIndex
CREATE INDEX "ReferralSession_referralId_heldAt_idx" ON "ReferralSession"("referralId", "heldAt");

-- CreateIndex
CREATE INDEX "ReferralSession_psychologistId_heldAt_idx" ON "ReferralSession"("psychologistId", "heldAt");

-- AddForeignKey
ALTER TABLE "PsychSchedule" ADD CONSTRAINT "PsychSchedule_psychologistId_fkey" FOREIGN KEY ("psychologistId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsychSchedule" ADD CONSTRAINT "PsychSchedule_dormitoryId_fkey" FOREIGN KEY ("dormitoryId") REFERENCES "Dormitory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralSession" ADD CONSTRAINT "ReferralSession_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;
