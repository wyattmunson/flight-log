import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  FLIGHT_TIME_FIELDS,
  haversineMiles,
  milesToKm,
  normalizeFlightNumber,
  toLocalInputValue,
  toLocalParts,
  type AirlineSummary,
  type AirportSummary,
  type FlightDetail,
  type FlightInput,
  type FlightTimeField,
} from '@flight-log/shared';
import { ApiError, apiFetch } from '../api/client';
import {
  useAirlineSearch,
  useAirportSearch,
  useConfig,
  useDisplayPrefs,
  useFlight,
  useLookup,
  useSaveFlight,
} from '../api/hooks';
import { Combobox } from '../components/Combobox';
import { ErrorState, Spinner } from '../components/States';
import { formatInt } from '../lib/format';

type Times = Record<FlightTimeField, string>;

interface FormState {
  flightDate: string;
  airline: AirlineSummary | null;
  airlineText: string;
  flightNumber: string;
  origin: AirportSummary | null;
  destination: AirportSummary | null;
  divertedTo: AirportSummary | null;
  canceled: boolean;
  times: Times;
  depTerminal: string;
  depGate: string;
  arrTerminal: string;
  arrGate: string;
  aircraftTypeName: string;
  tailNumber: string;
  pnr: string;
  seat: string;
  seatType: string;
  cabinClass: string;
  flightReason: string;
  notes: string;
}

const emptyTimes = Object.fromEntries(FLIGHT_TIME_FIELDS.map((f) => [f, ''])) as Times;

const EMPTY: FormState = {
  flightDate: '',
  airline: null,
  airlineText: '',
  flightNumber: '',
  origin: null,
  destination: null,
  divertedTo: null,
  canceled: false,
  times: emptyTimes,
  depTerminal: '',
  depGate: '',
  arrTerminal: '',
  arrGate: '',
  aircraftTypeName: '',
  tailNumber: '',
  pnr: '',
  seat: '',
  seatType: '',
  cabinClass: '',
  flightReason: '',
  notes: '',
};

/** Which airport's zone a time field is entered in (mirrors the API's rule). */
function zoneFor(
  field: FlightTimeField,
  s: Pick<FormState, 'origin' | 'destination' | 'divertedTo'>,
) {
  if (field.startsWith('gateDeparture') || field.startsWith('takeoff')) return s.origin;
  return field.endsWith('Actual') && s.divertedTo ? s.divertedTo : s.destination;
}

function fromFlight(f: FlightDetail): FormState {
  const airports = { origin: f.origin, destination: f.destination, divertedTo: f.divertedTo };
  const times = Object.fromEntries(
    FLIGHT_TIME_FIELDS.map((field) => [
      field,
      toLocalInputValue(f[field], zoneFor(field, airports)?.timezone),
    ]),
  ) as Times;
  return {
    flightDate: f.flightDate,
    airline: f.airline,
    airlineText: f.airline ? '' : (f.airlineNameRaw ?? ''),
    flightNumber: f.flightNumber ?? '',
    ...airports,
    canceled: f.canceled,
    times,
    depTerminal: f.depTerminal ?? '',
    depGate: f.depGate ?? '',
    arrTerminal: f.arrTerminal ?? '',
    arrGate: f.arrGate ?? '',
    aircraftTypeName: f.aircraftType ?? '',
    tailNumber: f.tailNumber ?? '',
    pnr: f.pnr ?? '',
    seat: f.seat ?? '',
    seatType: f.seatType ?? '',
    cabinClass: f.cabinClass ?? '',
    flightReason: f.flightReason ?? '',
    notes: f.notes ?? '',
  };
}

function toInput(s: FormState): FlightInput {
  return {
    flightDate: s.flightDate,
    airlineId: s.airline?.id ?? null,
    airlineNameRaw: s.airline ? null : s.airlineText || null,
    flightNumber: s.flightNumber || null,
    originAirportId: s.origin!.id,
    destinationAirportId: s.destination!.id,
    divertedToAirportId: s.divertedTo?.id ?? null,
    canceled: s.canceled,
    ...Object.fromEntries(FLIGHT_TIME_FIELDS.map((f) => [f, s.times[f] || null])),
    depTerminal: s.depTerminal,
    depGate: s.depGate,
    arrTerminal: s.arrTerminal,
    arrGate: s.arrGate,
    aircraftTypeName: s.aircraftTypeName,
    tailNumber: s.tailNumber,
    pnr: s.pnr,
    seat: s.seat,
    seatType: s.seatType,
    cabinClass: s.cabinClass,
    flightReason: s.flightReason,
    notes: s.notes,
  };
}

