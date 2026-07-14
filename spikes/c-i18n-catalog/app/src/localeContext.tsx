import { createContext, ReactNode, useState, useContext, useEffect } from "react";
import { setLanguageTag, languageTag, onSetLanguageTag } from "./paraglide/runtime";

type LocaleContextType = {
  locale: string;
  setCurrentLocale: (locale: string) => void;
  availableLocales: string[];
};

const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState(() => languageTag());
  const availableLocales = ["en", "ms", "zh"];

  const setCurrentLocale = (newLocale: string) => {
    if (availableLocales.includes(newLocale)) {
      // @ts-ignore - Paraglide type is overly strict
      setLanguageTag(newLocale);
      // @ts-ignore - Paraglide type is overly strict
      setLocaleState(newLocale);
      // Persist to localStorage for demo purposes
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
    if (savedLocale && availableLocales.includes(savedLocale)) {
      setCurrentLocale(savedLocale);
    }
  }, []);

  return (
    <LocaleContext.Provider value={{ locale, setCurrentLocale, availableLocales }}>
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
