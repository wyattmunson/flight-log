import type { FlightLookupResult } from '@flight-log/shared';

export type { FlightLookupResult };

export interface FlightLookupInput {
  /** Normalized designator including carrier, e.g. "UA837". */
  flightNumber: string;
  /** Local departure date, YYYY-MM-DD. */
  date: string;
}

/**
 * A source of flight data looked up by flight number + departure date.
 * Implementations should map their payload into `FlightLookupResult` (times as UTC ISO
 * strings, airports as IATA codes) and keep the untouched payload in `raw`.
 */
export interface FlightLookupProvider {
  /** Stable id, also the `provider` column in `flight_lookup_cache`. */
  name: string;
  /** False when required config (API key etc.) is missing. */
  isConfigured(): boolean;
  lookup(input: FlightLookupInput): Promise<FlightLookupResult[]>;
}
