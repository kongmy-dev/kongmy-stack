// Debug @hono/zod-openapi OpenAPI spec generation

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import * as contracts from './contracts';

const app = new OpenAPIHono();

const testRoute = createRoute({
  method: 'get',
  path: '/test',
  summary: 'Test',
  description: 'Test route',
  request: {},
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: z.object({ ok: z.boolean() }),
        },
      },
    },
  },
});

app.openapi(testRoute, (c) => {
  return c.json({ ok: true });
});

// Try to generate spec
try {
  console.log('Attempting to get spec...');

  // Check if app has spec method
  console.log('App methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(app)).slice(0, 20));

  // Try different approaches
  if ('getOpenAPIDocument' in app) {
    const doc = (app as any).getOpenAPIDocument();
    console.log('Got document via getOpenAPIDocument:', doc);
  }

  if ('getOpenAPIDocument' in app) {
    const doc = (app as any).getOpenAPIDocument?.({
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
    });
    console.log('Got document:', doc);
  }

  // Check what's exported
  console.log('\nApp is OpenAPIHono instance');

} catch (e) {
  console.error('Error:', e);
}
