import { DateTime } from 'luxon';
import type { FlightLookupProvider, FlightLookupInput, FlightLookupResult } from '../types';

interface CannedFlight {
  airline: FlightLookupResult['airline'];
  origin: string;
  originZone: string;
  destination: string;
  destinationZone: string;
  /** Local wall-clock times as [dayOffset, "HH:mm"] relative to the requested date. */
  gateDeparture: [number, string];
  takeoff: [number, string];
  landing: [number, string];
  gateArrival: [number, string];
  /** Minutes the "actual" times differ from scheduled. */
  delay: number;
  aircraftType: string;
  tailNumber: string;
  altitudeFt: number;
}

/** Canned data for demos and tests. Selected with FLIGHT_API_PROVIDER=stub. */
const CANNED: Record<string, CannedFlight> = {
  UA837: {
    airline: { name: 'United Airlines', iata: 'UA', icao: 'UAL' },
    origin: 'SFO',
    originZone: 'America/Los_Angeles',
    destination: 'NRT',
    destinationZone: 'Asia/Tokyo',
    gateDeparture: [0, '11:00'],
    takeoff: [0, '11:25'],
    landing: [1, '14:55'],
    gateArrival: [1, '15:10'],
    delay: 12,
    aircraftType: 'Boeing 787-9',
    tailNumber: 'N24976',
    altitudeFt: 37000,
  },
  BA117: {
    airline: { name: 'British Airways', iata: 'BA', icao: 'BAW' },
    origin: 'LHR',
    originZone: 'Europe/London',
    destination: 'JFK',
    destinationZone: 'America/New_York',
    gateDeparture: [0, '08:25'],
    takeoff: [0, '08:45'],
    landing: [0, '11:05'],
    gateArrival: [0, '11:20'],
    delay: -5,
    aircraftType: 'Boeing 777-300ER',
    tailNumber: 'G-STBA',
    altitudeFt: 38000,
  },
};

function at(date: string, zone: string, [days, hm]: [number, string], plusMinutes = 0) {
  const [h, m] = hm.split(':').map(Number) as [number, number];
  return DateTime.fromISO(date, { zone })
    .plus({ days })
    .set({ hour: h, minute: m })
    .plus({ minutes: plusMinutes })
    .toUTC()
    .toISO({ suppressMilliseconds: true });
}

export class StubProvider implements FlightLookupProvider {
  readonly name = 'stub';
  isConfigured() {
    return true;
  }
  async lookup({ flightNumber, date }: FlightLookupInput): Promise<FlightLookupResult[]> {
    const c = CANNED[flightNumber.toUpperCase().replace(/\s+/g, '')];
    if (!c) return [];
    const dep = (t: [number, string], d = 0) => at(date, c.originZone, t, d);
    const arr = (t: [number, string], d = 0) => at(date, c.destinationZone, t, d);
    const isPast = DateTime.fromISO(date) < DateTime.now().startOf('day');
    return [
      {
        airline: c.airline,
        flightNumber: flightNumber.toUpperCase(),
        origin: c.origin,
        destination: c.destination,
        gateDepartureScheduled: dep(c.gateDeparture),
        gateDepartureActual: isPast ? dep(c.gateDeparture, c.delay) : null,
        takeoffScheduled: dep(c.takeoff),
        takeoffActual: isPast ? dep(c.takeoff, c.delay) : null,
        landingScheduled: arr(c.landing),
        landingActual: isPast ? arr(c.landing, c.delay) : null,
        gateArrivalScheduled: arr(c.gateArrival),
        gateArrivalActual: isPast ? arr(c.gateArrival, c.delay) : null,
        aircraftType: c.aircraftType,
        tailNumber: c.tailNumber,
        altitudeFt: c.altitudeFt,
        status: isPast ? 'Landed' : 'Scheduled',
        raw: { stub: true, flightNumber, date },
      },
    ];
  }
}
