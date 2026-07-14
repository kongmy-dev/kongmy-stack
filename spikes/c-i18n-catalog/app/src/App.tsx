import { useState } from "react";
import { LocaleProvider } from "./localeContext";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { Home } from "./pages/Home";
import { ErrorDemo } from "./pages/ErrorDemo";

type Page = "home" | "errors";

export function App() {
  const [currentPage, setCurrentPage] = useState<Page>("home");

  return (
    <LocaleProvider>
      <div style={{ fontFamily: "system-ui, sans-serif" }}>
        <LocaleSwitcher />
        <hr />
        <nav style={{ padding: "1rem", backgroundColor: "#f9f9f9" }}>
          <button
            onClick={() => setCurrentPage("home")}
            style={{
              marginRight: "1rem",
              fontWeight: currentPage === "home" ? "bold" : "normal",
              cursor: "pointer",
              padding: "0.5rem 1rem",
              border: "1px solid #ccc",
              backgroundColor: currentPage === "home" ? "#e0e0e0" : "white",
            }}
          >
            Home
          </button>
          <button
            onClick={() => setCurrentPage("errors")}
            style={{
              fontWeight: currentPage === "errors" ? "bold" : "normal",
              cursor: "pointer",
              padding: "0.5rem 1rem",
              border: "1px solid #ccc",
              backgroundColor: currentPage === "errors" ? "#e0e0e0" : "white",
            }}
          >
            Error Demo
          </button>
        </nav>
        <main>
          {currentPage === "home" && <Home />}
          {currentPage === "errors" && <ErrorDemo />}
        </main>
      </div>
    </LocaleProvider>
  );
}
