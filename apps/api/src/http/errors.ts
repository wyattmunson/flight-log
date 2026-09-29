import type { ErrorRequestHandler, RequestHandler } from 'express';
import { MulterError } from 'multer';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', `${what} not found`);
export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'bad_request', message, details);

export const notFoundHandler: RequestHandler = (req, _res, next) =>
  next(new AppError(404, 'not_found', `No route for ${req.method} ${req.path}`));

/** Converts every error into `{ error: { code, message, details? } }`. Never echoes request bodies. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  if (err instanceof MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooLarge ? 413 : 400).json({
      error: { code: tooLarge ? 'file_too_large' : 'upload_error', message: err.message },
    });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.status(409).json({
      error: { code: 'conflict', message: 'A flight with the same identity already exists' },
    });
    return;
  }
  if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'invalid_json', message: 'Malformed JSON body' } });
    return;
  }
  // Log the error itself but never the request body (may contain PNR/seat data).
  console.error('[api] unhandled error:', err instanceof Error ? err.stack : err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong' } });
};
