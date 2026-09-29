import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './openapi';

/** Swagger UI at `/api/docs` and the raw spec at `/api/openapi.json`. Mounted only when enabled. */
export function docsRouter() {
  const router = Router();
  router.get('/openapi.json', (_req, res) => {
    res.json(openApiSpec);
  });
  router.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec, { customSiteTitle: 'Flight Log API' }),
  );
  return router;
}
