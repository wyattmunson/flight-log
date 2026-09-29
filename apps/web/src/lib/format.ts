import {
  convertMiles,
  formatMinutes,
  toLocalParts,
  type AirlineSummary,
  type AirportSummary,
  type DistanceUnit,
} from '@flight-log/shared';

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export const formatInt = (n: number) => nf0.format(n);
export const formatOne = (n: number) => nf1.format(n);
export const formatTwo = (n: number) => nf2.format(n);

export function formatDistance(miles: number, unit: DistanceUnit = 'mi') {
  return `${nf0.format(convertMiles(miles, unit))} ${unit}`;
}

export { formatMinutes };

/** "Jan 15, 2023" from a YYYY-MM-DD date without timezone shifting. */
export function formatDate(isoDate: string) {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export const airportCode = (a: Pick<AirportSummary, 'iata' | 'icao'> | null | undefined) =>
  a?.iata ?? a?.icao ?? '—';

export function airlineLabel(airline: AirlineSummary | null, raw: string | null) {
  return airline?.name ?? raw ?? 'Unknown airline';
}

/** "UA 837" when the airline code is known, otherwise just the number. */
export function flightDesignator(
  airline: Pick<AirlineSummary, 'iata' | 'icao'> | null,
  flightNumber: string | null,
) {
  if (!flightNumber) return '—';
  const code = airline?.iata ?? airline?.icao;
  return code ? `${code} ${flightNumber}` : flightNumber;
}

const regionNames =
  typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

export function countryName(code: string | null | undefined) {
  if (!code) return '—';
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "Jan 15 · 11:38 PST" in the airport's local zone. */
export function formatLocalTime(utc: string | null, zone: string | null | undefined) {
  if (!utc) return null;
  const p = toLocalParts(utc, zone);
  return { ...p, label: `${p.time} ${p.abbr}` };
}

export const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
