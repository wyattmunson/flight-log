import type { RequestHandler } from 'express';

/** Minimal access log: method, path, status, duration. Deliberately omits bodies and query strings. */
export const requestLog: RequestHandler = (req, res, next) => {
  if (process.env.NODE_ENV === 'test') return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`[api] ${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(0)}ms`);
  });
  next();
};
