-- CreateTable
CREATE TABLE "Vehicle" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "plate" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRoute" (
    "id" SERIAL NOT NULL,
    "baseCity" TEXT NOT NULL DEFAULT 'Anápolis-GO',
    "departureAt" TEXT NOT NULL,
    "availableAt" TEXT NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRouteVehicle" (
    "id" SERIAL NOT NULL,
    "routeId" INTEGER NOT NULL,
    "vehicleId" INTEGER,
    "vehicleName" TEXT NOT NULL,
    "vehiclePlate" TEXT,
    "hasTrailer" BOOLEAN NOT NULL DEFAULT false,
    "trailerTrucada" BOOLEAN NOT NULL DEFAULT false,
    "trailerLengthMeters" DOUBLE PRECISION,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventRouteVehicle_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "routeId" INTEGER;

-- CreateIndex
CREATE INDEX "Event_routeId_idx" ON "Event"("routeId");

-- CreateIndex
CREATE INDEX "EventRouteVehicle_routeId_idx" ON "EventRouteVehicle"("routeId");

-- CreateIndex
CREATE INDEX "EventRouteVehicle_vehicleId_idx" ON "EventRouteVehicle"("vehicleId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "EventRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRouteVehicle" ADD CONSTRAINT "EventRouteVehicle_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "EventRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRouteVehicle" ADD CONSTRAINT "EventRouteVehicle_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
