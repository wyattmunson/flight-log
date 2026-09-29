import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import { normalizeFlightNumber } from '@flight-log/shared';
import type {
  ImportPreview,
  ImportPreviewRow,
  ImportRowError,
  ImportRowStatus,
  ImportSummary,
} from '@flight-log/shared';
import { env } from '../env';
import { AppError } from '../http/errors';
import { existingFlightyIds, flightsWithoutFlightyIdOn, dateOnly } from '../dal/flights';
import { commitBatch, findCommittedBatchBySha } from '../dal/imports';
import { loadReferenceIndex, rememberFlightyIds } from '../dal/reference';
import { mapHeaders, recordFromRow, type FlightyRecord } from './columns';
import { naturalKey, parseRow, type ParsedRow } from './parseRow';
import { PreviewStore } from './previewStore';

const MAX_ROWS = 20_000;
const SAMPLE_SIZE = 50;
const MAX_ERRORS_RETURNED = 500;

interface StoredPreview {
  filename: string;
  sha256: string;
  total: number;
  rows: (ParsedRow & { status: ImportRowStatus; duplicateReason?: string })[];
}

export const previewStore = new PreviewStore<StoredPreview>(() => env.previewTtlMs);

interface CsvRow {
  line: number;
  record: FlightyRecord;
  raw: Record<string, string | null>;
}

/** Stream-parse the upload. Returns the header mapping and one entry per non-empty data row. */
export async function readFlightyCsv(buffer: Buffer) {
  if (buffer.includes(0)) {
    throw new AppError(415, 'unsupported_file', 'The file does not look like a text CSV');
  }
  const parser = Readable.from(buffer).pipe(
    parse({
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      skip_records_with_empty_values: true,
      info: true,
    }),
  );

  let mapping: ReturnType<typeof mapHeaders> | undefined;
  const rows: CsvRow[] = [];
  try {
    for await (const { record, info } of parser as AsyncIterable<{
      record: string[];
      info: { lines: number };
    }>) {
      if (!mapping) {
        mapping = mapHeaders(record);
        continue;
      }
      if (rows.length >= MAX_ROWS) {
        throw new AppError(422, 'too_many_rows', `Files are limited to ${MAX_ROWS} rows`);
      }
      rows.push({ line: info.lines, ...recordFromRow(record, mapping) });
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(422, 'invalid_csv', `Could not parse CSV: ${(e as Error).message}`);
  }
  if (!mapping) throw new AppError(422, 'empty_file', 'The file is empty');
  if (mapping.missingRequired.length) {
    throw new AppError(
      422,
      'missing_columns',
      `Missing required column(s): ${mapping.missingRequired.join(', ')}. Is this a Flighty export?`,
      { missingColumns: mapping.missingRequired, foundColumns: mapping.headers },
    );
  }
  return { mapping, rows };
}

/** Parse, validate and dedupe an upload without writing anything. */
export async function buildPreview(
  userId: string,
  file: { originalname: string; buffer: Buffer },
): Promise<ImportPreview> {
  const sha256 = createHash('sha256').update(file.buffer).digest('hex');
  const { mapping, rows } = await readFlightyCsv(file.buffer);

  const nonEmpty = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x);
  const index = await loadReferenceIndex({
    airportCodes: nonEmpty(rows.flatMap((r) => [r.record.from, r.record.to, r.record.divertedTo])),
    airportFlightyIds: nonEmpty(
      rows.flatMap((r) => [
        r.record.flightyDepartureAirportId,
        r.record.flightyArrivalAirportId,
        r.record.flightyDivertedAirportId,
      ]),
    ),
    airlineValues: nonEmpty(
      rows.flatMap((r) => [r.record.airline, normalizeFlightNumber(r.record.flight).carrier]),
    ),
    airlineFlightyIds: nonEmpty(rows.map((r) => r.record.flightyAirlineId)),
  });

  const parsed = rows.map((r) => parseRow(r.record, r.raw, r.line, index));
  const valid = parsed.flatMap((p) => (p.flight ? [p.flight] : []));

  const [dbFlightyIds, dbNatural] = await Promise.all([
    existingFlightyIds(userId, nonEmpty(valid.map((f) => f.flightyId))),
    flightsWithoutFlightyIdOn(
      userId,
      valid.filter((f) => !f.flightyId).map((f) => f.flightDate),
    ),
  ]);
  const dbNaturalKeys = new Set(
    dbNatural.map((f) => naturalKey({ ...f, flightDate: dateOnly(f.flightDate) })),
  );

  const seenFlighty = new Set<string>();
  const seenNatural = new Set<string>();
  const stored: StoredPreview['rows'] = parsed.map((p) => {
    if (!p.flight) return { ...p, status: 'invalid' };
    if (p.flight.flightyId) {
      const id = p.flight.flightyId;
      if (dbFlightyIds.has(id))
        return { ...p, status: 'duplicate', duplicateReason: 'Already imported (same Flighty ID)' };
      if (seenFlighty.has(id))
        return {
          ...p,
          status: 'duplicate',
          duplicateReason: 'Repeated Flighty ID earlier in this file',
        };
      seenFlighty.add(id);
      return { ...p, status: 'new' };
    }
    const key = naturalKey(p.flight);
    if (dbNaturalKeys.has(key))
      return {
        ...p,
        status: 'duplicate',
        duplicateReason: 'Already in your log (same date, airline, flight and route)',
      };
    if (seenNatural.has(key))
      return { ...p, status: 'duplicate', duplicateReason: 'Repeated earlier in this file' };
    seenNatural.add(key);
    return { ...p, status: 'new' };
  });

  const counts = { total: stored.length, new: 0, duplicate: 0, invalid: 0 };
  for (const r of stored) counts[r.status]++;

  const previous = await findCommittedBatchBySha(userId, sha256);
  const { id, expiresAt } = previewStore.put(userId, {
    filename: file.originalname,
    sha256,
    total: stored.length,
    rows: stored,
  });

  const errors = stored.flatMap((r) => r.errors);
  return {
    previewId: id,
    filename: file.originalname,
    expiresAt: expiresAt.toISOString(),
    counts,
    unknownColumns: mapping.unknownColumns,
    missingColumns: mapping.missingColumns,
    previouslyImportedBatchId: previous?.id ?? null,
    sample: stored.slice(0, SAMPLE_SIZE).map(toPreviewRow),
    errors: errors.slice(0, MAX_ERRORS_RETURNED),
  };
}

