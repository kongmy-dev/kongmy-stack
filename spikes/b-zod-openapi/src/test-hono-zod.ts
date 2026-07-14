// Test spike: @hono/zod-openapi

import app from './hono-zod-openapi';

async function test() {
  console.log('Testing @hono/zod-openapi\n');

  // Test 1: Health check
  console.log('=== Test 1: Health check ===');
  let res = await app.request('/health');
  console.log('Status:', res.status);
  console.log('Body:', await res.json());

  // Test 2: List items
  console.log('\n=== Test 2: List items with pagination ===');
  res = await app.request('/items?limit=1&offset=0');
  console.log('Status:', res.status);
  console.log('Body:', await res.json());

  // Test 3: Create item
  console.log('\n=== Test 3: Create item ===');
  res = await app.request('/items', {
    method: 'POST',
    body: JSON.stringify({ name: 'Test Item', quantity: 42 }),
    headers: { 'Content-Type': 'application/json' },
  });
  console.log('Status:', res.status);
  console.log('Body:', await res.json());

  // Test 4: Get item
  console.log('\n=== Test 4: Get item ===');
  res = await app.request('/items/item_001');
  console.log('Status:', res.status);
  console.log('Body:', await res.json());

  // Test 5: 404 case
  console.log('\n=== Test 5: Get non-existent item (404) ===');
  res = await app.request('/items/notfound');
  console.log('Status:', res.status);
  console.log('Body:', await res.json());

  // Test 6: OpenAPI spec
  console.log('\n=== Test 6: OpenAPI spec ===');
  res = await app.request('/openapi.json');
  console.log('Status:', res.status);
  const spec = await res.json();
  console.log('OpenAPI paths:', Object.keys(spec.paths || {}));
  console.log('Spec excerpt (paths):');
  console.log(JSON.stringify(spec.paths, null, 2));
}

test().catch(console.error);
