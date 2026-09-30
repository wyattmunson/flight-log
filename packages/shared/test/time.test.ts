import { describe, expect, it } from 'vitest';
import {
  computeAirTimeMinutes,
  computeGateTimeMinutes,
  delayMinutes,
  formatMinutes,
  parseFlightDate,
  parseFlightTime,
  toLocalInputValue,
  toLocalParts,
} from '../src';

const ok = <T>(r: { ok: boolean; value?: T; error?: string }) => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('parseFlightDate', () => {
  it.each([
    ['2023-06-01', '2023-06-01'],
    ['2023-06-01T19:00', '2023-06-01'],
    ['6/1/2023', '2023-06-01'],
    ['06/01/23', '2023-06-01'],
    ['2023/6/1', '2023-06-01'],
    ['1 Jun 2023', '2023-06-01'],
    ['Jun 1, 2023', '2023-06-01'],
    ['01.06.2023', '2023-06-01'],
  ])('%s → %s', (input, expected) => {
    expect(ok(parseFlightDate(input))).toBe(expected);
  });

  it('returns null for blanks', () => {
    expect(ok(parseFlightDate(''))).toBeNull();
  });

  it('rejects garbage and impossible dates', () => {
    expect(parseFlightDate('not a date').ok).toBe(false);
    expect(parseFlightDate('2023-02-30').ok).toBe(false);
    expect(parseFlightDate('13/45/2023').ok).toBe(false);
  });
});

describe('parseFlightTime', () => {
  it('interprets naive times in the airport zone (trans-Atlantic, EDT → BST)', () => {
    // JFK departure 19:00 EDT (UTC-4) → 23:00Z
    const dep = ok(parseFlightTime('2023-06-01T19:00', 'America/New_York'));
    expect(dep).toBe('2023-06-01T23:00:00Z');
    // LHR arrival 07:05 BST (UTC+1) next day → 06:05Z
    const arr = ok(parseFlightTime('2023-06-02T07:05', 'Europe/London'));
    expect(arr).toBe('2023-06-02T06:05:00Z');
    expect(computeAirTimeMinutes({ takeoffActual: dep, landingActual: arr })).toBe(425);
  });

  it('handles a westbound date-line crossing (LAX → SYD loses a day)', () => {
    const dep = ok(parseFlightTime('2024-07-01T22:30', 'America/Los_Angeles'));
    const arr = ok(parseFlightTime('2024-07-03T06:30', 'Australia/Sydney'));
    expect(dep).toBe('2024-07-02T05:30:00Z');
    expect(arr).toBe('2024-07-02T20:30:00Z');
    expect(computeAirTimeMinutes({ takeoffScheduled: dep, landingScheduled: arr })).toBe(900);
  });

  it('handles an eastbound date-line crossing (SYD → LAX lands "before" it left)', () => {
    const dep = ok(parseFlightTime('2024-07-20T12:00', 'Australia/Sydney'));
    const arr = ok(parseFlightTime('2024-07-20T08:30', 'America/Los_Angeles'));
    expect(dep).toBe('2024-07-20T02:00:00Z');
    expect(arr).toBe('2024-07-20T15:30:00Z');
    expect(computeAirTimeMinutes({ takeoffActual: dep, landingActual: arr })).toBe(810);
  });

  it('honors explicit offsets and Z regardless of zone', () => {
    expect(ok(parseFlightTime('2023-03-11T13:05:00Z', 'America/New_York'))).toBe(
      '2023-03-11T13:05:00Z',
    );
    expect(ok(parseFlightTime('2023-03-11T08:05:00-05:00', 'Asia/Tokyo'))).toBe(
      '2023-03-11T13:05:00Z',
    );
    expect(ok(parseFlightTime('2023-03-11T22:05+0900', 'UTC'))).toBe('2023-03-11T13:05:00Z');
  });

  it('accepts a space separator and US formats', () => {
    expect(ok(parseFlightTime('2023-01-15 11:00', 'America/Los_Angeles'))).toBe(
      '2023-01-15T19:00:00Z',
    );
    expect(ok(parseFlightTime('1/15/2023 11:00 AM', 'America/Los_Angeles'))).toBe(
      '2023-01-15T19:00:00Z',
    );
  });

  it('falls back to UTC for an unknown zone', () => {
    expect(ok(parseFlightTime('2023-01-15T11:00', 'Not/AZone'))).toBe('2023-01-15T11:00:00Z');
  });

  it('treats blanks as null and rejects garbage', () => {
    expect(ok(parseFlightTime('  ', 'UTC'))).toBeNull();
    expect(parseFlightTime('soon', 'UTC').ok).toBe(false);
  });
});

