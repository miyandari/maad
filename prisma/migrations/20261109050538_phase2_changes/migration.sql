/*
  Warnings:

  - You are about to drop the column `areaSqm` on the `Dormitory` table. All the data in the column will be lost.
  - You are about to drop the column `builtYear` on the `Dormitory` table. All the data in the column will be lost.
  - The `employmentType` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "DormitoryType" AS ENUM ('OWNED', 'RENTED', 'SELF_MANAGED_PARTNERSHIP', 'SELF_MANAGED');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('OFFICIAL', 'CONTRACT', 'CONTRACT_ARTICLE4', 'CORPORATE', 'HOURLY', 'PROJECT');

-- CreateEnum
CREATE TYPE "DegreeLevel" AS ENUM ('BACHELOR', 'MASTER', 'DOCTORATE_GENERAL', 'PHD');

-- CreateEnum
CREATE TYPE "GuardianRelation" AS ENUM ('FATHER', 'MOTHER');

-- CreateEnum
CREATE TYPE "EmergencyRelation" AS ENUM ('FRIEND', 'BROTHER', 'SISTER', 'RELATIVE');

-- AlterTable
ALTER TABLE "Dormitory" DROP COLUMN "areaSqm",
DROP COLUMN "builtYear",
ADD COLUMN     "address" TEXT,
ADD COLUMN     "ownershipType" "DormitoryType";

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "degree" "DegreeLevel",
ADD COLUMN     "emergencyContactRelation" "EmergencyRelation",
ADD COLUMN     "guardianPhone" TEXT,
ADD COLUMN     "guardianRelation" "GuardianRelation",
ADD COLUMN     "landline" TEXT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "employmentType",
ADD COLUMN     "employmentType" "EmploymentType";

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdempotencyKey_createdAt_idx" ON "IdempotencyKey"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_userId_key_key" ON "IdempotencyKey"("userId", "key");
