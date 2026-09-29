import type { Airline, Airport } from '@prisma/client';
import type { AirlineSummary, AirportSummary } from '@flight-log/shared';

export function toAirportSummary(a: Airport): AirportSummary {
  return {
    id: a.id,
    iata: a.iataCode,
    icao: a.icaoCode,
    name: a.name,
    city: a.municipality,
    country: a.isoCountry,
    timezone: a.timezone,
    latitude: a.latitude,
    longitude: a.longitude,
    type: a.type,
  };
}

export function toAirlineSummary(a: Airline): AirlineSummary {
  return { id: a.id, name: a.name, iata: a.iataCode, icao: a.icaoCode, country: a.country };
}
