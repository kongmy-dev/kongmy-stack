import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./styles/index.css";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { RouterProvider, createRouter, RootRoute, Route, Outlet, redirect } from "@tanstack/react-router";
import { LocaleProvider } from "./contexts/localeContext";
import RootLayout from "./routes/__root";

// Lazy load route components
const InvoiceListPage = React.lazy(() => import("./routes/invoices"));
const CreateInvoicePage = React.lazy(() => import("./routes/invoices/create"));
const EditInvoicePage = React.lazy(() => import("./routes/invoices/edit"));
const LoginPage = React.lazy(() => import("./routes/login"));

// Auth check helper
async function checkAuth() {
  try {
    const response = await fetch("/api/auth/me", {
      credentials: "include",
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

// Create root route
const rootRoute = new RootRoute({
  component: RootLayout,
});

// Create login route
const loginRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: () => (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginPage />
    </Suspense>
  ),
});

// Create invoice routes: parent is a pure layout (Outlet); list is the index child
const invoicesRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/invoices",
  component: Outlet,
});

const invoicesIndexRoute = new Route({
  getParentRoute: () => invoicesRoute,
  path: "/",
  beforeLoad: async () => {
    const isAuth = await checkAuth();
    if (!isAuth) {
      throw redirect({ to: "/login" });
    }
  },
  component: () => (
    <Suspense fallback={<div>Loading...</div>}>
      <InvoiceListPage />
    </Suspense>
  ),
});

const invoicesCreateRoute = new Route({
  getParentRoute: () => invoicesRoute,
  path: "/create",
  beforeLoad: async () => {
    const isAuth = await checkAuth();
    if (!isAuth) {
      throw redirect({ to: "/login" });
    }
  },
  component: () => (
    <Suspense fallback={<div>Loading...</div>}>
      <CreateInvoicePage />
    </Suspense>
  ),
});

const invoicesEditRoute = new Route({
  getParentRoute: () => invoicesRoute,
  path: "/$id/edit",
  beforeLoad: async () => {
    const isAuth = await checkAuth();
    if (!isAuth) {
      throw redirect({ to: "/login" });
    }
  },
  component: () => (
    <Suspense fallback={<div>Loading...</div>}>
      <EditInvoicePage />
    </Suspense>
  ),
});

// Create route tree
const routeTree = rootRoute.addChildren([
  loginRoute,
  invoicesRoute.addChildren([
    invoicesIndexRoute,
    invoicesCreateRoute,
    invoicesEditRoute,
  ]),
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
