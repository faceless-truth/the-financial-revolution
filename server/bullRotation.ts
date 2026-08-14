/**
 * Bull Rotation Dashboard — Server Data Adapter
 * ─────────────────────────────────────────────────────────────────────────────
 * Serves the consolidated dashboard payload produced by the Python script
 * `generate_dashboard_payload.py` on the droplet. That script reads the live
 * bull_rotate state/history/MSB files and emits a single self-describing JSON
 * with: btc_7d closes, current status, entry/exit rules, next-move forecast,
 * params, the full daily decision history, the permanent trade records for both
 * Telegram-alerting strategies (Bull Rotation round-trips and the 4h scalp
 * tracker), and learning content.
 *
 * Per the project rule, every field rendered by the UI is emitted upstream by
 * the Python producer — this adapter only reads and passes it through, with a
 * safe fallback so the endpoint never throws.
 *
 * Source file (under CRYPTO_DASHBOARD_ROOT): data/public/dashboard_payload.json
 */

import fs from "fs/promises";
import path from "path";

const DASHBOARD_ROOT = process.env.CRYPTO_DASHBOARD_ROOT ?? "/root/crypto_dashboard";
const PAYLOAD_FILE =
  process.env.BULL_ROTATION_PAYLOAD_FILE ??
  path.join(DASHBOARD_ROOT, "data", "public", "dashboard_payload.json");

export interface BtcClose {
  date: string;
  close: number;
}

export interface ForecastCondition {
  label: string;
  detail: string;
  distance_pct: number | null;
}

export interface BullRotationPayload {
  generated_at: string | null;
  as_of_date: string | null;
  strategy_version: string;
  btc_7d: BtcClose[];
  btc_7d_source: string;
  status: Record<string, any>;
  rules: { entry: string[]; exit: string[] };
  forecast: {
    mode: string;
    headline: string;
    conditions: ForecastCondition[];
    eta: string;
  };
  params: Record<string, any>;
  history: Array<Record<string, any>>;
  trades: TradeRecord;
  scalp: ScalpRecord;
  learning: Record<string, any>;
  available: boolean;
}

/** Bull Rotation's permanent trade record — one entry per completed round-trip,
 *  derived by trade_ledger.py from the same daily decisions that are sent to
 *  Telegram. Returns are priced from the canonical daily bars. */
export interface TradeRecord {
  first_date: string | null;
  last_date: string | null;
  days_recorded: number;
  closed_trades: Array<Record<string, any>>;
  open_trade: Record<string, any> | null;
  cash_periods: Array<Record<string, any>>;
  stats: Record<string, any>;
}

/** The 4h scalp tracker's own record, results in R (risk multiples). */
export interface ScalpRecord {
  available: boolean;
  closed_trades: Array<Record<string, any>>;
  open_positions: Array<Record<string, any>>;
  stats: Record<string, any>;
  first_date: string | null;
  last_date: string | null;
}

const EMPTY: BullRotationPayload = {
  generated_at: null,
  as_of_date: null,
  strategy_version: "v4.1",
  btc_7d: [],
  btc_7d_source: "none",
  status: {},
  rules: { entry: [], exit: [] },
  forecast: { mode: "UNKNOWN", headline: "Strategy data is not available yet.", conditions: [], eta: "" },
  params: {},
  history: [],
  trades: {
    first_date: null, last_date: null, days_recorded: 0,
    closed_trades: [], open_trade: null, cash_periods: [], stats: {},
  },
  scalp: {
    available: false, closed_trades: [], open_positions: [], stats: {},
    first_date: null, last_date: null,
  },
  learning: {},
  available: false,
};

export async function getBullRotationDashboard(): Promise<BullRotationPayload> {
  try {
    const raw = await fs.readFile(PAYLOAD_FILE, "utf8");
    const parsed = JSON.parse(raw) as BullRotationPayload;
    return { ...EMPTY, ...parsed, available: true };
  } catch {
    return EMPTY;
  }
}
