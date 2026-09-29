import { Router } from 'express';
import { z } from 'zod';
import { FlightFiltersSchema } from '@flight-log/shared';
import { filterOptions, routeFlights } from '../dal/flights';
import { mapData } from '../dal/map';
import { computeStats } from '../dal/stats';
import { route } from '../http/route';

export const insightsRouter = Router();

insightsRouter.get(
  '/map',
  route(async (req, res) => {
    res.json(await mapData(req.userId, FlightFiltersSchema.parse(req.query)));
  }),
);

insightsRouter.get(
  '/map/routes/:a/:b/flights',
  route(async (req, res) => {
    const { a, b } = z
      .object({ a: z.coerce.number().int(), b: z.coerce.number().int() })
      .parse(req.params);
    res.json(await routeFlights(req.userId, a, b, FlightFiltersSchema.parse(req.query)));
  }),
);

insightsRouter.get(
  '/stats',
  route(async (req, res) => {
    res.json(await computeStats(req.userId, FlightFiltersSchema.parse(req.query)));
  }),
);

insightsRouter.get(
  '/filter-options',
  route(async (req, res) => {
    res.json(await filterOptions(req.userId));
  }),
);
