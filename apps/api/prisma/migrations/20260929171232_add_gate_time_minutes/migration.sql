-- AlterTable
ALTER TABLE "flights" ADD COLUMN     "gate_time_minutes" INTEGER;

-- Backfill: actual gate pair, else scheduled gate pair; NULL if not 0 < minutes <= 30h
-- (mirrors computeGateTimeMinutes in packages/shared/src/time.ts).
UPDATE "flights" SET "gate_time_minutes" = CASE
  WHEN round(extract(epoch FROM ("gate_arrival_actual" - "gate_departure_actual")) / 60) BETWEEN 1 AND 1800
    THEN round(extract(epoch FROM ("gate_arrival_actual" - "gate_departure_actual")) / 60)
  WHEN round(extract(epoch FROM ("gate_arrival_scheduled" - "gate_departure_scheduled")) / 60) BETWEEN 1 AND 1800
    THEN round(extract(epoch FROM ("gate_arrival_scheduled" - "gate_departure_scheduled")) / 60)
END;
