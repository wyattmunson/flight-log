import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
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

describe('FlightDetailView', () => {
  it('shows times in each airport’s local zone, across the date line', () => {
    render(
      <MemoryRouter>
        <FlightDetailView flight={flight} onDelete={vi.fn()} deleting={false} />
      </MemoryRouter>,
    );
    const takeoff = screen.getByRole('row', { name: /Takeoff/ });
    expect(within(takeoff).getByText('22:30')).toBeInTheDocument();
    expect(within(takeoff).getByText('PDT')).toBeInTheDocument();
    expect(within(takeoff).getByText('Mon, Jul 1 2024')).toBeInTheDocument();
    const landing = screen.getByRole('row', { name: /Landing/ });
    expect(within(landing).getByText('06:30')).toBeInTheDocument();
    expect(within(landing).getByText('Wed, Jul 3 2024')).toBeInTheDocument();
  });

  it('shows the PNR (detail view only) and computed values', () => {
    render(
      <MemoryRouter>
        <FlightDetailView flight={flight} onDelete={vi.fn()} deleting={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText('SECRET1')).toBeInTheDocument();
    expect(screen.getByText('7,494 mi · 12,061 km')).toBeInTheDocument();
    expect(screen.getByText('15h 00m')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/flights/f1/edit');
  });
});
