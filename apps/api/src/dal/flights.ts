/**
 * User-owned flight data. Every function takes `userId` first and scopes by it.
 */
import { Prisma } from '@prisma/client';
import type {
  FilterOptions,
  FlightDetail,
  FlightListItem,
  FlightListQuery,
  Paginated,
  RouteFlight,
} from '@flight-log/shared';
import type { FlightFilters } from '@flight-log/shared';
import { prisma } from '../db';
import { filtersSql, filtersWhere } from './filters';
import { toAirlineSummary, toAirportSummary } from './mappers';

export const flightInclude = {
  airline: true,
  origin: true,
  destination: true,
  divertedTo: true,
  aircraftType: true,
} satisfies Prisma.FlightInclude;

export type FlightWithRelations = Prisma.FlightGetPayload<{ include: typeof flightInclude }>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
export const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

export function toListItem(f: FlightWithRelations): FlightListItem {
  return {
    id: f.id,
    flightDate: dateOnly(f.flightDate),
    source: f.source,
    airline: f.airline ? toAirlineSummary(f.airline) : null,
    airlineNameRaw: f.airlineNameRaw,
    flightNumber: f.flightNumber,
    origin: toAirportSummary(f.origin),
    destination: toAirportSummary(f.destination),
    divertedTo: f.divertedTo ? toAirportSummary(f.divertedTo) : null,
    canceled: f.canceled,
    aircraftType: f.aircraftType?.name ?? null,
    tailNumber: f.tailNumber,
    cabinClass: f.cabinClass,
    distanceMiles: Number(f.distanceMiles),
    airTimeMinutes: f.airTimeMinutes,
    gateDepartureScheduled: iso(f.gateDepartureScheduled),
    gateDepartureActual: iso(f.gateDepartureActual),
    takeoffScheduled: iso(f.takeoffScheduled),
    takeoffActual: iso(f.takeoffActual),
    landingScheduled: iso(f.landingScheduled),
    landingActual: iso(f.landingActual),
    gateArrivalScheduled: iso(f.gateArrivalScheduled),
    gateArrivalActual: iso(f.gateArrivalActual),
  };
}

