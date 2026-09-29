/**
 * Hand-written OpenAPI 3.0 description of the HTTP API.
 * Keep it in step with `src/routes/*` and the shared types in `packages/shared`
 * (`test/integration/docs.test.ts` fails if a mounted route is missing here).
 */
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

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Flight Log API',
    version: '0.1.0',
    description: [
      'Personal flight log: import Flighty CSVs or add flights by hand, then view a map and stats.',
      '',
      '- All `/api/*` requests act as the seeded default user (no auth in Phase 1).',
      '- Errors use `{ "error": { "code", "message", "details?" } }`. The one deliberate exception is',
      '  `POST /api/lookup`, which returns 501 `{ configured: false, provider: null, error }` when no provider is set.',
      '- PNR and seat are only returned by the flight **detail** endpoints, never by lists, search or stats.',
      '- Derived values (`distanceMiles`, `airTimeMinutes`, `gateTimeMinutes`) are computed server-side and ignored if sent.',
    ].join('\n'),
  },
  servers: [{ url: '/', description: 'This server' }],
  tags: [
    { name: 'System' },
    { name: 'Flights' },
    { name: 'Import' },
    { name: 'Insights' },
    { name: 'Reference' },
    { name: 'Lookup' },
  ],
  paths: {
    '/api/health': {
      get: {
        tags: ['System'],
        summary: 'Liveness and database check',
        responses: { '200': ok('Healthy', obj({ status: { type: 'string', enum: ['ok'] } })) },
      },
    },
    '/api/config': {
      get: {
        tags: ['System'],
        summary: 'Client configuration',
        responses: { '200': ok('Config', ref('AppConfig')) },
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
  },
  components: {
    schemas: {
      ApiError: obj(
        {
          error: obj({ code: str, message: str, details: {} }, ['code', 'message']),
        },
        ['error'],
      ),
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
          aircraftTypes: arrayOf({ type: 'object' }),
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
