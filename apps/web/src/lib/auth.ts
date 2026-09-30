import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { ME_KEY } from '../api/hooks';

/**
 * A same-origin path to return to after signing in, or "/" for anything else. Accepts "/flights?x=1";
 * rejects "//evil.com" (protocol-relative), "https://evil.com", "/\evil.com" and control characters.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/';
  if (next.includes('\\') || [...next].some((c) => c.charCodeAt(0) < 0x20 || c === '\u007f'))
    return '/';
  try {
    const base = 'http://app.invalid';
    const url = new URL(next, base);
    if (url.origin !== base || url.pathname === '/login') return '/';
  } catch {
    return '/';
  }
  return next;
}

export const loginPath = (from: string) =>
  from === '/' || from === '' ? '/login' : `/login?next=${encodeURIComponent(from)}`;

/**
 * Global 401 handler (QueryCache and MutationCache `onError`). A 401 from anywhere but the auth
 * endpoints means the session is gone: re-check `/auth/me`, whose 401 makes the route guard send the
 * user to /login with the page they were on. Login/me failures are handled where they happen.
 */
export function handleUnauthorized(queryClient: QueryClient, error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 401) return;
  if (error.meta.path?.startsWith('/auth/')) return;
  void queryClient.invalidateQueries({ queryKey: ME_KEY });
}
