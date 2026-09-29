# Flight-data API analysis (Phase 2 research)

**Goal:** given a flight number and a departure date, fetch scheduled + actual times, aircraft type, tail
number and (ideally) altitude, to prefill the add-flight form and enrich imported flights.

**Checked:** 2026-09-29, via each provider's pricing/docs pages and web search. Pricing and quotas in
this space change often. Re-verify before signing up. Items marked _unverified_ could not be confirmed
from a primary source on that date.

## Summary

| Provider                                         | Key?                                   | Free tier                                                                                                         | Sched. + actual times                                                                                                              | Aircraft type                           | Tail                                                | Altitude                                  | Historical dates                                                                                                                                 | Personal-hobby terms                                                                                          |
| ------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **AeroDataBox** (RapidAPI / API.Market / direct) | Yes                                    | RapidAPI **Basic: free, 400 units/mo**, 1 req/s (+1,000 req/h)                                                    | Yes (scheduled, revised, runway, actual)                                                                                           | Yes (model)                             | Yes                                                 | No (not in flight status)                 | **180 days** back on Basic/Pro (210 Ultra, 365 Mega)                                                                                             | Free plan: **non-commercial only, attribution required**. Fine for a personal log                             |
| **AviationStack**                                | Yes                                    | **100 requests/mo**                                                                                               | Yes                                                                                                                                | Partial (IATA/ICAO type code)           | Yes                                                 | Live flights only                         | **Paid plans only** (Basic $49.99/mo, 10k req)                                                                                                   | Free plan non-commercial                                                                                      |
| **AirLabs**                                      | Yes                                    | **1,000 queries/mo**, "personal use"                                                                              | Schedules/real-time: yes. Historical endpoint returns `dep_actual`/`arr_actual`, but the free plan exposes only a subset of fields | Yes (`aircraft_icao`)                   | `reg_number` on `/flight` (plan level _unverified_) | Yes (`alt`, live only)                    | Historical endpoint exists; depth and plan _unverified_                                                                                          | Free plan personal/non-commercial                                                                             |
| **FlightAware AeroAPI**                          | Yes                                    | **Personal tier: $5 free usage/mo**, no minimum; flight lookup **$0.005 per result set** (≈1,000 lookups/mo free) | Yes (out/off/on/in: scheduled, estimated, actual)                                                                                  | Yes                                     | Yes                                                 | Via track/position endpoints (extra cost) | `/flights/{ident}`: **10 days back, 2 days ahead**. `/history/*` needs Standard ($100/mo min) or Premium ($1,000/mo min), with data back to 2011 | Personal tier: "personal or academic purposes only"                                                           |
| **OpenSky Network**                              | Anonymous or OAuth2 client credentials | Anonymous 400 credits/day; registered **4,000 credits/day**                                                       | **No schedules**: ADS-B tracks only; callsign, not flight number                                                                   | No                                      | ICAO24 transponder only                             | Yes (tracks)                              | Flights by aircraft: previous day or earlier, 2-day windows. Tracks: **≤ 30 days**                                                               | Research/non-profit only; **any "operational" use (a live product, even internal) needs a written agreement** |
| **adsbdb**                                       | No                                     | Free. Reported limit **~360 req/min per client** (third-party report, _unverified_ upstream)                      | n/a                                                                                                                                | Yes (`type`, `icao_type`, manufacturer) | Lookup **by** registration or Mode-S                | No                                        | n/a                                                                                                                                              | Code MIT-licensed; data license not stated. Be polite and cache                                               |

## Notes per provider

### AeroDataBox

- Endpoint: `GET /flights/number/{flightNumber}/{dateLocal}?dateLocalRole=Departure`. It returns every leg of
  that flight number departing on the local date, which is what we want for multi-leg numbers.
- Pricing: RapidAPI Basic **free, 400 API units/month**. Paid: Pro $8 (RapidAPI) / $7.50 (API.Market)
  for 5,000 units; direct Starter $19 for 40,000 units.
- **Cost per call:** AeroDataBox prices endpoints by tier. Their docs and news put _Flight Status_ in
  **Tier 2 (2 units)**, and add a second charge when a flight plan is included. Their pricing-page
  summary listed "1 unit" for flight status, so assume **2 units** until confirmed on sign-up. That
  gives ≈200 lookups/month free.
- Flight History & Schedule (date ranges) is **Tier 3**, capped at 7-day ranges on Basic/Pro. Not needed here.
- Terms: free plan requires visible attribution and forbids commercial use. The standard caching
  guidance is 7 days. We cache in `flight_lookup_cache` and show "Data: AeroDataBox" next to looked-up values.

### AviationStack

- `GET /v1/flights?flight_iata=UA837&flight_date=YYYY-MM-DD`. Historical queries (`flight_date`) are
  **paid-only**, and the free tier's 100 requests/month suits only "what's my flight today".
- Paid starts at **$49.99/mo**. That is too expensive for a hobby log.

### AirLabs

- `/flight?flight_iata=UA837` (live/scheduled, rich fields incl. `aircraft_icao`, `reg_number`, `alt`),
  `/schedules`, and a `/flights` history endpoint with `dep_actual`/`arr_actual`.
