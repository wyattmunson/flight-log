import { Router } from 'express';
import { z } from 'zod';
import { FlightListQuerySchema } from '@flight-log/shared';
import * as flightsDal from '../dal/flights';
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
