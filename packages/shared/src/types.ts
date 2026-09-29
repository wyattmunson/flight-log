/** API response shapes shared by the API and the web client. */

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface AirportSummary {
  id: number;
  iata: string | null;
  icao: string | null;
  name: string;
  city: string | null;
  country: string | null;
  timezone: string | null;
  latitude: number;
  longitude: number;
  type?: string;
}

export interface AirlineSummary {
  id: number;
  name: string;
  iata: string | null;
  icao: string | null;
  country?: string | null;
}

export interface FlightTimes {
  gateDepartureScheduled: string | null;
  gateDepartureActual: string | null;
  takeoffScheduled: string | null;
  takeoffActual: string | null;
  landingScheduled: string | null;
  landingActual: string | null;
  gateArrivalScheduled: string | null;
  gateArrivalActual: string | null;
}

/** Row shape for list views: never contains PNR or seat. */
export interface FlightListItem extends FlightTimes {
  id: string;
  flightDate: string;
  source: 'flighty_csv' | 'manual' | 'api';
  airline: AirlineSummary | null;
  airlineNameRaw: string | null;
  flightNumber: string | null;
  origin: AirportSummary;
  destination: AirportSummary;
  divertedTo: AirportSummary | null;
  canceled: boolean;
  aircraftType: string | null;
  tailNumber: string | null;
  cabinClass: string | null;
  distanceMiles: number;
  airTimeMinutes: number | null;
}

/** Full record for the detail view, including personal fields. */
export interface FlightDetail extends FlightListItem {
  flightyId: string | null;
  importBatchId: string | null;
  depTerminal: string | null;
  depGate: string | null;
  arrTerminal: string | null;
  arrGate: string | null;
  pnr: string | null;
  seat: string | null;
  seatType: string | null;
  flightReason: string | null;
  notes: string | null;
  cruiseAltitudeFt: number | null;
  maxAltitudeFt: number | null;
  groundSpeedKts: number | null;
  lookupSource: string | null;
  lookupFetchedAt: string | null;
  sourceRaw: Record<string, string | null> | null;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export type ImportRowStatus = 'new' | 'duplicate' | 'invalid';

export interface ImportRowError {
  /** 1-based line number in the file (header is line 1). */
  line: number;
  column?: string;
  message: string;
}

export interface ImportPreviewRow {
  line: number;
  status: ImportRowStatus;
  duplicateReason?: string;
  errors: ImportRowError[];
  warnings: string[];
  flightDate: string | null;
  airline: string | null;
  flightNumber: string | null;
  origin: string | null;
  destination: string | null;
  divertedTo: string | null;
  canceled: boolean;
  distanceMiles: number | null;
}

export interface ImportPreview {
  previewId: string;
  filename: string;
  expiresAt: string;
  counts: { total: number; new: number; duplicate: number; invalid: number };
  unknownColumns: string[];
  missingColumns: string[];
  /** A committed batch with the same file hash, if any. */
  previouslyImportedBatchId: string | null;
  sample: ImportPreviewRow[];
  errors: ImportRowError[];
}

export interface ImportSummary {
  batchId: string;
  total: number;
  imported: number;
  duplicates: number;
  failed: number;
  errors: ImportRowError[];
}

export interface ImportBatch {
  id: string;
  filename: string;
  status: 'committed' | 'undone';
  total: number;
  imported: number;
  duplicates: number;
  failed: number;
  remainingFlights: number;
  createdAt: string;
}

export interface MapAirport extends AirportSummary {
  visits: number;
  departures: number;
  arrivals: number;
}

export interface MapRoute {
  key: string;
  airportA: number;
  airportB: number;
  count: number;
  distanceMiles: number;
  /** [lon, lat] points along the great circle, longitudes unwrapped across the antimeridian. */
  path: [number, number][];
}

export interface MapData {
  airports: MapAirport[];
  routes: MapRoute[];
}

export interface RouteFlight {
  id: string;
  flightDate: string;
  airline: string | null;
  flightNumber: string | null;
  origin: string | null;
  destination: string | null;
}

export interface FilterOptions {
  years: number[];
  airlines: { value: string; label: string; count: number }[];
  cabins: { value: string; count: number }[];
}

export interface NamedCount {
  label: string;
  flights: number;
  miles: number;
}

export interface StatsAirportRow {
  id: number;
  iata: string | null;
  icao: string | null;
  name: string;
  city: string | null;
  country: string | null;
  departures: number;
  arrivals: number;
  visits: number;
}

export interface StatsFlightRef {
  id: string;
  flightDate: string;
  airline: string | null;
  flightNumber: string | null;
  origin: string | null;
  destination: string | null;
  distanceMiles: number;
}

export interface Stats {
  headline: {
    totalFlights: number;
    canceledFlights: number;
    totalMiles: number;
    totalAirMinutes: number;
    flightsWithAirTime: number;
    uniqueAirports: number;
    uniqueAirlines: number;
    uniqueCountries: number;
    timesAroundEarth: number;
    percentToMoon: number;
  };
  airports: StatsAirportRow[];
  airlines: (NamedCount & { airlineId: number | null })[];
  aircraftTypes: NamedCount[];
  tails: { tailNumber: string; flights: number; aircraftTypes: string[]; airlines: string[] }[];
  perYear: { year: number; flights: number; miles: number }[];
  perMonth: { month: string; flights: number; miles: number }[];
  byMonthOfYear: { month: number; flights: number }[];
  cabinClass: { label: string; flights: number }[];
  seatType: { label: string; flights: number }[];
  flightReason: { label: string; flights: number }[];
  records: {
    longest: StatsFlightRef | null;
    shortest: StatsFlightRef | null;
    topRoute: { a: string; b: string; flights: number; distanceMiles: number } | null;
    busiestDay: { date: string; flights: number } | null;
  };
  punctuality: {
    thresholdMinutes: number;
    departureSamples: number;
    arrivalSamples: number;
    avgDepartureDelayMinutes: number | null;
    avgArrivalDelayMinutes: number | null;
    departureOnTimePercent: number | null;
    arrivalOnTimePercent: number | null;
  };
}

export interface FlightLookupResult {
  airline: { name: string | null; iata: string | null; icao: string | null };
  flightNumber: string;
  origin: string | null;
  destination: string | null;
  gateDepartureScheduled: string | null;
  gateDepartureActual: string | null;
  takeoffScheduled: string | null;
  takeoffActual: string | null;
  landingScheduled: string | null;
  landingActual: string | null;
  gateArrivalScheduled: string | null;
  gateArrivalActual: string | null;
  aircraftType: string | null;
  tailNumber: string | null;
  altitudeFt: number | null;
  status: string | null;
  raw: unknown;
}

export interface LookupResponse {
  configured: boolean;
  provider: string | null;
  cached?: boolean;
  results: FlightLookupResult[];
}

export interface AppConfig {
  mapStyleUrl: string;
  lookup: { configured: boolean; provider: string | null };
}
