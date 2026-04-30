import { createContext, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "hr_theme";

function getSystemTheme() {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function getStoredTheme() {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : null;
}

export function getInitialTheme() {
  return getStoredTheme() || getSystemTheme();
}

export function applyTheme(theme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [systemTheme, setSystemTheme] = useState(getSystemTheme);
  const [themePreference, setThemePreference] = useState(getStoredTheme);
  const theme = themePreference || systemTheme;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (themePreference) window.localStorage.setItem(STORAGE_KEY, themePreference);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, [themePreference]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    function syncSystemTheme() {
      setSystemTheme(media.matches ? "light" : "dark");
    }
    media.addEventListener?.("change", syncSystemTheme);
    return () => media.removeEventListener?.("change", syncSystemTheme);
  }, []);

  const value = useMemo(() => ({
    theme,
    isDark: theme === "dark",
    setTheme: setThemePreference,
    clearThemePreference: () => setThemePreference(null),
    toggleTheme: () => setThemePreference(theme === "dark" ? "light" : "dark"),
  }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
