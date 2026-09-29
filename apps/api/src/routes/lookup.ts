import { Router } from 'express';
import { LookupInputSchema } from '@flight-log/shared';
import { route } from '../http/route';
import { LookupNotConfiguredError, lookupFlight } from '../lookup/service';
import type { FlightLookupProvider } from '../lookup/types';

export function lookupRouter(provider: FlightLookupProvider) {
  const router = Router();
  router.post(
    '/',
    route(async (req, res) => {
      const input = LookupInputSchema.parse(req.body);
      try {
        res.json(await lookupFlight(provider, input));
      } catch (e) {
        if (!(e instanceof LookupNotConfiguredError)) throw e;
        res.status(501).json({
          configured: false,
          provider: null,
          error: { code: 'lookup_not_configured', message: e.message },
        });
      }
    }),
  );
  return router;
}
