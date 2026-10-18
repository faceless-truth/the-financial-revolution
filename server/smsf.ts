/**
 * Scarton SMSF — Server Data Adapter
 * ─────────────────────────────────────────────────────────────────────────────
 * Serves the payload written by `scripts/smsf_trend.py` (monthly 12-month
 * average rule: today's signals per holding plus the historical backtest).
 * Pass-through only; every rendered field is emitted by the Python producer.
 *
 * Source file (under CRYPTO_DASHBOARD_ROOT): data/public/smsf_dashboard.json
 */

import fs from "fs/promises";
import path from "path";

const DASHBOARD_ROOT = process.env.CRYPTO_DASHBOARD_ROOT ?? "/root/crypto_dashboard";
const SMSF_FILE =
  process.env.SMSF_PAYLOAD_FILE ?? path.join(DASHBOARD_ROOT, "data", "public", "smsf_dashboard.json");

export async function getSmsfDashboard(): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await fs.readFile(SMSF_FILE, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.available === true) return parsed;
    return { available: false };
  } catch {
    return { available: false };
  }
}
