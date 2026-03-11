/**
 * PasswordGate — Server-side password protection
 *
 * Password is verified server-side (bcrypt hash stored in DB).
 * Unlock state is stored in an httpOnly cookie so it works in:
 *   - Safari Private Browsing
 *   - Brave (aggressive shields)
 *   - Firefox strict ETP
 *   - Any browser that blocks localStorage
 *
 * The cookie lasts 30 days so you stay logged in across sessions.
 * Password manager support: proper <form>, id, name, and autocomplete attributes.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";

export default function PasswordGate({ children }: { children: React.ReactNode }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [shaking, setShaking] = useState(false);

  // Check server-side gate cookie on mount
  const { data: gateData, isLoading: gateLoading } = trpc.password.checkGate.useQuery(undefined, {
    retry: false,
    staleTime: Infinity,
  });

  const utils = trpc.useUtils();

  const unlockMutation = trpc.password.unlock.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        // Invalidate the gate check so it re-fetches and shows the dashboard
        utils.password.checkGate.invalidate();
      } else {
        setError(true);
        setShaking(true);
        setInput("");
        setTimeout(() => setShaking(false), 600);
      }
    },
    onError: () => {
      setError(true);
      setShaking(true);
      setInput("");
      setTimeout(() => setShaking(false), 600);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setError(false);
    unlockMutation.mutate({ password: input });
  }

  // Show nothing while checking the cookie (fast — just a server round-trip)
  if (gateLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "oklch(0.10 0.010 260)" }}
      />
    );
  }

  // Already unlocked via cookie
  if (gateData?.unlocked) return <>{children}</>;

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
              disabled={unlockMutation.isPending}
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

          <button
            type="submit"
            disabled={unlockMutation.isPending}
            className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
            style={{
              fontFamily: "Syne, sans-serif",
              background: "oklch(0.60 0.22 255)",
              boxShadow: "0 4px 20px oklch(0.60 0.22 255 / 30%)",
            }}
          >
            {unlockMutation.isPending ? "Unlocking…" : "Unlock"}
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
