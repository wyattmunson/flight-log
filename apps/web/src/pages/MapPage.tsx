import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useConfig, useMapData, useRouteFlights } from '../api/hooks';
import { FilterBar } from '../components/FilterBar';
import { FlightMap } from '../components/FlightMap';
import { ErrorState, Spinner } from '../components/States';
import { formatDate, formatDistance, formatInt } from '../lib/format';
import { useFilters } from '../lib/useFilters';

export function MapPage() {
  const config = useConfig();
  const { filters, active } = useFilters();
  const mapData = useMapData(filters);
  const [selected, setSelected] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const airportsById = useMemo(
    () => new Map(mapData.data?.airports.map((a) => [a.id, a]) ?? []),
    [mapData.data],
  );
  const route = mapData.data?.routes.find((r) => r.key === selected) ?? null;
  const routeFlights = useRouteFlights(
    route ? { a: route.airportA, b: route.airportB } : null,
    filters,
  );
  const code = (id: number) => {
    const a = airportsById.get(id);
    return a?.iata ?? a?.icao ?? '?';
  };

  const totals = useMemo(() => {
    const routes = mapData.data?.routes ?? [];
    return {
      flights: routes.reduce((s, r) => s + r.count, 0),
      routes: routes.length,
      airports: mapData.data?.airports.length ?? 0,
    };
  }, [mapData.data]);

  return (
    <div className="relative min-h-[70dvh] flex-1">
      {config.data && (
        <FlightMap
          styleUrl={config.data.mapStyleUrl}
          data={mapData.data}
          selectedRoute={selected}
          onSelectRoute={(k) => {
            setSelected(k);
            setPanelOpen(true);
          }}
        />
      )}
      {config.isError && (
        <div className="p-4">
          <ErrorState error={config.error} onRetry={() => config.refetch()} />
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-col gap-2 sm:inset-x-auto sm:left-3 sm:top-3 sm:w-[26rem]">
        <section
          className="pointer-events-auto rounded-xl bg-white/95 p-3 shadow-lg backdrop-blur dark:bg-stone-900/95"
          aria-label="Map filters"
        >
          <FilterBar compact />
          <p className="mt-2 text-xs muted" aria-live="polite">
            {mapData.isLoading
              ? 'Loading flights…'
              : `${formatInt(totals.flights)} flights · ${formatInt(totals.routes)} routes · ${formatInt(totals.airports)} airports${active ? ' (filtered)' : ''}. Canceled flights are hidden.`}
          </p>
          {mapData.isError && (
            <ErrorState error={mapData.error} onRetry={() => mapData.refetch()} />
          )}
          {mapData.data && totals.flights === 0 && (
            <p className="mt-2 text-sm">
              {active ? (
                'No flights match these filters.'
              ) : (
                <>
                  No flights yet.{' '}
                  <Link className="text-brand underline" to="/import">
                    Import from Flighty
                  </Link>{' '}
                  or{' '}
                  <Link className="text-brand underline" to="/flights/new">
                    add one
                  </Link>
                  .
                </>
              )}
            </p>
          )}
        </section>
      </div>

      {mapData.data && totals.routes > 0 && (
        <aside
          className="absolute inset-x-2 bottom-2 max-h-[45%] overflow-hidden rounded-xl bg-white/95 shadow-lg backdrop-blur dark:bg-stone-900/95 sm:inset-x-auto sm:bottom-auto sm:right-14 sm:top-3 sm:max-h-[calc(100%-1.5rem)] sm:w-80"
          aria-label="Routes"
        >
          <div className="flex items-center justify-between border-b border-stone-200 px-3 py-2 dark:border-stone-800">
            <h2 className="text-sm font-semibold">
              {route ? `${code(route.airportA)} ↔ ${code(route.airportB)}` : 'Routes'}
            </h2>
            <div className="flex gap-1">
              {route && (
                <button
                  type="button"
                  className="btn-secondary px-2 py-0.5 text-xs"
                  onClick={() => setSelected(null)}
                >
                  All routes
                </button>
              )}
              <button
                type="button"
                className="btn-secondary px-2 py-0.5 text-xs"
                aria-expanded={panelOpen}
                onClick={() => setPanelOpen((o) => !o)}
              >
                {panelOpen ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          {panelOpen && (
            <div className="max-h-[calc(45dvh-3rem)] overflow-y-auto p-2 sm:max-h-[60vh]">
              {route ? (
                <>
                  <p className="px-1 pb-2 text-xs muted">
                    {route.count} flight{route.count === 1 ? '' : 's'} ·{' '}
                    {formatDistance(route.distanceMiles)} each way
                  </p>
                  {routeFlights.isLoading && <Spinner />}
                  {routeFlights.isError && <ErrorState error={routeFlights.error} />}
                  <ul className="space-y-1 text-sm">
                    {routeFlights.data?.map((f) => (
                      <li key={f.id}>
                        <Link
                          to={`/flights?flight=${f.id}`}
                          className="block rounded-md px-2 py-1.5 hover:bg-stone-100 dark:hover:bg-stone-800"
                        >
                          <span className="font-medium">{formatDate(f.flightDate)}</span>{' '}
                          <span className="muted">
                            {f.origin}→{f.destination}
                          </span>
                          <span className="block text-xs">
                            {[f.airline, f.flightNumber].filter(Boolean).join(' · ') ||
                              'Unknown airline'}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <ul className="space-y-0.5 text-sm">
                  {mapData.data.routes.map((r) => (
                    <li key={r.key}>
                      <button
                        type="button"
                        onClick={() => setSelected(r.key)}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-stone-100 dark:hover:bg-stone-800"
                      >
                        <span className="font-medium">
                          {code(r.airportA)} ↔ {code(r.airportB)}
                        </span>
                        <span className="text-xs muted">
                          {r.count}× · {formatDistance(r.distanceMiles)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
