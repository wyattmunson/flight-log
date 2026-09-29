import { Link } from 'react-router-dom';
import type { FlightDetail as Flight, FlightTimeField } from '@flight-log/shared';
import {
  airlineLabel,
  airportCode,
  countryName,
  formatDate,
  formatDistance,
  formatLocalTime,
  formatMinutes,
  flightDesignator,
} from '../lib/format';

const TIME_ROWS: {
  label: string;
  scheduled: FlightTimeField;
  actual: FlightTimeField;
  side: 'dep' | 'arr';
}[] = [
  {
    label: 'Gate departure',
    scheduled: 'gateDepartureScheduled',
    actual: 'gateDepartureActual',
    side: 'dep',
  },
  { label: 'Takeoff', scheduled: 'takeoffScheduled', actual: 'takeoffActual', side: 'dep' },
  { label: 'Landing', scheduled: 'landingScheduled', actual: 'landingActual', side: 'arr' },
  {
    label: 'Gate arrival',
    scheduled: 'gateArrivalScheduled',
    actual: 'gateArrivalActual',
    side: 'arr',
  },
];

function TimeCell({ utc, zone }: { utc: string | null; zone: string | null }) {
  const t = formatLocalTime(utc, zone);
  if (!t) return <span className="muted">—</span>;
  return (
    <span title={utc ?? undefined}>
      <span className="font-medium tabular-nums">{t.time}</span>{' '}
      <span className="text-xs text-stone-500 dark:text-stone-400">{t.abbr}</span>
      <span className="block text-xs text-stone-500 dark:text-stone-400">{t.date}</span>
    </span>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">
        {label}
      </dt>
      <dd className="mt-0.5">{value || <span className="muted">—</span>}</dd>
    </div>
  );
}

export function FlightDetailView({
  flight,
  onDelete,
  deleting,
}: {
  flight: Flight;
  onDelete: () => void;
  deleting: boolean;
}) {
  const arrival = flight.divertedTo ?? flight.destination;
  const zoneFor = (side: 'dep' | 'arr', actual: boolean) =>
    side === 'dep' ? flight.origin.timezone : (actual ? arrival : flight.destination).timezone;

  return (
    <article>
      <p className="text-sm muted">{formatDate(flight.flightDate)}</p>
      <h2 className="mt-1 text-2xl font-semibold">
        {airportCode(flight.origin)} → {airportCode(flight.destination)}
        {flight.divertedTo && (
          <span className="ml-2 text-base font-normal text-amber-700 dark:text-amber-400">
            diverted to {airportCode(flight.divertedTo)}
          </span>
        )}
      </h2>
      <p className="mt-1">
        {airlineLabel(flight.airline, flight.airlineNameRaw)} ·{' '}
        {flightDesignator(flight.airline, flight.flightNumber)}
        {flight.canceled && (
          <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-950 dark:text-red-300">
            Canceled
          </span>
        )}
      </p>

      <div className="mt-4 flex gap-2">
        <Link to={`/flights/${flight.id}/edit`} className="btn-primary">
          Edit
        </Link>
        <button type="button" className="btn-danger" onClick={onDelete} disabled={deleting}>
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <Field
          label="From"
          value={`${flight.origin.name} (${[flight.origin.city, countryName(flight.origin.country)].filter(Boolean).join(', ')})`}
        />
        <Field
          label="To"
          value={`${flight.destination.name} (${[flight.destination.city, countryName(flight.destination.country)].filter(Boolean).join(', ')})`}
        />
        <Field
          label="Distance"
          value={`${formatDistance(flight.distanceMiles)} · ${formatDistance(flight.distanceMiles, 'km')}`}
        />
        <Field label="Air time" value={formatMinutes(flight.airTimeMinutes)} />
      </dl>

      <h3 className="mt-6 text-sm font-semibold">Times (local to each airport)</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-stone-500 dark:text-stone-400">
              <th scope="col" className="py-1 pr-2 font-medium" />
              <th scope="col" className="py-1 pr-2 font-medium">
                Scheduled
              </th>
              <th scope="col" className="py-1 font-medium">
                Actual
              </th>
            </tr>
          </thead>
          <tbody>
            {TIME_ROWS.map((r) => (
              <tr key={r.label} className="border-t border-stone-100 dark:border-stone-800">
                <th scope="row" className="py-2 pr-2 text-left font-medium">
                  {r.label}
                  <span className="block text-xs font-normal muted">
                    {r.side === 'dep' ? airportCode(flight.origin) : airportCode(arrival)}
                  </span>
                </th>
                <td className="py-2 pr-2">
                  <TimeCell utc={flight[r.scheduled]} zone={zoneFor(r.side, false)} />
                </td>
                <td className="py-2">
                  <TimeCell utc={flight[r.actual]} zone={zoneFor(r.side, true)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        <Field
          label="Departure terminal / gate"
          value={[flight.depTerminal, flight.depGate].filter(Boolean).join(' / ')}
        />
        <Field
          label="Arrival terminal / gate"
          value={[flight.arrTerminal, flight.arrGate].filter(Boolean).join(' / ')}
        />
        <Field label="Aircraft" value={flight.aircraftType} />
        <Field label="Tail number" value={flight.tailNumber} />
        <Field label="Cabin" value={flight.cabinClass} />
        <Field label="Seat" value={[flight.seat, flight.seatType].filter(Boolean).join(' · ')} />
        <Field label="Reason" value={flight.flightReason} />
        <Field label="Booking reference (PNR)" value={flight.pnr} />
        <Field
          label="Source"
          value={flight.source === 'flighty_csv' ? 'Flighty import' : flight.source}
        />
      </dl>
      {flight.notes && (
        <div className="mt-4 text-sm">
          <h3 className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">
            Notes
          </h3>
          <p className="mt-1 whitespace-pre-wrap">{flight.notes}</p>
        </div>
      )}
      {flight.sourceRaw && (
        <details className="mt-6 text-sm">
          <summary className="cursor-pointer text-stone-600 dark:text-stone-300">
            Original CSV row
          </summary>
          <dl className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
            {Object.entries(flight.sourceRaw).map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="shrink-0 text-stone-500">{k}:</dt>
                <dd className="break-all">{v ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </article>
  );
}
