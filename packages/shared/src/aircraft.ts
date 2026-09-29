/**
 * Aircraft families ("Boeing 777", "Airbus A320", …) derived from an aircraft type name.
 * No data source provides the family, so it is computed from the type name by ordered rules.
 * The first matching rule wins; a type that matches nothing has no family (shown as "Unknown").
 * Families are marketing families: 737 includes Classic/NG/MAX, A320 includes A318–A321 and neo.
 */
export interface AircraftFamilyDef {
  name: string;
  manufacturer: string;
  /** Tested against the compacted type name (lowercase letters/digits only), with and without a manufacturer prefix. */
  match: RegExp;
}

export const AIRCRAFT_FAMILIES: readonly AircraftFamilyDef[] = [
  { name: 'Boeing 707', manufacturer: 'Boeing', match: /^b?707/ },
  { name: 'Boeing 717', manufacturer: 'Boeing', match: /^b?717/ },
  { name: 'Boeing 727', manufacturer: 'Boeing', match: /^b?727/ },
  { name: 'Boeing 737', manufacturer: 'Boeing', match: /^b?737/ },
  { name: 'Boeing 747', manufacturer: 'Boeing', match: /^b?747/ },
  { name: 'Boeing 757', manufacturer: 'Boeing', match: /^b?757/ },
  { name: 'Boeing 767', manufacturer: 'Boeing', match: /^b?767/ },
  { name: 'Boeing 777', manufacturer: 'Boeing', match: /^b?777/ },
  { name: 'Boeing 787', manufacturer: 'Boeing', match: /^b?787/ },
  { name: 'Airbus A220', manufacturer: 'Airbus', match: /^(a220|cs[13]00)/ },
  { name: 'Airbus A300/A310', manufacturer: 'Airbus', match: /^a3(00|10)/ },
  { name: 'Airbus A320', manufacturer: 'Airbus', match: /^a3(18|19|20|21)/ },
  { name: 'Airbus A330', manufacturer: 'Airbus', match: /^a33\d/ },
  { name: 'Airbus A340', manufacturer: 'Airbus', match: /^a34\d/ },
  { name: 'Airbus A350', manufacturer: 'Airbus', match: /^a35\d/ },
  { name: 'Airbus A380', manufacturer: 'Airbus', match: /^a38\d/ },
  // E2 before E-Jet: "E190-E2" would otherwise match the E-Jet rule.
  { name: 'Embraer E-Jet E2', manufacturer: 'Embraer', match: /^e?(175|190|195)e2/ },
  { name: 'Embraer E-Jet', manufacturer: 'Embraer', match: /^e?(170|175|190|195)/ },
  { name: 'Embraer ERJ', manufacturer: 'Embraer', match: /^(erj|rj)?(135|140|145)/ },
  { name: 'Bombardier CRJ', manufacturer: 'Bombardier', match: /^(crj|canadairregionaljet)/ },
  { name: 'De Havilland Dash 8', manufacturer: 'De Havilland', match: /^(dhc8|dash8|q[1-4]00)/ },
  { name: 'ATR 42/72', manufacturer: 'ATR', match: /^atr/ },
];

const MANUFACTURER_PREFIX =
  /^(boeing|airbus|embraer|bombardier|mcdonnelldouglas|dehavillandcanada|dehavilland|canadair)/;

/** The family name for an aircraft type name, or null when no rule matches. */
export function classifyAircraftFamily(typeName: string | null | undefined): string | null {
  const compact = (typeName ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!compact) return null;
  const candidates = [compact, compact.replace(MANUFACTURER_PREFIX, '')];
  return AIRCRAFT_FAMILIES.find((f) => candidates.some((c) => f.match.test(c)))?.name ?? null;
}
