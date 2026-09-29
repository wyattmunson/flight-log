/**
 * Global reference data (airports, airlines, aircraft types). Not user-owned.
 */
import { Prisma, type Airline, type Airport } from '@prisma/client';
import { prisma } from '../db';

/** Matches whole-word prefixes ("fran" → "San Francisco"), not arbitrary substrings. */
/** Lower rank sorts first when several airports share a code or match a search. */
const AIRPORT_TYPE_RANK: Record<string, number> = {
  large_airport: 0,
  medium_airport: 1,
  small_airport: 2,
  seaplane_base: 3,
  heliport: 4,
  balloonport: 5,
  closed: 9,
};
export const airportTypeRank = (type: string) => AIRPORT_TYPE_RANK[type] ?? 6;

const AIRPORT_RANK_SQL = Prisma.sql`CASE type
  WHEN 'large_airport' THEN 0 WHEN 'medium_airport' THEN 1 WHEN 'small_airport' THEN 2
  WHEN 'seaplane_base' THEN 3 WHEN 'heliport' THEN 4 WHEN 'closed' THEN 9 ELSE 6 END`;

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function searchAirports(q: string, limit = 15): Promise<Airport[]> {
  const term = q.trim();
  if (!term) return [];
  const upper = term.toUpperCase();
  const lower = term.toLowerCase();
  const prefix = `${escapeLike(lower)}%`;
  const wordPrefix = `% ${escapeLike(lower)}%`;
  return prisma.$queryRaw<Airport[]>`
    SELECT id, ident, iata_code AS "iataCode", icao_code AS "icaoCode", name, municipality,
           iso_country AS "isoCountry", iso_region AS "isoRegion", latitude, longitude,
           elevation_ft AS "elevationFt", type, timezone, flighty_id AS "flightyId"
    FROM airports
    WHERE iata_code = ${upper} OR icao_code = ${upper}
       OR lower(name) LIKE ${prefix} OR lower(name) LIKE ${wordPrefix}
       OR lower(municipality) LIKE ${prefix} OR lower(municipality) LIKE ${wordPrefix}
    ORDER BY
      CASE WHEN iata_code = ${upper} THEN 0 WHEN icao_code = ${upper} THEN 1
           WHEN lower(municipality) = ${lower} THEN 2 WHEN lower(municipality) LIKE ${prefix} THEN 3
           WHEN lower(name) LIKE ${prefix} THEN 4 ELSE 5 END,
      ${AIRPORT_RANK_SQL},
      (iata_code IS NULL),
      name
    LIMIT ${limit}`;
}

export async function searchAirlines(q: string, limit = 15): Promise<Airline[]> {
  const term = q.trim();
  if (!term) return [];
  const upper = term.toUpperCase();
  const lower = term.toLowerCase();
  const prefix = `${escapeLike(lower)}%`;
  const wordPrefix = `% ${escapeLike(lower)}%`;
  return prisma.$queryRaw<Airline[]>`
    SELECT id, name, iata_code AS "iataCode", icao_code AS "icaoCode", callsign, country, active,
           flighty_id AS "flightyId"
    FROM airlines
    WHERE iata_code = ${upper} OR icao_code = ${upper}
       OR lower(name) LIKE ${prefix} OR lower(name) LIKE ${wordPrefix}
    ORDER BY
      CASE WHEN iata_code = ${upper} THEN 0 WHEN icao_code = ${upper} THEN 1
           WHEN lower(name) = ${lower} THEN 2 WHEN lower(name) LIKE ${prefix} THEN 3 ELSE 4 END,
      active DESC,
      (iata_code IS NULL),
      name
    LIMIT ${limit}`;
}

export function getAirportsByIds(ids: number[]) {
  return prisma.airport.findMany({ where: { id: { in: [...new Set(ids)] } } });
}

export function getAirline(id: number) {
  return prisma.airline.findUnique({ where: { id } });
}

/** Find or create an aircraft type by Flighty ID first, then by name. */
export async function upsertAircraftType(
  name: string,
  flightyId: string | null,
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  if (flightyId) {
    const byFlighty = await tx.aircraftType.findUnique({ where: { flightyId } });
    if (byFlighty) return byFlighty.id;
  }
  const existing = await tx.aircraftType.findUnique({ where: { name } });
  if (existing) {
    if (flightyId && !existing.flightyId) {
      await tx.aircraftType.update({ where: { id: existing.id }, data: { flightyId } });
    }
    return existing.id;
  }
  const created = await tx.aircraftType.create({ data: { name, flightyId } });
  return created.id;
}

