import { Router } from 'express';
import { z } from 'zod';
import { toAirlineSummary, toAirportSummary } from '../dal/mappers';
import { searchAirlines, searchAirports } from '../dal/reference';
import { route } from '../http/route';

const SearchQuery = z.object({
  q: z.string().trim().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(15),
});

export const referenceRouter = Router();

referenceRouter.get(
  '/airports/search',
  route(async (req, res) => {
    const { q, limit } = SearchQuery.parse(req.query);
    res.json((await searchAirports(q, limit)).map(toAirportSummary));
  }),
);

referenceRouter.get(
  '/airlines/search',
  route(async (req, res) => {
    const { q, limit } = SearchQuery.parse(req.query);
    res.json((await searchAirlines(q, limit)).map(toAirlineSummary));
  }),
);
