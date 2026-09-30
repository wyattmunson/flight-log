import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  convertMiles,
  type DistanceUnit,
  type Stats,
  type StatsFlightRef,
} from '@flight-log/shared';
import { useDisplayPrefs, useStats } from '../api/hooks';
import { ChartCard, ColumnChart, HBarChart, TimeLine } from '../components/charts';
import { FilterBar } from '../components/FilterBar';
import { SortableTable } from '../components/SortableTable';
import { ErrorState, NoFlightsYet, Spinner } from '../components/States';
import {
  MONTH_NAMES,
  countryName,
  formatDate,
  formatDistance,
  formatInt,
  formatMinutes,
  formatOne,
  formatTwo,
} from '../lib/format';
import { useFilters } from '../lib/useFilters';

const TOP_N = 10;

export function StatsPage() {
  const { filters, active } = useFilters();
  const stats = useStats(filters);
  // The saved preference (Profile) is the default; the toggle overrides it for this visit only.
  const { distanceUnit } = useDisplayPrefs();
  const [override, setUnit] = useState<DistanceUnit | null>(null);
  const unit = override ?? distanceUnit;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Stats</h1>
        <div
          role="group"
          aria-label="Distance unit"
          className="inline-flex rounded-lg border border-stone-300 p-0.5 dark:border-stone-700"
        >
          {(['mi', 'km'] as const).map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={unit === u}
              onClick={() => setUnit(u)}
              className={`rounded-md px-3 py-1 text-sm ${unit === u ? 'bg-brand text-white' : ''}`}
            >
              {u === 'mi' ? 'Miles' : 'Kilometers'}
            </button>
          ))}
        </div>
      </div>
      <FilterBar />
      {stats.isLoading && <Spinner />}
      {stats.isError && <ErrorState error={stats.error} onRetry={() => stats.refetch()} />}
      {stats.data &&
        (stats.data.headline.totalFlights === 0 &&
        stats.data.headline.canceledFlights === 0 &&
        !active ? (
          <NoFlightsYet />
        ) : (
          <div className={stats.isFetching ? 'opacity-70 transition-opacity' : ''}>
            <Dashboard stats={stats.data} unit={unit} />
          </div>
        ))}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card">
      <div className="text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs muted">{sub}</div>}
    </div>
  );
}

function FlightRef({ f, unit }: { f: StatsFlightRef | null; unit: DistanceUnit }) {
  if (!f) return <span className="muted">—</span>;
  return (
    <Link to={`/flights?flight=${f.id}`} className="hover:underline">
      {f.origin} → {f.destination}
      <span className="block text-xs font-normal muted">
        {formatDistance(f.distanceMiles, unit)} · {formatDate(f.flightDate)}
        {f.flightNumber ? ` · ${f.flightNumber}` : ''}
      </span>
    </Link>
  );
}

const delayText = (m: number | null) =>
  m === null ? '—' : `${m > 0 ? '+' : ''}${formatOne(m)} min`;

