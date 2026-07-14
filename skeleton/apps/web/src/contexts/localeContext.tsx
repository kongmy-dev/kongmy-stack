import {
  createContext,
  ReactNode,
  useState,
  useContext,
  useEffect,
} from "react";
import {
  setLanguageTag,
  languageTag,
  onSetLanguageTag,
  availableLanguageTags,
} from "../paraglide/runtime";

type Locale = ReturnType<typeof languageTag>;
const isLocale = (v: string): v is Locale =>
  (availableLanguageTags as readonly string[]).includes(v);

type LocaleContextType = {
  locale: Locale;
  setCurrentLocale: (locale: string) => void;
  availableLocales: readonly Locale[];
};

const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

/**
 * LocaleProvider sets up Paraglide i18n context.
 *
 * Locale resolution follows ADR-0007: user → tenant → en (default)
 * This prototype uses localStorage; production wires session hook + tenant settings.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => languageTag());
  const availableLocales = availableLanguageTags;

  const setCurrentLocale = (newLocale: string) => {
    if (isLocale(newLocale)) {
      setLanguageTag(newLocale);
      setLocaleState(newLocale);
      localStorage.setItem("locale", newLocale);
    }
  };

  // Set up callback to trigger re-render when language tag changes
  useEffect(() => {
    onSetLanguageTag((tag) => {
      setLocaleState(tag);
    });
  }, []);

  // Initialize from localStorage
  useEffect(() => {
    const savedLocale = localStorage.getItem("locale");
    if (savedLocale && isLocale(savedLocale)) {
      setCurrentLocale(savedLocale);
    }
  }, []);

  return (
    <LocaleContext.Provider
      value={{ locale, setCurrentLocale, availableLocales }}
    >
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return context;
}
