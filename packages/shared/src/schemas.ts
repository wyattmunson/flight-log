import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './constants';

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

/** Emails are compared lower-cased and trimmed everywhere (login, CLI, storage). */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const LoginInputSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254),
  // Longer than the policy maximum so an over-long attempt is simply "wrong", not a hint.
  password: z.string().min(1).max(1024),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const ChangePasswordInputSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordInputSchema>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `PUT /api/auth/email`. Normalized exactly like login (trimmed, lower-cased). */
export const ChangeEmailInputSchema = z
  .object({
    newEmail: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .regex(EMAIL_PATTERN, 'Enter a valid email address'),
    currentPassword: z.string().min(1).max(1024),
  })
  .strict();
export type ChangeEmailInput = z.infer<typeof ChangeEmailInputSchema>;

export const SessionIdParamSchema = z.object({ id: z.string().uuid() });

export const DistanceUnitSchema = z.enum(['mi', 'km']);
export const TimeFormatSchema = z.enum(['12h', '24h']);

/** `PATCH /api/auth/preferences`. Every field is optional but at least one must be present. */
export const UpdatePreferencesInputSchema = z
  .object({
    distanceUnit: DistanceUnitSchema.optional(),
    timeFormat: TimeFormatSchema.optional(),
    homeAirportId: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one preference',
  });
export type UpdatePreferencesInput = z.infer<typeof UpdatePreferencesInputSchema>;

export const PREFERENCE_DEFAULTS = {
  distanceUnit: 'mi',
  timeFormat: '12h',
  homeAirportId: null,
} as const;

/** `GET /api/flights/export?format=csv|json` (csv when omitted). */
export const ExportQuerySchema = z.object({ format: z.enum(['csv', 'json']).default('csv') });

/** `DELETE /api/flights` only proceeds with `?confirm=` set to exactly this. */
export const DELETE_ALL_FLIGHTS_CONFIRM = 'delete-all-flights';
export const DeleteAllFlightsQuerySchema = z.object({
  confirm: z.literal(DELETE_ALL_FLIGHTS_CONFIRM, {
    errorMap: () => ({
      message: `Set confirm=${DELETE_ALL_FLIGHTS_CONFIRM} to delete every flight`,
    }),
  }),
});

export const DISPLAY_NAME_MAX_LENGTH = 80;

/** `PATCH /api/auth/me`. Only the name is editable; email and password have their own paths. */
export const UpdateProfileInputSchema = z
  .object({ displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH) })
  .strict();
export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>;
