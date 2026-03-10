/**
 * PasswordGate — Simple client-side password protection
 * Design: Dark Precision — matches the dashboard aesthetic
 *
 * Password is stored in localStorage (persists across sessions).
 * Default password is "A" on first use.
 * Unlock state is stored in sessionStorage (cleared when browser tab closes).
 *
 * Password manager support: proper <form>, id, name, and autocomplete attributes
 * allow 1Password, Bitwarden, Safari Passwords, etc. to detect and autofill.
 */

import { useState, useEffect } from "react";

const DEFAULT_PASSWORD = "*c@6$2gZaFUxzu3y";
const SESSION_KEY = "tfr_auth_v2";
const PASSWORD_KEY = "tfr_password_v2";

/** Get the current password from localStorage, falling back to default */
export function getStoredPassword(): string {
  return localStorage.getItem(PASSWORD_KEY) ?? DEFAULT_PASSWORD;
}

/** Save a new password to localStorage */
export function setStoredPassword(newPassword: string): void {
  localStorage.setItem(PASSWORD_KEY, newPassword);
}

export default function PasswordGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [shaking, setShaking] = useState(false);

  // Check sessionStorage on mount
  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY) === "1") {
      setUnlocked(true);
    }
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input === getStoredPassword()) {
      sessionStorage.setItem(SESSION_KEY, "1");
      setUnlocked(true);
    } else {
      setError(true);
      setShaking(true);
      setInput("");
      setTimeout(() => setShaking(false), 600);
    }
  }

  if (unlocked) return <>{children}</>;

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "oklch(0.10 0.010 260)" }}
    >
      {/* Subtle background grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: "linear-gradient(oklch(1 0 0) 1px, transparent 1px), linear-gradient(90deg, oklch(1 0 0) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <img
            src="https://d2xsxph8kpxj0f.cloudfront.net/310519663335455300/f7qptPGnBE9WgCNPQkiCv7/tfr-logo-modern-v3_cdeb8880.png"
            alt="The Financial Revolution"
            className="w-40 h-40 object-contain"
          />
          <p className="text-xs text-muted-foreground mt-1">Private strategy dashboard</p>
        </div>

        {/* Password form — proper semantics for password manager detection */}
        <form
          onSubmit={handleSubmit}
          method="post"
          action="#"
          className={`flex flex-col gap-4 w-72 ${shaking ? "animate-[shake_0.5s_ease-in-out]" : ""}`}
          style={{
            animation: shaking ? "shake 0.5s ease-in-out" : undefined,
          }}
        >
          {/*
            Hidden username field: password managers (1Password, Bitwarden, Safari)
            require a username field to associate the credential with a site.
            We use a fixed value since this is a single-user dashboard.
          */}
          <input
            type="text"
            id="tfr-username"
            name="username"
            autoComplete="username"
            value="tfr-dashboard"
            readOnly
            aria-hidden="true"
            style={{ display: "none" }}
          />

          <div className="relative">
            <input
              id="tfr-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(false); }}
              placeholder="Enter password"
              autoFocus
              className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder:text-muted-foreground/40 outline-none transition-all"
              style={{
                background: "oklch(0.15 0.012 260)",
                border: error
                  ? "1px solid oklch(0.62 0.22 25 / 60%)"
                  : "1px solid oklch(1 0 0 / 12%)",
                boxShadow: error
                  ? "0 0 0 3px oklch(0.62 0.22 25 / 10%)"
                  : input
                  ? "0 0 0 3px oklch(0.60 0.22 255 / 10%)"
                  : "none",
                fontFamily: "JetBrains Mono, monospace",
                letterSpacing: "0.2em",
              }}
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 text-center -mt-2">
              Incorrect password. Try again.
            </p>
          )}

          <button
            type="submit"
            className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
            style={{
              fontFamily: "Syne, sans-serif",
              background: "oklch(0.60 0.22 255)",
              boxShadow: "0 4px 20px oklch(0.60 0.22 255 / 30%)",
            }}
          >
            Unlock
          </button>
        </form>

        <p className="text-xs text-muted-foreground/30">
          Access restricted · The Financial Revolution
        </p>
      </div>

      {/* Shake keyframe */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          15% { transform: translateX(-8px); }
          30% { transform: translateX(8px); }
          45% { transform: translateX(-6px); }
          60% { transform: translateX(6px); }
          75% { transform: translateX(-4px); }
          90% { transform: translateX(4px); }
        }
      `}</style>
    </div>
  );
}
