import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FlightListItem } from '@flight-log/shared';
import { useDeleteFlight, useDisplayPrefs, useFlight, useFlights } from '../api/hooks';
import { Drawer } from '../components/Drawer';
import { FilterBar } from '../components/FilterBar';
import { FlightDetailView } from '../components/FlightDetail';
import { EmptyState, ErrorState, NoFlightsYet, Spinner } from '../components/States';
import {
  airlineLabel,
  airportCode,
  formatDate,
  formatDistance,
  formatInt,
  formatMinutes,
  flightDesignator,
} from '../lib/format';
import { useDebounced } from '../lib/useDebounced';
import { useFilters } from '../lib/useFilters';

const COLUMNS: { key: string; label: string; sortable: boolean; className?: string }[] = [
  { key: 'date', label: 'Date', sortable: true },
  { key: 'route', label: 'Route', sortable: true },
  { key: 'airline', label: 'Airline', sortable: true, className: 'hidden md:table-cell' },
  { key: 'flightNumber', label: 'Flight', sortable: true },
  { key: 'distance', label: 'Distance', sortable: true, className: 'text-right' },
  { key: 'aircraft', label: 'Aircraft', sortable: true, className: 'hidden lg:table-cell' },
  {
    key: 'duration',
    label: 'Duration',
    sortable: true,
    className: 'hidden sm:table-cell text-right',
  },
];

export function FlightsPage() {
  const { filters, params, setParams, active } = useFilters();
  const page = Number(params.get('page')) || 1;
  const sort = params.get('sort') ?? '-date';
  const selectedId = params.get('flight');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search, 300);
  const pageSize = 25;

  const update = useCallback(
    (changes: Record<string, string | null>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(changes)) {
            if (v === null || v === '') next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const list = useFlights({ ...filters, page, pageSize, sort, q: q || undefined });
  const detail = useFlight(selectedId);
  const del = useDeleteFlight();

  const toggleSort = (key: string) => {
    const next =
      sort === `-${key}`
        ? key
        : sort === key
          ? `-${key}`
          : key === 'date' || key === 'distance' || key === 'duration'
            ? `-${key}`
            : key;
    update({ sort: next, page: null });
  };
  const closeDrawer = useCallback(() => update({ flight: null }), [update]);

  const data = list.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Flights</h1>
        <Link to="/flights/new" className="btn-primary">
          Add flight
        </Link>
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="w-full sm:w-64">
          <span className="label mb-0.5 text-xs">Search</span>
          <input
            type="search"
            className="input py-1.5"
            placeholder="Airport, flight, tail, notes…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              update({ q: e.target.value || null, page: null });
            }}
          />
        </label>
        <FilterBar compact />
      </div>

      {list.isLoading && <Spinner />}
      {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
      {data &&
        data.total === 0 &&
        (active || q ? <EmptyState title="No flights match these filters" /> : <NoFlightsYet />)}

      {data && data.total > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Your flights. Select a row to see details.</caption>
              <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500 dark:bg-stone-800/50 dark:text-stone-400">
                <tr>
                  {COLUMNS.map((c) => {
                    const dir =
                      sort === c.key ? 'ascending' : sort === `-${c.key}` ? 'descending' : 'none';
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        aria-sort={dir}
                        className={`px-3 py-2 font-medium ${c.className ?? ''}`}
                      >
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 uppercase"
                          onClick={() => toggleSort(c.key)}
                        >
                          {c.label}
                          <span aria-hidden className="text-[10px]">
                            {dir === 'ascending' ? '▲' : dir === 'descending' ? '▼' : ''}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className={list.isFetching ? 'opacity-60' : ''}>
                {data.items.map((f) => (
                  <FlightRow key={f.id} flight={f} onOpen={() => update({ flight: f.id })} />
                ))}
              </tbody>
            </table>
          </div>
          <nav
            aria-label="Pagination"
            className="flex items-center justify-between border-t border-stone-200 px-3 py-2 text-sm dark:border-stone-800"
          >
            <span className="muted">
              {formatInt((page - 1) * pageSize + 1)}–
              {formatInt(Math.min(page * pageSize, data.total))} of {formatInt(data.total)}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary py-1"
                disabled={page <= 1}
                onClick={() => update({ page: String(page - 1) })}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn-secondary py-1"
                disabled={page >= totalPages}
                onClick={() => update({ page: String(page + 1) })}
              >
                Next
              </button>
            </div>
          </nav>
        </div>
      )}

      <Drawer open={!!selectedId} onClose={closeDrawer} title="Flight details">
        {detail.isLoading && <Spinner />}
        {detail.isError && <ErrorState error={detail.error} />}
        {detail.data && (
          <FlightDetailView
            flight={detail.data}
            deleting={del.isPending}
            onDelete={() => {
              if (window.confirm('Delete this flight? This cannot be undone.')) {
                del.mutate(detail.data.id, { onSuccess: closeDrawer });
              }
            }}
          />
        )}
        {del.isError && <ErrorState error={del.error} />}
      </Drawer>
    </div>
  );
}

function FlightRow({ flight: f, onOpen }: { flight: FlightListItem; onOpen: () => void }) {
  const { distanceUnit } = useDisplayPrefs();
  return (
    <tr
      className={`cursor-pointer border-t border-stone-100 hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-800/50 ${f.canceled ? 'text-stone-400 line-through decoration-stone-400/60' : ''}`}
      onClick={onOpen}
    >
      <td className="whitespace-nowrap px-3 py-2">
        <button
          type="button"
          className="text-left font-medium hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          {formatDate(f.flightDate)}
        </button>
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-medium">
        {airportCode(f.origin)} → {airportCode(f.destination)}
        {f.divertedTo && (
          <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">
            diverted {airportCode(f.divertedTo)}
          </span>
        )}
        {f.canceled && <span className="sr-only"> (canceled)</span>}
      </td>
      <td className="hidden px-3 py-2 md:table-cell">
        {airlineLabel(f.airline, f.airlineNameRaw)}
      </td>
      <td className="whitespace-nowrap px-3 py-2">{flightDesignator(f.airline, f.flightNumber)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
        {formatDistance(f.distanceMiles, distanceUnit)}
      </td>
      <td className="hidden px-3 py-2 lg:table-cell">{f.aircraftType ?? '—'}</td>
      <td className="hidden whitespace-nowrap px-3 py-2 text-right tabular-nums sm:table-cell">
        {formatMinutes(f.airTimeMinutes)}
      </td>
    </tr>
  );
}
