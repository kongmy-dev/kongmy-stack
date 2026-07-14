// Spike: @hono/zod-openapi with zod v4
// Tests: zod v4 compat, route ergonomics, OpenAPI output quality, contract wrapping

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import * as contracts from './contracts';

// Create app with OpenAPI support
const app = new OpenAPIHono();

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
const listItemsRoute = createRoute({
  method: 'get',
  path: '/items',
  summary: 'List items',
  description: 'Retrieve paginated list of items',
  request: {
    query: contracts.paginationQuerySchema,
  },
  responses: {
    200: {
      description: 'Items retrieved successfully',
      content: {
        'application/json': {
          schema: contracts.itemListResponseSchema,
        },
      },
    },
  },
});

app.openapi(listItemsRoute, async (c) => {
  const query = c.req.valid('query') as contracts.PaginationQuery;
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
});

// === ROUTE 2: POST /items (create with validation) ===
const createItemRoute = createRoute({
  method: 'post',
  path: '/items',
  summary: 'Create item',
  description: 'Create a new item',
  request: {
    body: {
      content: {
        'application/json': {
          schema: contracts.createItemInputSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Item created successfully',
      content: {
        'application/json': {
          schema: contracts.itemSchema,
        },
      },
    },
    422: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: contracts.errorResponseSchema,
        },
      },
    },
  },
});

app.openapi(createItemRoute, async (c) => {
  const body = c.req.valid('json') as contracts.CreateItemInput;
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
});

// === ROUTE 3: GET /items/:id (by id with 404) ===
const getItemRoute = createRoute({
  method: 'get',
  path: '/items/:id',
  summary: 'Get item',
  description: 'Retrieve a specific item by ID',
  request: {
    params: z.object({
      id: z.string().describe('Item ID'),
    }),
  },
  responses: {
    200: {
      description: 'Item retrieved successfully',
      content: {
        'application/json': {
          schema: contracts.itemSchema,
        },
      },
    },
    404: {
      description: 'Item not found',
      content: {
        'application/json': {
          schema: contracts.errorResponseSchema,
        },
      },
    },
  },
});

app.openapi(getItemRoute, async (c) => {
  const { id } = c.req.valid('param');
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

// === Health check (non-OpenAPI) ===
app.get('/health', (c) => {
  return c.json({ ok: true });
});

// === OpenAPI documentation endpoint ===
app.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    title: '@hono/zod-openapi Spike',
    version: '1.0.0',
  },
});

// Export for testing
export default app;

// Start server if run directly
if (import.meta.main) {
  console.log('Starting @hono/zod-openapi spike on http://localhost:3000');
  console.log('  OpenAPI spec: http://localhost:3000/openapi.json');
  console.log('  Swagger UI: http://localhost:3000/swagger');

  Bun.serve({
    fetch: app.fetch,
    port: 3000,
  });
}
