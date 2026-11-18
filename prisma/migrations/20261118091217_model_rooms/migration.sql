-- CreateTable
CREATE TABLE "ModelRoomCriterion" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "order" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelRoomCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomScore" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "dormitoryId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "criterionId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "scoredById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelRoomSelection" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "dormitoryId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "breakdown" JSONB NOT NULL,
    "note" TEXT,
    "selectedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelRoomSelection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelRoomCriterion_universityId_order_idx" ON "ModelRoomCriterion"("universityId", "order");

-- CreateIndex
CREATE INDEX "RoomScore_dormitoryId_year_idx" ON "RoomScore"("dormitoryId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "RoomScore_roomId_year_criterionId_key" ON "RoomScore"("roomId", "year", "criterionId");

-- CreateIndex
CREATE INDEX "ModelRoomSelection_universityId_year_idx" ON "ModelRoomSelection"("universityId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "ModelRoomSelection_dormitoryId_year_key" ON "ModelRoomSelection"("dormitoryId", "year");
