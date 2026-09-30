/**
 * Hand-written OpenAPI 3.0 description of the HTTP API.
 * Keep it in step with `src/routes/*` and the shared types in `packages/shared`
 * (`test/integration/docs.test.ts` fails if a mounted route is missing here).
 */
import { appVersion } from '../version';

type Schema = Record<string, unknown>;

const nullable = (schema: Schema): Schema => ({ ...schema, nullable: true });
const str: Schema = { type: 'string' };
const nstr = nullable(str);
const int: Schema = { type: 'integer' };
const nint = nullable(int);
const num: Schema = { type: 'number' };
const bool: Schema = { type: 'boolean' };
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const arrayOf = (items: Schema): Schema => ({ type: 'array', items });
const obj = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({
  type: 'object',
  properties,
  required,
});
const dateTime = (description?: string): Schema => ({
  type: 'string',
  format: 'date-time',
  nullable: true,
  ...(description ? { description } : {}),
});

const json = (schema: Schema) => ({ 'application/json': { schema } });
const ok = (description: string, schema: Schema) => ({ description, content: json(schema) });
const error = (description: string) => ({ description, content: json(ref('ApiError')) });

const flightId = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
} as const;

const query = (name: string, schema: Schema, description?: string) => ({
  name,
  in: 'query',
  required: false,
  schema,
  ...(description ? { description } : {}),
});

const filterParams = [
  query('year', { type: 'integer', minimum: 1900, maximum: 2100 }, 'A single year'),
  query('yearFrom', { type: 'integer', minimum: 1900, maximum: 2100 }),
  query('yearTo', { type: 'integer', minimum: 1900, maximum: 2100 }),
  query('airline', str, 'An airline id, or `raw:<name>` for flights with an unresolved airline'),
  query('cabin', str, 'Cabin class'),
];

const searchParams = [
  query('q', { type: 'string', maxLength: 100, default: '' }),
  query('limit', { type: 'integer', minimum: 1, maximum: 50, default: 15 }),
];

const flightTimeFields = [
  'gateDepartureScheduled',
  'gateDepartureActual',
  'takeoffScheduled',
  'takeoffActual',
  'landingScheduled',
  'landingActual',
  'gateArrivalScheduled',
  'gateArrivalActual',
];

const timeProps = Object.fromEntries(
  flightTimeFields.map((f) => [f, dateTime('UTC instant. Null when unknown.')]),
);

/** Writable flight fields. Times may be sent as UTC ISO strings or naive local times. */
const flightInputProps: Record<string, Schema> = {
  flightDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', example: '2024-04-01' },
  airlineId: nint,
  airlineNameRaw: nstr,
  flightNumber: nstr,
  originAirportId: { type: 'integer', minimum: 1 },
  destinationAirportId: { type: 'integer', minimum: 1 },
  divertedToAirportId: nullable({ type: 'integer', minimum: 1 }),
  canceled: { ...bool, default: false },
  ...Object.fromEntries(
    flightTimeFields.map((f) => [
      f,
      {
        type: 'string',
        nullable: true,
        description:
          "Timestamp with offset/Z, or a naive local time read in the relevant airport's timezone.",
        example: '2024-04-01T11:30',
      },
    ]),
  ),
  depTerminal: nstr,
  depGate: nstr,
  arrTerminal: nstr,
  arrGate: nstr,
  aircraftTypeName: nstr,
  tailNumber: nstr,
  pnr: nstr,
  seat: nstr,
  seatType: nstr,
  cabinClass: nstr,
  flightReason: nstr,
  notes: nstr,
};

const validation = error(
  'Validation failed (`validation_error`, with `details: [{ path, message }]`)',
);
const notFoundResponse = error('Not found (`not_found`)');

const unauthenticated = error(
  'No valid session cookie (`unauthenticated`). Only when the server runs with `AUTH_REQUIRED=true`.',
);
const csrfRejected = error(
  'Cross-origin write rejected (`csrf_rejected`): `Origin` must match this server, or `Sec-Fetch-Site` must be same-origin/none',
);
const tooManyAttempts = {
  description: 'Too many attempts (`too_many_attempts`); wait `Retry-After` seconds',
  headers: {
    'Retry-After': { description: 'Seconds until another attempt is allowed', schema: int },
  },
  content: json(ref('ApiError')),
};
const noStore = {
  'Cache-Control': { description: 'Always `no-store`', schema: str },
};
const sessionCookieHeader = {
  'Set-Cookie': {
    description:
      '`flightlog_session=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=<ttl>` (plus `Secure` in production)',
    schema: str,
  },
};

