/**
 * Flights → CSV in the Flighty import layout (`FLIGHTY_COLUMNS`), so an export can be fed straight
 * back to the importer. Pure: takes rows already loaded through the DAL.
 *
 * Choices that keep the round trip exact:
 * - Times are UTC instants with a `Z` (the importer honors an explicit offset), so nothing depends on
 *   time-zone lookups or DST.
 * - Airports and airlines are written as IATA (else ICAO, else name) codes, plus their Flighty IDs
 *   when known, which is what the importer resolves.
 * - `Flight Flighty ID` is the stored one (blank for manual flights, which then dedupe by natural key).
 *
 * Cells are not sanitized against spreadsheet formulas: doing so would change the data and break the
 * round trip. This is the user's own data; see README → Assumptions.
 */
import { FLIGHTY_COLUMNS, type FlightyField } from '../import/columns';
import type { FlightWithRelations } from '../dal/flights';

const FIELDS = Object.keys(FLIGHTY_COLUMNS) as FlightyField[];

const utc = (d: Date | null) => (d ? d.toISOString().replace('.000Z', 'Z') : '');
const airportCode = (a: { iataCode: string | null; icaoCode: string | null; ident: string }) =>
  a.iataCode ?? a.icaoCode ?? a.ident;

export function flightToRecord(f: FlightWithRelations): Record<FlightyField, string> {
  const airline = f.airline
    ? (f.airline.iataCode ?? f.airline.icaoCode ?? f.airline.name)
    : (f.airlineNameRaw ?? '');
  return {
    date: f.flightDate.toISOString().slice(0, 10),
    airline,
    flight: f.flightNumber ?? '',
    from: airportCode(f.origin),
    to: airportCode(f.destination),
    depTerminal: f.depTerminal ?? '',
    depGate: f.depGate ?? '',
    arrTerminal: f.arrTerminal ?? '',
    arrGate: f.arrGate ?? '',
    canceled: f.canceled ? 'true' : 'false',
    divertedTo: f.divertedTo ? airportCode(f.divertedTo) : '',
    gateDepartureScheduled: utc(f.gateDepartureScheduled),
    gateDepartureActual: utc(f.gateDepartureActual),
    takeoffScheduled: utc(f.takeoffScheduled),
    takeoffActual: utc(f.takeoffActual),
    landingScheduled: utc(f.landingScheduled),
    landingActual: utc(f.landingActual),
    gateArrivalScheduled: utc(f.gateArrivalScheduled),
    gateArrivalActual: utc(f.gateArrivalActual),
    aircraftTypeName: f.aircraftType?.name ?? '',
    tailNumber: f.tailNumber ?? '',
    pnr: f.pnr ?? '',
    seat: f.seat ?? '',
    seatType: f.seatType ?? '',
    cabinClass: f.cabinClass ?? '',
    flightReason: f.flightReason ?? '',
    notes: f.notes ?? '',
    flightyFlightId: f.flightyId ?? '',
    flightyAirlineId: f.airline?.flightyId ?? '',
    flightyDepartureAirportId: f.origin.flightyId ?? '',
    flightyArrivalAirportId: f.destination.flightyId ?? '',
    flightyDivertedAirportId: f.divertedTo?.flightyId ?? '',
    flightyAircraftTypeId: f.aircraftType?.flightyId ?? '',
  };
}

/** RFC 4180 quoting: wrap in quotes when the cell has a comma, quote, CR or LF. */
export const csvCell = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const line = (cells: string[]) => cells.map(csvCell).join(',');

const BOM = String.fromCharCode(0xfeff);

/** UTF-8 BOM first so Excel opens non-ASCII names correctly; the importer strips it. */
export function flightsToCsv(flights: FlightWithRelations[]): string {
  const rows = [line(FIELDS.map((f) => FLIGHTY_COLUMNS[f]))];
  for (const flight of flights) {
    const record = flightToRecord(flight);
    rows.push(line(FIELDS.map((f) => record[f])));
  }
  return `${BOM}${rows.join('\r\n')}\r\n`;
}
