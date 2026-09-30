import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '../src/components/RequireAuth';
import { handleUnauthorized, loginPath, safeNextPath } from '../src/lib/auth';
import { ApiError } from '../src/api/client';
import { ME_KEY } from '../src/api/hooks';
import { LoginPage } from '../src/pages/LoginPage';

const me = (authRequired: boolean) => ({
  user: { id: 'u1', email: 'a@example.com', displayName: 'Ada' },
  authRequired,
});

type Handler = (
  url: string,
  init?: RequestInit,
) => { status: number; body?: unknown; headers?: Record<string, string> };

function mockApi(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const r = handler(url, init);
      return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), {
        status: r.status,
        headers: r.headers,
      });
    }),
  );
  return calls;
}

const error = (status: number, code: string, message = 'x', headers?: Record<string, string>) => ({
  status,
  body: { error: { code, message } },
  headers,
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function renderAt(path: string, ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        {ui}
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

const app = (
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<RequireAuth />}>
      <Route path="*" element={<p>Secret app</p>} />
    </Route>
  </Routes>
);

afterEach(() => vi.unstubAllGlobals());

describe('safeNextPath', () => {
  it('accepts same-origin relative paths', () => {
    expect(safeNextPath('/flights?x=1')).toBe('/flights?x=1');
    expect(safeNextPath('/stats#top')).toBe('/stats#top');
    expect(safeNextPath('/')).toBe('/');
  });

  it.each([
    '//evil.com',
    'https://evil.com',
    'http://evil.com/x',
    'javascript:alert(1)',
    '/\\evil.com',
    '\\\\evil.com',
    'evil.com',
    '/foo\nbar',
    '/login',
    '',
    null,
    undefined,
  ])('rejects %j', (bad) => {
    expect(safeNextPath(bad)).toBe('/');
  });

  it('builds the login redirect', () => {
    expect(loginPath('/flights?a=1')).toBe('/login?next=%2Fflights%3Fa%3D1');
    expect(loginPath('/')).toBe('/login');
  });
});

describe('LoginPage', () => {
  it('shows a generic inline error for invalid credentials and stays put', async () => {
    mockApi((url) =>
      url.endsWith('/auth/me')
        ? error(401, 'unauthenticated')
        : error(401, 'invalid_credentials', 'Incorrect email or password'),
    );
    renderAt('/login', app);
    await userEvent.type(await screen.findByLabelText('Email'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password-1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
    expect(screen.getByTestId('where')).toHaveTextContent('/login');
  });

  it('uses password-manager friendly autocomplete attributes', async () => {
    mockApi(() => error(401, 'unauthenticated'));
    renderAt('/login', app);
    expect(await screen.findByLabelText('Email')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('explains a 429 using Retry-After', async () => {
    mockApi((url) =>
      url.endsWith('/auth/me')
        ? error(401, 'unauthenticated')
        : error(429, 'too_many_attempts', 'Too many', { 'retry-after': '120' }),
    );
    renderAt('/login', app);
    await userEvent.type(await screen.findByLabelText('Email'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 2 minutes');
  });

  it('on success posts the credentials and returns to the requested page', async () => {
    let signedIn = false;
    const calls = mockApi((url) => {
      if (url.endsWith('/auth/login')) {
        signedIn = true;
        return { status: 200, body: me(true) };
      }
      return signedIn ? { status: 200, body: me(true) } : error(401, 'unauthenticated');
    });
    renderAt('/login?next=%2Fflights%3Fyear%3D2024', app);
    await userEvent.type(await screen.findByLabelText('Email'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'right-password-12');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Secret app');
    expect(screen.getByTestId('where')).toHaveTextContent('/flights?year=2024');
    const login = calls.find((c) => c.url.endsWith('/auth/login'))!;
    expect(JSON.parse(String(login.init?.body))).toEqual({
      email: 'a@example.com',
      password: 'right-password-12',
    });
  });

  it('ignores a malicious next target after login', async () => {
    let signedIn = false;
    mockApi((url) => {
      if (url.endsWith('/auth/login')) {
        signedIn = true;
        return { status: 200, body: me(true) };
      }
      return signedIn ? { status: 200, body: me(true) } : error(401, 'unauthenticated');
    });
    renderAt('/login?next=%2F%2Fevil.com', app);
    await userEvent.type(await screen.findByLabelText('Email'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'right-password-12');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Secret app');
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
  });
});

describe('RequireAuth', () => {
  it('renders the app with no login UI when authRequired is false', async () => {
    mockApi(() => ({ status: 200, body: me(false) }));
    renderAt('/flights', app);
    expect(await screen.findByText('Secret app')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/flights');
  });

  it('sends an unauthenticated visitor to /login, preserving the path', async () => {
    mockApi(() => error(401, 'unauthenticated'));
    renderAt('/flights?year=2024', app);
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/login?next=%2Fflights%3Fyear%3D2024');
    expect(screen.queryByText('Secret app')).not.toBeInTheDocument();
  });

  it('shows a spinner while loading and an error with retry on server failure', async () => {
    mockApi(() => error(500, 'internal_error', 'boom'));
    renderAt('/', app);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('renders the app when signed in', async () => {
    mockApi(() => ({ status: 200, body: me(true) }));
    renderAt('/stats', app);
    expect(await screen.findByText('Secret app')).toBeInTheDocument();
  });
});

describe('session lost while signed in', () => {
  it('lands on the login form (no redirect loop) and keeps the path', async () => {
    let signedIn = true;
    mockApi(() => (signedIn ? { status: 200, body: me(true) } : error(401, 'unauthenticated')));
    const client = renderAt('/stats', app);
    await screen.findByText('Secret app');

    signedIn = false; // e.g. the session expired or was revoked in another tab
    await client.invalidateQueries({ queryKey: ME_KEY });
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/login?next=%2Fstats');
  });
});

describe('handleUnauthorized', () => {
  it('re-checks the session on a 401 from a data request, but not from /auth/*', async () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    handleUnauthorized(
      client,
      new ApiError(401, 'unauthenticated', 'x', undefined, { path: '/flights' }),
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ME_KEY });
    spy.mockClear();
    handleUnauthorized(
      client,
      new ApiError(401, 'invalid_credentials', 'x', undefined, { path: '/auth/login' }),
    );
    handleUnauthorized(
      client,
      new ApiError(500, 'internal_error', 'x', undefined, { path: '/flights' }),
    );
    handleUnauthorized(client, new Error('network'));
    expect(spy).not.toHaveBeenCalled();
    await waitFor(() => undefined);
  });
});
