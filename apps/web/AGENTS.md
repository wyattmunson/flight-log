# apps/web (agent notes)

Vite 5 + React 18 + React Router 7 + TanStack Query 5 + Tailwind 3 (`darkMode: 'media'`) +
Recharts 2 + maplibre-gl 6. Root rules in [`/AGENTS.md`](../../AGENTS.md) apply.

## Layout

```
src/main.tsx           QueryClient (no retry on 4xx; global 401 handler), BrowserRouter
src/App.tsx            routes; /login is public, everything else sits under <RequireAuth>;
                       MapPage and StatsPage are React.lazy (MapLibre/Recharts are heavy)
src/api/client.ts      apiFetch() + ApiError (fieldErrors from validation details)
src/api/hooks.ts       every query/mutation hook; mutations invalidate all flight-derived keys
src/lib/               auth.ts (safeNextPath, loginPath, handleUnauthorized), format.ts (display helpers), useFilters.ts (URL-backed filters),
                       useChartTheme.ts (resolved CSS color tokens), useDebounced.ts
src/components/        Layout (nav + attribution footer), FilterBar, Combobox (ARIA typeahead),
                       Drawer (dialog), States (Spinner/ErrorState/EmptyState/NoFlightsYet),
                       FlightDetail, FlightMap, SortableTable, charts (ChartCard/HBarChart/ColumnChart/TimeLine)
src/pages/             MapPage, FlightsPage (+ drawer via ?flight=<id>), FlightFormPage (new + :id/edit),
                       ImportPage, StatsPage
test/                  Vitest + React Testing Library (jsdom)
```

## Rules

- **Data access only through `src/api/hooks.ts`.** Add a hook there; don't call `fetch` in components.
  Any mutation that changes flights must pass the function returned by the module-private
  `useInvalidateFlightData()` as its `onSuccess`, so the map, stats, list, filter options and
  import history all refresh.
- **Types come from `@flight-log/shared`.** Don't redeclare API shapes.
- **Filters live in the URL** (`useFilters`: `yearFrom`, `yearTo`, `airline`, `cabin`). The flights
  list adds `page`, `sort`, `q`, `flight`. Keep views shareable and reload-safe.
- **Every data view needs loading, error (`ErrorState` with retry) and empty states.** Charts get
  theirs from `ChartCard`'s `empty` prop.
- **Accessibility:** real `<button>`/`<label>`, `aria-sort` on sortable headers, `aria-label` on
  unlabeled controls, keyboard-operable comboboxes. Don't convey meaning by color alone.
- **Privacy:** only `FlightDetailView` and the edit form show PNR and seat.
- **Time display:** use `formatLocalTime(utc, airport.timezone)` / `toLocalParts` (shared). The zone
  rule for arrival _actuals_ (diversion airport) must match the API. See `zoneFor` in
  `FlightFormPage.tsx` and in `FlightDetail.tsx`.

## Auth

- `useMe` / `useLogin` / `useLogout` / `useChangePassword` are in `hooks.ts`. Login and logout clear the whole
  query cache. `RequireAuth` shows the Spinner while `/auth/me` loads, sends a 401 to `/login?next=…`, and
  renders the app with no login UI when `authRequired` is false.
- Decide "signed in" from `me.status === 'success'`, never `me.data`: after a failed re-check TanStack Query
  keeps the old `data` beside the error, which caused a login <-> guard redirect loop.
- Any `next` target must go through `safeNextPath()` (single leading `/`, no `//`, no backslash).
- The dev proxy keeps `changeOrigin: false`, so the API's CSRF check sees the browser's `Host`.

## Charts (dataviz conventions)

- Colors come from CSS tokens in `src/index.css` (`--series-*`, `--chart-*`, `--map-*`), which have
  separate light and dark values, read via `useChartTheme()`. Never hard-code hex in chart code.
- Single-series charts use `--series-1` and no legend. With two or more series, add a legend, assign
  hues in fixed slot order (never by rank) and use no dual axes.
- Prefer horizontal bars for ranked categories and a linear line for time series. Pie charts are
  deliberately not used. Offer a table view (`ChartCard table=`) for anything non-trivial.

## Map (`components/FlightMap.tsx`)

- **Keep `maplibregl.setWorkerUrl(workerUrl)`** (imported via `?worker&url`) and `worker.format: 'es'`
  in `vite.config.ts`. Without them, MapLibre 6's worker fails under Vite pre-bundling.
- Keep the `ResizeObserver → map.resize()`. The container is laid out after the map is created.
- Route paths arrive precomputed with **unwrapped longitudes** (may exceed ±180). Don't normalize
  them. `boundsOf()` picks the view from the largest empty longitude gap.
- Sources/layers are added on `load`. Effects must check `getSource`/`getLayer` exist
  (StrictMode/HMR remounts). Popups use `setDOMContent`, never `setHTML`.
- The style URL comes from `/api/config` (`MAP_STYLE_URL`), not a Vite env var.
