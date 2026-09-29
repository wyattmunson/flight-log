import { EARTH_RADIUS_MI, KM_PER_MILE } from './constants';

export interface LatLon {
  latitude: number;
  longitude: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle (haversine) distance between two points, in statute miles. */
export function haversineMiles(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rounded to one decimal, the precision stored in `flights.distance_miles`. */
export function roundMiles(miles: number): number {
  return Math.round(miles * 10) / 10;
}

export const milesToKm = (miles: number) => miles * KM_PER_MILE;
export const kmToMiles = (km: number) => km / KM_PER_MILE;

export type DistanceUnit = 'mi' | 'km';
export function convertMiles(miles: number, unit: DistanceUnit): number {
  return unit === 'km' ? milesToKm(miles) : miles;
}
