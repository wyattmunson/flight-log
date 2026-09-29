# packages/shared (agent notes)

Code shared by the API, the web app and the tests. Root rules in [`/AGENTS.md`](../../AGENTS.md) apply.

- **Consumed as TypeScript source** (`"exports": { ".": "./src/index.ts" }`). There is no build step;
  tsx, Vite and Vitest compile it. Export everything through `src/index.ts`, using `export type *`
  for `types.ts`.
- **Pure and isomorphic.** It runs in Node and the browser. No Node built-ins, DOM, Prisma or env
  access. Dependencies: `zod` and `luxon` only.
- **Every helper has unit tests** in `test/`. Time and geo helpers need edge cases (DST, date line,
  antimeridian, antipodes).

| File           | Contents                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `constants.ts` | Earth/Moon distances, mean radius, on-time threshold (15 min), `DEFAULT_USER_ID`                                                                                                           |
| `distance.ts`  | `haversineMiles`, `roundMiles` (0.1 mi, the stored precision), mi/km conversion                                                                                                            |
| `geo.ts`       | `greatCirclePoints` (**longitudes unwrapped** across ±180), `unwrapLongitudes`, `routeKey` (direction-independent)                                                                         |
| `normalize.ts` | `normalizeFlightNumber` (carrier + numeric part, no leading zeros), `normalizeCategory` (Title Case), airline/airport code classification, `parseBoolean`, `normalizeTailNumber`           |
| `time.ts`      | `parseFlightDate` (ISO first, then US-style), `parseFlightTime(value, zone)` (offset honored, else wall-clock in zone), `computeAirTimeMinutes`, `computeGateTimeMinutes`, display helpers |
| `schemas.ts`   | Zod request schemas (flight input/patch, filters, list query, lookup, import commit), time-field ↔ airport-side map                                                                        |
| `types.ts`     | API response types (list item vs detail, import preview/summary, map, stats, lookup, config)                                                                                               |

Changing a normalization rule changes dedupe keys and stats grouping. Check `naturalKey()` and the
SQL index (root AGENTS.md invariant 5), and note that existing rows are not re-normalized.
