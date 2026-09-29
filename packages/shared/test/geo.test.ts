import { describe, expect, it } from 'vitest';
import { greatCirclePoints, routeKey, unwrapLongitudes } from '../src';

const SFO = { latitude: 37.619, longitude: -122.375 };
const NRT = { latitude: 35.7647, longitude: 140.386 };
const JFK = { latitude: 40.6398, longitude: -73.7789 };
const LHR = { latitude: 51.4706, longitude: -0.461941 };

const maxJump = (pts: [number, number][]) =>
  Math.max(...pts.slice(1).map((p, i) => Math.abs(p[0] - pts[i]![0])));

describe('greatCirclePoints', () => {
  it('starts and ends at the endpoints', () => {
    const pts = greatCirclePoints(JFK, LHR, 32);
    expect(pts).toHaveLength(33);
    expect(pts[0]![0]).toBeCloseTo(JFK.longitude, 6);
    expect(pts[0]![1]).toBeCloseTo(JFK.latitude, 6);
    expect(pts[32]![0]).toBeCloseTo(LHR.longitude, 6);
    expect(pts[32]![1]).toBeCloseTo(LHR.latitude, 6);
  });

  it('bulges poleward for a trans-Atlantic route', () => {
    const pts = greatCirclePoints(JFK, LHR, 32);
    expect(Math.max(...pts.map((p) => p[1]))).toBeGreaterThan(LHR.latitude);
  });

  it('crosses the antimeridian continuously for a trans-Pacific route', () => {
    const pts = greatCirclePoints(SFO, NRT, 64);
    expect(maxJump(pts)).toBeLessThan(10);
    // Unwrapped: goes west past -180 instead of jumping to +140.
    expect(pts[pts.length - 1]![0]).toBeCloseTo(140.386 - 360, 3);
    // And arcs north over the Pacific.
    expect(Math.max(...pts.map((p) => p[1]))).toBeGreaterThan(45);
  });

  it('handles the reverse trans-Pacific direction', () => {
    const pts = greatCirclePoints(NRT, SFO, 64);
    expect(maxJump(pts)).toBeLessThan(10);
    expect(pts[pts.length - 1]![0]).toBeCloseTo(-122.375 + 360, 3);
  });

  it('returns a two-point line for identical endpoints', () => {
    expect(greatCirclePoints(JFK, JFK)).toHaveLength(2);
  });
});

describe('unwrapLongitudes', () => {
  it('keeps consecutive points within 180°', () => {
    expect(
      unwrapLongitudes([
        [170, 0],
        [-175, 0],
        [-160, 0],
      ]),
    ).toEqual([
      [170, 0],
      [185, 0],
      [200, 0],
    ]);
  });
});

describe('routeKey', () => {
  it('is direction independent', () => {
    expect(routeKey(5, 2)).toBe('2-5');
    expect(routeKey(2, 5)).toBe('2-5');
  });
});
