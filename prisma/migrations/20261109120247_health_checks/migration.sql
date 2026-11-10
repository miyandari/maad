-- CreateEnum
CREATE TYPE "HealthFollowStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'HEALTH_LIAISON';

-- CreateTable
CREATE TABLE "HealthItem" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthInspection" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "dormitoryId" TEXT NOT NULL,
    "inspectorId" TEXT NOT NULL,
    "inspectedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthResult" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "dormitoryId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "itemTitle" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "description" TEXT,
    "followStatus" "HealthFollowStatus",
    "actionTaken" TEXT,
    "obstacles" TEXT,
    "followUpById" TEXT,
    "followUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HealthItem_universityId_order_idx" ON "HealthItem"("universityId", "order");

-- CreateIndex
CREATE INDEX "HealthInspection_dormitoryId_inspectedAt_idx" ON "HealthInspection"("dormitoryId", "inspectedAt");

-- CreateIndex
CREATE INDEX "HealthInspection_universityId_inspectedAt_idx" ON "HealthInspection"("universityId", "inspectedAt");

-- CreateIndex
CREATE INDEX "HealthResult_dormitoryId_followStatus_idx" ON "HealthResult"("dormitoryId", "followStatus");

-- CreateIndex
CREATE INDEX "HealthResult_universityId_followStatus_idx" ON "HealthResult"("universityId", "followStatus");

-- CreateIndex
CREATE INDEX "HealthResult_inspectionId_idx" ON "HealthResult"("inspectionId");

-- AddForeignKey
ALTER TABLE "HealthInspection" ADD CONSTRAINT "HealthInspection_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthResult" ADD CONSTRAINT "HealthResult_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "HealthInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
