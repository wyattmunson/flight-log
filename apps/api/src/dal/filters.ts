import { Prisma } from '@prisma/client';
import type { FlightFilters } from '@flight-log/shared';

export function yearRange(f: FlightFilters): { from?: string; to?: string } {
  if (f.year) return { from: `${f.year}-01-01`, to: `${f.year}-12-31` };
  return {
    from: f.yearFrom ? `${f.yearFrom}-01-01` : undefined,
    to: f.yearTo ? `${f.yearTo}-12-31` : undefined,
  };
}

/** `airline` filter: a numeric airline id, or `raw:<name>` for unresolved airlines. */
export function parseAirlineFilter(value: string | undefined) {
  if (!value) return null;
  if (/^\d+$/.test(value)) return { kind: 'id' as const, id: Number(value) };
  if (value.startsWith('raw:')) return { kind: 'raw' as const, name: value.slice(4) };
  return { kind: 'raw' as const, name: value };
}

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Filters for Prisma query-builder calls (flights list). Mirrors `filtersSql`. */
export function filtersWhere(userId: string, f: FlightFilters): Prisma.FlightWhereInput {
  const where: Prisma.FlightWhereInput = { userId };
  const { from, to } = yearRange(f);
  if (from || to) where.flightDate = { gte: from ? toDate(from) : undefined, lte: to ? toDate(to) : undefined };
  const airline = parseAirlineFilter(f.airline);
  if (airline?.kind === 'id') where.airlineId = airline.id;
  if (airline?.kind === 'raw') {
    where.airlineId = null;
    where.airlineNameRaw = { equals: airline.name, mode: 'insensitive' };
  }
  if (f.cabin) where.cabinClass = { equals: f.cabin, mode: 'insensitive' };
  return where;
}

/** Filters for raw SQL (stats, map). `alias` is the flights table alias. Mirrors `filtersWhere`. */
export function filtersSql(userId: string, f: FlightFilters, alias = 'f'): Prisma.Sql {
  const a = Prisma.raw(alias);
  const parts: Prisma.Sql[] = [Prisma.sql`${a}.user_id = ${userId}::uuid`];
  const { from, to } = yearRange(f);
  if (from) parts.push(Prisma.sql`${a}.flight_date >= ${from}::date`);
  if (to) parts.push(Prisma.sql`${a}.flight_date <= ${to}::date`);
  const airline = parseAirlineFilter(f.airline);
  if (airline?.kind === 'id') parts.push(Prisma.sql`${a}.airline_id = ${airline.id}`);
  if (airline?.kind === 'raw') {
    parts.push(
      Prisma.sql`${a}.airline_id IS NULL AND lower(${a}.airline_name_raw) = lower(${airline.name})`,
    );
  }
  if (f.cabin) parts.push(Prisma.sql`lower(${a}.cabin_class) = lower(${f.cabin})`);
  return Prisma.join(parts, ' AND ');
}