type Operation = { security?: unknown[]; responses: Record<string, unknown> } & Record<
  string,
  unknown
>;

/** Every operation except the public ones (`security: []`) can answer 401, and writes can answer 403. */
function addAuthResponses<T extends Record<string, Record<string, unknown>>>(paths: T): T {
  for (const item of Object.values(paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      const operation = op as Operation;
      if (operation.security?.length === 0 && method === 'get') continue;
      if (operation.security?.length !== 0) operation.responses['401'] ??= unauthenticated;
      if (method !== 'get') operation.responses['403'] ??= csrfRejected;
    }
  }
  return paths;
}

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Flight Log API',
    version: appVersion,
    description: [
      'Personal flight log: import Flighty CSVs or add flights by hand, then view a map and stats.',
      '',
      '- Authentication: with `AUTH_REQUIRED=true` every route except `GET /api/health` and `POST /api/auth/login`',
      '  needs the `flightlog_session` cookie from `POST /api/auth/login` (401 `unauthenticated` otherwise), and',
      '  writes must come from the same origin (403 `csrf_rejected`). With it off (local dev) every request acts as',
      '  the seeded default user and `GET /api/auth/me` reports `authRequired: false`.',
      '- Errors use `{ "error": { "code", "message", "details?" } }`. The one deliberate exception is',
      '  `POST /api/lookup`, which returns 501 `{ configured: false, provider: null, error }` when no provider is set.',
      '- PNR and seat are only returned by the flight **detail** endpoints, never by lists, search or stats.',
      '- Derived values (`distanceMiles`, `airTimeMinutes`, `gateTimeMinutes`) are computed server-side and ignored if sent.',
    ].join('\n'),
  },
  servers: [{ url: '/', description: 'This server' }],
  security: [{ sessionCookie: [] }],
  tags: [
    { name: 'System' },
    { name: 'Auth' },
    { name: 'Flights' },
    { name: 'Import' },
    { name: 'Insights' },
    { name: 'Reference' },
    { name: 'Lookup' },
  ],
  paths: addAuthResponses({
    '/api/health': {
      get: {
        tags: ['System'],
        summary: 'Liveness and database check',
        security: [],
        responses: {
          '200': ok(
            'Healthy',
            obj({
              status: { type: 'string', enum: ['ok'] },
              version: { type: 'string', example: '1.0.0' },
            }),
          ),
        },
      },
    },
    '/api/config': {
      get: {
        tags: ['System'],
        summary: 'Client configuration',
        responses: { '200': ok('Config', ref('AppConfig')) },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Sign in with email and password',
        description:
          'Public. Sets the `flightlog_session` cookie. Unknown email, wrong password and an account without a password all return the same 401. Throttled per IP and per email.',
        security: [],
        requestBody: { required: true, content: json(ref('LoginInput')) },
        responses: {
          '200': {
            description: 'Signed in',
            headers: { ...sessionCookieHeader, ...noStore },
            content: json(ref('AuthMe')),
          },
          '400': validation,
          '401': error('Incorrect email or password (`invalid_credentials`)'),
          '403': csrfRejected,
          '429': tooManyAttempts,
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Sign out',
        description:
          'Deletes the session and clears the cookie. Idempotent: works (204) without a session.',
        security: [],
        responses: {
          '204': { description: 'Signed out', headers: { ...noStore } },
          '403': csrfRejected,
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'The signed-in user',
        description:
          'With `AUTH_REQUIRED` off, returns the default user with `authRequired: false` (the web app then shows no login UI).',
        responses: {
          '200': {
            description: 'Current user',
            headers: { ...noStore },
            content: json(ref('AuthMe')),
          },
        },
      },
      patch: {
        tags: ['Auth'],
        summary: "Update the signed-in user's display name",
        description:
          'Updates only the current user. The name is trimmed and must be 1 to 80 characters; unknown fields are rejected. Works with `AUTH_REQUIRED` off too (acts on the default user).',
        requestBody: { required: true, content: json(ref('UpdateProfileInput')) },
        responses: {
          '200': {
            description: 'Updated user',
            headers: { ...noStore },
            content: json(ref('AuthMe')),
          },
          '400': error('Validation failed'),
        },
      },
    },
    '/api/auth/preferences': {
      get: {
        tags: ['Auth'],
        summary: 'Display preferences',
        description:
          "Per-user distance unit, time format and home airport (defaults `mi`, `12h`, none). Works with `AUTH_REQUIRED` off (the default user's). They only affect how the web app displays values: stored miles and UTC times, derived values and the stats contract never change.",
        responses: {
          '200': {
            description: 'Preferences',
            headers: { ...noStore },
            content: json(ref('Preferences')),
          },
        },
      },
      patch: {
        tags: ['Auth'],
        summary: 'Update display preferences',
        description:
          'Partial update; at least one field. `homeAirportId: null` clears it; an unknown airport is a 400 on `homeAirportId`.',
        requestBody: { required: true, content: json(ref('UpdatePreferencesInput')) },
        responses: {
          '200': {
            description: 'Updated',
            headers: { ...noStore },
            content: json(ref('Preferences')),
          },
          '400': validation,
        },
      },
    },
    '/api/auth/password': {
      post: {
        tags: ['Auth'],
        summary: 'Change password',
        description:
          'Verifies the current password, applies the policy (12 to 128 characters, not equal to the email), stores the new hash and signs out every OTHER session. Wrong current password is a 400 (`invalid_current_password`), not a 401.',
        requestBody: { required: true, content: json(ref('ChangePasswordInput')) },
        responses: {
          '204': { description: 'Changed', headers: { ...noStore } },
          '400': error(
            'Validation failed, or the current password is wrong (`invalid_current_password`)',
          ),
          '429': tooManyAttempts,
        },
      },
    },
    '/api/auth/email': {
      put: {
        tags: ['Auth'],
        summary: 'Change email',
        description:
          'Re-checks the current password (same throttle and constant-time path as `POST /api/auth/password`; wrong password is a 400 `invalid_current_password`), normalizes the email like login (trimmed, lower-cased) and applies it IMMEDIATELY: there is no email delivery, so no confirmation step. Signs out every OTHER session and keeps the current one. A taken address is a bare 409 `email_unavailable` that never echoes the address. Only available with `AUTH_REQUIRED=true` (400 `auth_disabled` otherwise).',
        requestBody: { required: true, content: json(ref('ChangeEmailInput')) },
        responses: {
          '200': {
            description: 'Updated user',
            headers: { ...noStore },
            content: json(ref('AuthMe')),
          },
          '400': error(
            'Validation failed, the current password is wrong (`invalid_current_password`), or auth is disabled (`auth_disabled`)',
          ),
          '409': error('That address is not available (`email_unavailable`)'),
          '429': tooManyAttempts,
        },
      },
    },
    '/api/auth/sessions': {
      get: {
        tags: ['Auth'],
        summary: 'List active sessions',
        description:
          "The signed-in user's unexpired sessions, most recently used first. `current` marks the session making the request. Never includes tokens or hashes. `lastSeenAt` is refreshed at most hourly. Only with `AUTH_REQUIRED=true`.",
        responses: {
          '200': {
            description: 'Sessions',
            headers: { ...noStore },
            content: json(arrayOf(ref('SessionInfo'))),
          },
          '400': error('Auth is disabled (`auth_disabled`)'),
        },
      },
    },
    '/api/auth/sessions/revoke-others': {
      post: {
        tags: ['Auth'],
        summary: 'Sign out every other session',
        description: 'Keeps the current session. Only with `AUTH_REQUIRED=true`.',
        responses: {
          '204': { description: 'Done', headers: { ...noStore } },
          '400': error('Auth is disabled (`auth_disabled`)'),
        },
      },
    },
    '/api/auth/sessions/{id}': {
      delete: {
        tags: ['Auth'],
        summary: 'Sign out one session',
        description:
          "Scoped to the signed-in user: someone else's session id is a 404, same as a missing one. Revoking the current session also clears the cookie. Only with `AUTH_REQUIRED=true`.",
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '204': { description: 'Revoked', headers: { ...noStore } },
          '400': error('Malformed id (`validation_error`) or auth is disabled (`auth_disabled`)'),
          '404': notFoundResponse,
        },
      },
    },
    '/api/flights': {
      get: {
        tags: ['Flights'],
        summary: 'List flights (paginated)',
        description:
          'Never includes PNR or seat. `q` searches airline, flight number, airports and tail.',
        parameters: [
          ...filterParams,
          query('page', { type: 'integer', minimum: 1, default: 1 }),
          query('pageSize', { type: 'integer', minimum: 1, maximum: 200, default: 25 }),
          query(
            'sort',
            {
              type: 'string',
              default: '-date',
              pattern: '^-?(date|route|airline|flightNumber|distance|aircraft|duration)$',
            },
            'Field name; prefix with `-` for descending',
          ),
          query('q', { type: 'string', maxLength: 100 }),
        ],
        responses: {
          '200': ok(
            'A page of flights',
            obj({
              items: arrayOf(ref('FlightListItem')),
              page: int,
              pageSize: int,
              total: int,
            }),
          ),
          '400': validation,
        },
      },
      post: {
        tags: ['Flights'],
        summary: 'Create a flight manually',
        description:
          'Either `airlineId` or `airlineNameRaw` is required. Times are converted to UTC using airport timezones.',
        requestBody: {
          required: true,
          content: json({ $ref: '#/components/schemas/FlightInput' }),
        },
        responses: { '201': ok('Created', ref('FlightDetail')), '400': validation },
      },
      delete: {
        tags: ['Flights'],
        summary: 'Delete ALL of your flights',
        description:
          "Removes every flight AND import batch of the signed-in user (nobody else's), then returns the counts. Body-less; refuses unless `confirm=delete-all-flights` is present, so a stray request cannot empty the log. Cannot be undone; export first.",
        parameters: [
          {
            name: 'confirm',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: ['delete-all-flights'] },
          },
        ],
        responses: {
          '200': ok('What was deleted', ref('DeleteAllFlightsResult')),
          '400': validation,
        },
      },
    },
    '/api/flights/export': {
      get: {
        tags: ['Flights'],
        summary: 'Download all of your flights (CSV or JSON)',
        description:
          "Detail-level export of the signed-in user's own data, so it INCLUDES PNR and seat. Sent as an attachment (`Content-Disposition`) with `Cache-Control: no-store`, and never logged. `csv` (default) uses the Flighty import columns, with times as UTC instants, so the file can be imported again: every row is then recognized as a duplicate. `json` is the full `FlightDetail` of each flight. Server-derived values (distance, air time) are not in the CSV; the importer recomputes them.",
        parameters: [query('format', { type: 'string', enum: ['csv', 'json'], default: 'csv' })],
        responses: {
          '200': {
            description: 'The file',
            headers: {
              'Content-Disposition': {
                description: 'attachment; filename="flight-log-DATE.ext"',
                schema: str,
              },
              'Cache-Control': { description: 'Always `no-store`', schema: str },
            },
            content: {
              'text/csv': { schema: { type: 'string' } },
              'application/json': { schema: ref('FlightsExport') },
            },
          },
          '400': validation,
        },
      },
    },
    '/api/flights/{id}': {
      parameters: [flightId],
      get: {
        tags: ['Flights'],
        summary: 'Get one flight (includes PNR and seat)',
        responses: {
          '200': ok('The flight', ref('FlightDetail')),
          '400': validation,
          '404': notFoundResponse,
        },
      },
      patch: {
        tags: ['Flights'],
        summary: 'Update a flight',
        description: 'Partial update. Derived values are recomputed.',
        requestBody: {
          required: true,
          content: json({ type: 'object', properties: flightInputProps }),
        },
        responses: {
          '200': ok('Updated', ref('FlightDetail')),
          '400': validation,
          '404': notFoundResponse,
        },
      },
      delete: {
        tags: ['Flights'],
        summary: 'Delete a flight',
        responses: {
          '204': { description: 'Deleted' },
          '400': validation,
          '404': notFoundResponse,
        },
      },
    },
    '/api/import/preview': {
      post: {
        tags: ['Import'],
        summary: 'Upload a Flighty CSV and preview the import',
        description:
          'Nothing is written. The preview is held in memory (30 minutes) and is lost if the API restarts.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: obj({ file: { type: 'string', format: 'binary' } }),
            },
          },
        },
        responses: {
          '200': ok('Preview', ref('ImportPreview')),
          '400': error('No file attached'),
          '413': error('File too large'),
          '415': error('Not a .csv file (`unsupported_file`)'),
          '422': error('Unreadable CSV or missing Date/From/To columns'),
        },
      },
    },
    '/api/import/commit': {
      post: {
        tags: ['Import'],
        summary: 'Commit a previewed import',
        requestBody: {
          required: true,
          content: json(obj({ previewId: { type: 'string', format: 'uuid' } })),
        },
        responses: {
          '201': ok('Imported', ref('ImportSummary')),
          '400': validation,
          '404': error('Preview not found or expired'),
        },
      },
    },
    '/api/import/batches': {
      get: {
        tags: ['Import'],
        summary: 'List import batches',
        responses: { '200': ok('Batches, newest first', arrayOf(ref('ImportBatch'))) },
      },
    },
    '/api/import/batches/{id}': {
      delete: {
        tags: ['Import'],
        summary: 'Undo an import batch',
        description: 'Deletes the flights the batch created and marks it `undone`.',
        parameters: [flightId],
        responses: {
          '200': ok('Undone', ref('ImportBatch')),
          '400': validation,
          '404': notFoundResponse,
        },
      },
    },
    '/api/map': {
      get: {
        tags: ['Insights'],
        summary: 'Airports and great-circle routes for the map',
        description: 'Excludes canceled flights; diverted flights end at the diversion airport.',
        parameters: filterParams,
        responses: { '200': ok('Map data', ref('MapData')), '400': validation },
      },
    },
    '/api/map/routes/{a}/{b}/flights': {
      get: {
        tags: ['Insights'],
        summary: 'Flights flown between two airports (either direction)',
        parameters: [
          { name: 'a', in: 'path', required: true, schema: int, description: 'Airport id' },
          { name: 'b', in: 'path', required: true, schema: int, description: 'Airport id' },
          ...filterParams,
        ],
        responses: {
          '200': ok('Flights on the route', arrayOf(ref('RouteFlight'))),
          '400': validation,
        },
      },
    },
    '/api/stats': {
      get: {
        tags: ['Insights'],
        summary: 'Stats dashboard data',
        description:
          'Excludes canceled flights except `headline.canceledFlights`. Never includes PNR or seat.',
        parameters: filterParams,
        responses: { '200': ok('Stats', ref('Stats')), '400': validation },
      },
    },
    '/api/filter-options': {
      get: {
        tags: ['Insights'],
        summary: 'Values available for the year/airline/cabin filters',
        responses: { '200': ok('Options', ref('FilterOptions')) },
      },
    },
    '/api/airports/search': {
      get: {
        tags: ['Reference'],
        summary: 'Search airports by code, name or city',
        parameters: searchParams,
        responses: { '200': ok('Matches', arrayOf(ref('AirportSummary'))), '400': validation },
      },
    },
    '/api/airlines/search': {
      get: {
        tags: ['Reference'],
        summary: 'Search airlines by code or name',
        parameters: searchParams,
        responses: { '200': ok('Matches', arrayOf(ref('AirlineSummary'))), '400': validation },
      },
    },
    '/api/lookup': {
      post: {
        tags: ['Lookup'],
        summary: 'Look up a flight with the configured provider (Phase 2)',
        requestBody: {
          required: true,
          content: json(
            obj({
              flightNumber: { type: 'string', minLength: 1, maxLength: 20, example: 'UA837' },
              date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', example: '2024-04-01' },
            }),
          ),
        },
        responses: {
          '200': ok('Provider results (possibly cached)', ref('LookupResponse')),
          '400': validation,
          '501': {
            description: 'No provider configured',
            content: json(
              obj({
                configured: { type: 'boolean', enum: [false] },
                provider: { type: 'string', nullable: true },
                error: obj({ code: str, message: str }),
              }),
            ),
          },
        },
      },
    },
  }),
  components: {
    securitySchemes: {
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'flightlog_session',
        description:
          'Random session token set by `POST /api/auth/login` (HttpOnly, SameSite=Lax). Browsers send it automatically.',
      },
    },
    schemas: {
      ApiError: obj(
        {
          error: obj({ code: str, message: str, details: {} }, ['code', 'message']),
        },
        ['error'],
      ),
      LoginInput: obj({
        email: { type: 'string', maxLength: 254, example: 'traveler@example.com' },
        password: { type: 'string', maxLength: 1024, format: 'password' },
      }),
      UpdatePreferencesInput: obj({
        distanceUnit: { type: 'string', enum: ['mi', 'km'] },
        timeFormat: { type: 'string', enum: ['12h', '24h'] },
        homeAirportId: nullable({ type: 'integer', minimum: 1 }),
      }),
      Preferences: obj({
        distanceUnit: { type: 'string', enum: ['mi', 'km'] },
        timeFormat: { type: 'string', enum: ['12h', '24h'] },
        homeAirportId: nint,
        homeAirport: nullable(ref('AirportSummary')),
      }),
      DeleteAllFlightsResult: obj({ deleted: int, deletedImportBatches: int }),
      FlightsExport: obj({
        exportedAt: dateTime('When the export was made.'),
        count: int,
        flights: arrayOf(ref('FlightDetail')),
      }),
      UpdateProfileInput: obj({ displayName: { type: 'string', minLength: 1, maxLength: 80 } }),
      ChangeEmailInput: obj({
        newEmail: { type: 'string', format: 'email', maxLength: 254 },
        currentPassword: { type: 'string', maxLength: 1024, format: 'password' },
      }),
      SessionInfo: obj({
        id: { type: 'string', format: 'uuid' },
        createdAt: dateTime('When the session was created (login).'),
        lastSeenAt: dateTime('Last use, refreshed at most hourly.'),
        userAgent: nstr,
        current: bool,
      }),
      ChangePasswordInput: obj({
        currentPassword: { type: 'string', maxLength: 1024, format: 'password' },
        newPassword: { type: 'string', minLength: 12, maxLength: 128, format: 'password' },
      }),
      AuthMe: obj({
        user: obj({ id: { type: 'string', format: 'uuid' }, email: nstr, displayName: str }),
        authRequired: bool,
      }),
      AppConfig: obj({
        mapStyleUrl: str,
        lookup: obj({ configured: bool, provider: nstr }),
      }),
      AirportSummary: obj(
        {
          id: int,
          iata: nstr,
          icao: nstr,
          name: str,
          city: nstr,
          country: nstr,
          timezone: nstr,
          latitude: num,
          longitude: num,
          type: str,
        },
        ['id', 'iata', 'icao', 'name', 'city', 'country', 'timezone', 'latitude', 'longitude'],
      ),
      AirlineSummary: obj({ id: int, name: str, iata: nstr, icao: nstr, country: nstr }, [
        'id',
        'name',
        'iata',
        'icao',
      ]),
      FlightListItem: obj({
        id: { type: 'string', format: 'uuid' },
        flightDate: { type: 'string', format: 'date' },
        source: { type: 'string', enum: ['flighty_csv', 'manual', 'api'] },
        airline: nullable(ref('AirlineSummary')),
        airlineNameRaw: nstr,
        flightNumber: nstr,
        origin: ref('AirportSummary'),
        destination: ref('AirportSummary'),
        divertedTo: nullable(ref('AirportSummary')),
        canceled: bool,
        aircraftType: nstr,
        aircraftFamily: {
          ...nstr,
          description: 'Marketing family computed from the aircraft type, e.g. "Boeing 777"',
        },
        tailNumber: nstr,
        cabinClass: nstr,
        distanceMiles: num,
        airTimeMinutes: {
          ...nint,
          description: 'Takeoff to landing (actual, else scheduled). Null if neither pair exists.',
        },
        gateTimeMinutes: {
          ...nint,
          description:
            'Gate departure to gate arrival (actual, else scheduled). Null if neither pair exists.',
        },
        ...timeProps,
      }),
      FlightDetail: {
        allOf: [
          ref('FlightListItem'),
          obj({
            flightyId: nstr,
            importBatchId: nstr,
            depTerminal: nstr,
            depGate: nstr,
            arrTerminal: nstr,
            arrGate: nstr,
            pnr: nstr,
            seat: nstr,
            seatType: nstr,
            flightReason: nstr,
            notes: nstr,
            cruiseAltitudeFt: nint,
            maxAltitudeFt: nint,
            groundSpeedKts: nint,
            lookupSource: nstr,
            lookupFetchedAt: dateTime(),
            sourceRaw: { type: 'object', nullable: true, additionalProperties: nstr },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          }),
        ],
      },
      FlightInput: {
        type: 'object',
        required: ['flightDate', 'originAirportId', 'destinationAirportId'],
        properties: flightInputProps,
      },
      ImportRowError: obj({ line: int, column: str, message: str }, ['line', 'message']),
      ImportPreviewRow: obj(
        {
          line: int,
          status: { type: 'string', enum: ['new', 'duplicate', 'invalid'] },
          duplicateReason: str,
          errors: arrayOf(ref('ImportRowError')),
          warnings: arrayOf(str),
          flightDate: nstr,
          airline: nstr,
          flightNumber: nstr,
          origin: nstr,
          destination: nstr,
          divertedTo: nstr,
          canceled: bool,
          distanceMiles: nullable(num),
        },
        [
          'line',
          'status',
          'errors',
          'warnings',
          'flightDate',
          'airline',
          'flightNumber',
          'origin',
          'destination',
          'divertedTo',
          'canceled',
          'distanceMiles',
        ],
      ),
      ImportPreview: obj({
        previewId: { type: 'string', format: 'uuid' },
        filename: str,
        expiresAt: { type: 'string', format: 'date-time' },
        counts: obj({ total: int, new: int, duplicate: int, invalid: int }),
        unknownColumns: arrayOf(str),
        missingColumns: arrayOf(str),
        previouslyImportedBatchId: nstr,
        sample: arrayOf(ref('ImportPreviewRow')),
        errors: arrayOf(ref('ImportRowError')),
      }),
      ImportSummary: obj({
        batchId: { type: 'string', format: 'uuid' },
        total: int,
        imported: int,
        duplicates: int,
        failed: int,
        errors: arrayOf(ref('ImportRowError')),
      }),
      ImportBatch: obj({
        id: { type: 'string', format: 'uuid' },
        filename: str,
        status: { type: 'string', enum: ['committed', 'undone'] },
        total: int,
        imported: int,
        duplicates: int,
        failed: int,
        remainingFlights: int,
        createdAt: { type: 'string', format: 'date-time' },
      }),
      MapData: obj({
        airports: arrayOf({
          allOf: [ref('AirportSummary'), obj({ visits: int, departures: int, arrivals: int })],
        }),
        routes: arrayOf(
          obj({
            key: str,
            airportA: int,
            airportB: int,
            count: int,
            distanceMiles: num,
            path: {
              type: 'array',
              description:
                '[lon, lat] points along the great circle (longitudes unwrapped across the antimeridian)',
              items: { type: 'array', items: num, minItems: 2, maxItems: 2 },
            },
          }),
        ),
      }),
      RouteFlight: obj({
        id: { type: 'string', format: 'uuid' },
        flightDate: str,
        airline: nstr,
        flightNumber: nstr,
        origin: nstr,
        destination: nstr,
      }),
      FilterOptions: obj({
        years: arrayOf(int),
        airlines: arrayOf(obj({ value: str, label: str, count: int })),
        cabins: arrayOf(obj({ value: str, count: int })),
      }),
      NamedCount: obj({ label: str, flights: int, miles: num }),
      Stats: {
        type: 'object',
        description:
          'Aggregates over flown (non-canceled) flights. See `packages/shared/src/types.ts` (`Stats`) for the full shape.',
        properties: {
          headline: obj({
            totalFlights: int,
            canceledFlights: int,
            totalMiles: num,
            totalAirMinutes: int,
            flightsWithAirTime: int,
            totalGateMinutes: int,
            flightsWithGateTime: int,
            uniqueAirports: int,
            uniqueAirlines: int,
            uniqueCountries: int,
            timesAroundEarth: num,
            percentToMoon: num,
          }),
          airports: arrayOf({ type: 'object' }),
          airlines: arrayOf({ type: 'object' }),
          aircraftTypes: arrayOf(ref('NamedCount')),
          aircraftFamilies: arrayOf(ref('NamedCount')),
          tails: arrayOf({ type: 'object' }),
          perYear: arrayOf({ type: 'object' }),
          perMonth: arrayOf({ type: 'object' }),
          byMonthOfYear: arrayOf({ type: 'object' }),
          cabinClass: arrayOf({ type: 'object' }),
          seatType: arrayOf({ type: 'object' }),
          flightReason: arrayOf({ type: 'object' }),
          records: { type: 'object' },
          punctuality: { type: 'object' },
        },
      },
      LookupResponse: obj(
        {
          configured: bool,
          provider: nstr,
          cached: bool,
          results: arrayOf({ type: 'object', description: 'FlightLookupResult' }),
        },
        ['configured', 'provider', 'results'],
      ),
    },
  },
};
