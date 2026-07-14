// Inspect hono-openapi to understand its API

import { describeRoute, describeResponse, generateSpecs } from 'hono-openapi';

console.log('describeRoute type:', typeof describeRoute);
console.log('describeResponse type:', typeof describeResponse);
console.log('generateSpecs type:', typeof generateSpecs);

// Try creating a simple route to see what works
const { Hono } = await import('hono');
const { z } = await import('zod');

const app = new Hono();

// Try simpler describeRoute without describeResponse
const simpleRoute = describeRoute({
  summary: 'Simple route',
  tags: ['test'],
})(async (c) => {
  return c.json({ ok: true });
});

app.get('/simple', simpleRoute);

console.log('Route added successfully');

try {
  const specs = generateSpecs(app, {
    openapi: '3.0.0',
    info: { title: 'Test', version: '1.0.0' },
  });
  console.log('Specs generated:', specs);
} catch (e) {
  console.error('Error:', e.message);
}
