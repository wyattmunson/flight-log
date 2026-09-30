import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AirportSummary, Preferences } from '@flight-log/shared';
import { FlightFormPage } from '../src/pages/FlightFormPage';
import { ProfilePage } from '../src/pages/ProfilePage';

const SFO: AirportSummary = {
  id: 3878,
  iata: 'SFO',
  icao: 'KSFO',
  name: 'San Francisco International Airport',
  city: 'San Francisco',
  country: 'US',
  timezone: 'America/Los_Angeles',
  latitude: 37.6,
  longitude: -122.4,
};

let prefs: Preferences;
let authRequired: boolean;
let calls: { url: string; method: string; body?: unknown }[];

beforeEach(() => {
  authRequired = false;
  calls = [];
  prefs = { distanceUnit: 'mi', timeFormat: '12h', homeAirportId: null, homeAirport: null };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      const json = (status: number, payload: unknown) =>
        new Response(JSON.stringify(payload), { status });
      if (url === '/api/auth/me')
        return json(200, {
          user: { id: 'u1', email: null, displayName: 'Ada' },
          authRequired,
        });
      if (url === '/api/auth/preferences' && method === 'PATCH') {
        prefs = {
          ...prefs,
          ...body,
          homeAirport: body.homeAirportId === SFO.id ? SFO : null,
        };
        return json(200, prefs);
      }
      if (url === '/api/auth/preferences') return json(200, prefs);
      if (url.startsWith('/api/flights?confirm=') && method === 'DELETE')
        return json(200, { deleted: 3, deletedImportBatches: 1 });
      if (url === '/api/config')
        return json(200, { mapStyleUrl: '', apiDocsUrl: null, lookup: { configured: false } });
      return json(404, { error: { code: 'not_found', message: 'nope' } });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/flights/new" element={<FlightFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return spy;
}

describe('Preferences', () => {
  it('shows the defaults, works with auth off, and saves changes', async () => {
    renderAt('/profile');
    const section = (await screen.findByRole('heading', { name: 'Preferences' })).closest(
      'section',
    )!;
    await waitFor(() => expect(within(section).getByLabelText('Miles')).toBeChecked());
    expect(within(section).getByLabelText('12-hour (2:30 PM)')).toBeChecked();
    const save = within(section).getByRole('button', { name: 'Save preferences' });
    expect(save).toBeDisabled(); // nothing changed yet

    await userEvent.click(within(section).getByLabelText('Kilometers'));
    await userEvent.click(within(section).getByLabelText('24-hour (14:30)'));
    await userEvent.click(save);
    expect(await within(section).findByText('Preferences saved.')).toBeInTheDocument();
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toBe('/api/auth/preferences');
    expect(patch.body).toEqual({ distanceUnit: 'km', timeFormat: '24h', homeAirportId: null });
    expect(within(section).getByLabelText('Kilometers')).toBeChecked();
  });

  it('shows the saved home airport and can clear it', async () => {
    prefs = { ...prefs, homeAirportId: SFO.id, homeAirport: SFO };
    renderAt('/profile');
    expect(await screen.findByDisplayValue(/SFO · San Francisco/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear home airport' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ homeAirportId: null }),
    );
  });
});

describe('Your data', () => {
  it('offers CSV and JSON downloads from the export endpoint', async () => {
    renderAt('/profile');
    const csv = await screen.findByRole('link', { name: 'Download CSV' });
    expect(csv).toHaveAttribute('href', '/api/flights/export?format=csv');
    expect(csv).toHaveAttribute('download');
    expect(screen.getByRole('link', { name: 'Download JSON' })).toHaveAttribute(
      'href',
      '/api/flights/export?format=json',
    );
  });
});

describe('Danger zone', () => {
  it('needs the typed phrase before deleting, then refreshes flight data', async () => {
    const invalidate = renderAt('/profile');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete all flights…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete all flights' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete all flights' });
    expect(confirm).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText(/Type/), 'delete my flight');
    expect(confirm).toBeDisabled(); // one character short
    await userEvent.type(within(dialog).getByLabelText(/Type/), 's');
    expect(confirm).toBeEnabled();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    await userEvent.click(confirm);
    expect(await screen.findByText(/Deleted 3 flights and 1 import record\./)).toBeInTheDocument();
    const del = calls.find((c) => c.method === 'DELETE')!;
    expect(del.url).toBe('/api/flights?confirm=delete-all-flights');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const keys = invalidate.mock.calls.map((c) => (c[0]?.queryKey as string[])[0]);
    for (const k of ['flights', 'flight', 'map', 'stats', 'filter-options', 'import-batches']) {
      expect(keys).toContain(k);
    }
  });

  it('Cancel closes without deleting', async () => {
    renderAt('/profile');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete all flights…' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });
});

describe('Home airport default', () => {
  it('starts a new flight at the home airport', async () => {
    prefs = { ...prefs, homeAirportId: SFO.id, homeAirport: SFO };
    renderAt('/flights/new');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /From|Departure|Origin/i })).toHaveValue(
        'SFO · San Francisco International Airport',
      ),
    );
  });
});
