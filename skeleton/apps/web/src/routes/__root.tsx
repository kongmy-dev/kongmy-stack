/**
 * Root layout route.
 * Sets up the main app shell with navigation, locale switcher, etc.
 */

import { Outlet } from "@tanstack/react-router";
import { useLocale } from "../contexts/localeContext";

// Placeholder for Paraglide messages - will be generated at build time
import * as m from "../paraglide/messages.js";

export default function RootLayout() {
  const { locale, setCurrentLocale, availableLocales } = useLocale();

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-8">
            <h1 className="text-2xl font-bold">
              <a href="/invoices" className="text-blue-600 hover:text-blue-700">
                kongmy-stack
              </a>
            </h1>
            <nav className="flex gap-4">
              <a
                href="/invoices"
                className="text-gray-700 hover:text-gray-900"
              >
                {m.invoices_title()}
              </a>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <select
              value={locale}
              onChange={(e) => setCurrentLocale(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
              aria-label="Select language"
              data-testid="locale-toggle"
            >
              {availableLocales.map((loc) => (
                <option key={loc} value={loc}>
                  {loc.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-gray-200 bg-gray-50 px-6 py-4 text-center text-sm text-gray-600">
        <p>kongmy-stack template system · T6 web app</p>
      </footer>
    </div>
  );
}
