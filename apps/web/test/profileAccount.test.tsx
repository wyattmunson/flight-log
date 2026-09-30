import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionInfo } from '@flight-log/shared';
import { ProfilePage } from '../src/pages/ProfilePage';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

let authRequired = true;
let sessions: SessionInfo[];
let emailResponse: { status: number; body: unknown };
let calls: { url: string; method: string; body?: unknown }[];

const session = (id: string, userAgent: string | null, current = false): SessionInfo => ({
  id,
  createdAt: '2026-09-01T10:00:00.000Z',
  lastSeenAt: '2026-09-29T10:00:00.000Z',
  userAgent,
  current,
});

beforeEach(() => {
  authRequired = true;
  calls = [];
  sessions = [session('s1', CHROME_MAC, true), session('s2', SAFARI_IPHONE)];
  emailResponse = {
    status: 200,
    body: {
      user: { id: 'u1', email: 'new@example.com', displayName: 'Ada' },
      authRequired: true,
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = (status: number, body: unknown) =>
        new Response(status === 204 ? null : JSON.stringify(body), { status });
      if (url === '/api/auth/me')
        return json(200, {
          user: { id: 'u1', email: 'old@example.com', displayName: 'Ada' },
          authRequired,
        });
      if (url === '/api/auth/sessions') return json(200, sessions);
      if (url === '/api/auth/sessions/revoke-others') {
        sessions = sessions.filter((s) => s.current);
        return json(204, null);
      }
      if (url.startsWith('/api/auth/sessions/') && method === 'DELETE') {
        sessions = sessions.filter((s) => s.id !== url.split('/').pop());
        return json(204, null);
      }
      if (url === '/api/auth/email') return json(emailResponse.status, emailResponse.body);
      return json(404, { error: { code: 'not_found', message: 'nope' } });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderProfile() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/profile']}>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Email section', () => {
  it('is hidden, with the sessions section, when auth is off', async () => {
    authRequired = false;
    renderProfile();
    await screen.findByLabelText('Display name');
    expect(screen.queryByRole('heading', { name: 'Email' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Active sessions' })).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/auth/sessions'))).toBe(false);
  });

  it('submits the change with PUT and confirms', async () => {
    renderProfile();
    await userEvent.type(await screen.findByLabelText('New email'), ' New@Example.com ');
    const form = screen.getByRole('heading', { name: 'Email' }).closest('section')!;
    await userEvent.type(within(form).getByLabelText('Current password'), 'my-password-123');
    await userEvent.click(screen.getByRole('button', { name: 'Change email' }));
    expect(await screen.findByText(/Email changed/)).toBeInTheDocument();
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe('/api/auth/email');
    expect(put.body).toEqual({ newEmail: 'New@Example.com', currentPassword: 'my-password-123' });
    expect(screen.getByLabelText('New email')).toHaveValue('');
  });

  it('shows a 409 inline on the email field', async () => {
    emailResponse = {
      status: 409,
      body: {
        error: {
          code: 'email_unavailable',
          message: 'That email address is not available',
          details: [{ path: 'newEmail', message: 'That email address is not available' }],
        },
      },
    };
    renderProfile();
    await userEvent.type(await screen.findByLabelText('New email'), 'taken@example.com');
    const form = screen.getByRole('heading', { name: 'Email' }).closest('section')!;
    await userEvent.type(within(form).getByLabelText('Current password'), 'my-password-123');
    await userEvent.click(screen.getByRole('button', { name: 'Change email' }));
    expect(await screen.findByText('That email address is not available')).toBeInTheDocument();
    expect(screen.getByLabelText('New email')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('Sessions section', () => {
  it('lists devices with friendly labels and marks this one', async () => {
    renderProfile();
    expect(await screen.findByText('Chrome on macOS')).toBeInTheDocument();
    expect(screen.getByText('Safari on iPhone')).toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
    // Only the other device can be signed out individually.
    expect(screen.getAllByRole('button', { name: /^Sign out (Chrome|Safari)/ })).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: 'Sign out Chrome on macOS' }),
    ).not.toBeInTheDocument();
  });

  it('signs out one device', async () => {
    renderProfile();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out Safari on iPhone' }));
    await waitFor(() => expect(screen.queryByText('Safari on iPhone')).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/auth/sessions/s2')).toBe(
      true,
    );
  });

  it('asks before signing out other devices, and Cancel does nothing', async () => {
    renderProfile();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out other devices' }));
    expect(screen.getByText(/Sign out 1 other device\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls.some((c) => c.url.endsWith('/revoke-others'))).toBe(false);
    expect(screen.getByRole('button', { name: 'Sign out other devices' })).toBeInTheDocument();
  });

  it('signs out other devices after confirmation', async () => {
    renderProfile();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out other devices' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, sign out' }));
    expect(await screen.findByText('Signed out your other devices.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/revoke-others'))).toBe(true);
    await waitFor(() => expect(screen.queryByText('Safari on iPhone')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Sign out other devices' })).toBeDisabled();
  });
});
