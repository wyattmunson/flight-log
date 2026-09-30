import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlightDetail } from '@flight-log/shared';
import { FlightDetailView } from '../src/components/FlightDetail';

const airport = (id: number, iata: string, name: string, timezone: string) => ({
  id,
  iata,
  icao: null,
  name,
  city: null,
  country: 'US',
  timezone,
  latitude: 0,
  longitude: 0,
});

const flight: FlightDetail = {
  id: 'f1',
  flightDate: '2024-07-01',
  source: 'manual',
  airline: { id: 4089, name: 'Qantas', iata: 'QF', icao: 'QFA' },
  airlineNameRaw: null,
  flightNumber: '12',
  origin: airport(1, 'LAX', 'Los Angeles International', 'America/Los_Angeles'),
  destination: airport(2, 'SYD', 'Sydney Kingsford Smith', 'Australia/Sydney'),
  divertedTo: null,
  canceled: false,
  aircraftType: 'Airbus A380-800',
  tailNumber: 'VH-OQA',
  cabinClass: 'Business',
  distanceMiles: 7494.4,
  airTimeMinutes: 900,
  gateTimeMinutes: null,
  aircraftFamily: null,
  gateDepartureScheduled: null,
  gateDepartureActual: null,
  takeoffScheduled: '2024-07-02T05:30:00.000Z',
  takeoffActual: null,
  landingScheduled: '2024-07-02T20:30:00.000Z',
  landingActual: null,
  gateArrivalScheduled: null,
  gateArrivalActual: null,
  flightyId: null,
  importBatchId: null,
  depTerminal: 'B',
  depGate: '148',
  arrTerminal: null,
  arrGate: null,
  pnr: 'SECRET1',
  seat: '11A',
  seatType: 'Window',
  flightReason: 'Personal',
  notes: null,
  cruiseAltitudeFt: null,
  maxAltitudeFt: null,
  groundSpeedKts: null,
  lookupSource: null,
  lookupFetchedAt: null,
  sourceRaw: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

type Prefs = { distanceUnit: 'mi' | 'km'; timeFormat: '12h' | '24h' };

/** Renders the detail with the given saved preferences answered by a stubbed API. */
function renderDetail(prefs: Prefs = { distanceUnit: 'mi', timeFormat: '12h' }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ ...prefs, homeAirportId: null, homeAirport: null }), {
          status: 200,
        }),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FlightDetailView flight={flight} onDelete={vi.fn()} deleting={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('FlightDetailView', () => {
  it('shows times in each airport’s local zone, across the date line (12-hour by default)', () => {
    renderDetail();
    const takeoff = screen.getByRole('row', { name: /Takeoff/ });
    expect(within(takeoff).getByText('10:30 PM')).toBeInTheDocument();
    expect(within(takeoff).getByText('PDT')).toBeInTheDocument();
    expect(within(takeoff).getByText('Mon, Jul 1 2024')).toBeInTheDocument();
    const landing = screen.getByRole('row', { name: /Landing/ });
    expect(within(landing).getByText('6:30 AM')).toBeInTheDocument();
    expect(within(landing).getByText('Wed, Jul 3 2024')).toBeInTheDocument();
  });

  it('uses the 24-hour clock when that preference is saved (zones are unchanged)', async () => {
    renderDetail({ distanceUnit: 'mi', timeFormat: '24h' });
    const takeoff = screen.getByRole('row', { name: /Takeoff/ });
    await waitFor(() => expect(within(takeoff).getByText('22:30')).toBeInTheDocument());
    expect(within(takeoff).getByText('PDT')).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /Landing/ })).getByText('06:30'),
    ).toBeInTheDocument();
  });

  it('shows the PNR (detail view only) and computed values', () => {
    renderDetail();
    expect(screen.getByText('SECRET1')).toBeInTheDocument();
    expect(screen.getByText('7,494 mi · 12,061 km')).toBeInTheDocument();
    expect(screen.getByText('15h 00m')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/flights/f1/edit');
  });

  it('leads with kilometers when that preference is saved; the stored miles are untouched', async () => {
    renderDetail({ distanceUnit: 'km', timeFormat: '12h' });
    expect(await screen.findByText('12,061 km · 7,494 mi')).toBeInTheDocument();
  });
});
