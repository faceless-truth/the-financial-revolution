/**
 * Data contracts for the Bull Rotation Cockpit (/bull-rotation).
 *
 * Public blocks are emitted by the Python payload producer
 * (generate_dashboard_payload.py) and pass through /api/bull-rotation unchanged.
 * The private block is served only by the owner-authenticated
 * GET /api/bybit/performance route and never enters the public payload.
 */

export type PeriodKey = "7D" | "30D" | "6M" | "12M" | "All";
export const PERIOD_KEYS: PeriodKey[] = ["7D", "30D", "6M", "12M", "All"];

// ── Public: payload.strategy_curve ──────────────────────────────────────────
// A price-based "$10,000 following the strategy" curve. It is derived from the
// held asset's daily closes and the live switch fee, never from recorded
// account balances (pre-2026-06 rows recompounded and are not dollar-reliable).
export interface StrategyCurvePoint { date: string; value_usd: number; position: string }
export interface StrategyCurvePeriod {
  start_date: string; start_usd: number; end_usd: number; change_usd: number;
}
export interface StrategyCurve {
  available: boolean;
  basis_usd: number;          // e.g. 10000
  start_date: string | null;
  end_date: string | null;
  method: string;             // one plain-English sentence
  series: StrategyCurvePoint[];
  periods: Partial<Record<PeriodKey, StrategyCurvePeriod | null>>;
}

// ── Public: payload.learning_tests ──────────────────────────────────────────
export type LearningStatus = "watching" | "waiting" | "unlikely" | "not_promoted";
export interface LearningTest {
  id: string;
  name: string;
  plain: string;                          // what it changes, one sentence
  status: LearningStatus;
  verdict_label: string;                  // e.g. "Watching", "Not promoted"
  started: string | null;
  days_running: number | null;
  progress: { done: number; need: number; label: string } | null;
  live_return_pct: number | null;         // over the shared window
  test_return_pct: number | null;
  decision: string;                       // e.g. "Earliest decision around February 2027"
  backtest: {
    test_return_pct: number | null; live_return_pct: number | null;
    test_maxdd_pct: number | null; live_maxdd_pct: number | null;
    windows_won: string | null; confidence: number | null; bar: number;
    summary: string | null;
  } | null;
}

// ── Private: GET /api/bybit/performance ─────────────────────────────────────
// Decimal strings, venue convention. pnl_usd = end - start - net_flows, so a
// deposit or withdrawal never reads as trading profit or loss.
export interface AccountPerformancePoint {
  date: string;             // UTC day, equity at that day's close
  equity_usd: string;
  net_flow_usd: string;     // external deposits (+) / withdrawals (-) that day
}
export interface AccountPerformancePeriod {
  start_date: string;
  start_equity_usd: string;
  end_equity_usd: string;
  net_flows_usd: string;
  pnl_usd: string;
}
export interface AccountPerformance {
  available: boolean;
  as_of: string | null;               // ISO timestamp
  coverage: { start_date: string | null; complete: boolean; notes: string[] };
  series: AccountPerformancePoint[];
  periods: Partial<Record<PeriodKey, AccountPerformancePeriod | null>>;
  /** True when this is the last complete result while a newer sync runs; re-request shortly. */
  refreshing?: boolean;
}
