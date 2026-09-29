import { useFilterOptions } from '../api/hooks';
import { useFilters } from '../lib/useFilters';

/** Year range, airline and cabin filters, stored in the URL. */
export function FilterBar({ compact = false }: { compact?: boolean }) {
  const { filters, setFilter, clear, active } = useFilters();
  const { data } = useFilterOptions();
  const years = data?.years ?? [];
  const select = 'input w-auto min-w-0 py-1.5';

  return (
    <div
      role="group"
      aria-label="Filters"
      className={`flex flex-wrap items-end gap-2 ${compact ? '' : 'mb-4'}`}
    >
      <label className="text-xs">
        <span className="label mb-0.5 text-xs">From</span>
        <select
          className={select}
          value={filters.yearFrom ?? ''}
          onChange={(e) => setFilter('yearFrom', e.target.value || undefined)}
        >
          <option value="">Any year</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        <span className="label mb-0.5 text-xs">To</span>
        <select
          className={select}
          value={filters.yearTo ?? ''}
          onChange={(e) => setFilter('yearTo', e.target.value || undefined)}
        >
          <option value="">Any year</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        <span className="label mb-0.5 text-xs">Airline</span>
        <select
          className={`${select} max-w-[12rem]`}
          value={filters.airline ?? ''}
          onChange={(e) => setFilter('airline', e.target.value || undefined)}
        >
          <option value="">All airlines</option>
          {data?.airlines.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label} ({a.count})
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        <span className="label mb-0.5 text-xs">Cabin</span>
        <select
          className={select}
          value={filters.cabin ?? ''}
          onChange={(e) => setFilter('cabin', e.target.value || undefined)}
        >
          <option value="">All cabins</option>
          {data?.cabins.map((c) => (
            <option key={c.value} value={c.value}>
              {c.value} ({c.count})
            </option>
          ))}
        </select>
      </label>
      {active && (
        <button type="button" className="btn-secondary py-1.5" onClick={clear}>
          Clear
        </button>
      )}
    </div>
  );
}
