/**
 * i18next-based typed message catalog
 *
 * This demonstrates i18next with TypeScript typing.
 * Unlike Paraglide (which compiles to functions), i18next uses
 * runtime loading with optional type layers for compile-time safety.
 */

import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";

export type LocaleTag = "en" | "ms";

// Translation resources
const resources = {
  en: {
    translation: {
      greeting: "Hello, World!",
      welcome: "Welcome, {{name}}!",
      error_validation_failed: "Validation failed: {{field}} is required",
      items_count_one: "1 item",
      items_count_other: "{{count}} items",
      order_created: "Your order #{{orderId}} has been created",
    },
  },
  ms: {
    translation: {
      greeting: "Halo, Dunia!",
      welcome: "Selamat datang, {{name}}!",
      error_validation_failed: "Pengesahan gagal: {{field}} diperlukan",
      items_count_one: "1 item",
      items_count_other: "{{count}} item",
      order_created: "Pesanan anda #{{orderId}} telah dibuat",
    },
  },
};

// Type-safe key definitions
// This is the manual typing layer - errors caught at compile time
export const MessageKeys = {
  greeting: "greeting",
  welcome: "welcome",
  error_validation_failed: "error_validation_failed",
  items_count: "items_count",
  order_created: "order_created",
} as const;

export type MessageKey = (typeof MessageKeys)[keyof typeof MessageKeys];

// Initialize i18next
await i18next.use(LanguageDetector).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  defaultNS: "translation",
  ns: ["translation"],
  detection: {
    order: ["localStorage", "navigator"],
    caches: ["localStorage"],
  },
});

// Typed wrapper for type-safe key access
export function t(
  key: MessageKey,
  options?: Record<string, unknown>
): string {
  return i18next.t(key, options);
}

// Alternative: provide specific typed functions per message
export const messages = {
  greeting: () => t("greeting"),
  welcome: (params: { name: string }) => t("welcome", params),
  error_validation_failed: (params: { field: string }) =>
    t("error_validation_failed", params),
  items_count: (params: { count: number }) => {
    // i18next pluralization: key + "_one" / key + "_other"
    const suffix = params.count === 1 ? "_one" : "_other";
    return i18next.t(`items_count${suffix}`, { count: params.count });
  },
  order_created: (params: { orderId: string }) =>
    t("order_created", params),
};

export const setLocale = (locale: LocaleTag) => {
  i18next.changeLanguage(locale);
};

export const getLocale = () => i18next.language as LocaleTag;
