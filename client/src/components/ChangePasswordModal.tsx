/**
 * ChangePasswordModal — lets the user change their dashboard password from inside the app
 * Validates current password server-side (bcrypt), then saves the new hash to the DB.
 *
 * Password manager support: proper id, name, and autocomplete attributes allow
 * 1Password, Bitwarden, Safari Passwords, etc. to offer to save the new credential.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { X, Lock, CheckCircle } from "lucide-react";

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

  const changePasswordMutation = trpc.password.changePassword.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        setSuccess(true);
        setTimeout(() => {
          reset();
          onClose();
        }, 1800);
      } else {
        setError(data.error ?? "Failed to change password.");
      }
    },
    onError: () => {
      setError("Something went wrong. Please try again.");
    },
  });

  function reset() {
    setCurrent("");
    setNewPw("");
    setConfirm("");
    setError(null);
    setSuccess(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
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

    changePasswordMutation.mutate({ currentPassword: current, newPassword: newPw });
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "oklch(0 0 0 / 70%)" }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
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
            <h2 className="text-sm font-bold text-white" style={{ fontFamily: "Syne, sans-serif" }}>
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
            <p className="text-sm font-semibold text-emerald-400">Password updated successfully</p>
            <p className="text-xs text-muted-foreground text-center">Your new password is active. Use it next time you unlock the dashboard.</p>
          </div>
        ) : (
          /*
            method="post" + action="#" + proper autocomplete values tell password managers
            (1Password, Bitwarden, Safari, Chrome) that this is a real password-change form
            and prompts them to update the saved credential.
          */
          <form onSubmit={handleSubmit} method="post" action="#" className="flex flex-col gap-4">
            {/* Hidden username so password managers can match the credential */}
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
              <label htmlFor="cp-current" className="text-xs text-muted-foreground">Current Password</label>
              <input
                id="cp-current"
                name="current-password"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => { setCurrent(e.target.value); setError(null); }}
                placeholder="Enter current password"
                autoFocus
                disabled={changePasswordMutation.isPending}
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
              <label htmlFor="cp-new" className="text-xs text-muted-foreground">New Password</label>
              <input
                id="cp-new"
                name="new-password"
                type="password"
                autoComplete="new-password"
                value={newPw}
                onChange={(e) => { setNewPw(e.target.value); setError(null); }}
                placeholder="Enter new password"
                disabled={changePasswordMutation.isPending}
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
              <label htmlFor="cp-confirm" className="text-xs text-muted-foreground">Confirm New Password</label>
              <input
                id="cp-confirm"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => { setConfirm(e.target.value); setError(null); }}
                placeholder="Repeat new password"
                disabled={changePasswordMutation.isPending}
                className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder:text-muted-foreground/40 outline-none transition-all disabled:opacity-50"
                style={{
                  background: "oklch(0.10 0.010 260)",
                  border: error && error.includes("match")
                    ? "1px solid oklch(0.62 0.22 25 / 60%)"
                    : "1px solid oklch(1 0 0 / 12%)",
                  fontFamily: "JetBrains Mono, monospace",
                  letterSpacing: "0.15em",
                }}
              />
            </div>

            {error && (
              <p className="text-xs text-red-400 -mt-2">{error}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleClose}
                disabled={changePasswordMutation.isPending}
                className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-muted-foreground transition-all hover:text-foreground disabled:opacity-50"
                style={{ background: "oklch(1 0 0 / 6%)", border: "1px solid oklch(1 0 0 / 10%)" }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={changePasswordMutation.isPending}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
                style={{
                  background: "oklch(0.60 0.22 255)",
                  boxShadow: "0 4px 16px oklch(0.60 0.22 255 / 25%)",
                }}
              >
                {changePasswordMutation.isPending ? "Saving…" : "Update Password"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
