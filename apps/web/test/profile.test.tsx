import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfilePage } from '../src/pages/ProfilePage';

type Me = {
  user: { id: string; email: string | null; displayName: string };
  authRequired: boolean;
};
let current: Me;

function mockApi() {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'PATCH') {
        const { displayName } = JSON.parse(String(init.body));
        if (displayName.length > 80)
          return new Response(
            JSON.stringify({
              error: {
                code: 'validation_error',
                message: 'Request validation failed',
                details: [{ path: 'displayName', message: 'Too big' }],
              },
            }),
            { status: 400 },
          );
        current = { ...current, user: { ...current.user, displayName } };
      }
      return new Response(JSON.stringify(current), { status: 200 });
    }),
  );
  return calls;
}

function renderProfile(path = '/profile') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/change-password" element={<Navigate to="/profile" replace />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('ProfilePage', () => {
  it('saves a trimmed name and shows success', async () => {
    current = {
      user: { id: 'u1', email: 'a@example.com', displayName: 'Ada' },
      authRequired: true,
    };
    const calls = mockApi();
    renderProfile();
    const input = await screen.findByLabelText('Display name');
    await userEvent.clear(input);
    await userEvent.type(input, '  Ada L.  ');
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Name saved.');
    const patch = calls.find((c) => c.init?.method === 'PATCH')!;
    expect(patch.url).toBe('/api/auth/me');
    expect(JSON.parse(String(patch.init!.body))).toEqual({ displayName: 'Ada L.' });
    // The AuthMe query was refreshed with the new name.
    expect(screen.getByLabelText('Display name')).toHaveValue('Ada L.');
  });

  it('validates an empty or over-long name inline without calling the API', async () => {
    current = { user: { id: 'u1', email: null, displayName: 'Ada' }, authRequired: true };
    const calls = mockApi();
    renderProfile();
    const input = await screen.findByLabelText('Display name');
    await userEvent.clear(input);
    expect(await screen.findByText('Enter a name.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await userEvent.click(input);
    await userEvent.paste('x'.repeat(81));
    expect(screen.getByText(/80 characters or fewer/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(false);
  });

  it('shows the password section only when auth is required', async () => {
    current = { user: { id: 'u1', email: null, displayName: 'Ada' }, authRequired: false };
    mockApi();
    renderProfile();
    await screen.findByLabelText('Display name');
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    expect(screen.getByText(/credentials are managed elsewhere/)).toBeInTheDocument();
  });

  it('includes the password form when auth is required', async () => {
    current = { user: { id: 'u1', email: null, displayName: 'Ada' }, authRequired: true };
    mockApi();
    renderProfile();
    expect(await screen.findByLabelText('Current password')).toBeInTheDocument();
  });

  it('redirects /change-password to /profile', async () => {
    current = { user: { id: 'u1', email: null, displayName: 'Ada' }, authRequired: true };
    mockApi();
    renderProfile('/change-password');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Profile' })).toBeVisible());
  });
});