- Free plan: **1,000 queries/month**, personal use. The docs mark only a subset of fields as free
  (`dep_time`, `arr_time`, `aircraft_icao`, …). Actual times and registration may need a paid plan
  (_unverified_). Paid from about $45–49/mo.

### FlightAware AeroAPI

- Most authoritative data (FlightAware's own feed): gate _out/in_ and runway _off/on_ times, each
  scheduled, estimated and actual.
- Personal tier: **$5/month free usage**, no minimum, **$0.005 per result set** (a set is up to 15
  records). That is roughly **1,000 flight lookups/month free**.
- Limitation: Personal tier only sees **10 days back / 2 days forward** (`/flights/{ident}`). Anything
  older needs `/history/*` on **Standard ($100/mo minimum)**.
- Terms: Personal tier data is for "personal or academic purposes only", which fits this project.

### OpenSky Network

- Real ADS-B data (altitude, speed, tracks), but **no schedules or flight numbers**, only callsigns
  (e.g. `UAL837`) and transponder addresses. Track history is limited to **30 days**.
- The terms require a **written agreement for any operational use**, even non-profit. An app that
  automatically calls it on a button press is arguably "operational", so **don't integrate it without
  asking OpenSky first.**

### adsbdb

- `GET https://api.adsbdb.com/v0/aircraft/{REGISTRATION}` → type, ICAO type, manufacturer,
  registered owner, photo URLs. No key.
- Useful for **tail number → aircraft type** enrichment of imported flights that lack a type. It is
  a community project, so cache aggressively and don't hammer it.

## Recommendation

**Primary: AeroDataBox (RapidAPI Basic, free).**
It is the only free option that looks up **flight number + date** with **both scheduled and actual
times, aircraft model and registration**, and reaches **180 days into the past**. Setup is a single
`X-RapidAPI-Key` header.

**Fallback: FlightAware AeroAPI (Personal tier).**
Use it when AeroDataBox has no match or is out of quota. It has the best data quality and about
1,000 free lookups/month, but only for flights in the **last 10 days**. That covers the main use case
of logging a flight you just took.

**Enrichment (optional): adsbdb** for tail → aircraft type, cached per registration.

Not recommended: AviationStack (history is paid-only, $49.99/mo), OpenSky (no schedules, and
operational use needs an agreement). AirLabs is a reasonable second fallback if its free plan turns
out to include actual times.

### Will personal use stay within the free tier?

A frequent flyer logs perhaps **20–100 flights/year**. Assume every flight is looked up about twice
(a retry or date fix), with no cache hits:

|                                        | Lookups/month    | AeroDataBox Basic (≈200 lookups/mo at 2 units) | AeroAPI Personal (≈1,000/mo) |
| -------------------------------------- | ---------------- | ---------------------------------------------- | ---------------------------- |
| Typical (50 flights/yr)                | ~8               | 4% of quota                                    | <1%                          |
| Heavy (100 flights/yr)                 | ~17              | 8%                                             | 2%                           |
| One-off backfill of 150 recent flights | 150 in one month | 75%, and only if all are < 180 days old        | Only flights < 10 days old   |

**Yes, comfortably**, as long as lookups are user-initiated and cached. Don't run background
enrichment across a whole imported history. Flighty exports already contain the times, so a bulk
backfill isn't needed anyway.

## How this maps to the code

- `apps/api/src/lookup/types.ts`: `FlightLookupProvider` / `FlightLookupResult` (provider-agnostic).
- `apps/api/src/lookup/providers/`: `NullProvider` (default), `StubProvider` (`FLIGHT_API_PROVIDER=stub`).
- `apps/api/src/lookup/service.ts`: read-through cache in `flight_lookup_cache`, keyed by
  (provider, normalized designator, date), TTL `LOOKUP_CACHE_TTL_HOURS`.
- Adding AeroDataBox: implement `providers/aeroDataBoxProvider.ts` (map `departure.scheduledTime.utc`,
  `departure.revisedTime`/`runwayTime`, `aircraft.model`, `aircraft.reg`, …), register it in
  `lookup/registry.ts` under `aerodatabox`, and read `AERODATABOX_RAPIDAPI_KEY`. No schema changes needed.
- Show provider attribution next to looked-up values (required by AeroDataBox's free plan).

## Sources

- AeroDataBox pricing: <https://aerodatabox.com/pricing/>
- AeroDataBox flight history/tiers (2025-02-01): <https://aerodatabox.com/flight-history/>
- AeroDataBox flight plans (Tier 2 note): <https://aerodatabox.com/flight-plans/>
- AeroDataBox on RapidAPI: <https://rapidapi.com/aedbx-aedbx/api/aerodatabox>
- AviationStack pricing: <https://aviationstack.com/pricing>
- AirLabs docs: <https://airlabs.co/docs/flight>, <https://airlabs.co/docs/historical>; plan summary: <https://www.saasworthy.com/product/airlabs-co/pricing>
- FlightAware AeroAPI: <https://www.flightaware.com/commercial/aeroapi/>; endpoint limits: <https://github.com/chrischall/flightaware-mcp/blob/main/docs/FLIGHTAWARE-API.md>
- OpenSky REST API: <https://openskynetwork.github.io/opensky-api/rest.html>; terms: <https://opensky-network.org/about/terms-of-use>
- adsbdb: <https://github.com/mrjackwills/adsbdb>
