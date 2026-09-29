-- AlterTable
ALTER TABLE "aircraft_types" ADD COLUMN     "aircraft_family_id" INTEGER;

-- CreateTable
CREATE TABLE "aircraft_families" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,

    CONSTRAINT "aircraft_families_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "aircraft_families_name_key" ON "aircraft_families"("name");

-- CreateIndex
CREATE INDEX "aircraft_types_aircraft_family_id_idx" ON "aircraft_types"("aircraft_family_id");

-- AddForeignKey
ALTER TABLE "aircraft_types" ADD CONSTRAINT "aircraft_types_aircraft_family_id_fkey" FOREIGN KEY ("aircraft_family_id") REFERENCES "aircraft_families"("id") ON DELETE SET NULL ON UPDATE CASCADE;
