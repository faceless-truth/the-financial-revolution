/**
 * PasswordGate — Client-side password protection
 *
 * Works in ALL browsers including Safari Private Browsing, Brave, Firefox strict mode.
 * Uses in-memory state (module-level variable) as the source of truth so it never
 * depends on localStorage or sessionStorage. The password is hardcoded as a SHA-256
 * hash so it cannot be read from the bundle without knowing the original value.
 *
 * "Remember me" (30 days): stored in localStorage with a try/catch fallback so it
 * degrades gracefully when storage is blocked (Safari Private).
 *
 * Password manager support: proper <form>, id, name, and autocomplete attributes.
 */

import { useState } from "react";
import { sha256 } from "@/lib/sha256";
import { getCurrentHash } from "./ChangePasswordModal";

// In-memory unlock flag — survives re-renders but resets on page reload
// (unless "remember me" is active)
let _memoryUnlocked = false;

const REMEMBER_KEY = "tfr_remember_v1";
const REMEMBER_DAYS = 30;

function tryGetRemembered(): boolean {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return false;
    const { expiry } = JSON.parse(raw);
    if (Date.now() > expiry) {
      localStorage.removeItem(REMEMBER_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function trySetRemembered() {
  try {
    localStorage.setItem(
      REMEMBER_KEY,
      JSON.stringify({ expiry: Date.now() + REMEMBER_DAYS * 86400_000 })
    );
  } catch {
    // Safari Private — silently ignore; in-memory state still works for the session
  }
}

function tryClearRemembered() {
  try {
    localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // ignore
  }
}

export function lockDashboard() {
  _memoryUnlocked = false;
  tryClearRemembered();
  window.location.reload();
}

export default function PasswordGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(() => {
    if (_memoryUnlocked) return true;
    if (tryGetRemembered()) {
      _memoryUnlocked = true;
      return true;
    }
    return false;
  });

  const [input, setInput] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [checking, setChecking] = useState(false);

  // Already unlocked — render children immediately
  if (unlocked) return <>{children}</>;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setError(false);
    setChecking(true);

    const hash = await sha256(input.trim());
    setChecking(false);

    if (hash === getCurrentHash()) {
      _memoryUnlocked = true;
      if (remember) trySetRemembered();
      setUnlocked(true);
    } else {
      setError(true);
      setShaking(true);
      setInput("");
      setTimeout(() => setShaking(false), 600);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "oklch(0.10 0.010 260)" }}
    >
      {/* Subtle background grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(oklch(1 0 0) 1px, transparent 1px), linear-gradient(90deg, oklch(1 0 0) 1px, transparent 1px)",
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

        {/* Password form */}
        <form
          onSubmit={handleSubmit}
          method="post"
          action="#"
          className="flex flex-col gap-4 w-72"
          style={{
            animation: shaking ? "shake 0.5s ease-in-out" : undefined,
          }}
        >
          {/* Hidden username for password manager association */}
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
              onChange={(e) => {
                setInput(e.target.value);
                setError(false);
              }}
              placeholder="Enter password"
              autoFocus
              disabled={checking}
              className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder:text-muted-foreground/40 outline-none transition-all disabled:opacity-50"
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

          {/* Remember me */}
          <label className="flex items-center gap-2 cursor-pointer select-none -mt-1">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-blue-500"
            />
            <span className="text-xs text-muted-foreground">Remember me for 30 days</span>
          </label>

          <button
            type="submit"
            disabled={checking}
            className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
            style={{
              fontFamily: "Syne, sans-serif",
              background: "oklch(0.60 0.22 255)",
              boxShadow: "0 4px 20px oklch(0.60 0.22 255 / 30%)",
            }}
          >
            {checking ? "Checking…" : "Unlock"}
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
