/**
 * Reference data seeding: OurAirports airports (public domain) and OpenFlights airlines (ODbL).
 * Downloads from upstream and caches under /data; falls back to cached/manual files offline.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import tzLookup from 'tz-lookup';
import type { Prisma, PrismaClient } from '@prisma/client';
import { DEFAULT_USER_ID } from '@flight-log/shared';

export const AIRPORTS_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
export const AIRLINES_URL =
  'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat';

export const DATA_DIR =
  process.env.REFERENCE_DATA_DIR ?? fileURLToPath(new URL('../../../../data/', import.meta.url));

const log = (msg: string) => console.log(`[seed] ${msg}`);

async function fetchOrCache(url: string, candidates: string[]): Promise<string> {
  const target = path.join(DATA_DIR, candidates[0]!);
  try {
    log(`downloading ${url}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(target, text).catch(() => undefined); // cache is best-effort
    return text;
  } catch (e) {
    log(`download failed (${(e as Error).message}); looking for a local copy in ${DATA_DIR}`);
    for (const name of candidates) {
      const file = path.join(DATA_DIR, name);
      if (existsSync(file)) {
        log(`using ${file}`);
        return readFile(file, 'utf8');
      }
    }
    throw new Error(
      `Could not download ${url} and no local copy was found.\n` +
        `Download it manually and save it as ${target}, then run "npm run seed:reference".`,
    );
  }
}

const IATA = /^[A-Z]{3}$/;
const ICAO = /^[A-Z0-9]{4}$/;

export function parseAirports(csv: string): Prisma.AirportCreateManyInput[] {
  const rows = parse(csv, { columns: true, skip_empty_lines: true, relax_quotes: true }) as Record<
    string,
    string
  >[];
  const out: Prisma.AirportCreateManyInput[] = [];
  for (const r of rows) {
    const iata = r.iata_code?.trim().toUpperCase() ?? '';
    // Older snapshots lack icao_code; gps_code carries the ICAO ident for most airports.
    const icaoRaw = (r.icao_code ?? r.gps_code ?? '').trim().toUpperCase();
    const iataCode = IATA.test(iata) ? iata : null;
    const icaoCode = ICAO.test(icaoRaw) ? icaoRaw : null;
    if (!iataCode && !icaoCode) continue;
    const latitude = Number(r.latitude_deg);
    const longitude = Number(r.longitude_deg);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    let timezone: string | null = null;
    try {
      timezone = tzLookup(latitude, longitude);
    } catch {
      timezone = null;
    }
    const elevation = Number(r.elevation_ft);
    out.push({
      id: Number(r.id),
      ident: r.ident ?? '',
      iataCode,
      icaoCode,
      name: r.name ?? '',
      municipality: r.municipality || null,
      isoCountry: r.iso_country || null,
      isoRegion: r.iso_region || null,
      latitude,
      longitude,
      elevationFt: r.elevation_ft && Number.isFinite(elevation) ? Math.round(elevation) : null,
      type: r.type || 'unknown',
      timezone,
    });
  }
  return out;
}

const nullish = (v: string | undefined) => {
  const s = v?.trim();
  return !s || s === '\\N' || s === '-' || s === 'N/A' ? null : s;
};

/** OpenFlights airlines.dat: id,name,alias,iata,icao,callsign,country,active (a few rows have extra columns). */
export function parseAirlines(dat: string): Prisma.AirlineCreateManyInput[] {
  const rows = parse(dat, { relax_column_count: true, relax_quotes: true, skip_empty_lines: true }) as string[][];
  const out: Prisma.AirlineCreateManyInput[] = [];
  for (const r of rows) {
    const id = Number(r[0]);
    const name = nullish(r[1]);
    if (!Number.isInteger(id) || id <= 0 || !name) continue;
    const iata = nullish(r[3])?.toUpperCase() ?? null;
    const icao = nullish(r[4])?.toUpperCase() ?? null;
    out.push({
      id,
      name,
      iataCode: iata && /^[A-Z0-9]{2}$/.test(iata) ? iata : null,
      icaoCode: icao && /^[A-Z]{3}$/.test(icao) ? icao : null,
      callsign: nullish(r[5]),
      // Malformed rows have extra columns; country and active are always the last two.
      country: nullish(r[r.length - 2]),
      active: r[r.length - 1]?.trim().toUpperCase() === 'Y',
    });
  }
  return out;
}

async function insertChunked<T>(items: T[], insert: (chunk: T[]) => Promise<{ count: number }>) {
  let count = 0;
  for (let i = 0; i < items.length; i += 5000) count += (await insert(items.slice(i, i + 5000))).count;
  return count;
}

export async function ensureDefaultUser(prisma: PrismaClient) {
  const id = process.env.DEFAULT_USER_ID || DEFAULT_USER_ID;
  await prisma.user.upsert({
    where: { id },
    create: { id, displayName: 'Traveler' },
    update: {},
  });
}

export async function seedReference(prisma: PrismaClient, opts: { ifEmpty?: boolean } = {}) {
  await ensureDefaultUser(prisma);

  const [airportCount, airlineCount] = await Promise.all([
    prisma.airport.count(),
    prisma.airline.count(),
  ]);

  if (!opts.ifEmpty || airportCount === 0) {
    const airports = parseAirports(await fetchOrCache(AIRPORTS_URL, ['airports.csv']));
    const n = await insertChunked(airports, (data) =>
      prisma.airport.createMany({ data, skipDuplicates: true }),
    );
    log(`airports: ${airports.length} with IATA/ICAO codes, ${n} new`);
  } else {
    log(`airports: ${airportCount} already present, skipping`);
  }

  if (!opts.ifEmpty || airlineCount === 0) {
    const airlines = parseAirlines(
      await fetchOrCache(AIRLINES_URL, ['airlines.dat', 'airlines.csv']),
    );
    const n = await insertChunked(airlines, (data) =>
      prisma.airline.createMany({ data, skipDuplicates: true }),
    );
    log(`airlines: ${airlines.length} parsed, ${n} new`);
  } else {
    log(`airlines: ${airlineCount} already present, skipping`);
  }
}
