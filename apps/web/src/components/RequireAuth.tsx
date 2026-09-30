import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useMe } from '../api/hooks';
import { loginPath } from '../lib/auth';
import { ErrorState, Spinner } from './States';

/**
 * Route guard. With AUTH_REQUIRED off the API reports `authRequired: false` and the app renders
 * with no login UI at all; otherwise an unauthenticated visitor goes to /login and comes back here.
 */
export function RequireAuth() {
  const me = useMe();
  const { pathname, search, hash } = useLocation();

  if (me.error instanceof ApiError && me.error.status === 401)
    return <Navigate to={loginPath(pathname + search + hash)} replace />;
  if (me.isPending) return <Spinner label="Checking your session…" />;
  if (me.isError) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  return <Outlet />;
}
