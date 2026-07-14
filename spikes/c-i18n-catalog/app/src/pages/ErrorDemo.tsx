import * as m from "../paraglide/messages";

type ApiError = {
  code: string;
  details?: Record<string, any>;
};

function renderErrorMessage(error: ApiError): string {
  // This demonstrates the error_code → catalog pattern from ADR-0007
  const errorKey = `error_${error.code}` as keyof typeof m;
  const messageFunc = m[errorKey];

  if (typeof messageFunc === "function") {
    // @ts-ignore - Paraglide types are strict about params
    return messageFunc(error.details || {});
  }

  // Fallback for unknown error codes
  return `Unknown error: ${error.code}`;
}

export function ErrorDemo() {
  const mockErrors: ApiError[] = [
    { code: "validation_failed" },
    { code: "not_found" },
    { code: "unauthorized" },
  ];

  return (
    <div style={{ padding: "1rem" }}>
      <h1>Error Display Demo (ADR-0007 pattern)</h1>
      <p>
        This demonstrates error.code rendering via the message catalog. Errors contain only codes
        and details; UI renders the localized message.
      </p>

      <div style={{ marginTop: "2rem" }}>
        {mockErrors.map((err) => (
          <div key={err.code} style={{ marginBottom: "1rem", padding: "1rem", border: "1px solid #f44336", backgroundColor: "#ffebee" }}>
            <strong>Error code:</strong> <code>{err.code}</code>
            <br />
            <strong>Localized message:</strong> {renderErrorMessage(err)}
          </div>
        ))}
      </div>

      <div style={{ marginTop: "2rem", padding: "1rem", backgroundColor: "#fff3e0" }}>
        <h3>How this works:</h3>
        <ol>
          <li>API returns: error.code (stable, no i18n)</li>
          <li>UI constructs key: error_ (code)</li>
          <li>UI looks up in message catalog via Paraglide message function</li>
          <li>Locale switching automatically re-renders error text</li>
        </ol>
      </div>
    </div>
  );
}