function Dashboard({ stats, unit }: { stats: Stats; unit: DistanceUnit }) {
  const h = stats.headline;
  const p = stats.punctuality;
  const dist = (miles: number) => formatDistance(miles, unit);
  const airportsTop = stats.airports
    .slice(0, TOP_N)
    .map((a) => ({ ...a, label: a.iata ?? a.icao ?? a.name }));
  const airlinesTop = stats.airlines.slice(0, TOP_N);
  const aircraftTop = stats.aircraftTypes.slice(0, TOP_N);
  const familiesTop = stats.aircraftFamilies.slice(0, TOP_N);
  const unitMiles = <R extends { miles: number }>(rows: R[]) =>
    rows.map((r) => ({ ...r, distance: Math.round(convertMiles(r.miles, unit)) }));

  return (
    <div className="space-y-6">
      <section aria-label="Totals" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
        <StatCard
          label="Flights"
          value={formatInt(h.totalFlights)}
          sub={
            h.canceledFlights
              ? `+ ${formatInt(h.canceledFlights)} canceled (not counted)`
              : undefined
          }
        />
        <StatCard label="Distance" value={dist(h.totalMiles)} />
        <StatCard
          label="Time in the air"
          value={formatMinutes(h.totalAirMinutes)}
          sub={
            h.flightsWithAirTime < h.totalFlights
              ? `${formatInt(h.flightsWithAirTime)} of ${formatInt(h.totalFlights)} flights have times`
              : `${formatOne(h.totalAirMinutes / 60 / 24)} days`
          }
        />
        <StatCard
          label="Time between gates"
          value={formatMinutes(h.totalGateMinutes)}
          sub={
            h.flightsWithGateTime < h.totalFlights
              ? `${formatInt(h.flightsWithGateTime)} of ${formatInt(h.totalFlights)} flights have times`
              : `${formatOne(h.totalGateMinutes / 60 / 24)} days`
          }
        />
        <StatCard
          label="Around the Earth"
          value={`${formatTwo(h.timesAroundEarth)}×`}
          sub="at 24,901 mi per lap"
        />
        <StatCard
          label="To the Moon"
          value={`${formatOne(h.percentToMoon)}%`}
          sub="of 238,855 mi"
        />
        <StatCard label="Airports" value={formatInt(h.uniqueAirports)} />
        <StatCard label="Airlines" value={formatInt(h.uniqueAirlines)} />
        <StatCard label="Countries" value={formatInt(h.uniqueCountries)} />
        <StatCard
          label="On-time arrivals"
          value={p.arrivalOnTimePercent === null ? '—' : `${formatOne(p.arrivalOnTimePercent)}%`}
          sub={`within ${p.thresholdMinutes} min · ${p.arrivalSamples} flights`}
        />
        {/* Canceled tile hidden until the UI redesign; canceled count still shows under Flights. */}
      </section>

      <section
        aria-label="Records"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard
          label="Longest flight"
          value={
            <span className="text-lg">
              <FlightRef f={stats.records.longest} unit={unit} />
            </span>
          }
        />
        <StatCard
          label="Shortest flight"
          value={
            <span className="text-lg">
              <FlightRef f={stats.records.shortest} unit={unit} />
            </span>
          }
        />
        <StatCard
          label="Most-flown route"
          value={
            stats.records.topRoute
              ? `${stats.records.topRoute.a} ↔ ${stats.records.topRoute.b}`
              : '—'
          }
          sub={
            stats.records.topRoute
              ? `${stats.records.topRoute.flights} flights · ${dist(stats.records.topRoute.distanceMiles)}`
              : undefined
          }
        />
        <StatCard
          label="Busiest day"
          value={stats.records.busiestDay ? formatDate(stats.records.busiestDay.date) : '—'}
          sub={
            stats.records.busiestDay
              ? `${stats.records.busiestDay.flights} flight${stats.records.busiestDay.flights === 1 ? '' : 's'}`
              : undefined
          }
        />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Flights per year"
          empty={stats.perYear.length === 0}
          table={
            <SortableTable
              caption="Flights per year"
              rows={stats.perYear}
              rowKey={(r) => r.year}
              initialSort={{ key: 'year', dir: 'desc' }}
              columns={[
                { key: 'year', label: 'Year', value: (r) => r.year },
                { key: 'flights', label: 'Flights', value: (r) => r.flights, numeric: true },
                {
                  key: 'miles',
                  label: unit,
                  value: (r) => Math.round(convertMiles(r.miles, unit)),
                  numeric: true,
                  render: (r) => formatInt(convertMiles(r.miles, unit)),
                },
              ]}
            />
          }
        >
          <ColumnChart data={stats.perYear} xKey="year" valueKey="flights" valueLabel="flights" />
        </ChartCard>
        <ChartCard
          title="Flights per month"
          subtitle="Over time"
          empty={stats.perMonth.length === 0}
          table={
            <SortableTable
              caption="Flights per month"
              rows={stats.perMonth}
              rowKey={(r) => r.month}
              initialSort={{ key: 'month', dir: 'desc' }}
              columns={[
                { key: 'month', label: 'Month', value: (r) => r.month },
                { key: 'flights', label: 'Flights', value: (r) => r.flights, numeric: true },
              ]}
            />
          }
        >
          <TimeLine
            data={fillMonths(stats.perMonth)}
            xKey="month"
            valueKey="flights"
            valueLabel="flights"
            xFormat={(v) => monthLabel(String(v))}
          />
        </ChartCard>
        <ChartCard
          title="Busiest months"
          subtitle="All years combined"
          empty={stats.byMonthOfYear.length === 0}
        >
          <ColumnChart
            data={MONTH_NAMES.map((_, i) => ({
              month: i + 1,
              flights: stats.byMonthOfYear.find((m) => m.month === i + 1)?.flights ?? 0,
            }))}
            xKey="month"
            valueKey="flights"
            valueLabel="flights"
            xFormat={(v) => MONTH_NAMES[Number(v) - 1] ?? ''}
          />
        </ChartCard>
        <ChartCard
          title="Punctuality"
          subtitle={`Delay = actual − scheduled at the gate (runway times if gate times are missing). On time = ≤ ${p.thresholdMinutes} min late.`}
          empty={p.departureSamples === 0 && p.arrivalSamples === 0}
        >
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="muted">Average departure delay</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {delayText(p.avgDepartureDelayMinutes)}
              </dd>
              <dd className="text-xs muted">{p.departureSamples} flights</dd>
            </div>
            <div>
              <dt className="muted">Average arrival delay</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {delayText(p.avgArrivalDelayMinutes)}
              </dd>
              <dd className="text-xs muted">{p.arrivalSamples} flights</dd>
            </div>
            <div>
              <dt className="muted">On-time departures</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {p.departureOnTimePercent === null
                  ? '—'
                  : `${formatOne(p.departureOnTimePercent)}%`}
              </dd>
            </div>
            <div>
              <dt className="muted">On-time arrivals</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {p.arrivalOnTimePercent === null ? '—' : `${formatOne(p.arrivalOnTimePercent)}%`}
              </dd>
            </div>
          </dl>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title={`Top ${TOP_N} airports`}
          subtitle="Departures + arrivals"
          empty={airportsTop.length === 0}
        >
          <HBarChart data={airportsTop} labelKey="label" valueKey="visits" valueLabel="visits" />
        </ChartCard>
        <ChartCard title="All airports" empty={stats.airports.length === 0}>
          <div className="max-h-96 overflow-auto">
            <SortableTable
              caption="All airports by visits"
              rows={stats.airports}
              rowKey={(r) => r.id}
              initialSort={{ key: 'visits', dir: 'desc' }}
              columns={[
                {
                  key: 'code',
                  label: 'Code',
                  value: (r) => r.iata ?? r.icao,
                  render: (r) => <span className="font-medium">{r.iata ?? r.icao}</span>,
                },
                {
                  key: 'name',
                  label: 'Airport',
                  value: (r) => r.name,
                  render: (r) => (
                    <span>
                      {r.name}
                      <span className="block text-xs muted">
                        {[r.city, countryName(r.country)].filter(Boolean).join(', ')}
                      </span>
                    </span>
                  ),
                },
                { key: 'departures', label: 'Dep', value: (r) => r.departures, numeric: true },
                { key: 'arrivals', label: 'Arr', value: (r) => r.arrivals, numeric: true },
                { key: 'visits', label: 'Visits', value: (r) => r.visits, numeric: true },
              ]}
            />
          </div>
        </ChartCard>
        <ChartCard
          title="Airlines"
          subtitle="Flights per airline"
          empty={airlinesTop.length === 0}
          table={
            <SortableTable
              caption="Flights and distance per airline"
              rows={stats.airlines}
              rowKey={(r) => r.label}
              initialSort={{ key: 'flights', dir: 'desc' }}
              columns={[
                { key: 'label', label: 'Airline', value: (r) => r.label },
                { key: 'flights', label: 'Flights', value: (r) => r.flights, numeric: true },
                {
                  key: 'miles',
                  label: unit,
                  value: (r) => r.miles,
                  numeric: true,
                  render: (r) => formatInt(convertMiles(r.miles, unit)),
                },
              ]}
            />
          }
        >
          <HBarChart data={airlinesTop} labelKey="label" valueKey="flights" valueLabel="flights" />
        </ChartCard>
        <ChartCard
          title="Airlines by distance"
          subtitle={`Total ${unit === 'mi' ? 'miles' : 'kilometers'} per airline`}
          empty={airlinesTop.length === 0}
        >
          <HBarChart
            data={unitMiles([...stats.airlines].sort((a, b) => b.miles - a.miles).slice(0, TOP_N))}
            labelKey="label"
            valueKey="distance"
            valueLabel={unit}
          />
        </ChartCard>
        <ChartCard
          title="Aircraft types"
          empty={aircraftTop.length === 0}
          table={
            <SortableTable
              caption="Flights per aircraft type"
              rows={stats.aircraftTypes}
              rowKey={(r) => r.label}
              initialSort={{ key: 'flights', dir: 'desc' }}
              columns={[
                { key: 'label', label: 'Aircraft', value: (r) => r.label },
                { key: 'flights', label: 'Flights', value: (r) => r.flights, numeric: true },
                {
                  key: 'miles',
                  label: unit,
                  value: (r) => r.miles,
                  numeric: true,
                  render: (r) => formatInt(convertMiles(r.miles, unit)),
                },
              ]}
            />
          }
        >
          <HBarChart data={aircraftTop} labelKey="label" valueKey="flights" valueLabel="flights" />
        </ChartCard>
        <ChartCard
          title="Aircraft families"
          subtitle="Types grouped by family, e.g. all 777 variants"
          empty={familiesTop.length === 0}
          table={
            <SortableTable
              caption="Flights per aircraft family"
              rows={stats.aircraftFamilies}
              rowKey={(r) => r.label}
              initialSort={{ key: 'flights', dir: 'desc' }}
              columns={[
                { key: 'label', label: 'Family', value: (r) => r.label },
                { key: 'flights', label: 'Flights', value: (r) => r.flights, numeric: true },
                {
                  key: 'miles',
                  label: unit,
                  value: (r) => r.miles,
                  numeric: true,
                  render: (r) => formatInt(convertMiles(r.miles, unit)),
                },
              ]}
            />
          }
        >
          <HBarChart data={familiesTop} labelKey="label" valueKey="flights" valueLabel="flights" />
        </ChartCard>
        <ChartCard
          title="Most-flown tails"
          subtitle="The same physical aircraft more than once is highlighted"
          empty={stats.tails.length === 0}
        >
          <div className="max-h-80 overflow-auto">
            <SortableTable
              caption="Most-flown tail numbers"
              rows={stats.tails}
              rowKey={(r) => r.tailNumber}
              initialSort={{ key: 'flights', dir: 'desc' }}
              columns={[
                {
                  key: 'tail',
                  label: 'Tail',
                  value: (r) => r.tailNumber,
                  render: (r) => (
                    <span className="font-mono">
                      {r.tailNumber}
                      {r.flights > 1 && (
                        <span className="ml-2 rounded bg-brand/15 px-1.5 py-0.5 font-sans text-xs font-medium text-brand-dark dark:text-brand-light">
                          Repeat
                        </span>
                      )}
                    </span>
                  ),
                },
                {
                  key: 'type',
                  label: 'Aircraft',
                  value: (r) => r.aircraftTypes.join(', ') || null,
                },
                { key: 'airline', label: 'Airline', value: (r) => r.airlines.join(', ') || null },
                { key: 'flights', label: 'Flights', value: (r) => r.flights, numeric: true },
              ]}
            />
          </div>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ChartCard title="Cabin class" empty={stats.cabinClass.length === 0}>
          <HBarChart
            data={stats.cabinClass}
            labelKey="label"
            valueKey="flights"
            valueLabel="flights"
          />
        </ChartCard>
        <ChartCard title="Seat type" empty={stats.seatType.length === 0}>
          <HBarChart
            data={stats.seatType}
            labelKey="label"
            valueKey="flights"
            valueLabel="flights"
          />
        </ChartCard>
        <ChartCard title="Flight reason" empty={stats.flightReason.length === 0}>
          <HBarChart
            data={stats.flightReason}
            labelKey="label"
            valueKey="flights"
            valueLabel="flights"
          />
        </ChartCard>
      </div>
    </div>
  );
}

function monthLabel(ym: string) {
  const [y, m] = ym.split('-');
  return `${MONTH_NAMES[Number(m) - 1] ?? ''} ${y?.slice(2) ?? ''}`;
}

/** Insert zero months so gaps in the timeline read as "no flights", not interpolated values. */
function fillMonths(rows: { month: string; flights: number }[]) {
  if (rows.length < 2) return rows;
  const byMonth = new Map(rows.map((r) => [r.month, r.flights]));
  const out: { month: string; flights: number }[] = [];
  let [y, m] = rows[0]!.month.split('-').map(Number) as [number, number];
  const last = rows[rows.length - 1]!.month;
  for (let i = 0; i < 1200; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push({ month: key, flights: byMonth.get(key) ?? 0 });
    if (key === last) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
