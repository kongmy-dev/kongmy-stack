import { useLocale } from "./localeContext";
import * as m from "./paraglide/messages";

export function LocaleSwitcher() {
  const { locale, setCurrentLocale, availableLocales } = useLocale();

  const localeNames: Record<string, string> = {
    en: "English",
    ms: "Melayu",
    zh: "中文",
  };

  return (
    <div style={{ marginBottom: "1rem", padding: "1rem", backgroundColor: "#f0f0f0" }}>
      <label>
        {m.locale_label()}
        <select
          value={locale}
          onChange={(e) => setCurrentLocale(e.target.value)}
          style={{ marginLeft: "0.5rem" }}
        >
          {availableLocales.map((l) => (
            <option key={l} value={l}>
              {localeNames[l] || l}
            </option>
          ))}
        </select>
      </label>
      <p style={{ marginTop: "0.5rem", fontSize: "0.9rem", color: "#666" }}>
        Current locale: <strong>{locale}</strong>
      </p>
    </div>
  );
}
