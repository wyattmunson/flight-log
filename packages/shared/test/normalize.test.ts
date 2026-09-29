import { describe, expect, it } from 'vitest';
import {
  classifyAirlineValue,
  classifyAirportCode,
  cleanText,
  normalizeCategory,
  normalizeFlightNumber,
  normalizeTailNumber,
  parseBoolean,
} from '../src';

describe('normalizeFlightNumber', () => {
  it.each([
    ['1234', null, '1234'],
    ['0012', null, '12'],
    ['AA1234', 'AA', '1234'],
    ['AA 1234', 'AA', '1234'],
    ['aa-0100', 'AA', '100'],
    ['B61234', 'B6', '1234'],
    ['9W 7', '9W', '7'],
    ['U2 8123', 'U2', '8123'],
    ['UAL837', 'UAL', '837'],
    ['DL1234A', 'DL', '1234A'],
    [' 45 ', null, '45'],
  ])('%s → carrier %s, number %s', (input, carrier, number) => {
    expect(normalizeFlightNumber(input)).toEqual({ carrier, number });
  });

  it('returns nulls for empty input', () => {
    expect(normalizeFlightNumber('')).toEqual({ carrier: null, number: null });
    expect(normalizeFlightNumber(null)).toEqual({ carrier: null, number: null });
  });

  it('keeps unrecognized values as-is (uppercased, no spaces)', () => {
    expect(normalizeFlightNumber('charter x')).toEqual({ carrier: null, number: 'CHARTERX' });
  });
});

describe('classifyAirlineValue', () => {
  it('treats 2-char codes as IATA', () => {
    expect(classifyAirlineValue('ua')).toEqual({ kind: 'iata', value: 'UA' });
    expect(classifyAirlineValue('B6')).toEqual({ kind: 'iata', value: 'B6' });
  });
  it('treats 3-letter codes as ICAO', () => {
    expect(classifyAirlineValue('DAL')).toEqual({ kind: 'icao', value: 'DAL' });
  });
  it('treats anything else as a name', () => {
    expect(classifyAirlineValue(' British  Airways ')).toEqual({
      kind: 'name',
      value: 'British Airways',
    });
  });
  it('does not treat digits-only as IATA', () => {
    expect(classifyAirlineValue('12')?.kind).toBe('name');
  });
  it('returns null for blanks', () => {
    expect(classifyAirlineValue('  ')).toBeNull();
  });
});

describe('classifyAirportCode', () => {
  it('detects IATA and ICAO', () => {
    expect(classifyAirportCode('sfo')).toEqual({ kind: 'iata', value: 'SFO' });
    expect(classifyAirportCode('KSFO')).toEqual({ kind: 'icao', value: 'KSFO' });
    expect(classifyAirportCode('San Francisco')).toBeNull();
  });
});

describe('normalizeCategory', () => {
  it.each([
    ['economy', 'Economy'],
    ['ECONOMY', 'Economy'],
    [' premium_economy ', 'Premium Economy'],
    ['Premium-Economy', 'Premium Economy'],
    ['window', 'Window'],
    ['', null],
    [null, null],
  ])('%s → %s', (input, expected) => {
    expect(normalizeCategory(input)).toBe(expected);
  });
});

describe('parseBoolean', () => {
  it.each([
    ['true', true],
    ['YES', true],
    ['1', true],
    ['false', false],
    ['no', false],
    ['0', false],
    ['', false],
    [null, false],
    ['maybe', undefined],
  ])('%s → %s', (input, expected) => {
    expect(parseBoolean(input)).toBe(expected);
  });
});

describe('misc', () => {
  it('cleans text', () => {
    expect(cleanText('  a   b ')).toBe('a b');
    expect(cleanText('   ')).toBeNull();
  });
  it('normalizes tail numbers', () => {
    expect(normalizeTailNumber(' n123 ab ')).toBe('N123AB');
  });
});