/** In-memory lookup tables for resolving codes in an import, loaded with a handful of queries. */
export interface ReferenceIndex {
  airportsByIata: Map<string, Airport>;
  airportsByIcao: Map<string, Airport>;
  airportsByFlightyId: Map<string, Airport>;
  airlinesByIata: Map<string, Airline>;
  airlinesByIcao: Map<string, Airline>;
  airlinesByName: Map<string, Airline>;
  airlinesByFlightyId: Map<string, Airline>;
}

function preferAirport(map: Map<string, Airport>, key: string | null, a: Airport) {
  if (!key) return;
  const cur = map.get(key);
  if (!cur || airportTypeRank(a.type) < airportTypeRank(cur.type)) map.set(key, a);
}

function airlineRank(a: Airline) {
  // Active carriers first, then those with both codes, then the lowest (oldest) id.
  return (a.active ? 0 : 10) + (a.iataCode && a.icaoCode ? 0 : 1);
}

function preferAirline(map: Map<string, Airline>, key: string | null, a: Airline) {
  if (!key) return;
  const cur = map.get(key);
  if (!cur || airlineRank(a) < airlineRank(cur) || (airlineRank(a) === airlineRank(cur) && a.id < cur.id)) {
    map.set(key, a);
  }
}

export async function loadReferenceIndex(input: {
  airportCodes: string[];
  airportFlightyIds: string[];
  airlineValues: string[];
  airlineFlightyIds: string[];
}): Promise<ReferenceIndex> {
  const codes = [...new Set(input.airportCodes.map((c) => c.toUpperCase()))];
  const airlineCodes = [...new Set(input.airlineValues.map((v) => v.toUpperCase()))];
  const airlineNames = [...new Set(input.airlineValues.map((v) => v.toLowerCase()))];

  const [airports, airportsByFid, airlines, airlinesByFid] = await Promise.all([
    codes.length
      ? prisma.airport.findMany({
          where: { OR: [{ iataCode: { in: codes } }, { icaoCode: { in: codes } }] },
        })
      : [],
    input.airportFlightyIds.length
      ? prisma.airport.findMany({ where: { flightyId: { in: input.airportFlightyIds } } })
      : [],
    airlineCodes.length
      ? prisma.$queryRaw<Airline[]>`
          SELECT id, name, iata_code AS "iataCode", icao_code AS "icaoCode", callsign, country,
                 active, flighty_id AS "flightyId"
          FROM airlines
          WHERE iata_code = ANY(${airlineCodes}) OR icao_code = ANY(${airlineCodes})
             OR lower(name) = ANY(${airlineNames})`
      : [],
    input.airlineFlightyIds.length
      ? prisma.airline.findMany({ where: { flightyId: { in: input.airlineFlightyIds } } })
      : [],
  ]);

  const index: ReferenceIndex = {
    airportsByIata: new Map(),
    airportsByIcao: new Map(),
    airportsByFlightyId: new Map(),
    airlinesByIata: new Map(),
    airlinesByIcao: new Map(),
    airlinesByName: new Map(),
    airlinesByFlightyId: new Map(),
  };
  for (const a of airports) {
    preferAirport(index.airportsByIata, a.iataCode, a);
    preferAirport(index.airportsByIcao, a.icaoCode, a);
  }
  for (const a of airportsByFid) if (a.flightyId) index.airportsByFlightyId.set(a.flightyId, a);
  for (const a of airlines) {
    preferAirline(index.airlinesByIata, a.iataCode, a);
    preferAirline(index.airlinesByIcao, a.icaoCode, a);
    preferAirline(index.airlinesByName, a.name.toLowerCase(), a);
  }
  for (const a of airlinesByFid) if (a.flightyId) index.airlinesByFlightyId.set(a.flightyId, a);
  return index;
}

/** Remember Flighty IDs on reference rows the first time an import reveals them. */
export async function rememberFlightyIds(
  airports: Map<number, string>,
  airlines: Map<number, string>,
) {
  await prisma.$transaction([
    ...[...airports].map(([id, flightyId]) =>
      prisma.airport.updateMany({ where: { id, flightyId: null }, data: { flightyId } }),
    ),
    ...[...airlines].map(([id, flightyId]) =>
      prisma.airline.updateMany({ where: { id, flightyId: null }, data: { flightyId } }),
    ),
  ]);
}
