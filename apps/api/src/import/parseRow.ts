/**
 * Pure CSV-row → flight conversion. All database access happens beforehand (see
 * `loadReferenceIndex`), so this is fast and unit-testable.
 */
import type { Airline, Airport } from '@prisma/client';
import {
  FLIGHT_TIME_FIELDS,
  classifyAirportCode,
  cleanText,
  normalizeCategory,
  normalizeFlightNumber,
  normalizeTailNumber,
  parseBoolean,
  parseFlightDate,
  type ImportRowError,
} from '@flight-log/shared';
import type { ReferenceIndex } from '../dal/reference';
import {
  airTimeFrom,
  gateTimeFrom,
  convertTimes,
  flightDistanceMiles,
  type FlightTimeValues,
} from '../services/derive';
import { FLIGHTY_COLUMNS, type FlightyRecord } from './columns';

export interface PreparedFlight {
  flightyId: string | null;
  flightDate: string;
  airlineId: number | null;
  airlineNameRaw: string | null;
  flightNumber: string | null;
  originAirportId: number;
  destinationAirportId: number;
  divertedToAirportId: number | null;
  canceled: boolean;
  times: FlightTimeValues;
  depTerminal: string | null;
  depGate: string | null;
  arrTerminal: string | null;
  arrGate: string | null;
  aircraftTypeName: string | null;
  aircraftTypeFlightyId: string | null;
  tailNumber: string | null;
  pnr: string | null;
  seat: string | null;
  seatType: string | null;
  cabinClass: string | null;
  flightReason: string | null;
  notes: string | null;
  distanceMiles: number;
  airTimeMinutes: number | null;
  gateTimeMinutes: number | null;
  sourceRaw: Record<string, string | null>;
  /** Flighty IDs for reference rows, remembered after commit. */
  refFlightyIds: { airports: [number, string][]; airline: [number, string] | null };
}

export interface ParsedRow {
  line: number;
  errors: ImportRowError[];
  warnings: string[];
  flight: PreparedFlight | null;
  display: {
    flightDate: string | null;
    airline: string | null;
    flightNumber: string | null;
    origin: string | null;
    destination: string | null;
    divertedTo: string | null;
    canceled: boolean;
    distanceMiles: number | null;
  };
}

export function resolveAirport(
  code: string | null | undefined,
  flightyId: string | null | undefined,
  index: ReferenceIndex,
): Airport | undefined {
  const c = classifyAirportCode(code);
  if (c) {
    const primary = c.kind === 'iata' ? index.airportsByIata : index.airportsByIcao;
    const hit = primary.get(c.value) ?? index.airportsByIcao.get(c.value);
    if (hit) return hit;
  }
  return flightyId ? index.airportsByFlightyId.get(flightyId) : undefined;
}

/**
 * Airline resolution order: the Airline cell by IATA, then ICAO, then name; then a
 * previously seen Airline Flighty ID; then the carrier prefix of the Flight cell.
 */
export function resolveAirline(
  value: string | null | undefined,
  carrierHint: string | null,
  flightyId: string | null | undefined,
  index: ReferenceIndex,
): Airline | undefined {
  const v = cleanText(value);
  if (v) {
    const up = v.toUpperCase();
    const hit =
      (up.length === 2 ? index.airlinesByIata.get(up) : undefined) ??
      (up.length === 3 ? index.airlinesByIcao.get(up) : undefined) ??
      index.airlinesByName.get(v.toLowerCase());
    if (hit) return hit;
  }
  if (flightyId) {
    const hit = index.airlinesByFlightyId.get(flightyId);
    if (hit) return hit;
  }
  if (carrierHint) {
    return carrierHint.length === 2
      ? index.airlinesByIata.get(carrierHint)
      : index.airlinesByIcao.get(carrierHint);
  }
  return undefined;
}

const col = (field: keyof typeof FLIGHTY_COLUMNS) => FLIGHTY_COLUMNS[field];