const airportLabel = (a: AirportSummary) => `${a.iata ?? a.icao} · ${a.name}`;
const airportOption = (a: AirportSummary) => (
  <span>
    <span className="font-semibold">{a.iata ?? a.icao}</span> {a.name}
    <span className="block text-xs text-stone-500">
      {[a.city, a.country].filter(Boolean).join(', ')}
    </span>
  </span>
);
const airlineOption = (a: AirlineSummary) => (
  <span>
    <span className="font-semibold">{a.iata ?? a.icao ?? '—'}</span> {a.name}
    {a.country && <span className="block text-xs text-stone-500">{a.country}</span>}
  </span>
);

export function FlightFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const existing = useFlight(id);
  const [state, setState] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const save = useSaveFlight();
  const navigate = useNavigate();

  useEffect(() => {
    if (existing.data) setState(fromFlight(existing.data));
  }, [existing.data]);

  // A new flight starts at the home airport (once: clearing it afterwards must stick).
  const { homeAirport } = useDisplayPrefs();
  const homeApplied = useRef(false);
  useEffect(() => {
    if (editing || homeApplied.current || !homeAirport) return;
    homeApplied.current = true;
    setState((s) => (s.origin ? s : { ...s, origin: homeAirport }));
  }, [editing, homeAirport]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((s) => ({ ...s, [key]: value }));
  const setTime = (field: FlightTimeField, value: string) =>
    setState((s) => ({ ...s, times: { ...s.times, [field]: value } }));

  const arrival = state.divertedTo ?? state.destination;
  const distance = useMemo(
    () => (state.origin && arrival ? haversineMiles(state.origin, arrival) : null),
    [state.origin, arrival],
  );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!state.flightDate) local.flightDate = 'Date is required';
    if (!state.origin) local.originAirportId = 'Choose a departure airport';
    if (!state.destination) local.destinationAirportId = 'Choose an arrival airport';
    if (!state.airline && !state.airlineText.trim())
      local.airlineId = 'Choose an airline or type its name';
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      const saved = await save.mutateAsync({ id, input: toInput(state) });
      navigate(`/flights?flight=${saved.id}`);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
    }
  };

  if (editing && existing.isLoading) return <Spinner />;
  if (editing && existing.isError) return <ErrorState error={existing.error} />;

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold">{editing ? 'Edit flight' : 'Add a flight'}</h1>

      <Section title="Flight">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Date"
            type="date"
            required
            value={state.flightDate}
            onChange={(v) => set('flightDate', v)}
            error={errors.flightDate}
            hint="Local departure date"
          />
          <Combobox<AirlineSummary>
            label="Airline"
            required
            value={state.airline}
            onChange={(a) => set('airline', a)}
            onFreeText={(t) => set('airlineText', t)}
            freeText={state.airlineText}
            useSearch={useAirlineSearch}
            getKey={(a) => a.id}
            getLabel={(a) => `${a.iata ?? a.icao ?? ''} · ${a.name}`}
            renderOption={airlineOption}
            placeholder="United, UA, UAL…"
            error={errors.airlineId}
            hint={
              !state.airline && state.airlineText
                ? 'Not in the list; will be saved as typed'
                : undefined
            }
          />
          <div className="sm:col-span-2 flex flex-wrap items-end gap-3">
            <div className="w-40">
              <TextField
                label="Flight number"
                value={state.flightNumber}
                onChange={(v) => set('flightNumber', v)}
                error={errors.flightNumber}
                placeholder="837 or UA837"
              />
            </div>
            <LookupButton state={state} setState={setState} onNotice={setNotice} />
          </div>
          {notice && (
            <p
              role="status"
              className="sm:col-span-2 text-sm text-emerald-700 dark:text-emerald-400"
            >
              {notice}
            </p>
          )}
        </div>
      </Section>

      <Section title="Route">
        <div className="grid gap-4 sm:grid-cols-2">
          <Combobox<AirportSummary>
            label="From"
            required
            value={state.origin}
            onChange={(a) => set('origin', a)}
            useSearch={useAirportSearch}
            getKey={(a) => a.id}
            getLabel={airportLabel}
            renderOption={airportOption}
            placeholder="SFO, San Francisco…"
            error={errors.originAirportId}
          />
          <Combobox<AirportSummary>
            label="To"
            required
            value={state.destination}
            onChange={(a) => set('destination', a)}
            useSearch={useAirportSearch}
            getKey={(a) => a.id}
            getLabel={airportLabel}
            renderOption={airportOption}
            placeholder="NRT, Tokyo…"
            error={errors.destinationAirportId}
          />
          <div className="sm:col-span-2 flex flex-wrap items-center gap-6">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={state.canceled}
                onChange={(e) => set('canceled', e.target.checked)}
              />
              Canceled
            </label>
            <p aria-live="polite" className="text-sm">
              {distance !== null ? (
                <>
                  Distance: <strong>{formatInt(distance)} mi</strong> (
                  {formatInt(milesToKm(distance))} km)
                  {state.divertedTo && ' to the diversion airport'}
                </>
              ) : (
                <span className="muted">Distance appears once both airports are chosen.</span>
              )}
            </p>
          </div>
          <div className="sm:col-span-2">
            <Combobox<AirportSummary>
              label="Diverted to (optional)"
              value={state.divertedTo}
              onChange={(a) => set('divertedTo', a)}
              useSearch={useAirportSearch}
              getKey={(a) => a.id}
              getLabel={airportLabel}
              renderOption={airportOption}
              placeholder="Only if the flight landed elsewhere"
              error={errors.divertedToAirportId}
            />
          </div>
        </div>
      </Section>

      <Section
        title="Times"
        description="Enter each time in the local time of its airport. They’re stored in UTC."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {FLIGHT_TIME_FIELDS.map((field) => {
            const ap = zoneFor(field, state);
            const zone = ap?.timezone;
            const abbr =
              zone && state.flightDate
                ? toLocalParts(`${state.flightDate}T12:00:00Z`, zone).abbr
                : null;
            return (
              <TextField
                key={field}
                type="datetime-local"
                label={TIME_LABELS[field]}
                value={state.times[field]}
                onChange={(v) => setTime(field, v)}
                error={errors[field]}
                hint={
                  ap
                    ? `Local time at ${ap.iata ?? ap.icao}${abbr ? ` (${abbr})` : ''}`
                    : 'Choose airports first'
                }
              />
            );
          })}
        </div>
      </Section>

      <Section title="Aircraft & seat">
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="Aircraft type"
            value={state.aircraftTypeName}
            onChange={(v) => set('aircraftTypeName', v)}
            placeholder="Boeing 787-9"
          />
          <TextField
            label="Tail number"
            value={state.tailNumber}
            onChange={(v) => set('tailNumber', v)}
            placeholder="N12345"
          />
          <TextField
            label="Cabin class"
            value={state.cabinClass}
            onChange={(v) => set('cabinClass', v)}
            list="cabin-options"
          />
          <TextField
            label="Seat"
            value={state.seat}
            onChange={(v) => set('seat', v)}
            placeholder="34A"
          />
          <TextField
            label="Seat type"
            value={state.seatType}
            onChange={(v) => set('seatType', v)}
            list="seat-options"
          />
          <TextField
            label="Flight reason"
            value={state.flightReason}
            onChange={(v) => set('flightReason', v)}
            list="reason-options"
          />
          <TextField
            label="Departure terminal"
            value={state.depTerminal}
            onChange={(v) => set('depTerminal', v)}
          />
          <TextField
            label="Departure gate"
            value={state.depGate}
            onChange={(v) => set('depGate', v)}
          />
          <TextField
            label="Booking reference (PNR)"
            value={state.pnr}
            onChange={(v) => set('pnr', v)}
            hint="Private: shown only on the flight’s detail view"
          />
          <TextField
            label="Arrival terminal"
            value={state.arrTerminal}
            onChange={(v) => set('arrTerminal', v)}
          />
          <TextField
            label="Arrival gate"
            value={state.arrGate}
            onChange={(v) => set('arrGate', v)}
          />
        </div>
        <datalist id="cabin-options">
          {['Economy', 'Premium Economy', 'Business', 'First'].map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <datalist id="seat-options">
          {['Window', 'Middle', 'Aisle'].map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <datalist id="reason-options">
          {['Personal', 'Business', 'Crew'].map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <label className="mt-4 block">
          <span className="label">Notes</span>
          <textarea
            className="input min-h-24"
            value={state.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </label>
      </Section>

      {save.isError &&
        !(save.error instanceof ApiError && Object.keys(save.error.fieldErrors).length) && (
          <div className="mb-4">
            <ErrorState error={save.error} />
          </div>
        )}
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="mb-4 text-sm text-red-700 dark:text-red-400">
          Please fix the highlighted fields.
        </p>
      )}
      <div className="flex gap-3">
        <button type="submit" className="btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add flight'}
        </button>
        <Link to={editing ? `/flights?flight=${id}` : '/flights'} className="btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}

const TIME_LABELS: Record<FlightTimeField, string> = {
  gateDepartureScheduled: 'Gate departure (scheduled)',
  gateDepartureActual: 'Gate departure (actual)',
  takeoffScheduled: 'Takeoff (scheduled)',
  takeoffActual: 'Takeoff (actual)',
  landingScheduled: 'Landing (scheduled)',
  landingActual: 'Landing (actual)',
  gateArrivalScheduled: 'Gate arrival (scheduled)',
  gateArrivalActual: 'Gate arrival (actual)',
};

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="card mb-6">
      <legend className="px-1 text-base font-semibold">{title}</legend>
      {description && <p className="mb-4 text-sm muted">{description}</p>}
      {children}
    </fieldset>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
  error,
  hint,
  required,
  placeholder,
  list,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  placeholder?: string;
  list?: string;
}) {
  const id = `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {required && (
          <span aria-hidden className="text-red-600">
            {' '}
            *
          </span>
        )}
      </label>
      <input
        id={id}
        type={type}
        className={`input ${error ? 'border-red-500' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={error || hint ? `${id}-help` : undefined}
        aria-required={required}
        placeholder={placeholder}
        list={list}
      />
      {(error || hint) && (
        <p
          id={`${id}-help`}
          className={`mt-1 text-xs ${error ? 'text-red-600 dark:text-red-400' : 'muted'}`}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

/** Phase 2 seam: disabled until a provider is configured (FLIGHT_API_PROVIDER). */
function LookupButton({
  state,
  setState,
  onNotice,
}: {
  state: FormState;
  setState: React.Dispatch<React.SetStateAction<FormState>>;
  onNotice: (msg: string | null) => void;
}) {
  const config = useConfig();
  const lookup = useLookup();
  const configured = config.data?.lookup.configured ?? false;

  const fn = normalizeFlightNumber(state.flightNumber);
  const carrier = fn.carrier ?? state.airline?.iata ?? state.airline?.icao ?? null;
  const designator = fn.number && carrier ? `${carrier}${fn.number}` : null;
  const ready = configured && !!designator && !!state.flightDate;

  const run = async () => {
    onNotice(null);
    if (!designator) return;
    try {
      const res = await lookup.mutateAsync({ flightNumber: designator, date: state.flightDate });
      const r = res.results[0];
      if (!r) {
        onNotice(`No match for ${designator} on ${state.flightDate}.`);
        return;
      }
      const findAirport = async (code: string | null) =>
        code
          ? ((await apiFetch<AirportSummary[]>('/airports/search', { query: { q: code } })).find(
              (a) => a.iata === code,
            ) ?? null)
          : null;
      const findAirline = async (code: string | null) =>
        code
          ? ((await apiFetch<AirlineSummary[]>('/airlines/search', { query: { q: code } })).find(
              (a) => a.iata === code,
            ) ?? null)
          : null;
      const [origin, destination, airline] = await Promise.all([
        findAirport(r.origin),
        findAirport(r.destination),
        findAirline(r.airline.iata),
      ]);
      setState((s) => {
        const next = {
          ...s,
          airline: airline ?? s.airline,
          flightNumber: fn.number ?? s.flightNumber,
          origin: origin ?? s.origin,
          destination: destination ?? s.destination,
          aircraftTypeName: r.aircraftType ?? s.aircraftTypeName,
          tailNumber: r.tailNumber ?? s.tailNumber,
        };
        const times = { ...s.times };
        for (const field of FLIGHT_TIME_FIELDS) {
          const value = r[field];
          if (value) times[field] = toLocalInputValue(value, zoneFor(field, next)?.timezone);
        }
        return { ...next, times };
      });
      onNotice(
        `Prefilled from ${res.provider}${res.cached ? ' (cached)' : ''}. Review before saving.`,
      );
    } catch (e) {
      onNotice(e instanceof Error ? `Lookup failed: ${e.message}` : 'Lookup failed');
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="btn-secondary"
        disabled={!ready || lookup.isPending}
        onClick={run}
        aria-describedby="lookup-help"
      >
        {lookup.isPending ? 'Looking up…' : 'Look up flight'}
      </button>
      <span id="lookup-help" className="text-xs muted">
        {configured ? (ready ? '' : 'Enter a date and flight number') : 'Coming soon'}
      </span>
    </div>
  );
}
