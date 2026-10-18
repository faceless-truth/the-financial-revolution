/**
 * OwnerGate — the single site login.
 *
 * Replaces the old browser-only PasswordGate. The password is checked on the
 * server (/api/bybit/login) and the session lives in an HttpOnly cookie, so
 * every data route (/api/*) is protected server-side, not just hidden.
 * If any data request later answers 401, the session has expired and the
 * login screen comes back.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type GateState = "checking" | "signed_out" | "not_configured" | "signed_in" | "offline";

const requestOptions = { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } } as const;

const OwnerContext = createContext<{ signOut: () => Promise<void> }>({ signOut: async () => {} });
export const useOwner = () => useContext(OwnerContext);

/** Pure: does a failed same-origin API response mean the owner session ended? */
export function isSessionExpiry(url: string, status: number, origin: string): boolean {
  if (status !== 401) return false;
  let path: string;
  try {
    const parsed = new URL(url, origin);
    if (parsed.origin !== origin) return false;
    path = parsed.pathname;
  } catch {
    return false;
  }
  return path.startsWith("/api/") && path !== "/api/bybit/login";
}

export default function OwnerGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signedIn = useRef(false);

  const checkSession = useCallback(async () => {
    try {
      const response = await fetch("/api/bybit/session", requestOptions);
      if (!response.ok) throw new Error(String(response.status));
      const result: { authenticated?: boolean; login_configured?: boolean } = await response.json();
      if (result.login_configured !== true) setState("not_configured");
      else setState(result.authenticated === true ? "signed_in" : "signed_out");
    } catch {
      setState("offline");
    }
  }, []);

  useEffect(() => { void checkSession(); }, [checkSession]);
  useEffect(() => { signedIn.current = state === "signed_in"; }, [state]);

  // Drop back to the login screen when any data request reports an expired session.
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await original(...args);
      const input = args[0];
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (signedIn.current && isSessionExpiry(url, response.status, window.location.origin)) {
        signedIn.current = false;
        setError("Your session ended. Sign in again.");
        setState("signed_out");
      }
      return response;
    };
    return () => { window.fetch = original; };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/bybit/logout", { ...requestOptions, method: "POST" });
    } finally {
      signedIn.current = false;
      setError(null);
      setState("signed_out");
    }
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const length = Array.from(password).length;
    if (busy) return;
    if (length < 12 || length > 256) {
      setError("That password is too short. Use your dashboard password (12 characters or more).");
      return;
    }
    const body = JSON.stringify({ password });
    setPassword("");
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/bybit/login", {
        ...requestOptions, method: "POST",
        headers: { ...requestOptions.headers, "Content-Type": "application/json" }, body,
      });
      if (response.status === 429) setError("Too many attempts. Wait a few minutes and try again.");
      else if (response.status === 503) setState("not_configured");
      else if (!response.ok) setError("That password wasn't accepted. Try again.");
      else await checkSession();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "signed_in") {
    return <OwnerContext.Provider value={{ signOut }}>{children}</OwnerContext.Provider>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "oklch(0.10 0.010 260)" }}>
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(oklch(1 0 0) 1px, transparent 1px), linear-gradient(90deg, oklch(1 0 0) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div className="relative z-10 flex flex-col items-center gap-8 px-4">
        <div className="flex flex-col items-center gap-3">
          <img
            src="https://d2xsxph8kpxj0f.cloudfront.net/310519663335455300/f7qptPGnBE9WgCNPQkiCv7/tfr-logo-modern-v3_cdeb8880.png"
            alt="The Financial Revolution"
            className="w-40 h-40 object-contain"
          />
          <p className="text-xs text-muted-foreground mt-1">Private strategy dashboard</p>
        </div>

        {state === "checking" && <p className="text-sm text-muted-foreground">Checking your session…</p>}

        {state === "offline" && (
          <div className="flex flex-col items-center gap-3 w-72 text-center">
            <p className="text-sm text-muted-foreground">Couldn't reach the server.</p>
            <button type="button" onClick={() => { setState("checking"); void checkSession(); }}
              className="px-4 py-2 rounded-xl text-sm font-bold text-white" style={{ background: "oklch(0.60 0.22 255)" }}>
              Try again
            </button>
          </div>
        )}

        {state === "not_configured" && (
          <p className="text-sm text-muted-foreground w-72 text-center">
            Sign-in isn't set up on the server yet. Set the owner password with the server setup command, then reload.
          </p>
        )}

        {state === "signed_out" && (
          <form onSubmit={handleSubmit} method="post" action="#" className="flex flex-col gap-4 w-72">
            {/* Username for password-manager association */}
            <input type="text" id="tfr-username" name="username" autoComplete="username"
              value="tfr-dashboard" readOnly aria-hidden="true" style={{ display: "none" }} />
            <input
              id="tfr-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null); }}
              placeholder="Password"
              autoFocus
              disabled={busy}
              className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder:text-muted-foreground/40 outline-none transition-all disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-500"
              style={{
                background: "oklch(0.15 0.012 260)",
                border: error ? "1px solid oklch(0.62 0.22 25 / 60%)" : "1px solid oklch(1 0 0 / 12%)",
                fontFamily: "JetBrains Mono, monospace",
                letterSpacing: "0.2em",
              }}
            />
            {error && <p className="text-xs text-red-400 text-center -mt-2" role="alert">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
              style={{ fontFamily: "Syne, sans-serif", background: "oklch(0.60 0.22 255)", boxShadow: "0 4px 20px oklch(0.60 0.22 255 / 30%)" }}
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <p className="text-[11px] text-muted-foreground text-center">Stays signed in for 8 hours on this device.</p>
          </form>
        )}
      </div>
    </div>
  );
}
