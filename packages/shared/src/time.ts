import { DateTime, IANAZone } from 'luxon';

const DATE_FORMATS = [
  'M/d/yyyy',
  'M/d/yy',
  'yyyy/M/d',
  'd MMM yyyy',
  'd MMMM yyyy',
  'MMM d, yyyy',
  'MMMM d, yyyy',
  'MMM d yyyy',
  'd-MMM-yyyy',
  'd-MMM-yy',
  'dd.MM.yyyy',
];

const DATETIME_FORMATS = [
  'M/d/yyyy H:mm',
  'M/d/yyyy H:mm:ss',
  'M/d/yyyy h:mm a',
  'M/d/yyyy h:mm:ss a',
  'M/d/yy H:mm',
  'M/d/yy h:mm a',
  'yyyy/M/d H:mm',
  'yyyy/M/d H:mm:ss',
  'd MMM yyyy H:mm',
  'MMM d, yyyy h:mm a',
  'MMM d, yyyy H:mm',
  'dd.MM.yyyy H:mm',
];

const HAS_OFFSET = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function inRange(dt: DateTime) {
  return dt.isValid && dt.year >= MIN_YEAR && dt.year <= MAX_YEAR;
}

/**
 * Parse a flight date into `yyyy-MM-dd`. Tries ISO first (a full ISO timestamp keeps its
 * local date part), then common variants. Ambiguous slash dates are read US-style (M/d/yyyy).
 */
export function parseFlightDate(value: unknown): ParseResult<string | null> {
  const s = value === null || value === undefined ? '' : String(value).trim();
  if (s === '') return { ok: true, value: null };

  const isoDate = /^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/.exec(s);
  if (isoDate) {
    const dt = DateTime.fromISO(isoDate[1]!, { zone: 'UTC' });
    if (inRange(dt)) return { ok: true, value: dt.toISODate()! };
    return { ok: false, error: `Invalid date "${s}"` };
  }
  for (const fmt of DATE_FORMATS) {
    const dt = DateTime.fromFormat(s, fmt, { zone: 'UTC', locale: 'en-US' });
    if (inRange(dt)) return { ok: true, value: dt.toISODate()! };
  }
  return { ok: false, error: `Unrecognized date format "${s}"` };
}

export function isValidZone(zone: string | null | undefined): zone is string {
  return !!zone && IANAZone.isValidZone(zone);
}

/**
 * Parse a timestamp cell to a UTC ISO string.
 * - A value with an offset or `Z` is honored as-is.
 * - A value without an offset is interpreted as wall-clock time in `zone`
 *   (the relevant airport's IANA timezone). Falls back to UTC if the zone is unknown.
 * - Empty values are `null`.
 */
export function parseFlightTime(
  value: unknown,
  zone: string | null | undefined,
): ParseResult<string | null> {
  const s = value === null || value === undefined ? '' : String(value).trim();
  if (s === '') return { ok: true, value: null };
  const tz = isValidZone(zone) ? zone : 'UTC';

  // Accept "2024-01-02 10:30" by normalizing the separator to ISO's "T".
  const iso = s.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d)/, '$1T$2');
  let dt: DateTime;
  if (/^\d{4}-\d{2}-\d{2}T/.test(iso)) {
    dt = HAS_OFFSET.test(iso)
      ? DateTime.fromISO(iso, { setZone: true })
      : DateTime.fromISO(iso, { zone: tz });
  } else {
    dt = DateTime.invalid('unparsed');
    for (const fmt of DATETIME_FORMATS) {
      const candidate = DateTime.fromFormat(s, fmt, { zone: tz, locale: 'en-US' });
      if (candidate.isValid) {
        dt = candidate;
        break;
      }
    }
  }
  if (!inRange(dt)) return { ok: false, error: `Unrecognized date/time "${s}"` };
  return { ok: true, value: dt.toUTC().toISO({ suppressMilliseconds: true })! };
}

type Instant = string | Date | null | undefined;

function toMillis(v: Instant): number | null {
  if (!v) return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

function minutesBetween(start: Instant, end: Instant): number | null {
  const a = toMillis(start);
  const b = toMillis(end);
  if (a === null || b === null) return null;
  const minutes = Math.round((b - a) / 60_000);
  // Reject nonsense (negative, or longer than any commercial flight).
  return minutes > 0 && minutes <= 30 * 60 ? minutes : null;
}

/** Air time: actual takeoff→landing if both exist, else the scheduled pair, else null. */
export function computeAirTimeMinutes(t: {
  takeoffActual?: Instant;
  landingActual?: Instant;
  takeoffScheduled?: Instant;
  landingScheduled?: Instant;
}): number | null {
  return (
    minutesBetween(t.takeoffActual, t.landingActual) ??
    minutesBetween(t.takeoffScheduled, t.landingScheduled)
  );
}

/** Gate-to-gate time: actual gate departure→arrival if both exist, else the scheduled pair, else null. */
export function computeGateTimeMinutes(t: {
  gateDepartureActual?: Instant;
  gateArrivalActual?: Instant;
  gateDepartureScheduled?: Instant;
  gateArrivalScheduled?: Instant;
}): number | null {
  return (
    minutesBetween(t.gateDepartureActual, t.gateArrivalActual) ??
    minutesBetween(t.gateDepartureScheduled, t.gateArrivalScheduled)
  );
}

/** Delay in whole minutes (positive = late). */
export function delayMinutes(scheduled: Instant, actual: Instant): number | null {
  const a = toMillis(scheduled);
  const b = toMillis(actual);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 60_000);
}

export interface LocalTimeParts {
  date: string;
  time: string;
  /** Short zone name, e.g. "PST", "BST", or "GMT+9" where no abbreviation exists. */
  abbr: string;
  iso: string;
}

export type TimeFormat = '12h' | '24h';

/** Render a UTC instant in an airport's local time. `timeFormat` only changes `time` ("2:05 PM"). */
export function toLocalParts(
  utc: string | Date,
  zone: string | null | undefined,
  timeFormat: TimeFormat = '24h',
): LocalTimeParts {
  const base = utc instanceof Date ? DateTime.fromJSDate(utc) : DateTime.fromISO(utc);
  const dt = base.setZone(isValidZone(zone) ? zone : 'UTC');
  return {
    date: dt.toFormat('ccc, LLL d yyyy'),
    time: dt.setLocale('en-US').toFormat(timeFormat === '12h' ? 'h:mm a' : 'HH:mm'),
    abbr: dt.offsetNameShort ?? dt.toFormat('ZZ'),
    iso: dt.toISO() ?? '',
  };
}

/** UTC instant → value for an `<input type="datetime-local">` in the airport's zone. */
export function toLocalInputValue(
  utc: string | null | undefined,
  zone: string | null | undefined,
): string {
  if (!utc) return '';
  const dt = DateTime.fromISO(utc).setZone(isValidZone(zone) ? zone : 'UTC');
  return dt.isValid ? dt.toFormat("yyyy-MM-dd'T'HH:mm") : '';
}

export function formatMinutes(total: number | null | undefined): string {
  if (total === null || total === undefined) return '—';
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
