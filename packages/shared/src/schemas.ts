import { z } from 'zod';

const optionalText = (max = 500) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) =>
      v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim(),
    );

/**
 * A timestamp as entered by a user. Either an ISO string with an offset/`Z` (honored as-is),
 * or a wall-clock value without offset (e.g. "2024-05-01T08:30") interpreted in the relevant
 * airport's local timezone by the API.
 */
const flightTime = z
  .string()
  .max(40)
  .nullish()
  .transform((v) =>
    v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim(),
  );

export const FLIGHT_TIME_FIELDS = [
  'gateDepartureScheduled',
  'gateDepartureActual',
  'takeoffScheduled',
  'takeoffActual',
  'landingScheduled',
  'landingActual',
  'gateArrivalScheduled',
  'gateArrivalActual',
] as const;
export type FlightTimeField = (typeof FLIGHT_TIME_FIELDS)[number];

/** Which airport's timezone applies to naive local times in each field. */
export const TIME_FIELD_AIRPORT: Record<FlightTimeField, 'origin' | 'arrival'> = {
  gateDepartureScheduled: 'origin',
  gateDepartureActual: 'origin',
  takeoffScheduled: 'origin',
  takeoffActual: 'origin',
  landingScheduled: 'arrival',
  landingActual: 'arrival',
  gateArrivalScheduled: 'arrival',
  gateArrivalActual: 'arrival',
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format');
const airportId = z.coerce.number().int().positive();

const flightFields = {
  flightDate: isoDate,
  airlineId: z.coerce.number().int().nullish(),
  airlineNameRaw: optionalText(200),
  flightNumber: optionalText(20),
  originAirportId: airportId,
  destinationAirportId: airportId,
  divertedToAirportId: airportId.nullish(),
  canceled: z.boolean().default(false),
  gateDepartureScheduled: flightTime,
  gateDepartureActual: flightTime,
  takeoffScheduled: flightTime,
  takeoffActual: flightTime,
  landingScheduled: flightTime,
  landingActual: flightTime,
  gateArrivalScheduled: flightTime,
  gateArrivalActual: flightTime,
  depTerminal: optionalText(40),
  depGate: optionalText(40),
  arrTerminal: optionalText(40),
  arrGate: optionalText(40),
  aircraftTypeName: optionalText(200),
  tailNumber: optionalText(20),
  pnr: optionalText(20),
  seat: optionalText(20),
  seatType: optionalText(50),
  cabinClass: optionalText(50),
  flightReason: optionalText(50),
  notes: optionalText(5000),
};

export const FlightInputSchema = z
  .object(flightFields)
  .refine((f) => f.airlineId != null || !!f.airlineNameRaw, {
    message: 'Choose an airline or enter an airline name',
    path: ['airlineId'],
  });
export type FlightInput = z.input<typeof FlightInputSchema>;
export type FlightInputParsed = z.output<typeof FlightInputSchema>;

export const FlightPatchSchema = z.object(flightFields).partial();
export type FlightPatch = z.input<typeof FlightPatchSchema>;

export const FlightFiltersSchema = z.object({
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  yearFrom: z.coerce.number().int().min(1900).max(2100).optional(),
  yearTo: z.coerce.number().int().min(1900).max(2100).optional(),
  /** An airline id, or `raw:<name>` for flights whose airline could not be resolved. */
  airline: z.string().trim().min(1).optional(),
  cabin: z.string().trim().min(1).optional(),
});
export type FlightFilters = z.infer<typeof FlightFiltersSchema>;

export const FLIGHT_SORT_FIELDS = [
  'date',
  'route',
  'airline',
  'flightNumber',
  'distance',
  'aircraft',
  'duration',
] as const;
export type FlightSortField = (typeof FLIGHT_SORT_FIELDS)[number];

export const FlightListQuerySchema = FlightFiltersSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  /** `date` ascending, `-date` descending. */
  sort: z
    .string()
    .regex(new RegExp(`^-?(${FLIGHT_SORT_FIELDS.join('|')})$`))
    .default('-date'),
  q: z.string().trim().max(100).optional(),
});
export type FlightListQuery = z.infer<typeof FlightListQuerySchema>;

export const LookupInputSchema = z.object({
  flightNumber: z.string().trim().min(1).max(20),
  date: isoDate,
});
export type LookupInput = z.infer<typeof LookupInputSchema>;

export const ImportCommitSchema = z.object({ previewId: z.string().uuid() });
