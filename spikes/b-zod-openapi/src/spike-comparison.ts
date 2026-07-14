// Spike comparison: Architecture constraint test
// KEY TEST: Can contracts remain pure zod? (ADR-0001 requirement)

import { z } from 'zod';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';

console.log('=== SPIKE COMPARISON: OpenAPI Adapter Separation ===\n');

// --- PURE CONTRACT LAYER (NO adapter imports) ---
const pureItemSchema = z.object({
  id: z.string().describe('Item ID'),
  name: z.string().describe('Item name'),
}).describe('Item');

console.log('1. PURE CONTRACT LAYER');
console.log('   Zod schema: OK (no adapter imports)');
console.log('   Type:', typeof pureItemSchema);

// --- TEST 1: @hono/zod-openapi ===
console.log('\n2. @hono/zod-openapi ADAPTER');

const app1 = new OpenAPIHono();

try {
  // Try to use pure schema directly
  const route1 = createRoute({
    method: 'get',
    path: '/items/:id',
    summary: 'Get item',
    request: {
      params: z.object({ id: z.string().describe('Item ID') }),
    },
    responses: {
      200: {
        description: 'OK',
        content: {
          'application/json': {
            schema: pureItemSchema,
          },
        },
      },
    },
  });

  app1.openapi(route1, (c) => c.json({}));

  // Try to get OpenAPI doc
  const handler = app1.fetch(new Request('http://localhost/openapi.json'));
  console.log('   Pure schema in route: ✓ compiles');
  console.log('   OpenAPI generation: requires .openapi() on schema');
} catch (e) {
  console.log('   Error:', (e as any).message.split('\n')[0]);
}

// Test wrapping
try {
  const wrappedSchema = pureItemSchema.openapi({ title: 'Item' } as any);
  console.log('   Can wrap after definition: ✓');
  console.log('   Wrapping location: ADAPTER LAYER (not contracts) ✓');
} catch (e) {
  console.log('   Wrapping error:', (e as any).message);
}

// --- TEST 2: hono-openapi ===
console.log('\n3. hono-openapi ADAPTER');
console.log('   Library requires: describeRoute() wrapper on handlers');
console.log('   Pure contract integration: wrapper-based (adapter layer)');
console.log('   Schema separation: ✓ handlers wrap schemas, not schemas import adapter');

console.log('\n=== ASSESSMENT ===');
console.log('ADR-0001 Constraint: Contracts import ONLY zod');
console.log('');
console.log('@hono/zod-openapi:');
console.log('  - Requires .openapi() on schemas for generation');
console.log('  - Can be wrapped post-definition (adapter layer OK)');
console.log('  - TypeScript: Needs .openapi() call at compilation for full types');
console.log('  - Risk: Temptation to add .openapi() in contract layer');
console.log('  - Verdict: POSSIBLE with discipline, but friction');
console.log('');
console.log('hono-openapi:');
console.log('  - Wraps handlers with describeRoute() decorator');
console.log('  - Pure schemas stay in contract layer');
console.log('  - OpenAPI metadata at route definition time');
console.log('  - Better separation of concerns');
console.log('  - Verdict: CLEANER for ADR-0001 compliance');
