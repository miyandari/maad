-- AlterTable
ALTER TABLE "Dormitory" ADD COLUMN     "geofenceRadiusM" INTEGER NOT NULL DEFAULT 200;

-- AlterTable
ALTER TABLE "StaffPresence" ADD COLUMN     "checkInAccuracyM" INTEGER,
ADD COLUMN     "checkInDistanceM" INTEGER,
ADD COLUMN     "checkOutAccuracyM" INTEGER,
ADD COLUMN     "checkOutDistanceM" INTEGER,
ADD COLUMN     "closedById" TEXT;
