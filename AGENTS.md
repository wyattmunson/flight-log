# AGENTS.md

Operating guide for coding agents working in this repo. **Humans: start with [README.md](README.md)**.
It holds the rationale (Design decisions), component overview, roadmap and how-tos that this file
only points to. Workspace-specific rules live in `apps/api/AGENTS.md`, `apps/web/AGENTS.md` and
`packages/shared/AGENTS.md`. Read the one for the area you're changing.

## What this is

Personal flight log: import a Flighty CSV (preview → commit → undo) or add flights by hand, then view
them on a MapLibre great-circle map and a stats dashboard. Optional email + password login
(`AUTH_REQUIRED`, off locally, on in production; README → Authentication). **Phase 1 is complete.** Phase 2 (live
flight lookups) has a provider seam but no real provider yet. See README → Roadmap.

TypeScript npm-workspaces monorepo:

| Path                            | Role                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared`               | Zod schemas, API response types, pure helpers (distance, great circle, normalization, time). Consumed as **TS source**, with no build step.                  |
| `apps/api`                      | Express 4 + Prisma 6 on Postgres 16, run with `tsx`. Layers: `routes → services/import/auth → dal → prisma`.                                                 |
| `apps/web`                      | Vite 5 + React 18 + React Router 7 + TanStack Query 5 + Tailwind 3 + Recharts 2 + maplibre-gl 6.                                                             |
| `docs/`                         | `data-model.md` (ERD, dedupe, derived values), `flight-data-api-analysis.md` (Phase 2 research).                                                             |
| `docker/`, `docker-compose.yml` | Dev stack: `db`, `api` (migrate → seed-if-empty → `tsx watch`), `web` (Vite, proxies `/api`).                                                                |
| `deploy/`                       | Production deploy to a single Lightsail k3s node: prod Dockerfiles, Kustomize manifests (CloudNativePG, Traefik), bootstrap scripts. See `deploy/README.md`. |

## Commands

```bash
docker compose up -d db                      # Postgres on localhost:5434 (needed by API tests)
npm run lint && npm run typecheck && npm test # the full gate: run before calling work done
npm run format                               # Prettier (also rewrites Markdown tables)
npm test --workspace @flight-log/api         # one workspace
npx vitest run test/unit/parseRow.test.ts    # one file (run from the workspace dir)
npm run prisma -w @flight-log/api -- migrate dev --create-only --name <change>   # new migration
npm run seed:reference                       # (re)seed airports/airlines + default user
docker compose up                            # whole app → http://localhost:5173
```

Host ports: web 5173, api **3001** (container port 3000), db **5434**. They come from the root `.env`
(copied from `.env.example`). The API and Prisma CLI load the root `.env` themselves. API integration
tests use the separate `flightlog_test` database (`TEST_DATABASE_URL`), never the dev DB.

## Invariants (don't break these)

1. **User scoping.** Every query on `flights` / `import_batches` goes through `apps/api/src/dal/*` and
   filters by `userId` (first argument). Routes read `req.userId`, **set only by
   `http/resolveUser.ts`** (nothing else may assign it; with `AUTH_REQUIRED` on it never falls back
   to the default user). Never query user-owned tables from a route or service directly.
2. **Privacy.** PNR and seat never appear in list responses (`FlightListItem`), search (`q`), stats,
   logs or error messages. They are only in `FlightDetail` / the edit form. Don't log request bodies.
3. **Times.** Store UTC `timestamptz`. Naive local inputs are converted with the airport's IANA zone
   via `zoneForField()` (origin for departure-side fields; destination for scheduled arrival;
   diversion airport, if any, for actual arrival). Web and API must agree. The web mirror is
   `zoneFor()` in `FlightFormPage.tsx`.
4. **Derived values are computed server-side** on every create/update (`services/derive.ts`):
   `distance_miles` (haversine to the diversion airport if present), `air_time_minutes`. Never
   accept them from clients.
5. **Dedupe has two mirrored implementations.** They must change together:
   - SQL: `UNIQUE(user_id, flighty_id)` plus the partial expression index `flights_dedupe_natural_key`
     (hand-written in `prisma/migrations/*_init/migration.sql`).
   - App: `naturalKey()` in `apps/api/src/import/parseRow.ts`.
6. **Filters have two mirrored implementations:** `filtersWhere()` (Prisma) and `filtersSql()` (raw
   SQL) in `apps/api/src/dal/filters.ts`. Map, stats and list must filter identically.
7. **"Flown" semantics.** Map, stats and records exclude canceled flights (`canceledFlights` is the
   only exception), and treat `COALESCE(diverted_to_airport_id, destination_airport_id)` as the
   arrival airport.
8. **Error shape:** `{ error: { code, message, details? } }` via `AppError` / `errorHandler`. The one
   deliberate exception is `POST /api/lookup` → 501 `{ configured: false, provider: null, error }`.
9. **Shared contracts.** Request schemas and response types live in `packages/shared`. If you change
   an API shape, change the type there and fix both sides. Don't define API types locally.
10. **Data hygiene.** Never commit `.env`, real flight exports, or `data/*` downloads. Test
    fixtures must be synthetic (`apps/api/test/fixtures/`).
11. **License.** The repo is under PolyForm Noncommercial 1.0.0 (`LICENSE.md`, `"license"` in every
    `package.json`). Keep `LICENSE.md` verbatim, including its `Required Notice:` line. Only add
    permissively licensed dependencies or code (MIT, ISC, BSD, Apache-2.0, CC0, …). No GPL/AGPL/LGPL
    or other copyleft: their terms conflict with the noncommercial restriction. Ask before adding
    anything else. New workspaces get the same `"license"` field.

12. **Auth secrets stay secret.** Passwords, password hashes, session tokens and cookies never appear in
    logs, error messages, error `details` or any response body, and neither does the submitted login
    email. Response types (`AuthMe` etc.) have no credential fields. Session tokens are stored only as a
    SHA-256 hash. New auth code follows the same rule as invariant 2: don't log bodies.
13. **Only `http/resolveUser.ts` sets `req.userId`.** With `AUTH_REQUIRED` on it takes the user from a
    valid session and answers 401 otherwise; it never falls back to `DEFAULT_USER_ID`. Public routes
    (`/api/health`, `POST /api/auth/login`, `/logout`) are the only exceptions and are listed there.

## Gotchas

- **Prisma migrations.** `prisma migrate dev` will propose `DROP INDEX` for
  `flights_dedupe_natural_key` and the `lower(...)` search indexes, because Prisma can't model them.
  Always use `--create-only`, delete those lines, then apply with `npm run db:migrate`.
- **Reference seeding only inserts** (`createMany … skipDuplicates`). It never updates existing
  airport/airline rows.
- **Docker `node_modules` is a named volume.** After changing dependencies, run
  `docker compose down && docker volume rm flight-log_node_modules && docker compose up --build`.
- **Pinned majors.** Don't bump React, Prisma, Zod, Tailwind, Vite, Express, Recharts or TypeScript
  majors as a side effect. Upgrades are a planned task (README → Roadmap).
  `npm audit` has one accepted advisory (`deepmerge-ts`, Prisma CLI only).
- **Import previews are in-memory** (single API process, 30-minute TTL). Restarting the API loses them.
  That's expected; the UI asks the user to re-upload.
- **Stats test values are hand-checked.** If you change the fixture CSV, recompute the expected stats
  independently (not by running the code under test), then update both
  `test/integration/stats.test.ts` and the README "Fixture stats" table.

## Change checklists

| Change                     | Touch                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New/changed API field      | `packages/shared/src/types.ts` (+ `schemas.ts` for inputs) → `dal/*` mapper → route → web usage → tests                                                                                                                                                                                                                 |
| New auth/account route     | Zod schema in `packages/shared` → `routes/auth.ts` (sensitive changes via `reauthenticate()`; sessions only via `auth/sessions.ts`, scoped by `req.userId`) → `openapi.ts` → hook in `hooks.ts` → tests in `auth.test.ts` (wrong password, other user, `AUTH_REQUIRED` on and off, no secrets/emails in bodies or logs) |
| New DB column              | `schema.prisma` → migration (`--create-only`, keep raw indexes) → DAL mappers → shared types → `docs/data-model.md`                                                                                                                                                                                                     |
| New endpoint               | `apps/api/src/routes/<area>.ts` (Zod-parse params/query/body, wrap in `route()`) → mount in `app.ts` → **document it in `apps/api/src/docs/openapi.ts`** (`docs.test.ts` fails if a route is undocumented) → hook in `apps/web/src/api/hooks.ts` → integration test                                                     |
| New aircraft family / rule | `AIRCRAFT_FAMILIES` in `packages/shared/src/aircraft.ts` (+ its test) → `npm run seed:aircraft-families` (assigns only types with no family yet)                                                                                                                                                                        |
| New stat                   | query in `dal/stats.ts` (use `baseCte`, `flown`) → `Stats` type → `StatsPage.tsx` (`ChartCard` with empty state) → assertion in `stats.test.ts`                                                                                                                                                                         |
| New filter                 | `FlightFiltersSchema` → `filtersWhere` **and** `filtersSql` → `useFilters` KEYS → `FilterBar`                                                                                                                                                                                                                           |
| New lookup provider        | README → "Adding a flight-lookup provider"; `apps/api/src/lookup/`                                                                                                                                                                                                                                                      |
| Docs                       | Behavior or assumption changes → README "Assumptions". Architecture/rationale → README "Design decisions". Agent rules → the relevant `AGENTS.md`.                                                                                                                                                                      |

## Definition of done

- `npm run lint && npm run typecheck && npm test` all pass, and `npm run format:check` is clean.
- For UI changes, look at the page in a browser (`npm run dev` or `docker compose up`), including a
  phone-width viewport, light and dark.
- Commits are small and logical. README / `docs/` / `AGENTS.md` are updated in the same change when
  behavior, architecture or conventions change.
