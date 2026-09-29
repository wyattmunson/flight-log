import { type Prisma } from '@prisma/client';
import { normalizeFlightNumber, type LookupResponse } from '@flight-log/shared';
import { prisma } from '../db';
import { env } from '../env';
import { AppError } from '../http/errors';
import type { FlightLookupProvider, FlightLookupResult } from './types';

export class LookupNotConfiguredError extends Error {
  constructor() {
    super('Flight lookup is not configured');
  }
}

/** Designator used as the cache key: carrier + number without spaces/leading zeros, e.g. "UA837". */
export function cacheFlightNumber(input: string): string {
  const { carrier, number } = normalizeFlightNumber(input);
  return `${carrier ?? ''}${number ?? ''}`;
}

/**
 * Look up a flight through the active provider with a read-through cache in
 * `flight_lookup_cache` (unique on provider + flight number + date).
 */
export async function lookupFlight(
  provider: FlightLookupProvider,
  input: { flightNumber: string; date: string },
): Promise<LookupResponse> {
  if (!provider.isConfigured()) throw new LookupNotConfiguredError();
  const flightNumber = cacheFlightNumber(input.flightNumber);
  if (!normalizeFlightNumber(input.flightNumber).carrier) {
    throw new AppError(400, 'validation_error', 'Include the airline code, e.g. "UA837"');
  }
  const flightDate = new Date(`${input.date}T00:00:00Z`);
  const key = { provider: provider.name, flightNumber, flightDate };

  const cached = await prisma.flightLookupCache.findUnique({
    where: { provider_flightNumber_flightDate: key },
  });
  if (cached && Date.now() - cached.fetchedAt.getTime() < env.lookupCacheTtlMs) {
    return {
      configured: true,
      provider: provider.name,
      cached: true,
      results: cached.response as unknown as FlightLookupResult[],
    };
  }

  const results = await provider.lookup({ flightNumber, date: input.date });
  const response = results as unknown as Prisma.InputJsonValue;
  await prisma.flightLookupCache.upsert({
    where: { provider_flightNumber_flightDate: key },
    create: { ...key, response },
    update: { response, fetchedAt: new Date() },
  });
  return { configured: true, provider: provider.name, cached: false, results };
}
