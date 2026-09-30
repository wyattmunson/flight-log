import { Router } from 'express';
import { z } from 'zod';
import {
  DeleteAllFlightsQuerySchema,
  ExportQuerySchema,
  FlightListQuerySchema,
  type FlightsExport,
} from '@flight-log/shared';
import * as flightsDal from '../dal/flights';
import { flightsToCsv } from '../export/flightsCsv';
import { notFound } from '../http/errors';
import { route } from '../http/route';
import { createManualFlight, updateFlight } from '../services/flights';

const IdParam = z.object({ id: z.string().uuid('Invalid flight id') });

export const flightsRouter = Router();

flightsRouter.get(
  '/',
  route(async (req, res) => {
    res.json(await flightsDal.listFlights(req.userId, FlightListQuerySchema.parse(req.query)));
  }),
);

/**
 * Detail-level export of the user's own flights (includes PNR and seat). Registered before `/:id`.
 * Nothing here logs the data, and the response is never cached.
 */
flightsRouter.get(
  '/export',
  route(async (req, res) => {
    const { format } = ExportQuerySchema.parse(req.query);
    const flights = await flightsDal.listAllFlights(req.userId);
    const now = new Date();
    res.set({
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="flight-log-${now.toISOString().slice(0, 10)}.${format}"`,
      'X-Content-Type-Options': 'nosniff',
    });
    if (format === 'csv') {
      res.type('text/csv; charset=utf-8').send(flightsToCsv(flights));
      return;
    }
    const body: FlightsExport = {
      exportedAt: now.toISOString(),
      count: flights.length,
      flights: flights.map(flightsDal.toDetail),
    };
    res.json(body);
  }),
);

flightsRouter.get(
  '/:id',
  route(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const flight = await flightsDal.findFlight(req.userId, id);
    if (!flight) throw notFound('Flight');
    res.json(flightsDal.toDetail(flight));
  }),
);

flightsRouter.post(
  '/',
  route(async (req, res) => {
    res.status(201).json(await createManualFlight(req.userId, req.body));
  }),
);

flightsRouter.patch(
  '/:id',
  route(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    res.json(await updateFlight(req.userId, id, req.body));
  }),
);

flightsRouter.delete(
  '/:id',
  route(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    if (!(await flightsDal.deleteFlight(req.userId, id))) throw notFound('Flight');
    res.status(204).end();
  }),
);

/** Empties the user's log. Needs `?confirm=delete-all-flights` so a stray request cannot do it. */
flightsRouter.delete(
  '/',
  route(async (req, res) => {
    DeleteAllFlightsQuerySchema.parse(req.query);
    res.json(await flightsDal.deleteAllFlights(req.userId));
  }),
);
