import { m } from "./messages";

// This should produce a TypeScript compile error:
// ❌ Property 'nonexistent_key' does not exist on type
const msg = m.nonexistent_key();
