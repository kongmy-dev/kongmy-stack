/**
 * Root layout route.
 * Sets up the main app shell with navigation, locale switcher, logout button, etc.
 */

import { useState } from "react";
import { Outlet, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useLocale } from "../contexts/localeContext";
import { useRealtime } from "../lib/useRealtime";
import { sessionQueries } from "../lib/queryOptions";
import { apiClient } from "../lib/api";
import { Button } from "../components/ui/button";

// Placeholder for Paraglide messages - will be generated at build time
import * as m from "../paraglide/messages.js";

export default function RootLayout() {
  const { locale, setCurrentLocale, availableLocales } = useLocale();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Subscribe to realtime events (SSE)
  useRealtime();

  // Fetch current session
  const { data: session } = useQuery(sessionQueries.current());

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await apiClient.auth.signOut();
      // Redirect to login
      await router.navigate({ to: "/login" });
    } catch (err) {
      console.error("Logout failed:", err);
    } finally {
      setIsLoggingOut(false);
    }
  };

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
            {session && (
              <div className="text-sm text-gray-700">
                {session.userId}
              </div>
            )}
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
            {session && (
              <Button
                onClick={handleLogout}
                disabled={isLoggingOut}
                variant="outline"
                size="sm"
              >
                {isLoggingOut ? "Logging out..." : "Logout"}
              </Button>
            )}
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
