import { describe, expect, it } from 'vitest';
import { FLIGHTY_COLUMNS, mapHeaders, recordFromRow } from '../../src/import/columns';

const FLIGHTY_HEADER = Object.values(FLIGHTY_COLUMNS);

describe('mapHeaders', () => {
  it('maps the exact Flighty header with nothing missing or unknown', () => {
    const m = mapHeaders(FLIGHTY_HEADER);
    expect(m.unknownColumns).toEqual([]);
    expect(m.missingColumns).toEqual([]);
    expect(m.fields[0]).toBe('date');
    expect(m.fields[FLIGHTY_HEADER.indexOf('Take off (Actual)')]).toBe('takeoffActual');
  });

  it('matches case-insensitively, trims, strips a BOM and reports unknown columns', () => {
    const m = mapHeaders([
      '\uFEFFdate',
      '  FROM ',
      'to',
      'take OFF  (scheduled)',
      'Loyalty Points',
    ]);
    expect(m.fields).toEqual(['date', 'from', 'to', 'takeoffScheduled', undefined]);
    expect(m.unknownColumns).toEqual(['Loyalty Points']);
    expect(m.missingRequired).toEqual([]);
    expect(m.missingColumns).toContain('Airline');
  });

  it('reports missing required columns', () => {
    expect(mapHeaders(['Date', 'Airline']).missingRequired).toEqual(['From', 'To']);
  });
});

describe('recordFromRow', () => {
  it('treats empty cells as null and keeps the whole raw row', () => {
    const m = mapHeaders(['Date', 'From', 'To', 'Extra']);
    const { record, raw } = recordFromRow(['2024-01-01', ' SFO ', '', 'x'], m);
    expect(record).toEqual({ date: '2024-01-01', from: 'SFO', to: null });
    expect(raw).toEqual({ Date: '2024-01-01', From: 'SFO', To: null, Extra: 'x' });
  });
});