export function parseRow(
  record: FlightyRecord,
  sourceRaw: Record<string, string | null>,
  line: number,
  index: ReferenceIndex,
): ParsedRow {
  const errors: ImportRowError[] = [];
  const warnings: string[] = [];
  const err = (column: string, message: string) => errors.push({ line, column, message });

  const date = parseFlightDate(record.date);
  if (!date.ok) err(col('date'), date.error);
  else if (!date.value) err(col('date'), 'Date is required');

  const canceled = parseBoolean(record.canceled);
  if (canceled === undefined) {
    warnings.push(`Unrecognized Canceled value "${record.canceled}", treated as not canceled`);
  }

  const origin = resolveAirport(record.from, record.flightyDepartureAirportId, index);
  const destination = resolveAirport(record.to, record.flightyArrivalAirportId, index);
  const divertedTo = record.divertedTo
    ? resolveAirport(record.divertedTo, record.flightyDivertedAirportId, index)
    : undefined;

  if (!record.from) err(col('from'), 'Departure airport is required');
  else if (!origin) err(col('from'), `Unknown airport "${record.from}"`);
  if (!record.to) err(col('to'), 'Arrival airport is required');
  else if (!destination) err(col('to'), `Unknown airport "${record.to}"`);
  if (record.divertedTo && !divertedTo) {
    err(col('divertedTo'), `Unknown diversion airport "${record.divertedTo}"`);
  }

  const fn = normalizeFlightNumber(record.flight);
  const airline = resolveAirline(record.airline, fn.carrier, record.flightyAirlineId, index);
  const airlineNameRaw = cleanText(record.airline) ?? fn.carrier;
  if (!airline) {
    if (airlineNameRaw) warnings.push(`Airline "${airlineNameRaw}" not found; kept as text`);
    else err(col('airline'), 'Airline is required');
  }

  const display: ParsedRow['display'] = {
    flightDate: date.ok ? date.value : null,
    airline: airline?.name ?? airlineNameRaw,
    flightNumber: fn.number,
    origin: origin?.iataCode ?? origin?.icaoCode ?? record.from ?? null,
    destination: destination?.iataCode ?? destination?.icaoCode ?? record.to ?? null,
    divertedTo: divertedTo?.iataCode ?? divertedTo?.icaoCode ?? record.divertedTo ?? null,
    canceled: canceled ?? false,
    distanceMiles: null,
  };

  if (!origin || !destination) return { line, errors, warnings, flight: null, display };

  const timeInput = Object.fromEntries(FLIGHT_TIME_FIELDS.map((f) => [f, record[f]]));
  const { values: times, errors: timeErrors } = convertTimes(timeInput, {
    origin,
    destination,
    divertedTo,
  });
  for (const e of timeErrors) err(col(e.field), e.message);

  const distanceMiles = flightDistanceMiles(origin, destination, divertedTo);
  display.distanceMiles = distanceMiles;

  if (errors.length > 0 || !date.ok || !date.value) {
    return { line, errors, warnings, flight: null, display };
  }

  const refAirports: [number, string][] = [];
  if (record.flightyDepartureAirportId)
    refAirports.push([origin.id, record.flightyDepartureAirportId]);
  if (record.flightyArrivalAirportId)
    refAirports.push([destination.id, record.flightyArrivalAirportId]);
  if (divertedTo && record.flightyDivertedAirportId) {
    refAirports.push([divertedTo.id, record.flightyDivertedAirportId]);
  }

  const flight: PreparedFlight = {
    flightyId: cleanText(record.flightyFlightId),
    flightDate: date.value,
    airlineId: airline?.id ?? null,
    airlineNameRaw,
    flightNumber: fn.number,
    originAirportId: origin.id,
    destinationAirportId: destination.id,
    divertedToAirportId: divertedTo?.id ?? null,
    canceled: canceled ?? false,
    times,
    depTerminal: cleanText(record.depTerminal),
    depGate: cleanText(record.depGate),
    arrTerminal: cleanText(record.arrTerminal),
    arrGate: cleanText(record.arrGate),
    aircraftTypeName: cleanText(record.aircraftTypeName),
    aircraftTypeFlightyId: cleanText(record.flightyAircraftTypeId),
    tailNumber: normalizeTailNumber(record.tailNumber),
    pnr: cleanText(record.pnr),
    seat: cleanText(record.seat)?.toUpperCase() ?? null,
    seatType: normalizeCategory(record.seatType),
    cabinClass: normalizeCategory(record.cabinClass),
    flightReason: normalizeCategory(record.flightReason),
    notes: record.notes?.trim() || null,
    distanceMiles,
    airTimeMinutes: airTimeFrom(times),
    gateTimeMinutes: gateTimeFrom(times),
    sourceRaw,
    refFlightyIds: {
      airports: refAirports,
      airline: airline && record.flightyAirlineId ? [airline.id, record.flightyAirlineId] : null,
    },
  };
  return { line, errors, warnings, flight, display };
}

/**
 * Application-level mirror of the `flights_dedupe_natural_key` index (dedupe rule 2).
 * Must stay in sync with the SQL expression in the init migration.
 */
export function naturalKey(f: {
  flightDate: string;
  airlineId: number | null;
  airlineNameRaw: string | null;
  flightNumber: string | null;
  originAirportId: number;
  destinationAirportId: number;
}): string {
  const airline =
    f.airlineId != null
      ? String(f.airlineId)
      : f.airlineNameRaw != null
        ? `raw:${f.airlineNameRaw.trim().toLowerCase()}`
        : '';
  return [
    f.flightDate,
    airline,
    (f.flightNumber ?? '').toUpperCase(),
    f.originAirportId,
    f.destinationAirportId,
  ].join('|');
}
