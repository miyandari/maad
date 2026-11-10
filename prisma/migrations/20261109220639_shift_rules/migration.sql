-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "overtimeMinutes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StaffPresence" ADD COLUMN     "checkOutNote" TEXT;

-- CreateTable
CREATE TABLE "ShiftSettings" (
    "universityId" TEXT NOT NULL,
    "startHour" INTEGER NOT NULL DEFAULT 14,
    "workdayEndHour" INTEGER NOT NULL DEFAULT 8,
    "holidayEndHour" INTEGER NOT NULL DEFAULT 14,
    "weeklyOffDays" INTEGER[] DEFAULT ARRAY[5]::INTEGER[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftSettings_pkey" PRIMARY KEY ("universityId")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_universityId_date_key" ON "Holiday"("universityId", "date");
