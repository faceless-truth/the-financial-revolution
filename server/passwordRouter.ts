/**
 * passwordRouter — server-side dashboard password verification
 *
 * The password is stored as a bcrypt hash in the app_settings table.
 * On successful verification, an httpOnly cookie is set so the unlock state
 * persists across page reloads and works in Safari Private Browsing, Brave,
 * Firefox strict mode, and any other browser that blocks localStorage.
 *
 * Cookie name: tfr_gate_v1
 * Cookie value: a signed JWT containing { unlocked: true }
 */

import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { getAppSetting, setAppSetting } from "./db";
import { ENV } from "./_core/env";
import { publicProcedure, router } from "./_core/trpc";
import type { CookieOptions } from "express";

const GATE_COOKIE = "tfr_gate_v1";
const DEFAULT_PASSWORD = "*c@6$2gZaFUxzu3y";
const SETTING_KEY = "dashboard_password_hash";

function getSecret() {
  return new TextEncoder().encode(ENV.cookieSecret || "tfr-fallback-secret-change-me");
}

function getGateCookieOptions(req: { headers: Record<string, string | string[] | undefined> }): CookieOptions {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const isHttps = Array.isArray(forwardedProto)
    ? forwardedProto.some(p => p.trim() === "https")
    : typeof forwardedProto === "string"
    ? forwardedProto.trim() === "https"
    : false;

  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isHttps || ENV.isProduction,
    maxAge: 60 * 60 * 24 * 30, // 30 days
  };
}

async function signGateToken(): Promise<string> {
  return new SignJWT({ unlocked: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(getSecret());
}

async function verifyGateToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload.unlocked === true;
  } catch {
    return false;
  }
}

async function getPasswordHash(): Promise<string> {
  const stored = await getAppSetting(SETTING_KEY);
  if (stored) return stored;
  // First run: hash the default password and store it
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  await setAppSetting(SETTING_KEY, hash);
  return hash;
}

export const passwordRouter = router({
  /** Check if the current request is already unlocked via cookie */
  checkGate: publicProcedure.query(async ({ ctx }) => {
    const token = ctx.req.cookies?.[GATE_COOKIE];
    if (!token) return { unlocked: false };
    const valid = await verifyGateToken(token);
    return { unlocked: valid };
  }),

  /** Verify the dashboard password and set the gate cookie on success */
  unlock: publicProcedure
    .input(z.object({ password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const hash = await getPasswordHash();
      const match = await bcrypt.compare(input.password, hash);
      if (!match) {
        return { success: false as const };
      }
      const token = await signGateToken();
      ctx.res.cookie(GATE_COOKIE, token, getGateCookieOptions(ctx.req as any));
      return { success: true as const };
    }),

  /** Change the dashboard password (requires knowing the current password) */
  changePassword: publicProcedure
    .input(z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const hash = await getPasswordHash();
      const match = await bcrypt.compare(input.currentPassword, hash);
      if (!match) {
        return { success: false as const, error: "Current password is incorrect." };
      }
      const newHash = await bcrypt.hash(input.newPassword, 10);
      await setAppSetting(SETTING_KEY, newHash);
      // Re-issue cookie so the session stays valid after password change
      const token = await signGateToken();
      ctx.res.cookie(GATE_COOKIE, token, getGateCookieOptions(ctx.req as any));
      return { success: true as const };
    }),

  /** Clear the gate cookie (lock the dashboard) */
  lock: publicProcedure.mutation(({ ctx }) => {
    ctx.res.clearCookie(GATE_COOKIE, { path: "/" });
    return { success: true as const };
  }),
});
