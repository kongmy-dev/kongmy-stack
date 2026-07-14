import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { RouterProvider, createRouter, RootRoute, Route } from "@tanstack/react-router";
import { LocaleProvider } from "./contexts/localeContext";
import RootLayout from "./routes/__root";

// Lazy load route components
const InvoiceListPage = React.lazy(() => import("./routes/invoices"));
const CreateInvoicePage = React.lazy(() => import("./routes/invoices/create"));
const EditInvoicePage = React.lazy(() => import("./routes/invoices/edit"));

// Create root route
const rootRoute = new RootRoute({
  component: RootLayout,
});

// Create invoice routes
const invoicesRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/invoices/",
  component: () => (
    <Suspense fallback={<div>Loading...</div>}>
      <InvoiceListPage />
    </Suspense>
  ),
});

const invoicesCreateRoute = new Route({
  getParentRoute: () => invoicesRoute,
  path: "/create",
  component: () => (
    <Suspense fallback={<div>Loading...</div>}>
      <CreateInvoicePage />
    </Suspense>
  ),
});

const invoicesEditRoute = new Route({
  getParentRoute: () => invoicesRoute,
  path: "/$id/edit",
  component: () => (
    <Suspense fallback={<div>Loading...</div>}>
      <EditInvoicePage />
    </Suspense>
  ),
});

// Create route tree
const routeTree = rootRoute.addChildren([
  invoicesRoute.addChildren([invoicesCreateRoute, invoicesEditRoute]),
]);

// Create router
const router = createRouter({
  routeTree,
  defaultNotFoundComponent: () => <div>Not found</div>,
});

// Create query client
const queryClient = new QueryClient();

// Render app
const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <RouterProvider router={router} />
      </LocaleProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
