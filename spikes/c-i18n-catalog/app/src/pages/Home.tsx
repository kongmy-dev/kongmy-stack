import * as m from "../paraglide/messages";

export function Home() {
  return (
    <div style={{ padding: "1rem" }}>
      <h1>{m.greeting()}</h1>
      <p>{m.welcome()}</p>
      <p>{m.user_greeting({ name: "Alice" })}</p>

      <div style={{ marginTop: "2rem", padding: "1rem", backgroundColor: "#e8f5e9" }}>
        <h3>Message types demonstrated:</h3>
        <ul>
          <li>Plain string: {m.greeting()}</li>
          <li>Interpolation: {m.user_greeting({ name: "Bob" })}</li>
          {/* @ts-ignore */}
          <li>Plurals (1): {m.items_count({ count: 1 })}</li>
          {/* @ts-ignore */}
          <li>Plurals (5): {m.items_count({ count: 5 })}</li>
        </ul>
      </div>
    </div>
  );
}
