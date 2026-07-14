/**
 * Minimal i18next setup without language detection
 * for a fairer bundle size comparison
 */

let currentLocale = "en";

// Type-safe key definitions
export const MessageKeys = {
  greeting: "greeting",
  welcome: "welcome",
  error_validation_failed: "error_validation_failed",
  items_count: "items_count",
  order_created: "order_created",
} as const;

export type MessageKey = (typeof MessageKeys)[keyof typeof MessageKeys];

// Translation resources
const resources = {
  en: {
    greeting: "Hello, World!",
    welcome: "Welcome, {{name}}!",
    error_validation_failed: "Validation failed: {{field}} is required",
    items_count: "{{count}} item",
    order_created: "Your order #{{orderId}} has been created",
  },
  ms: {
    greeting: "Halo, Dunia!",
    welcome: "Selamat datang, {{name}}!",
    error_validation_failed: "Pengesahan gagal: {{field}} diperlukan",
    items_count: "{{count}} item",
    order_created: "Pesanan anda #{{orderId}} telah dibuat",
  },
};

// Simple template interpolation (minimal runtime)
function interpolate(template: string, values: Record<string, any> = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "");
}

export function t(
  key: MessageKey,
  options?: Record<string, unknown>
): string {
  const resource = resources[currentLocale as "en" | "ms"] || resources.en;
  const template = resource[key as keyof typeof resource] || key;
  if (typeof template === "string") {
    return interpolate(template as string, options);
  }
  return String(template);
}

export const setLocale = (locale: string) => {
  currentLocale = locale;
};

export const getLocale = () => currentLocale;
