import { m, setLocale, getLocale } from "./messages";

// Test 1: Simple message access (typed)
console.log("Test 1: Simple message");
console.log(m.greeting()); // Should work - no params needed
// console.log(m.nonexistent()); // ❌ Compile error - key doesn't exist

// Test 2: Message with parameters (typed)
console.log("\nTest 2: Message with parameters");
console.log(m.welcome({ name: "Alice" })); // ✅ Typed params
// console.log(m.welcome({ wrongParam: "Bob" })); // ❌ Compile error - wrong param

// Test 3: Error message with details (common pattern)
console.log("\nTest 3: Error message");
console.log(
  m.error_validation_failed({ field: "email" })
); // ✅ Parameterized message for UI error rendering

// Test 4: Plural handling
console.log("\nTest 4: Plural forms");
console.log(m.items_count({ count: 1 })); // "1 item"
console.log(m.items_count({ count: 5 })); // "5 items"

// Test 5: Business message (orderCreated)
console.log("\nTest 5: Business context message");
console.log(m.order_created({ orderId: "ORD-123456" })); // ✅ Domain-specific message

// Test 6: Locale switching (important for Vite SPA)
console.log("\nTest 6: Locale switching");
console.log("Current locale:", getLocale()); // "en"
setLocale("ms");
console.log("After setLocale('ms'):", getLocale()); // "ms"
console.log(m.greeting()); // Should now be in Malay
console.log(
  m.welcome({ name: "Alice" })
); // Should be in Malay
console.log(m.welcome({ name: "Alice" }, { locale: "en" })); // Can override per-call

// Test 7: Demonstrate tree-shaking - only greeting is imported/used from catalog
console.log("\nTest 7: Tree-shaking potential");
// In real usage: import { greeting } from "./messages"
// Only greeting's function is bundled, not the others
const singleMessage = m.greeting;
console.log(typeof singleMessage); // "function"
