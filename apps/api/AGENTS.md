# apps/api (agent notes)

Express 4 + Prisma 6, ESM, run with `tsx` (no build). Root rules in [`/AGENTS.md`](../../AGENTS.md)
apply; the rationale is in README → Design decisions.

## Layout and layering

```
src/index.ts          listen + graceful shutdown (imports ./env first: loads the root .env)
src/app.ts            createApp({ lookupProvider? }): middleware + router mounts. Tests call this.
src/env.ts            typed getters over process.env (read lazily, so tests can override)
src/db.ts             Prisma singleton
src/http/             errors.ts (AppError, errorHandler), route.ts (async wrapper), resolveUser.ts (sets req.userId),
                      csrf.ts (Origin / Sec-Fetch-Site guard, only when AUTH_REQUIRED), requestLog.ts
src/auth/             password.ts (scrypt), sessions.ts (DB sessions + cookie helpers), cookies.ts, throttle.ts,
                      users.ts (create/adopt/set-password), cli.ts (npm run user:create / user:set-password)
src/routes/           thin: Zod-parse input → call service/DAL → res.json. No Prisma here.
src/services/         derive.ts (UTC conversion, distance, air time), flights.ts (manual create/PATCH)
src/import/           columns.ts (header map) → parseRow.ts (pure) → service.ts (preview/commit) + previewStore.ts
src/dal/              ALL database access. User-owned: flights.ts, imports.ts, stats.ts, map.ts.
                      Global: reference.ts. Users/sessions: auth.ts. Shared: filters.ts, mappers.ts
src/lookup/           types.ts (FlightLookupProvider), providers/{nullProvider,stubProvider}.ts, registry.ts, service.ts (cache)
src/seed/             reference.ts (OurAirports/OpenFlights parse + insert), cli.ts
prisma/               schema.prisma + migrations (init migration has hand-written SQL at the end)
scripts/prisma.mjs    Prisma CLI wrapper that loads the root .env
test/unit/            no DB access (parseRow, columns, seed parsers, preview store)
test/integration/     supertest against createApp(); real Postgres (flightlog_test)
test/fixtures/        flighty-sample.csv (synthetic, 17 rows), reference.ts (test airports/airlines)
```

Request path: `requestLog → csrfGuard (/api) → express.json → resolveUser (/api/*) → router → errorHandler`.
`/api/health` is mounted before `resolveUser`; `POST /api/auth/login` and `/logout` are let through inside it.

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

## Auth

- `AUTH_REQUIRED`, `COOKIE_SECURE`, `TRUST_PROXY_HOPS`, `SESSION_TTL_DAYS` are lazy `env` getters; tests set
  `process.env.AUTH_REQUIRED` and must restore it. With it off everything acts as the default user.
- Only `resolveUser` sets `req.userId` (and `req.sessionId`). Never log or return passwords, hashes,
  tokens or cookies, and don't put the submitted email in an error. Session/user DB access is `dal/auth.ts`.
- Cookie-authenticated tests send `Sec-Fetch-Site: same-origin` (or a matching `Origin`), or the CSRF
  guard answers 403. The login throttle lives in `authRouter()`, so each `createApp()` starts fresh.
- `PATCH /api/auth/me` changes only `displayName`, for `req.userId` (the schema is `.strict()`, so email or
  password fields are rejected). It also works with auth off, acting on the default user.
- Wrong _current_ password on `/api/auth/password` is a 400 on purpose: the web app treats every 401 as
  "session lost".

## Tests

- Integration tests share one database and run sequentially (`fileParallelism: false`). Call
  `resetUserData()` in `beforeEach`/`beforeAll`; reference data comes from `test/fixtures/reference.ts`
  (loaded in `globalSetup.ts`), not the real downloads.
- Use `api({ lookupProvider })` to inject a provider. Don't rely on `FLIGHT_API_PROVIDER` in tests.
- Stats expectations are independent hand calculations (see the root AGENTS.md gotcha).
