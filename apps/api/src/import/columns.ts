/** Flighty CSV export columns, keyed by the field name used internally. */
export const FLIGHTY_COLUMNS = {
  date: 'Date',
  airline: 'Airline',
  flight: 'Flight',
  from: 'From',
  to: 'To',
  depTerminal: 'Dep Terminal',
  depGate: 'Dep Gate',
  arrTerminal: 'Arr Terminal',
  arrGate: 'Arr Gate',
  canceled: 'Canceled',
  divertedTo: 'Diverted To',
  gateDepartureScheduled: 'Gate Departure (Scheduled)',
  gateDepartureActual: 'Gate Departure (Actual)',
  takeoffScheduled: 'Take off (Scheduled)',
  takeoffActual: 'Take off (Actual)',
  landingScheduled: 'Landing (Scheduled)',
  landingActual: 'Landing (Actual)',
  gateArrivalScheduled: 'Gate Arrival (Scheduled)',
  gateArrivalActual: 'Gate Arrival (Actual)',
  aircraftTypeName: 'Aircraft Type Name',
  tailNumber: 'Tail Number',
  pnr: 'PNR',
  seat: 'Seat',
  seatType: 'Seat Type',
  cabinClass: 'Cabin Class',
  flightReason: 'Flight Reason',
  notes: 'Notes',
  flightyFlightId: 'Flight Flighty ID',
  flightyAirlineId: 'Airline Flighty ID',
  flightyDepartureAirportId: 'Departure Airport Flighty ID',
  flightyArrivalAirportId: 'Arrival Airport Flighty ID',
  flightyDivertedAirportId: 'Diverted To Airport Flighty ID',
  flightyAircraftTypeId: 'Aircraft Type Flighty ID',
} as const;

export type FlightyField = keyof typeof FLIGHTY_COLUMNS;
export type FlightyRecord = Partial<Record<FlightyField, string | null>>;

export const REQUIRED_FIELDS: FlightyField[] = ['date', 'from', 'to'];

const normalizeHeader = (h: string) => h.replace(/^﻿/, '').replace(/\s+/g, ' ').trim().toLowerCase();

const HEADER_LOOKUP = new Map<string, FlightyField>(
  Object.entries(FLIGHTY_COLUMNS).map(([field, header]) => [
    normalizeHeader(header),
    field as FlightyField,
  ]),
);

export interface HeaderMapping {
  /** Column index → internal field (undefined for unknown columns). */
  fields: (FlightyField | undefined)[];
  /** Original header text per column, trimmed (used as keys for `source_raw`). */
  headers: string[];
  unknownColumns: string[];
  missingColumns: string[];
  missingRequired: string[];
}

/** Match headers case-insensitively and whitespace-tolerantly; report unknown and missing ones. */
export function mapHeaders(headerRow: string[]): HeaderMapping {
  const headers = headerRow.map((h) => h.replace(/^﻿/, '').trim());
  const seen = new Set<FlightyField>();
  const unknownColumns: string[] = [];
  const fields = headers.map((h) => {
    const field = HEADER_LOOKUP.get(normalizeHeader(h));
    if (!field) {
      if (h) unknownColumns.push(h);
      return undefined;
    }
    if (seen.has(field)) return undefined; // first occurrence wins
    seen.add(field);
    return field;
  });
  const missing = (Object.keys(FLIGHTY_COLUMNS) as FlightyField[]).filter((f) => !seen.has(f));
  return {
    fields,
    headers,
    unknownColumns,
    missingColumns: missing.map((f) => FLIGHTY_COLUMNS[f]),
    missingRequired: REQUIRED_FIELDS.filter((f) => !seen.has(f)).map((f) => FLIGHTY_COLUMNS[f]),
  };
}

/** Turn a raw CSV row into (a) internal fields and (b) the raw object stored in `source_raw`. */
export function recordFromRow(
  row: string[],
  mapping: HeaderMapping,
): { record: FlightyRecord; raw: Record<string, string | null> } {
  const record: FlightyRecord = {};
  const raw: Record<string, string | null> = {};
  mapping.headers.forEach((header, i) => {
    const cell = row[i];
    const value = cell === undefined || cell.trim() === '' ? null : cell.trim();
    const key = header || `column_${i + 1}`;
    if (!(key in raw)) raw[key] = value;
    const field = mapping.fields[i];
    if (field) record[field] = value;
  });
  return { record, raw };
}
