import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 py-6 text-sm text-stone-500 dark:text-stone-400"
    >
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-brand"
        aria-hidden
      />
      {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      <p className="font-medium">Couldn’t load this.</p>
      <p className="mt-1">{message}</p>
      {onRetry && (
        <button type="button" className="btn-secondary mt-3" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 px-4 py-10 text-center dark:border-stone-700">
      <p className="font-medium">{title}</p>
      {children && (
        <div className="mt-2 text-sm text-stone-500 dark:text-stone-400">{children}</div>
      )}
    </div>
  );
}

export function NoFlightsYet() {
  return (
    <EmptyState title="No flights yet">
      <Link className="text-brand underline" to="/import">
        Import your Flighty export
      </Link>{' '}
      or{' '}
      <Link className="text-brand underline" to="/flights/new">
        add a flight
      </Link>
      .
    </EmptyState>
  );
}
