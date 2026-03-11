/**
 * ChangePasswordModal — lets the user change their dashboard password.
 *
 * Since the password gate is client-side, "changing" the password means:
 * 1. Verify the current password matches the stored hash
 * 2. Store the new password hash in localStorage (with try/catch for Safari Private)
 * 3. Update the in-memory hash so the current session stays unlocked
 *
 * Password manager support: proper id, name, and autocomplete attributes.
 */

import { useState } from "react";
import { X, Lock, CheckCircle } from "lucide-react";
import { sha256 } from "@/lib/sha256";

// This key stores the user's custom password hash in localStorage.
// If absent, the default hardcoded hash in PasswordGate is used.
export const CUSTOM_HASH_KEY = "tfr_pw_hash_v1";

// Default hash (TFR2026) — must match PasswordGate.tsx PASSWORD_HASH
const DEFAULT_HASH = "e773972be28a7d8545e37e55b86ea8cd40750cacf341f441c3ea5cc78ba31cc1";

export function getCurrentHash(): string {
  try {
    return localStorage.getItem(CUSTOM_HASH_KEY) ?? DEFAULT_HASH;
  } catch {
    return DEFAULT_HASH;
  }
}

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
}

export function ChangePasswordModal({ open, onClose }: ChangePasswordModalProps) {
  const [current, setCurrent] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  function reset() {
    setCurrent("");
    setNewPw("");
    setConfirm("");
    setError(null);
    setSuccess(false);
    setSaving(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPw.length < 1) {
      setError("New password cannot be empty.");
      return;
    }
    if (newPw !== confirm) {
      setError("New passwords do not match.");
      return;
    }

    setSaving(true);
    const currentHash = await sha256(current.trim());
    const storedHash = getCurrentHash();

    if (currentHash !== storedHash) {
      setSaving(false);
      setError("Current password is incorrect.");
      return;
    }

    const newHash = await sha256(newPw.trim());
    try {
      localStorage.setItem(CUSTOM_HASH_KEY, newHash);
    } catch {
      // Safari Private — hash is only in memory for this session
    }

    setSaving(false);
    setSuccess(true);
    setTimeout(() => {
      reset();
      onClose();
    }, 1800);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "oklch(0 0 0 / 70%)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl p-6 flex flex-col gap-5"
        style={{
          background: "oklch(0.13 0.012 260)",
          border: "1px solid oklch(1 0 0 / 10%)",
          boxShadow: "0 24px 60px oklch(0 0 0 / 60%)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock size={16} style={{ color: "oklch(0.60 0.22 255)" }} />
            <h2
              className="text-sm font-bold text-white"
              style={{ fontFamily: "Syne, sans-serif" }}
            >
              Change Password
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:opacity-70"
            style={{ background: "oklch(1 0 0 / 8%)" }}
          >
            <X size={14} className="text-muted-foreground" />
          </button>
        </div>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <CheckCircle size={36} className="text-emerald-400" />
            <p className="text-sm font-semibold text-emerald-400">
              Password updated successfully
            </p>
            <p className="text-xs text-muted-foreground text-center">
              Your new password is active. Use it next time you unlock the dashboard.
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            method="post"
            action="#"
            className="flex flex-col gap-4"
          >
            {/* Hidden username for password manager */}
            <input
              type="text"
              id="cp-username"
              name="username"
              autoComplete="username"
              value="tfr-dashboard"
              readOnly
              aria-hidden="true"
              style={{ display: "none" }}
            />

            {/* Current password */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cp-current" className="text-xs text-muted-foreground">
                Current Password
              </label>
              <input
                id="cp-current"
                name="current-password"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => {
                  setCurrent(e.target.value);
                  setError(null);
                }}
                placeholder="Enter current password"
                autoFocus
                disabled={saving}
                className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder:text-muted-foreground/40 outline-none transition-all disabled:opacity-50"
                style={{
                  background: "oklch(0.10 0.010 260)",
                  border: "1px solid oklch(1 0 0 / 12%)",
                  fontFamily: "JetBrains Mono, monospace",
                  letterSpacing: "0.15em",
                }}
              />
            </div>

            {/* New password */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cp-new" className="text-xs text-muted-foreground">
                New Password
              </label>
              <input
                id="cp-new"
                name="new-password"
                type="password"
                autoComplete="new-password"
                value={newPw}
                onChange={(e) => {
                  setNewPw(e.target.value);
                  setError(null);
                }}
                placeholder="Enter new password"
                disabled={saving}
                className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder:text-muted-foreground/40 outline-none transition-all disabled:opacity-50"
                style={{
                  background: "oklch(0.10 0.010 260)",
                  border: "1px solid oklch(1 0 0 / 12%)",
                  fontFamily: "JetBrains Mono, monospace",
                  letterSpacing: "0.15em",
                }}
              />
            </div>

            {/* Confirm new password */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cp-confirm" className="text-xs text-muted-foreground">
                Confirm New Password
              </label>
              <input
                id="cp-confirm"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setError(null);
                }}
                placeholder="Repeat new password"
                disabled={saving}
                className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder:text-muted-foreground/40 outline-none transition-all disabled:opacity-50"
                style={{
                  background: "oklch(0.10 0.010 260)",
                  border:
                    error && error.includes("match")
                      ? "1px solid oklch(0.62 0.22 25 / 60%)"
                      : "1px solid oklch(1 0 0 / 12%)",
                  fontFamily: "JetBrains Mono, monospace",
                  letterSpacing: "0.15em",
                }}
              />
            </div>

            {error && <p className="text-xs text-red-400 -mt-2">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleClose}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-muted-foreground transition-all hover:text-foreground disabled:opacity-50"
                style={{
                  background: "oklch(1 0 0 / 6%)",
                  border: "1px solid oklch(1 0 0 / 10%)",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
                style={{
                  background: "oklch(0.60 0.22 255)",
                  boxShadow: "0 4px 16px oklch(0.60 0.22 255 / 25%)",
                }}
              >
                {saving ? "Saving…" : "Update Password"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
