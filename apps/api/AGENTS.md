# apps/api (agent notes)

Express 4 + Prisma 6, ESM, run with `tsx` (no build). Root rules in [`/AGENTS.md`](../../AGENTS.md)
apply; the rationale is in README → Design decisions.

## Layout and layering

```
src/index.ts          listen + graceful shutdown (imports ./env first: loads the root .env)
src/app.ts            createApp({ lookupProvider? }): middleware + router mounts. Tests call this.
src/env.ts            typed getters over process.env (read lazily, so tests can override)
src/db.ts             Prisma singleton
src/http/             errors.ts (AppError, errorHandler), route.ts (async wrapper), resolveUser.ts, requestLog.ts
src/routes/           thin: Zod-parse input → call service/DAL → res.json. No Prisma here.
src/services/         derive.ts (UTC conversion, distance, air time), flights.ts (manual create/PATCH)
src/import/           columns.ts (header map) → parseRow.ts (pure) → service.ts (preview/commit) + previewStore.ts
src/dal/              ALL database access. User-owned: flights.ts, imports.ts, stats.ts, map.ts.
                      Global: reference.ts. Shared: filters.ts, mappers.ts
src/lookup/           types.ts (FlightLookupProvider), providers/{nullProvider,stubProvider}.ts, registry.ts, service.ts (cache)
src/seed/             reference.ts (OurAirports/OpenFlights parse + insert), cli.ts
prisma/               schema.prisma + migrations (init migration has hand-written SQL at the end)
scripts/prisma.mjs    Prisma CLI wrapper that loads the root .env
test/unit/            no DB access (parseRow, columns, seed parsers, preview store)
test/integration/     supertest against createApp(); real Postgres (flightlog_test)
test/fixtures/        flighty-sample.csv (synthetic, 17 rows), reference.ts (test airports/airlines)
```

Request path: `requestLog → express.json → resolveUser (/api/*) → router → errorHandler`.

## Rules

- **Wrap every async handler in `route()`.** Express 4 doesn't forward rejected promises.
- **Validate at the edge:** `Schema.parse(req.query | req.params | req.body)`. A thrown `ZodError`
  becomes a 400 `validation_error` with `details: [{ path, message }]`, and the web form maps those
  paths to fields.
- **Throw `AppError(status, code, message, details?)`** (or `notFound()` / `badRequest()`) for
  expected failures. Unknown errors become a 500 and are logged without request data.
- **Raw SQL:** always use tagged `prisma.$queryRaw\`…\``/`Prisma.sql`, never string concatenation.
Compose with `filtersSql(userId, filters)`. `count()`/`sum()`come back as`bigint`/`Decimal`;
convert with `Number()`(see the`num()` helpers).
- **`distanceMiles` is `Decimal(8,1)`**: map it with `Number()` in DAL mappers.
- **Dates:** `flight_date` is a `DATE`; write `new Date('YYYY-MM-DDT00:00:00Z')`, read with `dateOnly()`.
- New user-owned queries go in `src/dal/` and take `userId` first. `updateMany`/`deleteMany` with
  `{ id, userId }` is how "not yours" becomes "not found".

## Import pipeline

1. `readFlightyCsv` stream-parses the upload (rejects NUL bytes, >20k rows, missing Date/From/To → 422).
2. `loadReferenceIndex` fetches only the airports/airlines referenced in the file, in a few queries,
   then builds in-memory maps. Ranking: large airports beat closed ones; active airlines beat defunct.
3. `parseRow` is **pure** (no I/O). Keep it that way so it stays unit-testable. Row errors get
   `{ line, column, message }`; warnings don't block import.
4. Dedupe: DB lookups for existing Flighty IDs / natural keys, plus in-file sets. Statuses:
   `new | duplicate | invalid`.
5. Commit (one transaction): batch row, aircraft-type upserts, `createMany({ skipDuplicates })`
   (ON CONFLICT DO NOTHING), counts. Then remember Flighty IDs on reference rows.

## Tests

- Integration tests share one database and run sequentially (`fileParallelism: false`). Call
  `resetUserData()` in `beforeEach`/`beforeAll`; reference data comes from `test/fixtures/reference.ts`
  (loaded in `globalSetup.ts`), not the real downloads.
- Use `api({ lookupProvider })` to inject a provider. Don't rely on `FLIGHT_API_PROVIDER` in tests.
- Stats expectations are independent hand calculations (see the root AGENTS.md gotcha).
