import type { FlightLookupProvider } from '../types';

/** Default when FLIGHT_API_PROVIDER is unset: lookups are unavailable. */
export class NullProvider implements FlightLookupProvider {
  readonly name = 'none';
  isConfigured() {
    return false;
  }
  async lookup(): Promise<never> {
    throw new Error('No flight lookup provider is configured');
  }
}
