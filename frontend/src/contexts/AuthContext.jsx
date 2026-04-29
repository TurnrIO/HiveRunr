import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api } from "../api/client.js";

/**
 * AuthContext — provides the currently authenticated user to the whole app.
 *
 * Consumed via `useAuth()`.
 *
 * Shape:
 *   currentUser    {object|null} — user object from GET /api/auth/me
 *                                  { id, username, role, email }
 *   encryptionOk   {boolean}     — whether SECRET_KEY is properly configured
 *   refreshUser    {function}    — re-fetch /api/auth/me
 *   logout         {function}    — POST /api/auth/logout + redirect to /login
 */

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [encryptionOk, setEncryptionOk] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const u = await api("GET", "/api/auth/me");
      setCurrentUser(u || null);
    } catch (_) {
      setCurrentUser(null);
    }
  }, []);

  useEffect(() => {
    refreshUser();
    api("GET", "/api/auth/status")
      .then((s) => { if (s) setEncryptionOk(!!s.encryption_configured); })
      .catch(() => {});
  }, [refreshUser]);

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch (_) {}
    window.location.href = "/login";
  }

  return (
    <AuthContext.Provider value={{ currentUser, encryptionOk, refreshUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Hook — use inside any component wrapped by AuthProvider. */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
