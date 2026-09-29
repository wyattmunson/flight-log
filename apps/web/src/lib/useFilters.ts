import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { FlightFilters } from '@flight-log/shared';

const KEYS = ['yearFrom', 'yearTo', 'airline', 'cabin'] as const;

/** Map/stats/list filters live in the URL so views are shareable and survive reloads. */
export function useFilters() {
  const [params, setParams] = useSearchParams();

  const filters: FlightFilters = useMemo(() => {
    const f: FlightFilters = {};
    const from = Number(params.get('yearFrom'));
    const to = Number(params.get('yearTo'));
    if (from) f.yearFrom = from;
    if (to) f.yearTo = to;
    const airline = params.get('airline');
    if (airline) f.airline = airline;
    const cabin = params.get('cabin');
    if (cabin) f.cabin = cabin;
    return f;
  }, [params]);

  const setFilter = useCallback(
    (key: (typeof KEYS)[number], value: string | number | undefined) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === undefined || value === '') next.delete(key);
          else next.set(key, String(value));
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const clear = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const k of KEYS) next.delete(k);
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  const active = KEYS.some((k) => params.has(k));
  return { filters, setFilter, clear, active, params, setParams };
}
