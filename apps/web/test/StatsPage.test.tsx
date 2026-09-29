import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatsPage } from '../src/pages/StatsPage';

const emptyStats = {
  headline: {
    totalFlights: 0,
    canceledFlights: 0,
    totalMiles: 0,
    totalAirMinutes: 0,
    flightsWithAirTime: 0,
    uniqueAirports: 0,
    uniqueAirlines: 0,
    uniqueCountries: 0,
    timesAroundEarth: 0,
    percentToMoon: 0,
  },
  airports: [],
  airlines: [],
  aircraftTypes: [],
  tails: [],
  perYear: [],
  perMonth: [],
  byMonthOfYear: [],
  cabinClass: [],
  seatType: [],
  flightReason: [],
  records: { longest: null, shortest: null, topRoute: null, busiestDay: null },
  punctuality: {
    thresholdMinutes: 15,
    departureSamples: 0,
    arrivalSamples: 0,
    avgDepartureDelayMinutes: null,
    avgArrivalDelayMinutes: null,
    departureOnTimePercent: null,
    arrivalOnTimePercent: null,
  },
};

function renderAt(url: string, body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (input: string) =>
        new Response(
          JSON.stringify(
            input.startsWith('/api/filter-options')
              ? { years: [], airlines: [], cabins: [] }
              : body,
          ),
          {
            status,
            headers: { 'content-type': 'application/json' },
          },
        ),
    ),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <StatsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('StatsPage', () => {
  it('shows an onboarding empty state when there are no flights', async () => {
    renderAt('/stats', emptyStats);
    expect(await screen.findByText('No flights yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Import your Flighty export/ })).toHaveAttribute(
      'href',
      '/import',
    );
  });

  it('shows per-chart empty states when filters match nothing', async () => {
    renderAt('/stats?yearFrom=1999', emptyStats);
    expect((await screen.findAllByText('No data for these filters yet.')).length).toBeGreaterThan(
      5,
    );
    expect(screen.getByText('Flights').nextSibling).toHaveTextContent('0');
  });

  it('shows an error state with retry', async () => {
    renderAt('/stats', { error: { code: 'internal_error', message: 'Boom' } }, 500);
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
