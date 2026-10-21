/**
 * Scarton SMSF — Server Data Adapter
 * ─────────────────────────────────────────────────────────────────────────────
 * Serves the payload written by `scripts/smsf_trend.py` (monthly 12-month
 * average rule: today's signals per holding plus the historical backtest).
 * Pass-through only; every rendered field is emitted by the Python producer.
 *
 * Source files (under CRYPTO_DASHBOARD_ROOT): data/public/smsf_dashboard.json,
 * and data/public/smsf_report.pdf from `scripts/smsf_report.py`.
 */

import fs from "fs/promises";
import path from "path";

const DASHBOARD_ROOT = process.env.CRYPTO_DASHBOARD_ROOT ?? "/root/crypto_dashboard";
const SMSF_FILE =
  process.env.SMSF_PAYLOAD_FILE ?? path.join(DASHBOARD_ROOT, "data", "public", "smsf_dashboard.json");

export const SMSF_REPORT_FILE =
  process.env.SMSF_REPORT_FILE ?? path.join(DASHBOARD_ROOT, "data", "public", "smsf_report.pdf");

export async function getSmsfDashboard(): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await fs.readFile(SMSF_FILE, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.available === true) return parsed;
    return { available: false };
  } catch {
    return { available: false };
  }
}
