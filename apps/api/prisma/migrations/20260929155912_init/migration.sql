-- CreateEnum
CREATE TYPE "FlightSource" AS ENUM ('flighty_csv', 'manual', 'api');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('committed', 'undone');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "airports" (
    "id" INTEGER NOT NULL,
    "ident" TEXT NOT NULL,
    "iata_code" TEXT,
    "icao_code" TEXT,
    "name" TEXT NOT NULL,
    "municipality" TEXT,
    "iso_country" TEXT,
    "iso_region" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "elevation_ft" INTEGER,
    "type" TEXT NOT NULL,
    "timezone" TEXT,
    "flighty_id" TEXT,

    CONSTRAINT "airports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "airlines" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "iata_code" TEXT,
    "icao_code" TEXT,
    "callsign" TEXT,
    "country" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "flighty_id" TEXT,

    CONSTRAINT "airlines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aircraft_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "icao_code" TEXT,
    "flighty_id" TEXT,

    CONSTRAINT "aircraft_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flights" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "flighty_id" TEXT,
    "import_batch_id" UUID,
    "source" "FlightSource" NOT NULL,
    "flight_date" DATE NOT NULL,
    "airline_id" INTEGER,
    "airline_name_raw" TEXT,
    "flight_number" TEXT,
    "origin_airport_id" INTEGER NOT NULL,
    "destination_airport_id" INTEGER NOT NULL,
    "diverted_to_airport_id" INTEGER,
    "canceled" BOOLEAN NOT NULL DEFAULT false,
    "gate_departure_scheduled" TIMESTAMPTZ(6),
    "gate_departure_actual" TIMESTAMPTZ(6),
    "takeoff_scheduled" TIMESTAMPTZ(6),
    "takeoff_actual" TIMESTAMPTZ(6),
    "landing_scheduled" TIMESTAMPTZ(6),
    "landing_actual" TIMESTAMPTZ(6),
    "gate_arrival_scheduled" TIMESTAMPTZ(6),
    "gate_arrival_actual" TIMESTAMPTZ(6),
    "dep_terminal" TEXT,
    "dep_gate" TEXT,
    "arr_terminal" TEXT,
    "arr_gate" TEXT,
    "aircraft_type_id" INTEGER,
    "tail_number" TEXT,
    "pnr" TEXT,
    "seat" TEXT,
    "seat_type" TEXT,
    "cabin_class" TEXT,
    "flight_reason" TEXT,
    "notes" TEXT,
    "distance_miles" DECIMAL(8,1) NOT NULL,
    "air_time_minutes" INTEGER,
    "cruise_altitude_ft" INTEGER,
    "max_altitude_ft" INTEGER,
    "ground_speed_kts" INTEGER,
    "lookup_source" TEXT,
    "lookup_fetched_at" TIMESTAMPTZ(6),
    "source_raw" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "flights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'committed',
    "total" INTEGER NOT NULL,
    "imported" INTEGER NOT NULL,
    "duplicates" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flight_lookup_cache" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "flight_number" TEXT NOT NULL,
    "flight_date" DATE NOT NULL,
    "response" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flight_lookup_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "airports_iata_code_idx" ON "airports"("iata_code");

-- CreateIndex
CREATE INDEX "airports_icao_code_idx" ON "airports"("icao_code");

-- CreateIndex
CREATE INDEX "airports_flighty_id_idx" ON "airports"("flighty_id");

-- CreateIndex
CREATE INDEX "airlines_iata_code_idx" ON "airlines"("iata_code");

-- CreateIndex
CREATE INDEX "airlines_icao_code_idx" ON "airlines"("icao_code");

-- CreateIndex
CREATE INDEX "airlines_flighty_id_idx" ON "airlines"("flighty_id");

-- CreateIndex
CREATE UNIQUE INDEX "aircraft_types_name_key" ON "aircraft_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "aircraft_types_flighty_id_key" ON "aircraft_types"("flighty_id");

-- CreateIndex
CREATE INDEX "flights_user_id_flight_date_idx" ON "flights"("user_id", "flight_date");

-- CreateIndex
CREATE INDEX "flights_import_batch_id_idx" ON "flights"("import_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "flights_user_flighty_id_key" ON "flights"("user_id", "flighty_id");

-- CreateIndex
CREATE INDEX "import_batches_user_id_created_at_idx" ON "import_batches"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "flight_lookup_cache_provider_flight_number_flight_date_key" ON "flight_lookup_cache"("provider", "flight_number", "flight_date");

-- AddForeignKey
ALTER TABLE "flights" ADD CONSTRAINT "flights_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flights" ADD CONSTRAINT "flights_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flights" ADD CONSTRAINT "flights_airline_id_fkey" FOREIGN KEY ("airline_id") REFERENCES "airlines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flights" ADD CONSTRAINT "flights_origin_airport_id_fkey" FOREIGN KEY ("origin_airport_id") REFERENCES "airports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flights" ADD CONSTRAINT "flights_destination_airport_id_fkey" FOREIGN KEY ("destination_airport_id") REFERENCES "airports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flights" ADD CONSTRAINT "flights_diverted_to_airport_id_fkey" FOREIGN KEY ("diverted_to_airport_id") REFERENCES "airports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flights" ADD CONSTRAINT "flights_aircraft_type_id_fkey" FOREIGN KEY ("aircraft_type_id") REFERENCES "aircraft_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written (Prisma cannot express partial or expression indexes).
-- Keep these when generating future migrations: `prisma migrate dev` will
-- propose dropping them because they are absent from schema.prisma.
-- ---------------------------------------------------------------------------

-- Dedupe rule 2: flights without a Flighty ID are unique per user on
-- (date, airline id or normalized raw name, flight number, origin, destination).
CREATE UNIQUE INDEX "flights_dedupe_natural_key"
  ON "flights" (
    "user_id",
    "flight_date",
    (COALESCE("airline_id"::text, 'raw:' || lower(btrim("airline_name_raw")), '')),
    (COALESCE(upper("flight_number"), '')),
    "origin_airport_id",
    "destination_airport_id"
  )
  WHERE "flighty_id" IS NULL;

-- Case-insensitive typeahead on reference data.
CREATE INDEX "airports_name_lower_idx" ON "airports" (lower("name"));
CREATE INDEX "airports_municipality_lower_idx" ON "airports" (lower("municipality"));
CREATE INDEX "airlines_name_lower_idx" ON "airlines" (lower("name"));
