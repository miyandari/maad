-- CreateEnum
CREATE TYPE "LateKind" AS ENUM ('EXCUSED', 'UNEXCUSED');

-- CreateTable
CREATE TABLE "LateArrival" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "dormitoryId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "arrivedAt" TIMESTAMP(3),
    "kind" "LateKind" NOT NULL,
    "reason" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guardianNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "LateArrival_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LateArrival_dormitoryId_date_idx" ON "LateArrival"("dormitoryId", "date");

-- CreateIndex
CREATE INDEX "LateArrival_studentId_kind_guardianNotifiedAt_idx" ON "LateArrival"("studentId", "kind", "guardianNotifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LateArrival_studentId_date_key" ON "LateArrival"("studentId", "date");

-- AddForeignKey
ALTER TABLE "LateArrival" ADD CONSTRAINT "LateArrival_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
