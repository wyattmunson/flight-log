import { env } from '../env';
import { NullProvider } from './providers/nullProvider';
import { StubProvider } from './providers/stubProvider';
import type { FlightLookupProvider } from './types';

/**
 * Map FLIGHT_API_PROVIDER to an implementation. To add a real provider: implement
 * `FlightLookupProvider` in ./providers, then add a case here (see README).
 */
export function createLookupProvider(name = env.flightApiProvider): FlightLookupProvider {
  switch (name) {
    case 'stub':
      return new StubProvider();
    case null:
    case '':
    case 'none':
      return new NullProvider();
    default:
      console.warn(`[lookup] Unknown FLIGHT_API_PROVIDER "${name}"; lookups disabled`);
      return new NullProvider();
  }
}