function toPreviewRow(r: StoredPreview['rows'][number]): ImportPreviewRow {
  return {
    line: r.line,
    status: r.status,
    duplicateReason: r.duplicateReason,
    errors: r.errors,
    warnings: r.warnings,
    ...r.display,
  };
}

export async function commitPreview(userId: string, previewId: string): Promise<ImportSummary> {
  const preview = previewStore.get(userId, previewId);
  if (!preview) {
    throw new AppError(
      410,
      'preview_expired',
      'This preview has expired or was already committed. Please upload the file again.',
    );
  }
  previewStore.delete(previewId);

  const newRows = preview.rows.filter((r) => r.status === 'new' && r.flight);
  const errors: ImportRowError[] = preview.rows.flatMap((r) => r.errors);
  const summary = await commitBatch(userId, {
    filename: preview.filename,
    sha256: preview.sha256,
    total: preview.total,
    previewDuplicates: preview.rows.filter((r) => r.status === 'duplicate').length,
    errors,
    flights: newRows.map((r) => r.flight!),
  });

  const airports = new Map<number, string>();
  const airlines = new Map<number, string>();
  for (const r of newRows) {
    for (const [id, fid] of r.flight!.refFlightyIds.airports) airports.set(id, fid);
    const al = r.flight!.refFlightyIds.airline;
    if (al) airlines.set(al[0], al[1]);
  }
  await rememberFlightyIds(airports, airlines);
  return summary;
}
