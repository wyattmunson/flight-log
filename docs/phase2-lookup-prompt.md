# Phase 2 prompt: automatic flight lookup on `/flights/new`

Drafted 2026-09-29. Paste the fenced block below into a fresh agent session.

**Open questions to settle before running it**

- **Card requirement.** AeroDataBox's pricing page lists RapidAPI/API.Market Basic as "Free (7-day trial)",
  400 units. One source said 600. Confirm the free plan is permanent and needs no card. If it needs a card,
  FlightAware AeroAPI Personal is the only other candidate (its card requirement is also unconfirmed, and
  it only covers about the last 10 days).
- **Accuracy caveats.** AeroDataBox is best-effort. Route, scheduled times and airline are reliable.
  Aircraft and tail are often present. Actual times, gate and terminal only exist where the airport has a
  live feed. Diversions have no known dedicated field (Step 0 checks this).

```
Implement Phase 2 flight lookup for /flights/new. Read AGENTS.md, apps/api/AGENTS.md,
apps/web/AGENTS.md and docs/flight-data-api-analysis.md first.

Already exists (extend, don't rebuild): FlightLookupProvider seam and registry
(apps/api/src/lookup/), read-through cache (service.ts, flight_lookup_cache),
POST /api/lookup, FlightLookupResult in packages/shared, useLookup hook, and a manual
"Look up flight" button (LookupButton in apps/web/src/pages/FlightFormPage.tsx).

GOAL
When the user enters a date and a flight number (airline optional if the number includes the
carrier code), query the external API automatically and prefill as much of the form as
possible. The user can still edit everything. After a successful prefill, move focus to the
"Add flight" submit button.

STEP 0 (blocking): verify the provider before coding
- Confirm AeroDataBox's current free plan on RapidAPI or API.Market: is it permanent or a
  7-day trial, the monthly units, cost of GET /flights/number/{n}/{date}, and whether a
  card is required. If it is not free, permanently, without a card, stop and ask me.
- With my key, make 5+ real calls (a flight today, one 3 days ago, one 60 days ago, a
  multi-leg number, a known diversion or cancellation, a small-airport flight). Save
  redacted payloads as synthetic fixtures under apps/api/test/fixtures/. Report which
  fields were populated in each case: scheduled/actual gate and runway times,
  aircraft model, registration, terminal/gate, status, and how a diversion appears.

API (apps/api)
1. providers/aeroDataBoxProvider.ts implementing FlightLookupProvider, registered in
   registry.ts as "aerodatabox". Key from AERODATABOX_RAPIDAPI_KEY (server-side only, add
   to .env.example and env.ts). Never send the key to the browser or log it.
2. Map the payload to FlightLookupResult: UTC ISO times, IATA airports, all legs of the
   flight number departing that local date, and the untouched payload in `raw`. Prefer
   airport-local times converted with the airport's IANA zone when the payload has no UTC
   value.
3. Diversions: if the payload shows a diversion, expose the diversion airport. If that
   needs a new field on FlightLookupResult, add it in packages/shared and update both sides.
4. Handle errors: 404/no data → empty results; 429/quota → distinct error code;
   timeout (~8 s) → retryable error. Follow the { error: { code, message } } shape
   (the 501 not-configured response stays as is). Don't log request bodies.
5. Keep the cache, but don't cache empty results for flights within the next 24 hours or
   already departed, since live data changes. Actuals should not be served stale.
6. Document any new endpoint in apps/api/src/docs/openapi.ts. Add unit tests (mapper on
   fixtures) and an integration test (cache hit/miss, quota error, no match).

Web (apps/web)
1. Trigger automatically (debounced ~600 ms) once date and a valid designator are both
   present. Only re-fire when date or designator changes. Keep the manual button as a
   retry. Cancel or ignore stale responses.
2. Don't overwrite fields the user has already edited. Only fill empty fields, or replace
   values that came from a previous lookup. Track which fields are lookup-sourced.
3. Multiple legs: if results.length > 1, show a small picker (origin → destination) and
   don't prefill until one is chosen.
4. On success, show "Prefilled from AeroDataBox · review before saving" (attribution is
   required by the free plan), then focus the "Add flight" button. Don't auto-submit. Keep
   the existing time-zone rules (zoneFor()), and only prefill actuals that are present.
5. States: loading (aria-live), no match, quota exceeded, lookup unavailable. All must be
   non-blocking, so the form works exactly as today.
6. Accessibility and layout: check phone width, light and dark. Follow the rules in
   apps/web/AGENTS.md (hooks only in api/hooks.ts, shared types only).

Constraints
- PNR and seat are never sent to the provider. Send only flight number and date.
- Add no dependencies unless permissively licensed. Don't bump pinned majors.
- Update README (Assumptions, Roadmap), docs/flight-data-api-analysis.md with the verified
  quota, cost per call and observed field coverage, and apps/api/AGENTS.md if conventions change.
- Definition of done: npm run lint && npm run typecheck && npm test && npm run format:check
  pass, and the flow is verified in the browser with a real lookup.

Report at the end: field coverage observed, quota used, and anything that surprised you.
```

## Sources

- AeroDataBox pricing: <https://aerodatabox.com/pricing/>
- AeroDataBox data coverage: <https://aerodatabox.com/data-coverage/>
- FlightAware AeroAPI: <https://www.flightaware.com/commercial/aeroapi/>
- AirLabs flight docs: <https://airlabs.co/docs/flight>
