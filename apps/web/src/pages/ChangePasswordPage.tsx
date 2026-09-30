import { useState, type FormEvent } from 'react';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@flight-log/shared';
import { ApiError } from '../api/client';
import { useChangePassword, useMe } from '../api/hooks';
import { EmptyState } from '../components/States';

export function ChangePasswordPage() {
  const me = useMe().data;
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);

  if (me && !me.authRequired)
    return (
      <EmptyState title="Sign-in is not enabled on this server">Nothing to change here.</EmptyState>
    );

  const fieldErrors = change.error instanceof ApiError ? change.error.fieldErrors : {};
  const generalError =
    change.error && Object.keys(fieldErrors).length === 0
      ? change.error instanceof ApiError && change.error.status === 429
        ? 'Too many attempts. Try again later.'
        : change.error.message
      : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setMismatch(true);
    setMismatch(false);
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          setCurrent('');
          setNext('');
          setConfirm('');
        },
      },
    );
  };

  const errorText = 'mt-1 text-sm text-red-700 dark:text-red-300';

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-xl font-semibold">Change password</h1>
      <form onSubmit={submit} className="card space-y-4">
        {change.isSuccess && (
          <p
            role="status"
            className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
          >
            Password changed. Your other devices have been signed out.
          </p>
        )}
        {generalError && (
          <p
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            {generalError}
          </p>
        )}
        <div>
          <label htmlFor="current" className="label">
            Current password
          </label>
          <input
            id="current"
            type="password"
            className="input"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            aria-invalid={!!fieldErrors.currentPassword}
            aria-describedby={fieldErrors.currentPassword ? 'current-error' : undefined}
          />
          {fieldErrors.currentPassword && (
            <p id="current-error" className={errorText}>
              {fieldErrors.currentPassword}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="new" className="label">
            New password
          </label>
          <input
            id="new"
            type="password"
            className="input"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            aria-invalid={!!fieldErrors.newPassword}
            aria-describedby={fieldErrors.newPassword ? 'new-error' : 'new-hint'}
          />
          <p id="new-hint" className="mt-1 text-xs muted">
            {PASSWORD_MIN_LENGTH} to {PASSWORD_MAX_LENGTH} characters.
          </p>
          {fieldErrors.newPassword && (
            <p id="new-error" className={errorText}>
              {fieldErrors.newPassword}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="confirm" className="label">
            Confirm new password
          </label>
          <input
            id="confirm"
            type="password"
            className="input"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={mismatch}
            aria-describedby={mismatch ? 'confirm-error' : undefined}
          />
          {mismatch && (
            <p id="confirm-error" className={errorText}>
              The passwords do not match.
            </p>
          )}
        </div>
        <button type="submit" className="btn-primary" disabled={change.isPending}>
          {change.isPending ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </div>
  );
}
