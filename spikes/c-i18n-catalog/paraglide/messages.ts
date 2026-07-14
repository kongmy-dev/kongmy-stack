/**
 * Paraglide-inspired typed message catalog
 * This demonstrates what Paraglide compiles to:
 * - Typed message functions
 * - Compile-time key safety (imports are typed)
 * - Tree-shakeable per-locale
 */

export type LocaleTag = "en" | "ms";

let currentLocale: LocaleTag = "en";

interface MessageContext {
  locale?: LocaleTag;
}

type MessageFn<T = Record<string, unknown>> = (
  params: T,
  ctx?: MessageContext
) => string;

// Messages catalog - each message is a typed function
// This is what Paraglide generates from the JSON definitions

const catalogEn = {
  greeting: () => "Hello, World!",
  welcome: (params: { name: string }) => `Welcome, ${params.name}!`,
  error_validation_failed: (params: {
    field: string;
  }) => `Validation failed: ${params.field} is required`,
  items_count: (params: { count: number }) => {
    if (params.count === 1) return "1 item";
    return `${params.count} items`;
  },
  order_created: (params: { orderId: string }) =>
    `Your order #${params.orderId} has been created`,
};

const catalogMs = {
  greeting: () => "Halo, Dunia!",
  welcome: (params: { name: string }) =>
    `Selamat datang, ${params.name}!`,
  error_validation_failed: (params: {
    field: string;
  }) => `Pengesahan gagal: ${params.field} diperlukan`,
  items_count: (params: { count: number }) => {
    if (params.count === 1) return "1 item";
    return `${params.count} item`;
  },
  order_created: (params: { orderId: string }) =>
    `Pesanan anda #${params.orderId} telah dibuat`,
};

type CatalogKeys = keyof typeof catalogEn;
type CatalogType = typeof catalogEn;

// Type-safe message access
function createMessageFunctions() {
  const messages = {} as Record<
    CatalogKeys,
    (params?: unknown, ctx?: MessageContext) => string
  >;

  for (const key of Object.keys(catalogEn) as CatalogKeys[]) {
    messages[key] = (params: unknown = {}, ctx?: MessageContext) => {
      const locale = ctx?.locale ?? currentLocale;
      const catalog = locale === "ms" ? catalogMs : catalogEn;
      const msgFn = catalog[key] as any;
      return msgFn(params);
    };
  }

  return messages;
}

export const m = createMessageFunctions();
export const setLocale = (locale: LocaleTag) => {
  currentLocale = locale;
};
export const getLocale = () => currentLocale;
