/** Equatorial circumference of the Earth in statute miles. */
export const EARTH_CIRCUMFERENCE_MI = 24_901;
/** Average Earth–Moon distance in statute miles. */
export const MOON_DISTANCE_MI = 238_855;
/** Mean Earth radius in statute miles (IUGG mean radius 6371.0088 km). */
export const EARTH_RADIUS_MI = 3958.7613;
export const KM_PER_MILE = 1.609344;
/** A flight counts as on time when it arrives (or departs) no more than this many minutes late. */
export const ON_TIME_THRESHOLD_MINUTES = 15;
/** Seeded Phase 1 user. `resolveUser` returns this until real auth exists. */
export const DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000001';
/** Password policy: length only, no composition rules. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
/** Longest User-Agent kept on a session row. */
export const SESSION_USER_AGENT_MAX_LENGTH = 200;
