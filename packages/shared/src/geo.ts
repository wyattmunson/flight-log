import type { LatLon } from './distance';

export type LonLat = [number, number];

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/**
 * Points along the great circle from `a` to `b` as [lon, lat] pairs.
 *
 * Longitudes are "unwrapped": each point is kept within 180° of the previous one, so a
 * trans-Pacific arc runs continuously past ±180 (e.g. 170 → 190) instead of jumping across
 * the whole map. MapLibre renders out-of-range longitudes into the adjacent world copy.
 */
export function greatCirclePoints(a: LatLon, b: LatLon, segments = 64): LonLat[] {
  const lat1 = toRad(a.latitude);
  const lon1 = toRad(a.longitude);
  const lat2 = toRad(b.latitude);
  const lon2 = toRad(b.longitude);

  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
      ),
    );

  if (d < 1e-9 || Math.abs(Math.PI - d) < 1e-9) {
    // Same point, or antipodal (no unique great circle): fall back to a straight segment.
    return unwrapLongitudes([
      [a.longitude, a.latitude],
      [b.longitude, b.latitude],
    ]);
  }

  const points: LonLat[] = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    points.push([toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }
  return unwrapLongitudes(points);
}

export function unwrapLongitudes(points: LonLat[]): LonLat[] {
  const out: LonLat[] = [];
  for (const [lon, lat] of points) {
    const prev = out[out.length - 1];
    let l = lon;
    if (prev) {
      while (l - prev[0] > 180) l -= 360;
      while (l - prev[0] < -180) l += 360;
    }
    out.push([l, lat]);
  }
  return out;
}

/** Direction-independent key for a route, so A→B and B→A collapse into one. */
export function routeKey(airportIdA: number, airportIdB: number): string {
  return airportIdA < airportIdB ? `${airportIdA}-${airportIdB}` : `${airportIdB}-${airportIdA}`;
}
