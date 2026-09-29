/**
 * Derived values shared by CSV import and the add/edit form:
 * UTC conversion of local times, great-circle distance and air time.
 */
import {
  FLIGHT_TIME_FIELDS,
  TIME_FIELD_AIRPORT,
  computeAirTimeMinutes,
  computeGateTimeMinutes,
  haversineMiles,
  parseFlightTime,
  roundMiles,
  type FlightTimeField,
} from '@flight-log/shared';

export interface AirportGeo {
  id: number;
  latitude: number;
  longitude: number;
  timezone: string | null;
}

export type FlightTimeValues = Record<FlightTimeField, Date | null>;

/**
 * Which airport's timezone applies to a naive local time.
 * Departure-side fields use the origin. Arrival-side scheduled times use the planned
 * destination; arrival-side *actual* times use the diversion airport when there is one,
 * since that is where the aircraft really landed.
 */
export function zoneForField(
  field: FlightTimeField,
  airports: { origin: AirportGeo; destination: AirportGeo; divertedTo?: AirportGeo | null },
): string | null {
  if (TIME_FIELD_AIRPORT[field] === 'origin') return airports.origin.timezone;
  const actual = field.endsWith('Actual');
  return (actual && airports.divertedTo ? airports.divertedTo : airports.destination).timezone;
}

export function convertTimes(
  raw: Partial<Record<FlightTimeField, string | null | undefined>>,
  airports: { origin: AirportGeo; destination: AirportGeo; divertedTo?: AirportGeo | null },
): { values: FlightTimeValues; errors: { field: FlightTimeField; message: string }[] } {
  const values = {} as FlightTimeValues;
  const errors: { field: FlightTimeField; message: string }[] = [];
  for (const field of FLIGHT_TIME_FIELDS) {
    const parsed = parseFlightTime(raw[field], zoneForField(field, airports));
    if (parsed.ok) {
      values[field] = parsed.value ? new Date(parsed.value) : null;
    } else {
      values[field] = null;
      errors.push({ field, message: parsed.error });
    }
  }
  return { values, errors };
}

/** Distance to where the flight actually ended: the diversion airport if it diverted. */
export function flightDistanceMiles(
  origin: AirportGeo,
  destination: AirportGeo,
  divertedTo?: AirportGeo | null,
): number {
  return roundMiles(haversineMiles(origin, divertedTo ?? destination));
}

export function airTimeFrom(values: FlightTimeValues): number | null {
  return computeAirTimeMinutes(values);
}

export function gateTimeFrom(values: FlightTimeValues): number | null {
  return computeGateTimeMinutes(values);
}
