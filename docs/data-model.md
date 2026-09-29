# Data model

Source of truth: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma) plus the hand-written
SQL at the end of the init migration. Tables use snake_case; Prisma models use camelCase fields.

```mermaid
erDiagram
  users ||--o{ flights : owns
  users ||--o{ import_batches : owns
  import_batches |o--o{ flights : "created (nullable)"
  airports ||--o{ flights : "origin"
  airports ||--o{ flights : "destination"
  airports |o--o{ flights : "diverted_to"
  airlines |o--o{ flights : "airline (nullable)"
  aircraft_families |o--o{ aircraft_types : "family (nullable)"
  aircraft_types |o--o{ flights : "aircraft (nullable)"

  users {
    uuid id PK
    text email UK "nullable"
    text display_name
    timestamptz created_at
  }
  airports {
    int id PK "OurAirports id"
    text ident
    text iata_code "indexed"
    text icao_code "indexed"
    text name
    text municipality
    text iso_country
    text iso_region
    float latitude
    float longitude
    int elevation_ft
    text type "large_airport, closed, ..."
    text timezone "IANA, via tz-lookup"
    text flighty_id "filled on import"
  }
  airlines {
    int id PK "OpenFlights id"
    text name
    text iata_code "indexed"
    text icao_code "indexed"
    text callsign
    text country
    bool active
    text flighty_id
  }
  aircraft_types {
    int id PK
    text name UK
    text icao_code
    text flighty_id UK
    int aircraft_family_id FK
  }
  aircraft_families {
    int id PK
    text name UK
    text manufacturer
  }
  flights {
    uuid id PK
    uuid user_id FK
    text flighty_id "dedupe rule 1"
    uuid import_batch_id FK
    enum source "flighty_csv | manual | api"
    date flight_date "local departure date"
    int airline_id FK
    text airline_name_raw
    text flight_number "numeric part, e.g. 837"
    int origin_airport_id FK
    int destination_airport_id FK
    int diverted_to_airport_id FK
    bool canceled
    timestamptz gate_departure_scheduled
    timestamptz gate_departure_actual
    timestamptz takeoff_scheduled
    timestamptz takeoff_actual
    timestamptz landing_scheduled
    timestamptz landing_actual
    timestamptz gate_arrival_scheduled
    timestamptz gate_arrival_actual
    text dep_terminal
    text dep_gate
    text arr_terminal
    text arr_gate
    int aircraft_type_id FK
    text tail_number
    text pnr "sensitive: detail view only"
    text seat
    text seat_type "normalized"
    text cabin_class "normalized"
    text flight_reason "normalized"
    text notes
    numeric distance_miles "derived"
    int air_time_minutes "derived"
    int gate_time_minutes "derived"
    int cruise_altitude_ft "phase 2"
    int max_altitude_ft "phase 2"
    int ground_speed_kts "phase 2"
    text lookup_source "phase 2"
    timestamptz lookup_fetched_at "phase 2"
    jsonb source_raw "whole CSV row"
    timestamptz created_at
    timestamptz updated_at
  }
  import_batches {
    uuid id PK
    uuid user_id FK
    text filename
    text file_sha256
    enum status "committed | undone"
    int total
    int imported
    int duplicates
    int failed
    jsonb errors
    timestamptz created_at
  }
  flight_lookup_cache {
    int id PK
    text provider "unique with next two"
    text flight_number "e.g. UA837"
    date flight_date
    jsonb response
    timestamptz fetched_at
  }
```

## Ownership and scoping

`flights` and `import_batches` carry `user_id`. All access goes through `apps/api/src/dal/*`, and
every function there takes `userId` first and filters by it. Raw-SQL aggregates (stats, map) build
their `WHERE` from `filtersSql(userId, …)`. `req.userId` is set by a single middleware
(`apps/api/src/http/resolveUser.ts`), which returns the seeded default user in Phase 1.

Reference tables (`airports`, `airlines`, `aircraft_types`, `aircraft_families`, `flight_lookup_cache`) are global.

## Dedupe

| Rule | When                 | Enforced by                                                                                                                                                                                                                                                        |
| ---- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `flighty_id` present | `UNIQUE (user_id, flighty_id)`. Postgres treats NULLs as distinct, so this behaves like a partial index on non-null IDs.                                                                                                                                           |
| 2    | `flighty_id` is NULL | Partial expression index `flights_dedupe_natural_key` on `(user_id, flight_date, COALESCE(airline_id::text, 'raw:' ‖ lower(btrim(airline_name_raw)), ''), COALESCE(upper(flight_number), ''), origin_airport_id, destination_airport_id) WHERE flighty_id IS NULL` |

The application mirrors rule 2 in `naturalKey()` (`apps/api/src/import/parseRow.ts`) so the import
preview can report duplicates before anything is written. Commit uses `INSERT … ON CONFLICT DO
NOTHING` (Prisma `createMany({ skipDuplicates: true })`), so duplicates that appear between preview
and commit are skipped rather than failing the batch. A manual create that hits rule 2 returns
`409 conflict`.

> ⚠️ Prisma can't express partial or expression indexes. When you generate a new migration with
> `prisma migrate dev`, **review the SQL**: Prisma will propose dropping `flights_dedupe_natural_key`
> and the `lower(...)` search indexes. Delete those `DROP INDEX` lines.

## Derived values

- `distance_miles`: haversine, statute miles, mean Earth radius 3,958.7613 mi, rounded to 0.1 mi,
  from origin to the **diversion airport if present**, otherwise the destination
  (`packages/shared/src/distance.ts`). Recomputed on every create/update.
- `air_time_minutes`: `takeoff_actual → landing_actual`, else `takeoff_scheduled → landing_scheduled`,
  else NULL. Negative or > 30 h results are treated as NULL.
- `gate_time_minutes`: `gate_departure_actual → gate_arrival_actual`, else the scheduled gate pair,
  else NULL (same bounds; `computeGateTimeMinutes`). The migration backfilled existing rows.
- `aircraft_types.aircraft_family_id`: **computed**, since no data source provides it.
  `classifyAircraftFamily()` (`packages/shared/src/aircraft.ts`) applies ordered rules to the type
  name and yields a marketing family such as "Boeing 777" (all 777 variants), "Boeing 737" (Classic,
  NG and MAX) or "Airbus A320" (A318–A321, ceo and neo). A type no rule matches keeps a NULL family
  and shows as "Unknown" in stats. Families are assigned when a type is first created (import or
  manual entry) and by `npm run seed:aircraft-families` (also run on every `docker compose up`),
  which creates the family rows and fills in any type without one. It never overwrites an existing
  assignment, so a manual correction sticks; after changing a rule, null the affected rows and re-run it.
- Times are stored as UTC `timestamptz`. Naive local inputs (CSV cells or form fields without an
  offset) are interpreted in the relevant airport's IANA zone:

  | Field                                        | Zone                                           |
  | -------------------------------------------- | ---------------------------------------------- |
  | gate departure, takeoff (scheduled + actual) | origin                                         |
  | landing, gate arrival (scheduled)            | destination                                    |
  | landing, gate arrival (actual)               | diversion airport if present, else destination |

## Normalization

- `cabin_class`, `seat_type`, `flight_reason`: trimmed, `_`/`-` → space, title-cased
  (`PREMIUM_ECONOMY` → `Premium Economy`), so they group cleanly in stats.
- `flight_number`: the numeric designator without carrier or leading zeros (`AA 0100` → `100`). The
  carrier prefix is used only to resolve the airline.
- `tail_number`: upper-cased, spaces removed. `seat`: upper-cased.
