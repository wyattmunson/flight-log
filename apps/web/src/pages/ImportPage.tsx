import { useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import type { ImportPreview, ImportRowStatus, ImportSummary } from '@flight-log/shared';
import { ApiError } from '../api/client';
import { useImportBatches, useImportCommit, useImportPreview, useUndoImport } from '../api/hooks';
import { EmptyState, ErrorState, Spinner } from '../components/States';
import { formatDate, formatInt } from '../lib/format';

const STATUS_STYLE: Record<ImportRowStatus, string> = {
  new: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  duplicate: 'bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-200',
  invalid: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-300',
};
const STATUS_LABEL: Record<ImportRowStatus, string> = {
  new: 'New',
  duplicate: 'Duplicate',
  invalid: 'Error',
};

export function ImportPage() {
  const preview = useImportPreview();
  const commit = useImportCommit();
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const reset = () => {
    preview.reset();
    commit.reset();
    setSummary(null);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Import from Flighty</h1>
        <p className="mt-1 text-sm muted">
          In Flighty, open Settings → Export Flight Data, then upload the CSV here. You’ll see a
          preview first; nothing is saved until you confirm. Re-importing the same file never
          creates duplicates.
        </p>
      </div>

      {summary ? (
        <SummaryCard summary={summary} onAgain={reset} />
      ) : preview.data ? (
        <PreviewCard
          preview={preview.data}
          committing={commit.isPending}
          commitError={commit.error}
          onCancel={reset}
          onCommit={() => commit.mutate(preview.data.previewId, { onSuccess: setSummary })}
        />
      ) : (
        <DropZone
          uploading={preview.isPending}
          error={preview.error}
          onFile={(f) => preview.mutate(f)}
        />
      )}

      <BatchList />
    </div>
  );
}

function DropZone({
  onFile,
  uploading,
  error,
}: {
  onFile: (f: File) => void;
  uploading: boolean;
  error: unknown;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const accept = (file: File | undefined) => {
    setLocalError(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setLocalError('Please choose a .csv file.');
      return;
    }
    onFile(file);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    accept(e.dataTransfer.files[0]);
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-12 text-center transition ${
          over ? 'border-brand bg-brand/5' : 'border-stone-300 dark:border-stone-700'
        }`}
      >
        {uploading ? (
          <Spinner label="Reading your flights…" />
        ) : (
          <>
            <p className="font-medium">Drag and drop your Flighty CSV here</p>
            <p className="my-2 text-sm muted">or</p>
            <button type="button" className="btn-primary" onClick={() => input.current?.click()}>
              Choose file
            </button>
            <input
              ref={input}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label="CSV file"
              onChange={(e) => {
                accept(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <p className="mt-3 text-xs muted">Max 10 MB.</p>
          </>
        )}
      </div>
      {localError && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {localError}
        </p>
      )}
      {error != null && (
        <div className="mt-3">
          <ErrorState error={error} />
          {error instanceof ApiError && error.code === 'missing_columns' && (
            <p className="mt-2 text-sm muted">
              Expected Flighty’s export header (Date, Airline, Flight, From, To, …).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`rounded-lg p-3 ${tone ?? 'bg-stone-100 dark:bg-stone-800'}`}>
      <div className="text-2xl font-semibold tabular-nums">{formatInt(value)}</div>
      <div className="text-xs uppercase tracking-wide">{label}</div>
    </div>
  );
}

function PreviewCard({
  preview,
  onCommit,
  onCancel,
  committing,
  commitError,
}: {
  preview: ImportPreview;
  onCommit: () => void;
  onCancel: () => void;
  committing: boolean;
  commitError: unknown;
}) {
  const { counts } = preview;
  return (
    <section className="card space-y-5" aria-labelledby="preview-title">
      <div>
        <h2 id="preview-title" className="text-lg font-semibold">
          Preview: {preview.filename}
        </h2>
        {preview.previouslyImportedBatchId && (
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
            You imported this exact file before. Rows already in your log are marked as duplicates.
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Count label="Rows" value={counts.total} />
        <Count label="New" value={counts.new} tone={STATUS_STYLE.new} />
        <Count label="Duplicates" value={counts.duplicate} tone={STATUS_STYLE.duplicate} />
        <Count label="Errors" value={counts.invalid} tone={STATUS_STYLE.invalid} />
      </div>
      {preview.unknownColumns.length > 0 && (
        <p className="text-sm">
          <span className="font-medium">Ignored columns:</span> {preview.unknownColumns.join(', ')}
        </p>
      )}
      {preview.missingColumns.length > 0 && (
        <p className="text-sm">
          <span className="font-medium">Columns not in this file:</span>{' '}
          {preview.missingColumns.join(', ')}
        </p>
      )}

      {preview.errors.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Rows that will be skipped</h3>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-sm">
            {preview.errors.map((e, i) => (
              <li key={i}>
                <span className="font-mono text-xs muted">Line {e.line}</span>{' '}
                {e.column && <span className="font-medium">{e.column}: </span>}
                {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold">
          Sample ({preview.sample.length} of {counts.total} rows)
        </h3>
        <div className="mt-2 max-h-96 overflow-auto rounded-lg border border-stone-200 dark:border-stone-800">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-stone-50 text-left text-xs uppercase text-stone-500 dark:bg-stone-800 dark:text-stone-400">
              <tr>
                <th scope="col" className="px-2 py-2 font-medium">
                  Line
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Date
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Route
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Airline
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Flight
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Notes
                </th>
              </tr>
            </thead>
            <tbody>
              {preview.sample.map((r) => (
                <tr
                  key={r.line}
                  className="border-t border-stone-100 align-top dark:border-stone-800"
                >
                  <td className="px-2 py-1.5 font-mono text-xs">{r.line}</td>
                  <td className="px-2 py-1.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {r.flightDate ? formatDate(r.flightDate) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {r.origin ?? '?'} → {r.destination ?? '?'}
                    {r.divertedTo && (
                      <span className="text-xs text-amber-700 dark:text-amber-400">
                        {' '}
                        (diverted {r.divertedTo})
                      </span>
                    )}
                    {r.canceled && (
                      <span className="ml-1 text-xs text-red-700 dark:text-red-400">canceled</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">{r.airline ?? '—'}</td>
                  <td className="px-2 py-1.5">{r.flightNumber ?? '—'}</td>
                  <td className="px-2 py-1.5 text-xs">
                    {[...r.errors.map((e) => e.message), r.duplicateReason, ...r.warnings]
                      .filter(Boolean)
                      .join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {commitError != null && <ErrorState error={commitError} />}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="btn-primary"
          onClick={onCommit}
          disabled={committing || counts.new === 0}
        >
          {committing
            ? 'Importing…'
            : `Import ${formatInt(counts.new)} new flight${counts.new === 1 ? '' : 's'}`}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={committing}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function SummaryCard({ summary, onAgain }: { summary: ImportSummary; onAgain: () => void }) {
  return (
    <section className="card space-y-4" aria-labelledby="summary-title" role="status">
      <h2 id="summary-title" className="text-lg font-semibold">
        Import complete
      </h2>
      <div className="grid grid-cols-3 gap-3">
        <Count label="Imported" value={summary.imported} tone={STATUS_STYLE.new} />
        <Count
          label="Skipped duplicates"
          value={summary.duplicates}
          tone={STATUS_STYLE.duplicate}
        />
        <Count label="Failed" value={summary.failed} tone={STATUS_STYLE.invalid} />
      </div>
      {summary.errors.length > 0 && (
        <ul className="max-h-48 space-y-1 overflow-auto text-sm">
          {summary.errors.map((e, i) => (
            <li key={i}>
              <span className="font-mono text-xs muted">Line {e.line}</span>{' '}
              {e.column && <span className="font-medium">{e.column}: </span>}
              {e.message}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-3">
        <Link to="/" className="btn-primary">
          See the map
        </Link>
        <Link to="/stats" className="btn-secondary">
          View stats
        </Link>
        <button type="button" className="btn-secondary" onClick={onAgain}>
          Import another file
        </button>
      </div>
    </section>
  );
}

function BatchList() {
  const batches = useImportBatches();
  const undo = useUndoImport();
  return (
    <section aria-labelledby="history-title">
      <h2 id="history-title" className="mb-3 text-lg font-semibold">
        Import history
      </h2>
      {batches.isLoading && <Spinner />}
      {batches.isError && <ErrorState error={batches.error} onRetry={() => batches.refetch()} />}
      {batches.data?.length === 0 && <EmptyState title="No imports yet" />}
      {batches.data && batches.data.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500 dark:bg-stone-800/50 dark:text-stone-400">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  When
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  File
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Imported
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Duplicates
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Failed
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {batches.data.map((b) => (
                <tr key={b.id} className="border-t border-stone-100 dark:border-stone-800">
                  <td className="whitespace-nowrap px-3 py-2">
                    {new Date(b.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">{b.filename}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInt(b.imported)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInt(b.duplicates)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInt(b.failed)}</td>
                  <td className="px-3 py-2 text-right">
                    {b.status === 'undone' ? (
                      <span className="text-xs muted">Undone</span>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary py-1 text-red-700 dark:text-red-400"
                        disabled={undo.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Undo this import? This deletes its ${b.remainingFlights} flight(s), including any edits you made to them.`,
                            )
                          ) {
                            undo.mutate(b.id);
                          }
                        }}
                      >
                        Undo
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {undo.isError && (
        <div className="mt-3">
          <ErrorState error={undo.error} />
        </div>
      )}
    </section>
  );
}