describe('computeAirTimeMinutes', () => {
  it('prefers actuals, then scheduled, else null', () => {
    const t = {
      takeoffScheduled: '2024-01-01T10:00:00Z',
      landingScheduled: '2024-01-01T12:00:00Z',
      takeoffActual: '2024-01-01T10:15:00Z',
      landingActual: '2024-01-01T12:05:00Z',
    };
    expect(computeAirTimeMinutes(t)).toBe(110);
    expect(computeAirTimeMinutes({ ...t, landingActual: null })).toBe(120);
    expect(computeAirTimeMinutes({})).toBeNull();
  });

  it('ignores negative durations', () => {
    expect(
      computeAirTimeMinutes({
        takeoffActual: '2024-01-01T12:00:00Z',
        landingActual: '2024-01-01T10:00:00Z',
      }),
    ).toBeNull();
  });
});

describe('display helpers', () => {
  it('renders local parts with zone abbreviation', () => {
    const p = toLocalParts('2023-06-01T23:00:00Z', 'America/New_York');
    expect(p.time).toBe('19:00');
    expect(p.abbr).toBe('EDT');
  });

  it('renders 12-hour time on request, and keeps 24-hour as the default', () => {
    expect(toLocalParts('2023-06-01T23:00:00Z', 'America/New_York', '12h').time).toBe('7:00 PM');
    expect(toLocalParts('2023-06-01T04:05:00Z', 'UTC', '12h').time).toBe('4:05 AM');
    expect(toLocalParts('2023-06-01T00:00:00Z', 'UTC', '12h').time).toBe('12:00 AM');
    expect(toLocalParts('2023-06-01T12:30:00Z', 'UTC', '12h').time).toBe('12:30 PM');
    expect(toLocalParts('2023-06-01T23:00:00Z', 'America/New_York', '24h').time).toBe('19:00');
    expect(toLocalParts('2023-06-01T23:00:00Z', 'America/New_York').time).toBe('19:00');
  });

  it('round-trips a datetime-local input value', () => {
    expect(toLocalInputValue('2024-07-02T20:30:00Z', 'Australia/Sydney')).toBe('2024-07-03T06:30');
    expect(toLocalInputValue(null, 'UTC')).toBe('');
  });

  it('computes delays and formats minutes', () => {
    expect(delayMinutes('2024-01-01T10:00:00Z', '2024-01-01T10:20:00Z')).toBe(20);
    expect(formatMinutes(425)).toBe('7h 05m');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(null)).toBe('—');
  });
});

describe('computeGateTimeMinutes', () => {
  it('prefers the actual gate pair, then the scheduled pair, else null', () => {
    const t = {
      gateDepartureScheduled: '2024-01-01T10:00:00Z',
      gateArrivalScheduled: '2024-01-01T12:00:00Z',
      gateDepartureActual: '2024-01-01T10:15:00Z',
      gateArrivalActual: '2024-01-01T12:05:00Z',
    };
    expect(computeGateTimeMinutes(t)).toBe(110);
    expect(computeGateTimeMinutes({ ...t, gateArrivalActual: null })).toBe(120);
    expect(computeGateTimeMinutes({})).toBeNull();
  });

  it('is independent of takeoff/landing times', () => {
    expect(
      computeGateTimeMinutes({
        takeoffActual: '2024-01-01T10:00:00Z',
        landingActual: '2024-01-01T12:00:00Z',
      }),
    ).toBeNull();
  });

  it('ignores negative durations', () => {
    expect(
      computeGateTimeMinutes({
        gateDepartureActual: '2024-01-01T12:00:00Z',
        gateArrivalActual: '2024-01-01T10:00:00Z',
      }),
    ).toBeNull();
  });
});
