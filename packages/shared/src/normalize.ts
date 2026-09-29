/** Trim and collapse internal whitespace; empty → null. */
export function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

/**
 * Normalize a free-text category (cabin class, seat type, flight reason) for grouping:
 * trims, turns `_`/`-` separators into spaces and title-cases each word.
 * `"PREMIUM_ECONOMY"`, `" premium economy "` → `"Premium Economy"`.
 */
export function normalizeCategory(value: unknown): string | null {
  const s = cleanText(value);
  if (!s) return null;
  return s
    .replace(/[_]+/g, ' ')
    .replace(/\s*-\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

export interface NormalizedFlightNumber {
  /** Carrier prefix (IATA 2-char or ICAO 3-letter) if the value contained one. */
  carrier: string | null;
  /** Numeric part without leading zeros, plus any operational suffix letter (e.g. "1234", "12A"). */
  number: string | null;
}

const NUMBER_ONLY = /^0*(\d{1,5})([A-Z]?)$/;
// Carrier must contain at least one letter: "AA", "B6", "9W", "UAL".
const WITH_CARRIER = /^([A-Z][A-Z0-9][A-Z]?|[0-9][A-Z][A-Z]?)[\s-]*0*(\d{1,5})([A-Z]?)$/;

/**
 * Split a flight designator into carrier and number.
 * `"1234"` → {carrier: null, number: "1234"}; `"AA 0012"` → {carrier: "AA", number: "12"}.
 * Unrecognized input keeps its cleaned, upper-cased form as `number`.
 */
export function normalizeFlightNumber(value: unknown): NormalizedFlightNumber {
  const s = cleanText(value)?.toUpperCase();
  if (!s) return { carrier: null, number: null };
  const compact = s.replace(/\s+/g, ' ');
  const only = NUMBER_ONLY.exec(compact);
  if (only) return { carrier: null, number: `${only[1]}${only[2]}` };
  const withCarrier = WITH_CARRIER.exec(compact);
  if (withCarrier) {
    return { carrier: withCarrier[1]!, number: `${withCarrier[2]}${withCarrier[3]}` };
  }
  return { carrier: null, number: compact.replace(/\s+/g, '') };
}

export type AirlineCodeKind = 'iata' | 'icao' | 'name';

/**
 * Guess how an airline cell should be matched: 2-char codes are IATA, 3-letter codes are ICAO,
 * everything else is a name. Resolution still falls back through all three.
 */
export function classifyAirlineValue(value: unknown): { kind: AirlineCodeKind; value: string } | null {
  const s = cleanText(value);
  if (!s) return null;
  const up = s.toUpperCase();
  if (/^(?=.*[A-Z])[A-Z0-9]{2}$/.test(up)) return { kind: 'iata', value: up };
  if (/^[A-Z]{3}$/.test(up)) return { kind: 'icao', value: up };
  return { kind: 'name', value: s };
}

/** Airport codes: 3 letters → IATA, 4 alphanumerics → ICAO. */
export function classifyAirportCode(value: unknown): { kind: 'iata' | 'icao'; value: string } | null {
  const s = cleanText(value)?.toUpperCase();
  if (!s) return null;
  if (/^[A-Z]{3}$/.test(s)) return { kind: 'iata', value: s };
  if (/^[A-Z0-9]{4}$/.test(s)) return { kind: 'icao', value: s };
  return null;
}

const TRUE_VALUES = new Set(['true', 'yes', 'y', '1', 't']);
const FALSE_VALUES = new Set(['false', 'no', 'n', '0', 'f', '']);

/** Accepts true/false/yes/no/1/0/blank (case-insensitive). Returns undefined for anything else. */
export function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  const s = value === null || value === undefined ? '' : String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(s)) return true;
  if (FALSE_VALUES.has(s)) return false;
  return undefined;
}

export function normalizeTailNumber(value: unknown): string | null {
  const s = cleanText(value);
  return s ? s.toUpperCase().replace(/\s+/g, '') : null;
}
