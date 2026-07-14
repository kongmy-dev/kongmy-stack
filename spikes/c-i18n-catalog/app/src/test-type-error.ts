/**
 * This file demonstrates Paraglide's compile-time type safety.
 * When uncommented, the code below should produce TypeScript errors
 * because the message keys do not exist in the generated catalog.
 *
 * UNCOMMENT THE LINES BELOW TO SEE COMPILE-TIME ERRORS:
 */

// import * as m from './paraglide/messages';

// // These keys do not exist in the catalog — should be TS errors:
// const x = m.nonexistent_key(); // Property 'nonexistent_key' does not exist on type 'typeof m'
// const y = m.greeting({ wrong_param: "value" }); // Expected 0 arguments, but got 1
// const z = m.user_greeting(); // Missing required parameter: 'name'

/**
 * To verify:
 * 1. Uncomment the import and any of the three lines above
 * 2. Run: tsc --noEmit
 * 3. You should see TypeScript errors immediately
 * 4. This is the compile-error guarantee that distinguishes Paraglide
 *    from i18next (which uses string literals and cannot catch typos)
 */
