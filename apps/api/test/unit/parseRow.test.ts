import { describe, expect, it } from 'vitest';
import type { Airline, Airport } from '@prisma/client';
import type { ReferenceIndex } from '../../src/dal/reference';
import { naturalKey, parseRow, resolveAirline } from '../../src/import/parseRow';
import type { FlightyRecord } from '../../src/import/columns';

const airport = (id: number, iata: string, icao: string, lat: number, lon: number, tz: string): Airport => ({
  id, ident: icao, iataCode: iata, icaoCode: icao, name: iata, municipality: null, isoCountry: 'US',
  isoRegion: null, latitude: lat, longitude: lon, elevationFt: null, type: 'large_airport', timezone: tz, flightyId: null,
});
const airline = (id: number, name: string, iata: string, icao: string): Airline => ({
  id, name, iataCode: iata, icaoCode: icao, callsign: null, country: null, active: true, flightyId: null,
});

const JFK = airport(3622, 'JFK', 'KJFK', 40.639447, -73.779317, 'America/New_York');
const LHR = airport(2434, 'LHR', 'EGLL', 51.470748, -0.459909, 'Europe/London');
const SEA = airport(3875, 'SEA', 'KSEA', 47.447943, -122.310276, 'America/Los_Angeles');
const SFO = airport(3878, 'SFO', 'KSFO', 37.619806, -122.374821, 'America/Los_Angeles');
const OAK = airport(3744, 'OAK', 'KOAK', 37.720085, -122.221184, 'America/Los_Angeles');
const AA = airline(24, 'American Airlines', 'AA', 'AAL');
const BA = airline(1355, 'British Airways', 'BA', 'BAW');

function index(): ReferenceIndex {
  const airports = [JFK, LHR, SEA, SFO, OAK];
  const airlines = [AA, BA];
  return {
    airportsByIata: new Map(airports.map((a) => [a.iataCode!, a])),
    airportsByIcao: new Map(airports.map((a) => [a.icaoCode!, a])),
    airportsByFlightyId: new Map([['fx-ap-jfk', JFK]]),
    airlinesByIata: new Map(airlines.map((a) => [a.iataCode!, a])),
    airlinesByIcao: new Map(airlines.map((a) => [a.icaoCode!, a])),
    airlinesByName: new Map(airlines.map((a) => [a.name.toLowerCase(), a])),
    airlinesByFlightyId: new Map(),
  };
}

const base: FlightyRecord = {
  date: '2023-06-01',
  airline: 'AA',
  flight: '100',
  from: 'JFK',
  to: 'LHR',
  takeoffActual: '2023-06-01T19:12',
  landingActual: '2023-06-02T07:00',
  flightyFlightId: 'fx-1',
};

