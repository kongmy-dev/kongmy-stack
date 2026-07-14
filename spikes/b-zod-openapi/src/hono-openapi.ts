// Spike: hono-openapi with zod v4
// Tests: zod v4 compat, route ergonomics, OpenAPI output quality, contract wrapping

import { Hono } from 'hono';
import { describeRoute, describeResponse, generateSpecs } from 'hono-openapi';
import { z } from 'zod';
import * as contracts from './contracts';

// Create app
const app = new Hono();

// Middleware to add request ID
app.use(async (c, next) => {
  c.set('requestId', Math.random().toString(36).substring(7));
  await next();
});

// Mock database
const items: Record<string, contracts.Item> = {
  'item_001': {
    id: 'item_001',
    name: 'Widget A',
    description: 'A useful widget',
    quantity: 42,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  },
  'item_002': {
    id: 'item_002',
    name: 'Widget B',
    quantity: 15,
    createdAt: '2024-01-03T00:00:00Z',
    updatedAt: '2024-01-04T00:00:00Z',
  },
};

// === ROUTE 1: GET /items (list with pagination) ===
const listItemsHandler = describeRoute({
  summary: 'List items',
  description: 'Retrieve paginated list of items',
  tags: ['items'],
  responses: {
    '200': describeResponse({
      description: 'Items retrieved successfully',
      schema: contracts.itemListResponseSchema,
    }),
  },
})(async (c) => {
  try {
    const query = contracts.paginationQuerySchema.parse(c.req.query());
    const itemArray = Object.values(items);
    const total = itemArray.length;
    const sorted = itemArray.sort((a, b) => {
      if (query.sort.startsWith('-')) {
        return b.name.localeCompare(a.name);
      }
      return a.name.localeCompare(b.name);
    });
    const paginated = sorted.slice(query.offset, query.offset + query.limit);

    return c.json({
      data: paginated,
      meta: { total, limit: query.limit, offset: query.offset },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: error.flatten().fieldErrors,
          },
        },
        422
      );
    }
    throw error;
  }
});

app.get('/items', listItemsHandler);

// === ROUTE 2: POST /items (create with validation) ===
const createItemHandler = describeRoute({
  summary: 'Create item',
  description: 'Create a new item',
  tags: ['items'],
  responses: {
    '201': describeResponse({
      description: 'Item created successfully',
      schema: contracts.itemSchema,
    }),
    '422': describeResponse({
      description: 'Validation error',
      schema: contracts.errorResponseSchema,
    }),
  },
})(async (c) => {
  try {
    const body = contracts.createItemInputSchema.parse(await c.req.json());
    const id = `item_${Date.now()}`;
    const now = new Date().toISOString();
    const item: contracts.Item = {
      id,
      name: body.name,
      description: body.description,
      quantity: body.quantity,
      createdAt: now,
      updatedAt: now,
    };
    items[id] = item;
    return c.json(item, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: error.flatten().fieldErrors,
          },
        },
        422
      );
    }
    throw error;
  }
});

app.post('/items', createItemHandler);

// === ROUTE 3: GET /items/:id (by id with 404) ===
const getItemHandler = describeRoute({
  summary: 'Get item',
  description: 'Retrieve a specific item by ID',
  tags: ['items'],
  responses: {
    '200': describeResponse({
      description: 'Item retrieved successfully',
      schema: contracts.itemSchema,
    }),
    '404': describeResponse({
      description: 'Item not found',
      schema: contracts.errorResponseSchema,
    }),
  },
})(async (c) => {
  const id = c.req.param('id');
  const item = items[id];
  if (!item) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `Item ${id} not found`,
        },
      },
      404
    );
  }
  return c.json(item);
});

app.get('/items/:id', getItemHandler);

// === Health check ===
app.get('/health', (c) => {
  return c.json({ ok: true });
});

// === OpenAPI documentation endpoint ===
app.get('/openapi.json', (c) => {
  try {
    const specs = generateSpecs(app, {
      openapi: '3.0.0',
      info: {
        title: 'hono-openapi Spike',
        version: '1.0.0',
      },
      servers: [{ url: 'http://localhost:3001' }],
    });
    return c.json(specs);
  } catch (error) {
    console.error('Error generating OpenAPI spec:', error);
    return c.json({ error: 'Failed to generate OpenAPI spec' }, 500);
  }
});

// Export for testing
export default app;

// Start server if run directly
if (import.meta.main) {
  console.log('Starting hono-openapi spike on http://localhost:3001');
  console.log('  OpenAPI spec: http://localhost:3001/openapi.json');

  Bun.serve({
    fetch: app.fetch,
    port: 3001,
  });
}
