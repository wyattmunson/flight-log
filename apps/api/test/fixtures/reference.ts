/**
 * Minimal reference data for tests (real OurAirports / OpenFlights ids and coordinates),
 * so tests don't depend on downloading the full datasets.
 */
import type { Prisma } from '@prisma/client';

const ap = (
  id: number,
  iata: string,
  icao: string,
  name: string,
  city: string,
  country: string,
  latitude: number,
  longitude: number,
  timezone: string,
  type = 'large_airport',
): Prisma.AirportCreateManyInput => ({
  id,
  ident: icao,
  iataCode: iata,
  icaoCode: icao,
  name,
  municipality: city,
  isoCountry: country,
  isoRegion: null,
  latitude,
  longitude,
  elevationFt: null,
  type,
  timezone,
});

export const TEST_AIRPORTS = [
  ap(3878, 'SFO', 'KSFO', 'San Francisco International Airport', 'San Francisco', 'US', 37.619806, -122.374821, 'America/Los_Angeles'),
  ap(5531, 'NRT', 'RJAA', 'Narita International Airport', 'Narita', 'JP', 35.76858, 140.388714, 'Asia/Tokyo'),
  ap(3622, 'JFK', 'KJFK', 'John F. Kennedy International Airport', 'New York', 'US', 40.639447, -73.779317, 'America/New_York'),
  ap(3632, 'LAX', 'KLAX', 'Los Angeles International Airport', 'Los Angeles', 'US', 33.942501, -118.407997, 'America/Los_Angeles'),
  ap(2434, 'LHR', 'EGLL', 'London Heathrow Airport', 'London', 'GB', 51.470748, -0.459909, 'Europe/London'),
  ap(3875, 'SEA', 'KSEA', 'Seattle–Tacoma International Airport', 'Seattle', 'US', 47.447943, -122.310276, 'America/Los_Angeles'),
  ap(3744, 'OAK', 'KOAK', 'Oakland San Francisco Bay Airport', 'Oakland', 'US', 37.720085, -122.221184, 'America/Los_Angeles'),
  ap(3486, 'DEN', 'KDEN', 'Denver International Airport', 'Denver', 'US', 39.860027, -104.673792, 'America/Denver'),
  ap(3754, 'ORD', 'KORD', "Chicago O'Hare International Airport", 'Chicago', 'US', 41.9786, -87.9048, 'America/Chicago'),
  ap(3422, 'BOS', 'KBOS', 'Boston Logan International Airport', 'Boston', 'US', 42.36197, -71.0079, 'America/New_York'),
  ap(5453, 'HNL', 'PHNL', 'Daniel K. Inouye International Airport', 'Honolulu', 'US', 21.318387, -157.92567, 'Pacific/Honolulu'),
  ap(27145, 'SYD', 'YSSY', 'Sydney Kingsford Smith International Airport', 'Sydney (Mascot)', 'AU', -33.946098, 151.177002, 'Australia/Sydney'),
  // A closed airfield sharing SFO's IATA code: resolution must prefer the large airport.
  ap(900001, 'SFO', 'XSFO', 'Old San Francisco Field (closed)', 'San Francisco', 'US', 37.7, -122.4, 'America/Los_Angeles', 'closed'),
];

const al = (
  id: number,
  name: string,
  iata: string | null,
  icao: string | null,
  country: string,
  active = true,
): Prisma.AirlineCreateManyInput => ({ id, name, iataCode: iata, icaoCode: icao, callsign: null, country, active });

export const TEST_AIRLINES = [
  al(5209, 'United Airlines', 'UA', 'UAL', 'United States'),
  al(2009, 'Delta Air Lines', 'DL', 'DAL', 'United States'),
  al(24, 'American Airlines', 'AA', 'AAL', 'United States'),
  al(1355, 'British Airways', 'BA', 'BAW', 'United Kingdom'),
  al(439, 'Alaska Airlines', 'AS', 'ASA', 'United States'),
  al(4547, 'Southwest Airlines', 'WN', 'SWA', 'United States'),
  al(2688, 'Hawaiian Airlines', 'HA', 'HAL', 'United States'),
  al(4089, 'Qantas', 'QF', 'QFA', 'Australia'),
  // Defunct carrier reusing an IATA code: resolution must prefer the active one.
  al(900002, 'Defunct United Test Air', 'UA', null, 'United States', false),
];

export const AIRPORT_ID = Object.fromEntries(
  TEST_AIRPORTS.filter((a) => a.type !== 'closed').map((a) => [a.iataCode, a.id]),
) as Record<string, number>;
export const AIRLINE_ID = Object.fromEntries(
  TEST_AIRLINES.filter((a) => a.active).map((a) => [a.iataCode, a.id]),
) as Record<string, number>;
