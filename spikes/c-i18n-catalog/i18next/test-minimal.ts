import { setLocale, getLocale, t, MessageKeys } from "./messages-minimal";

// Test 1: Simple message access
console.log("Test 1: Simple message");
console.log(t(MessageKeys.greeting));

// Test 2: Message with parameters
console.log("\nTest 2: Message with parameters");
console.log(t(MessageKeys.welcome, { name: "Alice" }));

// Test 3: Error message
console.log("\nTest 3: Error message");
console.log(t(MessageKeys.error_validation_failed, { field: "email" }));

// Test 4: Plural handling
console.log("\nTest 4: Plural forms");
console.log(t(MessageKeys.items_count, { count: 1 }));
console.log(t(MessageKeys.items_count, { count: 5 }));

// Test 5: Business message
console.log("\nTest 5: Business context message");
console.log(t(MessageKeys.order_created, { orderId: "ORD-123456" }));

// Test 6: Locale switching
console.log("\nTest 6: Locale switching");
console.log("Current locale:", getLocale());
setLocale("ms");
console.log("After setLocale('ms'):", getLocale());
console.log(t(MessageKeys.greeting));
console.log(t(MessageKeys.welcome, { name: "Alice" }));