export function toDetail(f: FlightWithRelations): FlightDetail {
  return {
    ...toListItem(f),
    flightyId: f.flightyId,
    importBatchId: f.importBatchId,
    depTerminal: f.depTerminal,
    depGate: f.depGate,
    arrTerminal: f.arrTerminal,
    arrGate: f.arrGate,
    pnr: f.pnr,
    seat: f.seat,
    seatType: f.seatType,
    flightReason: f.flightReason,
    notes: f.notes,
    cruiseAltitudeFt: f.cruiseAltitudeFt,
    maxAltitudeFt: f.maxAltitudeFt,
    groundSpeedKts: f.groundSpeedKts,
    lookupSource: f.lookupSource,
    lookupFetchedAt: iso(f.lookupFetchedAt),
    sourceRaw: (f.sourceRaw as Record<string, string | null> | null) ?? null,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

function orderBy(sort: string): Prisma.FlightOrderByWithRelationInput[] {
  const dir: Prisma.SortOrder = sort.startsWith('-') ? 'desc' : 'asc';
  const field = sort.replace(/^-/, '');
  const nullsLast = { sort: dir, nulls: 'last' as const };
  const byField: Record<string, Prisma.FlightOrderByWithRelationInput[]> = {
    date: [{ flightDate: dir }, { gateDepartureScheduled: nullsLast }, { createdAt: dir }],
    route: [{ origin: { iataCode: nullsLast } }, { destination: { iataCode: nullsLast } }],
    airline: [{ airline: { name: dir } }, { airlineNameRaw: nullsLast }],
    flightNumber: [{ flightNumber: nullsLast }],
    distance: [{ distanceMiles: dir }],
    aircraft: [{ aircraftType: { name: dir } }],
    duration: [{ airTimeMinutes: nullsLast }],
  };
  return [...(byField[field] ?? byField.date!), { flightDate: 'desc' }, { id: 'asc' }];
}

function searchWhere(q: string | undefined): Prisma.FlightWhereInput | undefined {
  if (!q) return undefined;
  const contains = { contains: q, mode: 'insensitive' as const };
  const code = q.toUpperCase();
  // PNR and seat are deliberately not searchable.
  return {
    OR: [
      { flightNumber: contains },
      { airlineNameRaw: contains },
      { airline: { name: contains } },
      { airline: { iataCode: code } },
      { origin: { iataCode: code } },
      { destination: { iataCode: code } },
      { origin: { municipality: contains } },
      { destination: { municipality: contains } },
      { tailNumber: contains },
      { aircraftType: { name: contains } },
      { notes: contains },
    ],
  };
}

export async function listFlights(
  userId: string,
  query: FlightListQuery,
): Promise<Paginated<FlightListItem>> {
  const where: Prisma.FlightWhereInput = {
    AND: [filtersWhere(userId, query), searchWhere(query.q) ?? {}],
  };
  const [total, rows] = await prisma.$transaction([
    prisma.flight.count({ where }),
    prisma.flight.findMany({
      where,
      include: flightInclude,
      orderBy: orderBy(query.sort),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { items: rows.map(toListItem), page: query.page, pageSize: query.pageSize, total };
}

export function findFlight(userId: string, id: string) {
  return prisma.flight.findFirst({ where: { id, userId }, include: flightInclude });
}

export function createFlight(userId: string, data: Omit<Prisma.FlightUncheckedCreateInput, 'userId'>) {
  return prisma.flight.create({ data: { ...data, userId }, include: flightInclude });
}

export async function updateFlight(
  userId: string,
  id: string,
  data: Prisma.FlightUncheckedUpdateInput,
) {
  const { count } = await prisma.flight.updateMany({ where: { id, userId }, data });
  return count === 0 ? null : findFlight(userId, id);
}

export async function deleteFlight(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.flight.deleteMany({ where: { id, userId } });
  return count > 0;
}

/** Flights (not canceled) on an undirected route, as drawn on the map. */
export async function routeFlights(
  userId: string,
  airportA: number,
  airportB: number,
  filters: FlightFilters,
): Promise<RouteFlight[]> {
  const rows = await prisma.$queryRaw<
    { id: string; flight_date: Date; airline: string | null; flight_number: string | null; origin: string | null; destination: string | null }[]
  >`
    SELECT f.id, f.flight_date, COALESCE(al.name, f.airline_name_raw) AS airline,
           CASE WHEN f.flight_number IS NULL THEN NULL
                ELSE COALESCE(al.iata_code, al.icao_code, '') || f.flight_number END AS flight_number,
           COALESCE(o.iata_code, o.icao_code) AS origin, COALESCE(d.iata_code, d.icao_code) AS destination
    FROM flights f
    LEFT JOIN airlines al ON al.id = f.airline_id
    JOIN airports o ON o.id = f.origin_airport_id
    JOIN airports d ON d.id = COALESCE(f.diverted_to_airport_id, f.destination_airport_id)
    WHERE ${filtersSql(userId, filters)}
      AND NOT f.canceled
      AND LEAST(f.origin_airport_id, COALESCE(f.diverted_to_airport_id, f.destination_airport_id)) = ${Math.min(airportA, airportB)}
      AND GREATEST(f.origin_airport_id, COALESCE(f.diverted_to_airport_id, f.destination_airport_id)) = ${Math.max(airportA, airportB)}
    ORDER BY f.flight_date DESC`;
  return rows.map((r) => ({
    id: r.id,
    flightDate: dateOnly(r.flight_date),
    airline: r.airline,
    flightNumber: r.flight_number,
    origin: r.origin,
    destination: r.destination,
  }));
}

export async function filterOptions(userId: string): Promise<FilterOptions> {
  const [years, airlines, cabins] = await Promise.all([
    prisma.$queryRaw<{ year: number }[]>`
      SELECT DISTINCT EXTRACT(YEAR FROM flight_date)::int AS year
      FROM flights WHERE user_id = ${userId}::uuid ORDER BY year DESC`,
    prisma.$queryRaw<{ value: string; label: string; count: number }[]>`
      SELECT COALESCE(f.airline_id::text, 'raw:' || f.airline_name_raw) AS value,
             COALESCE(al.name, f.airline_name_raw) AS label, count(*)::int AS count
      FROM flights f LEFT JOIN airlines al ON al.id = f.airline_id
      WHERE f.user_id = ${userId}::uuid AND (f.airline_id IS NOT NULL OR f.airline_name_raw IS NOT NULL)
      GROUP BY 1, 2 ORDER BY label`,
    prisma.$queryRaw<{ value: string; count: number }[]>`
      SELECT cabin_class AS value, count(*)::int AS count FROM flights
      WHERE user_id = ${userId}::uuid AND cabin_class IS NOT NULL
      GROUP BY 1 ORDER BY count DESC`,
  ]);
  return { years: years.map((y) => y.year), airlines, cabins };
}

/** Flighty IDs of this user's flights among `ids` (dedupe rule 1). */
export async function existingFlightyIds(userId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.flight.findMany({
    where: { userId, flightyId: { in: ids } },
    select: { flightyId: true },
  });
  return new Set(rows.map((r) => r.flightyId!));
}

/** This user's flights without a Flighty ID on the given dates (for dedupe rule 2). */
export function flightsWithoutFlightyIdOn(userId: string, dates: string[]) {
  if (dates.length === 0) return Promise.resolve([]);
  return prisma.flight.findMany({
    where: {
      userId,
      flightyId: null,
      flightDate: { in: [...new Set(dates)].map((d) => new Date(`${d}T00:00:00Z`)) },
    },
    select: {
      flightDate: true,
      airlineId: true,
      airlineNameRaw: true,
      flightNumber: true,
      originAirportId: true,
      destinationAirportId: true,
    },
  });
}
