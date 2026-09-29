import { describe, expect, it } from 'vitest';
import { haversineMiles, milesToKm, kmToMiles, roundMiles, convertMiles } from '../src';

const JFK = { latitude: 40.639801, longitude: -73.7789 };
const LHR = { latitude: 51.4706, longitude: -0.461941 };
const LAX = { latitude: 33.942501, longitude: -118.407997 };
const SYD = { latitude: -33.946098, longitude: 151.177002 };

describe('haversineMiles', () => {
  it('is zero for the same point', () => {
    expect(haversineMiles(JFK, JFK)).toBe(0);
  });

  // Published figures (gcmap) are ellipsoidal; a spherical model is within ~0.5%.
  const within = (actual: number, expected: number, pct: number) =>
    expect(Math.abs(actual - expected) / expected).toBeLessThan(pct / 100);

  it('is close to the published JFK–LHR distance (3,451 mi)', () => {
    within(haversineMiles(JFK, LHR), 3451, 0.5);
    expect(haversineMiles(JFK, LHR)).toBeCloseTo(3442.2, 1);
  });

  it('is close to the published LAX–SYD distance across the date line (7,488 mi)', () => {
    within(haversineMiles(LAX, SYD), 7488, 0.5);
  });

  it('gives exactly R·π/180 for one degree along a meridian', () => {
    const d = haversineMiles({ latitude: 10, longitude: 20 }, { latitude: 11, longitude: 20 });
    expect(d).toBeCloseTo((3958.7613 * Math.PI) / 180, 6);
  });

  it('is symmetric', () => {
    expect(haversineMiles(JFK, LHR)).toBeCloseTo(haversineMiles(LHR, JFK), 9);
  });

  it('handles antipodal points (half the circumference)', () => {
    const d = haversineMiles({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 });
    expect(d).toBeCloseTo(Math.PI * 3958.7613, 3);
  });
});

describe('unit helpers', () => {
  it('converts miles and km', () => {
    expect(milesToKm(1)).toBeCloseTo(1.609344, 6);
    expect(kmToMiles(milesToKm(123.4))).toBeCloseTo(123.4, 9);
    expect(convertMiles(100, 'mi')).toBe(100);
    expect(convertMiles(100, 'km')).toBeCloseTo(160.9344, 4);
  });

  it('rounds to one decimal', () => {
    expect(roundMiles(3451.2849)).toBe(3451.3);
  });
});
