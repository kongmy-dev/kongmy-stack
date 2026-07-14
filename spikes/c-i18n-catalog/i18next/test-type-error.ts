import { t, MessageKeys } from "./messages";

// ❌ This WILL catch a compile error - using MessageKeys.nonexistent
const msg = t(MessageKeys.nonexistent as any);

// ⚠️ But this WILL NOT catch a compile error - string literal
// The t() function accepts any string at runtime
const dangerous = t("any_random_key" as any);
