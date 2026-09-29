import type { Prisma } from '@prisma/client';
import {
  FLIGHT_TIME_FIELDS,
  FlightInputSchema,
  FlightPatchSchema,
  cleanText,
  normalizeCategory,
  normalizeFlightNumber,
  normalizeTailNumber,
  type FlightDetail,
  type FlightInputParsed,
} from '@flight-log/shared';
import * as flightsDal from '../dal/flights';
import { getAirline, getAirportsByIds, upsertAircraftType } from '../dal/reference';
import { AppError, notFound } from '../http/errors';
import { airTimeFrom, convertTimes, flightDistanceMiles } from './derive';

type FlightData = Omit<Prisma.FlightUncheckedCreateInput, 'userId' | 'source'>;

/** Validate references and compute UTC times, distance and air time for a full flight input. */
async function prepare(input: FlightInputParsed): Promise<FlightData> {
  const ids = [input.originAirportId, input.destinationAirportId];
  if (input.divertedToAirportId) ids.push(input.divertedToAirportId);
  const airports = new Map((await getAirportsByIds(ids)).map((a) => [a.id, a]));
  const origin = airports.get(input.originAirportId);
  const destination = airports.get(input.destinationAirportId);
  const divertedTo = input.divertedToAirportId ? airports.get(input.divertedToAirportId) : null;
  const issues: { path: string; message: string }[] = [];
  if (!origin) issues.push({ path: 'originAirportId', message: 'Unknown airport' });
  if (!destination) issues.push({ path: 'destinationAirportId', message: 'Unknown airport' });
  if (input.divertedToAirportId && !divertedTo) {
    issues.push({ path: 'divertedToAirportId', message: 'Unknown airport' });
  }

  const airline = input.airlineId != null ? await getAirline(input.airlineId) : null;
  if (input.airlineId != null && !airline)
    issues.push({ path: 'airlineId', message: 'Unknown airline' });

  if (!origin || !destination || issues.length) {
    throw new AppError(400, 'validation_error', 'Request validation failed', issues);
  }

  const { values: times, errors } = convertTimes(input, { origin, destination, divertedTo });
  if (errors.length) {
    throw new AppError(
      400,
      'validation_error',
      'Request validation failed',
      errors.map((e) => ({ path: e.field, message: e.message })),
    );
  }

  const aircraftTypeName = cleanText(input.aircraftTypeName);
  return {
    flightDate: new Date(`${input.flightDate}T00:00:00Z`),
    airlineId: airline?.id ?? null,
    airlineNameRaw: airline ? null : cleanText(input.airlineNameRaw),
    flightNumber: normalizeFlightNumber(input.flightNumber).number,
    originAirportId: origin.id,
    destinationAirportId: destination.id,
    divertedToAirportId: divertedTo?.id ?? null,
    canceled: input.canceled,
    ...times,
    depTerminal: input.depTerminal ?? null,
    depGate: input.depGate ?? null,
    arrTerminal: input.arrTerminal ?? null,
    arrGate: input.arrGate ?? null,
    aircraftTypeId: aircraftTypeName ? await upsertAircraftType(aircraftTypeName, null) : null,
    tailNumber: normalizeTailNumber(input.tailNumber),
    pnr: input.pnr ?? null,
    seat: input.seat?.toUpperCase() ?? null,
    seatType: normalizeCategory(input.seatType),
    cabinClass: normalizeCategory(input.cabinClass),
    flightReason: normalizeCategory(input.flightReason),
    notes: input.notes ?? null,
    distanceMiles: flightDistanceMiles(origin, destination, divertedTo),
    airTimeMinutes: airTimeFrom(times),
  };
}

export async function createManualFlight(userId: string, body: unknown): Promise<FlightDetail> {
  const input = FlightInputSchema.parse(body);
  const data = await prepare(input);
  const created = await flightsDal.createFlight(userId, { ...data, source: 'manual' });
  return flightsDal.toDetail(created);
}

/**
 * PATCH: merge the patch over the stored flight (stored times are UTC ISO strings, which
 * `parseFlightTime` honors as-is) and recompute every derived value.
 */
export async function updateFlight(
  userId: string,
  id: string,
  body: unknown,
): Promise<FlightDetail> {
  const patch = FlightPatchSchema.parse(body);
  const existing = await flightsDal.findFlight(userId, id);
  if (!existing) throw notFound('Flight');
  const current = flightsDal.toDetail(existing);

  const merged: Record<string, unknown> = {
    flightDate: current.flightDate,
    airlineId: current.airline?.id ?? null,
    airlineNameRaw: current.airlineNameRaw,
    flightNumber: current.flightNumber,
    originAirportId: current.origin.id,
    destinationAirportId: current.destination.id,
    divertedToAirportId: current.divertedTo?.id ?? null,
    canceled: current.canceled,
    depTerminal: current.depTerminal,
    depGate: current.depGate,
    arrTerminal: current.arrTerminal,
    arrGate: current.arrGate,
    aircraftTypeName: current.aircraftType,
    tailNumber: current.tailNumber,
    pnr: current.pnr,
    seat: current.seat,
    seatType: current.seatType,
    cabinClass: current.cabinClass,
    flightReason: current.flightReason,
    notes: current.notes,
  };
  for (const f of FLIGHT_TIME_FIELDS) merged[f] = current[f];
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) merged[k] = v;
  // Choosing an airline from the list replaces a free-text name and vice versa.
  if (patch.airlineId != null && patch.airlineNameRaw === undefined) merged.airlineNameRaw = null;
  if (patch.airlineNameRaw && patch.airlineId === undefined) merged.airlineId = null;

  const data = await prepare(FlightInputSchema.parse(merged));
  const updated = await flightsDal.updateFlight(userId, id, data);
  if (!updated) throw notFound('Flight');
  return flightsDal.toDetail(updated);
}
