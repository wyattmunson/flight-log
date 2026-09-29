import type { Application } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { openApiSpec } from '../../src/docs/openapi';
import { api } from '../helpers';

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  name: string;
  regexp: RegExp;
  handle: { stack?: Layer[] };
}

/** Every `METHOD /path` mounted on the app, with `:param` rewritten to `{param}`. */
function mountedRoutes(app: Application): Set<string> {
  const found = new Set<string>();
  const walk = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          const path = (prefix + layer.route.path).replace(/\/$/, '') || '/';
          found.add(`${method.toUpperCase()} ${path.replace(/:(\w+)/g, '{$1}')}`);
        }
      } else if (layer.name === 'router' && layer.handle.stack) {
        const mount = layer.regexp.source
          .replace('^', '')
          .replace('\\/?(?=\\/|$)', '')
          .replace(/\\\//g, '/');
        walk(layer.handle.stack, prefix + (mount === '(?:)' ? '' : mount));
      }
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  walk((app as any)._router.stack, '');
  return found;
}

const documentedRoutes = () =>
  new Set(
    Object.entries(openApiSpec.paths).flatMap(([path, item]) =>
      Object.keys(item)
        .filter((k) => ['get', 'post', 'put', 'patch', 'delete'].includes(k))
        .map((method) => `${method.toUpperCase()} ${path}`),
    ),
  );

afterEach(() => {
  delete process.env.ENABLE_API_DOCS;
});

describe('API docs', () => {
  it('documents every mounted API route (and nothing that does not exist)', () => {
    const mounted = [...mountedRoutes(createApp())].filter(
      (r) => !r.includes('/api/docs') && !r.includes('/api/openapi.json'),
    );
    const documented = documentedRoutes();
    expect(mounted.filter((r) => !documented.has(r))).toEqual([]);
    expect([...documented].filter((r) => !mounted.includes(r))).toEqual([]);
  });

  it('serves the spec and Swagger UI', async () => {
    const spec = await api().get('/api/openapi.json').expect(200);
    expect(spec.body.openapi).toBe('3.0.3');
    const ui = await api().get('/api/docs/').expect(200);
    expect(ui.text).toContain('swagger-ui');
    const config = await api().get('/api/config').expect(200);
    expect(config.body.apiDocsUrl).toBe('/api/docs');
  });

  it('can be disabled with ENABLE_API_DOCS=false', async () => {
    process.env.ENABLE_API_DOCS = 'false';
    await api().get('/api/openapi.json').expect(404);
    await api().get('/api/docs/').expect(404);
    expect((await api().get('/api/config')).body.apiDocsUrl).toBeNull();
  });
});
