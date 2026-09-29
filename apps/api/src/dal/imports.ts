/**
 * User-owned import batches. Every function takes `userId` first and scopes by it.
 */
import { Prisma } from '@prisma/client';
import type { ImportBatch, ImportRowError, ImportSummary } from '@flight-log/shared';
import { prisma } from '../db';
import type { PreparedFlight } from '../import/parseRow';
import { upsertAircraftType } from './reference';

export async function findCommittedBatchBySha(userId: string, sha: string) {
  return prisma.importBatch.findFirst({
    where: { userId, fileSha256: sha, status: 'committed' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
}

function toCreateInput(
  f: PreparedFlight,
  userId: string,
  batchId: string,
  aircraftTypeId: number | null,
): Prisma.FlightCreateManyInput {
  return {
    userId,
    importBatchId: batchId,
    source: 'flighty_csv',
    flightyId: f.flightyId,
    flightDate: new Date(`${f.flightDate}T00:00:00Z`),
    airlineId: f.airlineId,
    airlineNameRaw: f.airlineNameRaw,
    flightNumber: f.flightNumber,
    originAirportId: f.originAirportId,
    destinationAirportId: f.destinationAirportId,
    divertedToAirportId: f.divertedToAirportId,
    canceled: f.canceled,
    ...f.times,
    depTerminal: f.depTerminal,
    depGate: f.depGate,
    arrTerminal: f.arrTerminal,
    arrGate: f.arrGate,
    aircraftTypeId,
    tailNumber: f.tailNumber,
    pnr: f.pnr,
    seat: f.seat,
    seatType: f.seatType,
    cabinClass: f.cabinClass,
    flightReason: f.flightReason,
    notes: f.notes,
    distanceMiles: f.distanceMiles,
    airTimeMinutes: f.airTimeMinutes,
    sourceRaw: f.sourceRaw,
  };
}

/**
 * Write a batch and its flights atomically. Inserts use ON CONFLICT DO NOTHING against both
 * dedupe indexes, so rows that became duplicates after the preview are skipped, not failed.
 */
export async function commitBatch(
  userId: string,
  input: {
    filename: string;
    sha256: string;
    total: number;
    previewDuplicates: number;
    errors: ImportRowError[];
    flights: PreparedFlight[];
  },
): Promise<ImportSummary> {
  const failed = new Set(input.errors.map((e) => e.line)).size;
  return prisma.$transaction(
    async (tx) => {
      const batch = await tx.importBatch.create({
        data: {
          userId,
          filename: input.filename,
          fileSha256: input.sha256,
          total: input.total,
          imported: 0,
          duplicates: 0,
          failed,
          errors: input.errors as unknown as Prisma.InputJsonValue,
        },
      });

      const typeIds = new Map<string, number>();
      for (const f of input.flights) {
        if (f.aircraftTypeName && !typeIds.has(f.aircraftTypeName)) {
          typeIds.set(
            f.aircraftTypeName,
            await upsertAircraftType(f.aircraftTypeName, f.aircraftTypeFlightyId, tx),
          );
        }
      }

      const { count } = input.flights.length
        ? await tx.flight.createMany({
            data: input.flights.map((f) =>
              toCreateInput(
                f,
                userId,
                batch.id,
                f.aircraftTypeName ? typeIds.get(f.aircraftTypeName)! : null,
              ),
            ),
            skipDuplicates: true,
          })
        : { count: 0 };

      const duplicates = input.previewDuplicates + (input.flights.length - count);
      await tx.importBatch.update({
        where: { id: batch.id },
        data: { imported: count, duplicates },
      });
      return {
        batchId: batch.id,
        total: input.total,
        imported: count,
        duplicates,
        failed,
        errors: input.errors,
      };
    },
    { timeout: 60_000 },
  );
}

export async function listBatches(userId: string): Promise<ImportBatch[]> {
  const rows = await prisma.importBatch.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { flights: true } } },
  });
  return rows.map((b) => ({
    id: b.id,
    filename: b.filename,
    status: b.status,
    total: b.total,
    imported: b.imported,
    duplicates: b.duplicates,
    failed: b.failed,
    remainingFlights: b._count.flights,
    createdAt: b.createdAt.toISOString(),
  }));
}

/** Delete every flight from a batch and mark it undone. Returns null if the batch isn't the user's. */
export async function undoBatch(userId: string, batchId: string) {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.findFirst({ where: { id: batchId, userId } });
    if (!batch) return null;
    const { count } = await tx.flight.deleteMany({ where: { userId, importBatchId: batchId } });
    await tx.importBatch.update({ where: { id: batchId }, data: { status: 'undone' } });
    return { batchId, deletedFlights: count };
  });
}
