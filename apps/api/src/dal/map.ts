/** Map aggregates: collapsed undirected routes and airport visit counts (canceled excluded). */
import { Prisma } from '@prisma/client';
import { greatCirclePoints, routeKey, type FlightFilters, type MapData } from '@flight-log/shared';
import { prisma } from '../db';
import { filtersSql } from './filters';

export async function mapData(userId: string, filters: FlightFilters): Promise<MapData> {
  const base = Prisma.sql`
    WITH flown AS (
      SELECT f.origin_airport_id, COALESCE(f.diverted_to_airport_id, f.destination_airport_id) AS arr_id,
             f.distance_miles
      FROM flights f
      WHERE ${filtersSql(userId, filters)} AND NOT f.canceled
    )`;

  const [airports, routes] = await Promise.all([
    prisma.$queryRaw<Record<string, unknown>[]>`${base},
      visits AS (
        SELECT origin_airport_id AS airport_id, 1 AS dep, 0 AS arr FROM flown
        UNION ALL SELECT arr_id, 0, 1 FROM flown
      )
      SELECT a.id, a.iata_code, a.icao_code, a.name, a.municipality, a.iso_country, a.timezone,
             a.latitude, a.longitude, a.type,
             sum(v.dep)::int AS departures, sum(v.arr)::int AS arrivals, count(*)::int AS visits
      FROM visits v JOIN airports a ON a.id = v.airport_id
      GROUP BY a.id ORDER BY visits DESC`,
    prisma.$queryRaw<{ a: number; b: number; count: number; distance: unknown }[]>`${base}
      SELECT LEAST(origin_airport_id, arr_id) AS a, GREATEST(origin_airport_id, arr_id) AS b,
             count(*)::int AS count, max(distance_miles) AS distance
      FROM flown GROUP BY 1, 2 ORDER BY count DESC`,
  ]);

  const byId = new Map(airports.map((a) => [Number(a.id), a]));
  return {
    airports: airports.map((a) => ({
      id: Number(a.id),
      iata: a.iata_code as string | null,
      icao: a.icao_code as string | null,
      name: a.name as string,
      city: a.municipality as string | null,
      country: a.iso_country as string | null,
      timezone: a.timezone as string | null,
      latitude: Number(a.latitude),
      longitude: Number(a.longitude),
      type: a.type as string,
      departures: Number(a.departures),
      arrivals: Number(a.arrivals),
      visits: Number(a.visits),
    })),
    routes: routes.flatMap((r) => {
      const a = byId.get(r.a);
      const b = byId.get(r.b);
      if (!a || !b) return [];
      const distanceMiles = Number(r.distance);
      const segments = Math.min(128, Math.max(8, Math.round(distanceMiles / 60)));
      const pa = { latitude: Number(a.latitude), longitude: Number(a.longitude) };
      const pb = { latitude: Number(b.latitude), longitude: Number(b.longitude) };
      return [
        {
          key: routeKey(r.a, r.b),
          airportA: r.a,
          airportB: r.b,
          count: r.count,
          distanceMiles,
          path: greatCirclePoints(pa, pb, segments).map(
            ([lon, lat]) =>
              [Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4] as [number, number],
          ),
        },
      ];
    }),
  };
}
