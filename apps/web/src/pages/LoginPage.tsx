import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useLogin, useMe } from '../api/hooks';
import { Spinner } from '../components/States';
import { safeNextPath } from '../lib/auth';

export function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      const s = error.meta.retryAfter;
      const wait = !s ? 'a few minutes' : s < 90 ? `${s} seconds` : `${Math.ceil(s / 60)} minutes`;
      return `Too many attempts. Try again in ${wait}.`;
    }
    if (error.code === 'invalid_credentials') return 'Incorrect email or password.';
    return error.message;
  }
  return 'Could not reach the server. Check your connection and try again.';
}

export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const me = useMe();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Already signed in (or auth is off): nothing to do here. This is also where a successful login
  // lands, since useLogin puts the user into the cache.
  // `status`, not `data`: after a failed re-check TanStack Query keeps the last good `data` next to
  // the error, and treating that as "signed in" bounces between here and the route guard forever.
  if (me.status === 'success') return <Navigate to={me.data.authRequired ? next : '/'} replace />;
  if (me.isPending) return <Spinner label="Checking your session…" />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password });
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-semibold">
        <img src="/favicon.svg" alt="" className="h-7 w-7" />
        Flight Log
      </h1>
      <form onSubmit={submit} className="card space-y-4" aria-labelledby="signin-title">
        <h2 id="signin-title" className="text-lg font-medium">
          Sign in
        </h2>
        {login.isError && (
          <p
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            {loginErrorMessage(login.error)}
          </p>
        )}
        <div>
          <label htmlFor="email" className="label">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            className="input"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="password" className="label">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            className="input"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
