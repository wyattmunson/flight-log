import { useState, type FormEvent } from 'react';
import {
  DISPLAY_NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@flight-log/shared';
import { ApiError } from '../api/client';
import { useChangePassword, useMe, useUpdateProfile } from '../api/hooks';
import { ErrorState, Spinner } from '../components/States';

const errorText = 'mt-1 text-sm text-red-700 dark:text-red-300';
const successBox =
  'rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200';
const errorBox =
  'rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200';

/** Message for a failed mutation that has no field-level errors to show inline. */
function generalMessage(error: Error | null, fieldErrors: Record<string, string>) {
  if (!error || Object.keys(fieldErrors).length > 0) return null;
  return error instanceof ApiError && error.status === 429
    ? 'Too many attempts. Try again later.'
    : error.message;
}

function NameSection({ initial }: { initial: string }) {
  const update = useUpdateProfile();
  const [name, setName] = useState(initial);
  const [touched, setTouched] = useState(false);

  const trimmed = name.trim();
  const clientError =
    trimmed.length === 0
      ? 'Enter a name.'
      : trimmed.length > DISPLAY_NAME_MAX_LENGTH
        ? `Use ${DISPLAY_NAME_MAX_LENGTH} characters or fewer.`
        : null;
  const fieldErrors = update.error instanceof ApiError ? update.error.fieldErrors : {};
  const nameError = (touched && clientError) || fieldErrors.displayName || null;
  const generalError = generalMessage(update.error, fieldErrors);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (clientError) return;
    update.mutate({ displayName: trimmed }, { onSuccess: (me) => setName(me.user.displayName) });
  };

  return (
    <section aria-labelledby="name-heading">
      <h2 id="name-heading" className="mb-2 text-lg font-semibold">
        Name
      </h2>
      <form onSubmit={submit} className="card space-y-4" noValidate>
        {update.isSuccess && (
          <p role="status" className={successBox}>
            Name saved.
          </p>
        )}
        {generalError && (
          <p role="alert" className={errorBox}>
            {generalError}
          </p>
        )}
        <div>
          <label htmlFor="displayName" className="label">
            Display name
          </label>
          <input
            id="displayName"
            className="input"
            autoComplete="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setTouched(true);
              if (update.isSuccess || update.isError) update.reset();
            }}
            aria-invalid={!!nameError}
            aria-describedby={nameError ? 'displayName-error' : 'displayName-hint'}
          />
          <p id="displayName-hint" className="mt-1 text-xs muted">
            Shown in the header. {trimmed.length}/{DISPLAY_NAME_MAX_LENGTH}
          </p>
          {nameError && (
            <p id="displayName-error" className={errorText}>
              {nameError}
            </p>
          )}
        </div>
        <button
          type="submit"
          className="btn-primary"
          disabled={update.isPending || trimmed === initial}
        >
          {update.isPending ? 'Saving…' : 'Save name'}
        </button>
      </form>
    </section>
  );
}

function PasswordSection() {
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);

  const fieldErrors = change.error instanceof ApiError ? change.error.fieldErrors : {};
  const generalError = generalMessage(change.error, fieldErrors);

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

  return (
    <section aria-labelledby="password-heading">
      <h2 id="password-heading" className="mb-2 text-lg font-semibold">
        Password
      </h2>
      <form onSubmit={submit} className="card space-y-4">
        {change.isSuccess && (
          <p role="status" className={successBox}>
            Password changed. Your other devices have been signed out.
          </p>
        )}
        {generalError && (
          <p role="alert" className={errorBox}>
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
    </section>
  );
}

export function ProfilePage() {
  const me = useMe();
  if (me.isPending) return <Spinner label="Loading profile…" />;
  if (me.isError || !me.data) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  const { user, authRequired } = me.data;

  return (
    <div className="mx-auto max-w-md space-y-8">
      <h1 className="text-xl font-semibold">Profile</h1>
      {user.email && <p className="-mt-6 truncate text-sm muted">{user.email}</p>}
      <NameSection initial={user.displayName} />
      {authRequired ? (
        <PasswordSection />
      ) : (
        <p className="text-sm muted">
          Sign-in is not enabled on this server, so credentials are managed elsewhere (by the
          server&apos;s administrator).
        </p>
      )}
    </div>
  );
}
