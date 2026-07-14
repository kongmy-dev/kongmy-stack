import { messages, setLocale, getLocale, t, MessageKeys } from "./messages";

// Test 1: Simple message access (typed)
console.log("Test 1: Simple message");
console.log(messages.greeting()); // Should work

// Test 2: Message with parameters (typed)
console.log("\nTest 2: Message with parameters");
console.log(messages.welcome({ name: "Alice" })); // Typed params

// Test 3: Error message with details (common pattern)
console.log("\nTest 3: Error message");
console.log(messages.error_validation_failed({ field: "email" })); // Parameterized

// Test 4: Plural handling
console.log("\nTest 4: Plural forms");
console.log(messages.items_count({ count: 1 })); // "1 item"
console.log(messages.items_count({ count: 5 })); // "5 items"

// Test 5: Business message
console.log("\nTest 5: Business context message");
console.log(messages.order_created({ orderId: "ORD-123456" }));

// Test 6: Locale switching
console.log("\nTest 6: Locale switching");
console.log("Current locale:", getLocale()); // "en"
setLocale("ms");
console.log("After setLocale('ms'):", getLocale()); // "ms"
console.log(messages.greeting()); // Should now be in Malay
console.log(messages.welcome({ name: "Alice" })); // Should be in Malay

// Test 7: Direct typed key access (MessageKeys enum pattern)
console.log("\nTest 7: Using MessageKeys enum");
console.log(MessageKeys.greeting); // "greeting"
console.log(t(MessageKeys.greeting)); // Typed key access

// Note on type safety:
// ✅ MessageKeys.greeting - strongly typed, IDE autocomplete
// ✅ t(MessageKeys.nonexistent) - ❌ TypeScript error (key doesn't exist in enum)
// ⚠️ t("nonexistent_string") - ❌ At runtime only, not caught at compile time
console.log("\nNote: i18next type safety requires manual MessageKeys enum");
