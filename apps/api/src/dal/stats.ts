/**
 * Dashboard aggregates, computed in SQL and scoped to one user.
 * Canceled flights are excluded from everything except `canceledFlights`.
 * A diverted flight counts as arriving at its diversion airport.
 */
import { Prisma } from '@prisma/client';
import {
  EARTH_CIRCUMFERENCE_MI,
  MOON_DISTANCE_MI,
  ON_TIME_THRESHOLD_MINUTES,
  type FlightFilters,
  type Stats,
  type StatsFlightRef,
} from '@flight-log/shared';
import { prisma } from '../db';
import { dateOnly } from './flights';
import { filtersSql } from './filters';

function baseCte(userId: string, filters: FlightFilters) {
  return Prisma.sql`
    WITH base AS (
      SELECT f.*, COALESCE(f.diverted_to_airport_id, f.destination_airport_id) AS arr_id
      FROM flights f
      WHERE ${filtersSql(userId, filters)}
    ),
    flown AS (SELECT * FROM base WHERE NOT canceled)`;
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const round1 = (n: number) => Math.round(n * 10) / 10;

type FlightRefRow = {
  id: string;
  flight_date: Date;
  airline: string | null;
  flight_number: string | null;
  origin: string | null;
  destination: string | null;
  distance_miles: unknown;
};

const toRef = (r: FlightRefRow | undefined): StatsFlightRef | null =>
  r
    ? {
        id: r.id,
        flightDate: dateOnly(r.flight_date),
        airline: r.airline,
        flightNumber: r.flight_number,
        origin: r.origin,
        destination: r.destination,
        distanceMiles: num(r.distance_miles),
      }
    : null;

export async function computeStats(userId: string, filters: FlightFilters): Promise<Stats> {
  const base = baseCte(userId, filters);
  const flightRef = (order: Prisma.Sql, where: Prisma.Sql = Prisma.sql`TRUE`) =>
    prisma.$queryRaw<FlightRefRow[]>`${base}
      SELECT f.id, f.flight_date, COALESCE(al.name, f.airline_name_raw) AS airline,
             CASE WHEN f.flight_number IS NULL THEN NULL
                  ELSE COALESCE(al.iata_code, al.icao_code, '') || f.flight_number END AS flight_number,
             COALESCE(o.iata_code, o.icao_code) AS origin, COALESCE(d.iata_code, d.icao_code) AS destination,
             f.distance_miles
      FROM flown f
      LEFT JOIN airlines al ON al.id = f.airline_id
      JOIN airports o ON o.id = f.origin_airport_id
      JOIN airports d ON d.id = f.arr_id
      WHERE ${where}
      ORDER BY ${order}
      LIMIT 1`;

  const [
    headline,
    airports,
    airlines,
    aircraftTypes,
    tails,
    perYear,
    perMonth,
    byMonthOfYear,
    cabin,
    seatType,
    reason,
    longest,
    shortest,
    topRoute,
    busiestDay,
    punctuality,
  ] = await Promise.all([
    prisma.$queryRaw<Record<string, unknown>[]>`${base}
      SELECT
        (SELECT count(*) FROM flown) AS total_flights,
        (SELECT count(*) FROM base WHERE canceled) AS canceled_flights,
        (SELECT COALESCE(sum(distance_miles), 0) FROM flown) AS total_miles,
        (SELECT COALESCE(sum(air_time_minutes), 0) FROM flown) AS total_air_minutes,
        (SELECT count(air_time_minutes) FROM flown) AS flights_with_air_time,
        (SELECT COALESCE(sum(gate_time_minutes), 0) FROM flown) AS total_gate_minutes,
        (SELECT count(gate_time_minutes) FROM flown) AS flights_with_gate_time,
        (SELECT count(DISTINCT COALESCE(airline_id::text, 'raw:' || lower(airline_name_raw)))
           FROM flown WHERE airline_id IS NOT NULL OR airline_name_raw IS NOT NULL) AS unique_airlines`,
    prisma.$queryRaw<Record<string, unknown>[]>`${base},
      visits AS (
        SELECT origin_airport_id AS airport_id, 1 AS dep, 0 AS arr FROM flown
        UNION ALL
        SELECT arr_id, 0, 1 FROM flown
      )
      SELECT a.id, a.iata_code, a.icao_code, a.name, a.municipality, a.iso_country,
             sum(v.dep) AS departures, sum(v.arr) AS arrivals, count(*) AS visits
      FROM visits v JOIN airports a ON a.id = v.airport_id
      GROUP BY a.id
      ORDER BY visits DESC, a.iata_code NULLS LAST, a.name`,
    prisma.$queryRaw<Record<string, unknown>[]>`${base}
      SELECT f.airline_id, COALESCE(al.name, f.airline_name_raw, 'Unknown') AS label,
             count(*) AS flights, COALESCE(sum(f.distance_miles), 0) AS miles
      FROM flown f LEFT JOIN airlines al ON al.id = f.airline_id
      GROUP BY 1, 2
      ORDER BY flights DESC, miles DESC, label`,
    prisma.$queryRaw<Record<string, unknown>[]>`${base}
      SELECT COALESCE(t.name, 'Unknown') AS label, count(*) AS flights,
             COALESCE(sum(f.distance_miles), 0) AS miles
      FROM flown f LEFT JOIN aircraft_types t ON t.id = f.aircraft_type_id
      GROUP BY 1
      ORDER BY flights DESC, miles DESC, label`,
    prisma.$queryRaw<Record<string, unknown>[]>`${base}
      SELECT upper(f.tail_number) AS tail_number, count(*) AS flights,
             array_remove(array_agg(DISTINCT t.name), NULL) AS aircraft_types,
             array_remove(array_agg(DISTINCT COALESCE(al.name, f.airline_name_raw)), NULL) AS airlines
      FROM flown f
      LEFT JOIN aircraft_types t ON t.id = f.aircraft_type_id
      LEFT JOIN airlines al ON al.id = f.airline_id
      WHERE f.tail_number IS NOT NULL
      GROUP BY 1
      ORDER BY flights DESC, tail_number
      LIMIT 50`,
    prisma.$queryRaw<Record<string, unknown>[]>`${base}
      SELECT EXTRACT(YEAR FROM flight_date)::int AS year, count(*) AS flights,
             COALESCE(sum(distance_miles), 0) AS miles
      FROM flown GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<Record<string, unknown>[]>`${base}
      SELECT to_char(flight_date, 'YYYY-MM') AS month, count(*) AS flights,
             COALESCE(sum(distance_miles), 0) AS miles
      FROM flown GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<Record<string, unknown>[]>`${base}
      SELECT EXTRACT(MONTH FROM flight_date)::int AS month, count(*) AS flights
      FROM flown GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<Record<string, unknown>[]>`${base}
      SELECT COALESCE(cabin_class, 'Unknown') AS label, count(*) AS flights
      FROM flown GROUP BY 1 ORDER BY flights DESC, label`,
    prisma.$queryRaw<Record<string, unknown>[]>`${base}
      SELECT COALESCE(seat_type, 'Unknown') AS label, count(*) AS flights
      FROM flown GROUP BY 1 ORDER BY flights DESC, label`,
    prisma.$queryRaw<Record<string, unknown>[]>`${base}
      SELECT COALESCE(flight_reason, 'Unknown') AS label, count(*) AS flights
      FROM flown GROUP BY 1 ORDER BY flights DESC, label`,
    flightRef(Prisma.sql`f.distance_miles DESC, f.flight_date`),
    flightRef(Prisma.sql`f.distance_miles ASC, f.flight_date`, Prisma.sql`f.distance_miles > 0`),
    prisma.$queryRaw<Record<string, unknown>[]>`${base}
      SELECT COALESCE(a.iata_code, a.icao_code) AS a, COALESCE(b.iata_code, b.icao_code) AS b,
             r.flights, r.distance_miles
      FROM (
        SELECT LEAST(origin_airport_id, arr_id) AS a_id, GREATEST(origin_airport_id, arr_id) AS b_id,
               count(*) AS flights, max(distance_miles) AS distance_miles
        FROM flown GROUP BY 1, 2
      ) r
      JOIN airports a ON a.id = r.a_id JOIN airports b ON b.id = r.b_id
      ORDER BY r.flights DESC, r.distance_miles DESC
      LIMIT 1`,
    prisma.$queryRaw<Record<string, unknown>[]>`${base}
      SELECT flight_date, count(*) AS flights
      FROM flown GROUP BY 1 ORDER BY flights DESC, flight_date DESC LIMIT 1`,
    // Delay = actual − scheduled at the gate, falling back to runway times when a gate pair is missing.
    prisma.$queryRaw<Record<string, unknown>[]>`${base},
      delays AS (
        SELECT
          EXTRACT(EPOCH FROM COALESCE(gate_departure_actual - gate_departure_scheduled,
                                      takeoff_actual - takeoff_scheduled)) / 60 AS dep_delay,
          EXTRACT(EPOCH FROM COALESCE(gate_arrival_actual - gate_arrival_scheduled,
                                      landing_actual - landing_scheduled)) / 60 AS arr_delay
        FROM flown
      )
      SELECT avg(dep_delay) AS avg_dep, avg(arr_delay) AS avg_arr,
             count(dep_delay) AS dep_n, count(arr_delay) AS arr_n,
             count(*) FILTER (WHERE dep_delay <= ${ON_TIME_THRESHOLD_MINUTES}) AS dep_on_time,
             count(*) FILTER (WHERE arr_delay <= ${ON_TIME_THRESHOLD_MINUTES}) AS arr_on_time
      FROM delays`,
  ]);

  const h = headline[0]!;
  const totalMiles = round1(num(h.total_miles));
  const airportRows = airports.map((a) => ({
    id: num(a.id),
    iata: a.iata_code as string | null,
    icao: a.icao_code as string | null,
    name: a.name as string,
    city: a.municipality as string | null,
    country: a.iso_country as string | null,
    departures: num(a.departures),
    arrivals: num(a.arrivals),
    visits: num(a.visits),
  }));
  const p = punctuality[0]!;
  const depN = num(p.dep_n);
  const arrN = num(p.arr_n);
  const route = topRoute[0];
  const day = busiestDay[0];

  return {
    headline: {
      totalFlights: num(h.total_flights),
      canceledFlights: num(h.canceled_flights),
      totalMiles,
      totalAirMinutes: num(h.total_air_minutes),
      flightsWithAirTime: num(h.flights_with_air_time),
      totalGateMinutes: num(h.total_gate_minutes),
      flightsWithGateTime: num(h.flights_with_gate_time),
      uniqueAirports: airportRows.length,
      uniqueAirlines: num(h.unique_airlines),
      uniqueCountries: new Set(airportRows.map((a) => a.country).filter(Boolean)).size,
      timesAroundEarth: totalMiles / EARTH_CIRCUMFERENCE_MI,
      percentToMoon: (totalMiles / MOON_DISTANCE_MI) * 100,
    },
    airports: airportRows,
    airlines: airlines.map((r) => ({
      airlineId: numOrNull(r.airline_id),
      label: r.label as string,
      flights: num(r.flights),
      miles: round1(num(r.miles)),
    })),
    aircraftTypes: aircraftTypes.map((r) => ({
      label: r.label as string,
      flights: num(r.flights),
      miles: round1(num(r.miles)),
    })),
    tails: tails.map((r) => ({
      tailNumber: r.tail_number as string,
      flights: num(r.flights),
      aircraftTypes: r.aircraft_types as string[],
      airlines: r.airlines as string[],
    })),
    perYear: perYear.map((r) => ({
      year: num(r.year),
      flights: num(r.flights),
      miles: round1(num(r.miles)),
    })),
    perMonth: perMonth.map((r) => ({
      month: r.month as string,
      flights: num(r.flights),
      miles: round1(num(r.miles)),
    })),
    byMonthOfYear: byMonthOfYear.map((r) => ({ month: num(r.month), flights: num(r.flights) })),
    cabinClass: cabin.map((r) => ({ label: r.label as string, flights: num(r.flights) })),
    seatType: seatType.map((r) => ({ label: r.label as string, flights: num(r.flights) })),
    flightReason: reason.map((r) => ({ label: r.label as string, flights: num(r.flights) })),
    records: {
      longest: toRef(longest[0]),
      shortest: toRef(shortest[0]),
      topRoute: route
        ? {
            a: route.a as string,
            b: route.b as string,
            flights: num(route.flights),
            distanceMiles: num(route.distance_miles),
          }
        : null,
      busiestDay: day
        ? { date: dateOnly(day.flight_date as Date), flights: num(day.flights) }
        : null,
    },
    punctuality: {
      thresholdMinutes: ON_TIME_THRESHOLD_MINUTES,
      departureSamples: depN,
      arrivalSamples: arrN,
      avgDepartureDelayMinutes: depN ? round1(num(p.avg_dep)) : null,
      avgArrivalDelayMinutes: arrN ? round1(num(p.avg_arr)) : null,
      departureOnTimePercent: depN ? round1((num(p.dep_on_time) / depN) * 100) : null,
      arrivalOnTimePercent: arrN ? round1((num(p.arr_on_time) / arrN) * 100) : null,
    },
  };
}