describe('parseRow', () => {
  it('parses a complete trans-Atlantic row into UTC times, distance and air time', () => {
    const r = parseRow({ ...base, cabinClass: 'BUSINESS', seatType: 'aisle', pnr: 'ABC123' }, {}, 2, index());
    expect(r.errors).toEqual([]);
    const f = r.flight!;
    expect(f.flightDate).toBe('2023-06-01');
    expect(f.airlineId).toBe(AA.id);
    expect(f.flightNumber).toBe('100');
    expect(f.times.takeoffActual?.toISOString()).toBe('2023-06-01T23:12:00.000Z'); // EDT
    expect(f.times.landingActual?.toISOString()).toBe('2023-06-02T06:00:00.000Z'); // BST
    expect(f.airTimeMinutes).toBe(408);
    expect(f.distanceMiles).toBeCloseTo(3442.3, 1);
    expect(f.cabinClass).toBe('Business');
    expect(f.seatType).toBe('Aisle');
    expect(f.pnr).toBe('ABC123');
  });

  it('resolves airlines by ICAO and by name', () => {
    expect(parseRow({ ...base, airline: 'BAW' }, {}, 2, index()).flight?.airlineId).toBe(BA.id);
    expect(parseRow({ ...base, airline: 'british airways' }, {}, 2, index()).flight?.airlineId).toBe(BA.id);
  });

  it('falls back to the carrier prefix in the flight number', () => {
    const r = parseRow({ ...base, airline: null, flight: 'BA 117' }, {}, 2, index());
    expect(r.flight?.airlineId).toBe(BA.id);
    expect(r.flight?.flightNumber).toBe('117');
  });

  it('keeps an unknown airline as raw text with a warning', () => {
    const r = parseRow({ ...base, airline: 'Aurora Skyways', flight: '45' }, {}, 2, index());
    expect(r.errors).toEqual([]);
    expect(r.flight?.airlineId).toBeNull();
    expect(r.flight?.airlineNameRaw).toBe('Aurora Skyways');
    expect(r.warnings[0]).toMatch(/not found/);
  });

  it('errors on an unknown airport with the column name', () => {
    const r = parseRow({ ...base, from: 'ZZX' }, {}, 7, index());
    expect(r.flight).toBeNull();
    expect(r.errors).toEqual([{ line: 7, column: 'From', message: 'Unknown airport "ZZX"' }]);
  });

  it('resolves ICAO airport codes and falls back to a known Flighty airport id', () => {
    expect(parseRow({ ...base, from: 'KJFK' }, {}, 2, index()).flight?.originAirportId).toBe(JFK.id);
    expect(
      parseRow({ ...base, from: null, flightyDepartureAirportId: 'fx-ap-jfk' }, {}, 2, index()).errors,
    ).toEqual([{ line: 2, column: 'From', message: 'Departure airport is required' }]);
  });

  it('reports unparseable dates and times', () => {
    const r = parseRow({ ...base, date: 'soon', takeoffActual: 'later' }, {}, 3, index());
    expect(r.flight).toBeNull();
    expect(r.errors.map((e) => e.column)).toEqual(['Date', 'Take off (Actual)']);
  });

  it('computes distance to the diversion airport and uses its zone for actual arrival times', () => {
    const r = parseRow(
      { ...base, from: 'SEA', to: 'SFO', divertedTo: 'OAK', takeoffActual: '2023-08-05T07:20', landingActual: '2023-08-05T09:10' },
      {},
      2,
      index(),
    );
    expect(r.flight?.divertedToAirportId).toBe(OAK.id);
    expect(r.flight?.distanceMiles).toBeCloseTo(672.1, 1);
    expect(r.flight?.airTimeMinutes).toBe(110);
  });

  it('parses canceled values', () => {
    expect(parseRow({ ...base, canceled: 'YES' }, {}, 2, index()).flight?.canceled).toBe(true);
    expect(parseRow({ ...base, canceled: '0' }, {}, 2, index()).flight?.canceled).toBe(false);
    const odd = parseRow({ ...base, canceled: 'maybe' }, {}, 2, index());
    expect(odd.flight?.canceled).toBe(false);
    expect(odd.warnings[0]).toMatch(/Canceled/);
  });
});

describe('resolveAirline', () => {
  it('prefers the Airline cell over the flight-number carrier', () => {
    expect(resolveAirline('BA', 'AA', null, index())?.id).toBe(BA.id);
  });
});

describe('naturalKey (dedupe rule 2)', () => {
  const f = {
    flightDate: '2024-05-05',
    airlineId: 2688,
    airlineNameRaw: 'HA',
    flightNumber: '11',
    originAirportId: 3632,
    destinationAirportId: 5453,
  };

  it('uses the airline id when resolved, ignoring the raw text', () => {
    expect(naturalKey(f)).toBe(naturalKey({ ...f, airlineNameRaw: 'Hawaiian Airlines' }));
  });

  it('uses the normalized raw name when unresolved', () => {
    const a = naturalKey({ ...f, airlineId: null, airlineNameRaw: 'Aurora Skyways ' });
    expect(a).toBe(naturalKey({ ...f, airlineId: null, airlineNameRaw: 'aurora skyways' }));
    expect(a).not.toBe(naturalKey(f));
  });

  it('distinguishes date, number and direction', () => {
    expect(naturalKey(f)).not.toBe(naturalKey({ ...f, flightDate: '2024-05-06' }));
    expect(naturalKey(f)).not.toBe(naturalKey({ ...f, flightNumber: '12' }));
    expect(naturalKey(f)).not.toBe(
      naturalKey({ ...f, originAirportId: 5453, destinationAirportId: 3632 }),
    );
  });
});
