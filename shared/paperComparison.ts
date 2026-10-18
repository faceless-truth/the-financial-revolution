/** Read-only contract emitted by publish_profit_trail_comparison.py. */
export interface PaperAccount {
  id: "control" | "candidate";
  label: string;
  description: string;
  strategy_version: string;
  position: string;
  portfolio_value_usd: number;
  reserve_usd: number;
  total_wealth_usd: number;
  pnl_usd: number;
  return_pct: number;
  max_drawdown_pct: number; // Signed nonpositive percentage; zero at initialization.
  transition_count: number;
  fees_usd: number;
  hold_days: number;
  entry_price: number | null;
  entry_date: string | null;
  last_action: string | null;
  last_reason: string | null;
  trail?: {
    activation_pct: number;
    distance_pct: number;
    armed: boolean;
    peak_price: number | null;
    trigger_price: number | null;
  };
}

export interface PaperDayAccount {
  position: string;
  action: string | null;
  reason: string | null;
  wealth: number;
  return_pct: number;
  fees_usd: number;
  transition: boolean;
}

export interface PaperComparisonPayload {
  schema_version: 1;
  available: boolean;
  generated_at: string;
  phase: "initialized" | "collecting" | "unavailable";
  health: "ok" | "error" | "stale" | "unavailable";
  message: string;
  paper_only: true;
  candidate_promoted: false;
  start_date: string | null;
  last_observation_date: string | null;
  last_updated_at: string | null;
  last_quote_at: string | null;
  schedule_utc: string;
  next_update_due_at: string | null;
  stale_after: string | null;
  sample_days: number | null;
  divergence_days: number | null;
  trail_exit_count: number | null;
  starting_capital_usd: number | null;
  live_reference: {
    strategy_version: string | null;
    as_of_date: string | null;
    live_position: string | null;
    control_position: string | null;
    strategy_version_matches: boolean | null;
    position_matches: boolean | null;
    /** True only when the control runs the live rules AND holds what live holds. */
    control_matches_live: boolean | null;
    /** The control keeps its own virtual capital, so balances are never comparable. */
    separately_seeded: boolean;
    /** Live and control growth over the control's own window, in percent. */
    live_return_pct: number | null;
    control_return_pct: number | null;
    /** control_return_pct - live_return_pct, in percentage points. */
    return_gap_pp: number | null;
  };
  accounts: { control?: PaperAccount; candidate?: PaperAccount };
  comparison: { lead_usd: number | null; lead_return_pp: number | null };
  series: Array<{ date: string; control: number; candidate: number; is_seed: boolean }>;
  daily_history: Array<{
    date: string;
    signal_date: string;
    quote_at: string | null;
    control: PaperDayAccount;
    candidate: PaperDayAccount;
    lead_usd: number;
    lead_return_pp: number;
    divergent: boolean;
    trail_exit: boolean;
  }>;
  last_run: {
    status: string;
    started_at: string | null;
    completed_at: string | null;
    message: string | null;
  };
  notes: string[];
}
