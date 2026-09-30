import { useCallback, useState, type FormEvent } from 'react';
import {
  DISPLAY_NAME_MAX_LENGTH,
  type AirportSummary,
  type DistanceUnit,
  type TimeFormat,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@flight-log/shared';
import { ApiError } from '../api/client';
import {
  useAirportSearch,
  useChangeEmail,
  useChangePassword,
  useDeleteAllFlights,
  useMe,
  usePreferences,
  useRevokeOtherSessions,
  useRevokeSession,
  useSessions,
  useUpdatePreferences,
  useUpdateProfile,
} from '../api/hooks';
import { Combobox } from '../components/Combobox';
import { Drawer } from '../components/Drawer';
import { ErrorState, Spinner } from '../components/States';
import { deviceLabel } from '../lib/userAgent';

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

const airportLabel = (a: AirportSummary) => `${a.iata ?? a.icao} · ${a.name}`;

function RadioGroup<T extends string>({
  legend,
  name,
  value,
  onChange,
  options,
}: {
  legend: string;
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {options.map((o) => (
          <label key={o.value} className="inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function PreferencesSection() {
  const prefs = usePreferences();
  const update = useUpdatePreferences();
  const [unit, setUnit] = useState<DistanceUnit | null>(null);
  const [clock, setClock] = useState<TimeFormat | null>(null);
  // `undefined` = untouched; null = cleared; otherwise the chosen airport.
  const [home, setHome] = useState<AirportSummary | null | undefined>(undefined);

  if (prefs.isPending) return <Spinner label="Loading preferences…" />;
  if (prefs.isError) return <ErrorState error={prefs.error} onRetry={() => prefs.refetch()} />;

  const saved = prefs.data;
  const unitValue = unit ?? saved.distanceUnit;
  const clockValue = clock ?? saved.timeFormat;
  const homeValue = home === undefined ? saved.homeAirport : home;
  const dirty =
    unitValue !== saved.distanceUnit ||
    clockValue !== saved.timeFormat ||
    (homeValue?.id ?? null) !== saved.homeAirportId;

  const fieldErrors = update.error instanceof ApiError ? update.error.fieldErrors : {};
  const generalError = generalMessage(update.error, fieldErrors);
  const touch = () => update.isSuccess && update.reset();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate(
      { distanceUnit: unitValue, timeFormat: clockValue, homeAirportId: homeValue?.id ?? null },
      {
        onSuccess: () => {
          setUnit(null);
          setClock(null);
          setHome(undefined);
        },
      },
    );
  };

  return (
    <section aria-labelledby="prefs-heading">
      <h2 id="prefs-heading" className="mb-2 text-lg font-semibold">
        Preferences
      </h2>
      <form onSubmit={submit} className="card space-y-4">
        <p className="text-sm muted">
          These only change how values are shown. Your flights are still stored in miles and UTC.
        </p>
        {update.isSuccess && (
          <p role="status" className={successBox}>
            Preferences saved.
          </p>
        )}
        {generalError && (
          <p role="alert" className={errorBox}>
            {generalError}
          </p>
        )}
        <RadioGroup
          legend="Distance"
          name="distanceUnit"
          value={unitValue}
          onChange={(v) => {
            touch();
            setUnit(v);
          }}
          options={[
            { value: 'mi', label: 'Miles' },
            { value: 'km', label: 'Kilometers' },
          ]}
        />
        <RadioGroup
          legend="Time"
          name="timeFormat"
          value={clockValue}
          onChange={(v) => {
            touch();
            setClock(v);
          }}
          options={[
            { value: '12h', label: '12-hour (2:30 PM)' },
            { value: '24h', label: '24-hour (14:30)' },
          ]}
        />
        <div>
          <Combobox<AirportSummary>
            key={homeValue?.id ?? 'none'}
            label="Home airport"
            value={homeValue}
            onChange={(a) => {
              touch();
              setHome(a);
            }}
            useSearch={useAirportSearch}
            getKey={(a) => a.id}
            getLabel={airportLabel}
            renderOption={(a) => (
              <span>
                <span className="font-semibold">{a.iata ?? a.icao}</span> {a.name}
                <span className="block text-xs text-stone-500">
                  {[a.city, a.country].filter(Boolean).join(', ')}
                </span>
              </span>
            )}
            placeholder="SFO, London, Heathrow…"
            error={fieldErrors.homeAirportId}
            hint="New flights start from here."
          />
          {homeValue && (
            <button
              type="button"
              className="mt-2 text-sm underline"
              onClick={() => {
                touch();
                setHome(null);
              }}
            >
              Clear home airport
            </button>
          )}
        </div>
        <button type="submit" className="btn-primary" disabled={update.isPending || !dirty}>
          {update.isPending ? 'Saving…' : 'Save preferences'}
        </button>
      </form>
    </section>
  );
}

function DataSection() {
  return (
    <section aria-labelledby="data-heading">
      <h2 id="data-heading" className="mb-2 text-lg font-semibold">
        Your data
      </h2>
      <div className="card space-y-3">
        <p className="text-sm">
          Download every flight in your log. The export includes booking references (PNR) and seats,
          so keep the file private. The CSV uses the Flighty columns with UTC times, so it can be
          imported again.
        </p>
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" href="/api/flights/export?format=csv" download>
            Download CSV
          </a>
          <a className="btn-secondary" href="/api/flights/export?format=json" download>
            Download JSON
          </a>
        </div>
      </div>
    </section>
  );
}

const DELETE_PHRASE = 'delete my flights';

function DangerZone() {
  const remove = useDeleteAllFlights();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const matches = typed.trim().toLowerCase() === DELETE_PHRASE;

  // Must be stable: Drawer re-focuses its panel whenever `onClose` changes, which would steal focus
  // from the input on every keystroke.
  const { reset } = remove;
  const close = useCallback(() => {
    setOpen(false);
    setTyped('');
    reset();
  }, [reset]);
  const confirm = (e: FormEvent) => {
    e.preventDefault();
    if (!matches) return;
    remove.mutate(undefined, { onSuccess: () => setOpen(false) });
  };
  const result = remove.data;

  return (
    <section aria-labelledby="danger-heading">
      <h2 id="danger-heading" className="mb-2 text-lg font-semibold text-red-700 dark:text-red-300">
        Danger zone
      </h2>
      <div className="card space-y-3 border-red-300 dark:border-red-900">
        {result && (
          <p role="status" className={successBox}>
            Deleted {result.deleted} {result.deleted === 1 ? 'flight' : 'flights'} and{' '}
            {result.deletedImportBatches} import{' '}
            {result.deletedImportBatches === 1 ? 'record' : 'records'}.
          </p>
        )}
        <p className="text-sm">
          Permanently delete every flight and import record in your log. This cannot be undone, so
          download your data first.
        </p>
        <button type="button" className="btn-danger" onClick={() => setOpen(true)}>
          Delete all flights…
        </button>
      </div>
      <Drawer open={open} onClose={close} title="Delete all flights">
        <form onSubmit={confirm} className="space-y-4 pr-10">
          <h2 className="text-xl font-semibold">Delete all flights?</h2>
          <p className="text-sm">
            This permanently removes all of your flights and import history. Your account and
            preferences stay.
          </p>
          {remove.error && (
            <p role="alert" className={errorBox}>
              {remove.error.message}
            </p>
          )}
          <div>
            <label htmlFor="confirmDelete" className="label">
              Type <strong>{DELETE_PHRASE}</strong> to confirm
            </label>
            <input
              id="confirmDelete"
              className="input"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-danger" disabled={!matches || remove.isPending}>
              {remove.isPending ? 'Deleting…' : 'Delete all flights'}
            </button>
            <button type="button" className="btn-secondary" onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      </Drawer>
    </section>
  );
}

function EmailSection({ email }: { email: string | null }) {
  const change = useChangeEmail();
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');

  const fieldErrors = change.error instanceof ApiError ? change.error.fieldErrors : {};
  const generalError = generalMessage(change.error, fieldErrors);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    change.mutate(
      { newEmail: newEmail.trim(), currentPassword: password },
      {
        onSuccess: () => {
          setNewEmail('');
          setPassword('');
        },
      },
    );
  };

  return (
    <section aria-labelledby="email-heading">
      <h2 id="email-heading" className="mb-2 text-lg font-semibold">
        Email
      </h2>
      <form onSubmit={submit} className="card space-y-4">
        <p className="text-sm">
          Signed in as <strong className="break-all">{email ?? 'no email set'}</strong>. The change
          takes effect immediately (nothing is emailed) and signs out your other devices.
        </p>
        {change.isSuccess && (
          <p role="status" className={successBox}>
            Email changed. Your other devices have been signed out.
          </p>
        )}
        {generalError && (
          <p role="alert" className={errorBox}>
            {generalError}
          </p>
        )}
        <div>
          <label htmlFor="newEmail" className="label">
            New email
          </label>
          <input
            id="newEmail"
            type="email"
            className="input"
            autoComplete="email"
            required
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            aria-invalid={!!fieldErrors.newEmail}
            aria-describedby={fieldErrors.newEmail ? 'newEmail-error' : undefined}
          />
          {fieldErrors.newEmail && (
            <p id="newEmail-error" className={errorText}>
              {fieldErrors.newEmail}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="emailPassword" className="label">
            Current password
          </label>
          <input
            id="emailPassword"
            type="password"
            className="input"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!fieldErrors.currentPassword}
            aria-describedby={fieldErrors.currentPassword ? 'emailPassword-error' : undefined}
          />
          {fieldErrors.currentPassword && (
            <p id="emailPassword-error" className={errorText}>
              {fieldErrors.currentPassword}
            </p>
          )}
        </div>
        <button type="submit" className="btn-primary" disabled={change.isPending}>
          {change.isPending ? 'Saving…' : 'Change email'}
        </button>
      </form>
    </section>
  );
}

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function SessionsSection() {
  const sessions = useSessions(true);
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const [confirming, setConfirming] = useState(false);

  const others = sessions.data?.filter((s) => !s.current) ?? [];
  const failure = revoke.error ?? revokeOthers.error;

  return (
    <section aria-labelledby="sessions-heading">
      <h2 id="sessions-heading" className="mb-2 text-lg font-semibold">
        Active sessions
      </h2>
      <div className="card space-y-4">
        {failure && (
          <p role="alert" className={errorBox}>
            {failure.message}
          </p>
        )}
        {revokeOthers.isSuccess && (
          <p role="status" className={successBox}>
            Signed out your other devices.
          </p>
        )}
        {sessions.isPending && <Spinner label="Loading sessions…" />}
        {sessions.isError && (
          <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />
        )}
        {sessions.data && (
          <ul className="divide-y divide-stone-200 dark:divide-stone-800">
            {sessions.data.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {deviceLabel(s.userAgent)}
                    {s.current && (
                      <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand-dark dark:bg-brand/20 dark:text-brand-light">
                        This device
                      </span>
                    )}
                  </p>
                  <p className="text-xs muted">
                    Signed in {formatWhen(s.createdAt)} · Last active {formatWhen(s.lastSeenAt)}
                  </p>
                </div>
                {!s.current && (
                  <button
                    type="button"
                    className="btn-secondary shrink-0"
                    disabled={revoke.isPending}
                    aria-label={`Sign out ${deviceLabel(s.userAgent)}`}
                    onClick={() => revoke.mutate(s.id)}
                  >
                    Sign out
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {confirming ? (
          <div role="group" aria-label="Confirm sign out" className="space-y-2">
            <p className="text-sm">
              Sign out {others.length} other {others.length === 1 ? 'device' : 'devices'}? They will
              need to sign in again.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-danger"
                disabled={revokeOthers.isPending}
                onClick={() =>
                  revokeOthers.mutate(undefined, { onSettled: () => setConfirming(false) })
                }
              >
                {revokeOthers.isPending ? 'Signing out…' : 'Yes, sign out'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn-secondary"
            disabled={others.length === 0}
            onClick={() => {
              revokeOthers.reset();
              setConfirming(true);
            }}
          >
            Sign out other devices
          </button>
        )}
      </div>
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
      <PreferencesSection />
      {authRequired ? (
        <>
          <EmailSection email={user.email} />
          <PasswordSection />
          <SessionsSection />
        </>
      ) : (
        <p className="text-sm muted">
          Sign-in is not enabled on this server, so credentials are managed elsewhere (by the
          server&apos;s administrator).
        </p>
      )}
      <DataSection />
      <DangerZone />
    </div>
  );
}
