-- AlterTable
ALTER TABLE "users" ADD COLUMN     "distance_unit" TEXT NOT NULL DEFAULT 'mi',
ADD COLUMN     "home_airport_id" INTEGER,
ADD COLUMN     "time_format" TEXT NOT NULL DEFAULT '12h';

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_home_airport_id_fkey" FOREIGN KEY ("home_airport_id") REFERENCES "airports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written (Prisma cannot model CHECK constraints): keep preference values to the known set.
ALTER TABLE "users" ADD CONSTRAINT "users_distance_unit_check" CHECK ("distance_unit" IN ('mi', 'km'));
ALTER TABLE "users" ADD CONSTRAINT "users_time_format_check" CHECK ("time_format" IN ('12h', '24h'));
