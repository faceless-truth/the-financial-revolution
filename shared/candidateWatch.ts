/** Forward paper candidate being watched for a possible promotion to live.
 *  Produced by generate_dashboard_payload.py -> build_candidate_watch(). */
export interface CandidateWatchPayload {
  schema_version: number;
  available: boolean;
  name: string;
  label: string;
  plain_summary: string;
  message?: string | null;
  start_date?: string | null;
  as_of_date?: string | null;
  days_running?: number | null;
  candidate_position?: string | null;
  live_position?: string | null;
  /** Candidate return since its own start date, percent. */
  candidate_return_pct?: number | null;
  /** Live return over that same window, percent. */
  live_return_pct?: number | null;
  /** candidate_return_pct - live_return_pct, percentage points. */
  gap_pp?: number | null;
  /** The book holds its own virtual capital: balances are never comparable. */
  separately_seeded?: boolean;
  divergent_days?: number | null;
  divergence_target?: number | null;
  rotations?: number | null;
  rotation_target?: number | null;
  gate_met?: boolean;
  promoted?: boolean;
  decision_window?: string | null;
  note?: string | null;
  backtest?: {
    candidate_return_pct?: number | null;
    live_return_pct?: number | null;
    candidate_maxdd_pct?: number | null;
    live_maxdd_pct?: number | null;
    windows_won?: number | null;
    windows?: number | null;
    psr?: number | null;
    dsr?: number | null;
    dsr_bar?: number | null;
    verdict?: string | null;
    summary?: string | null;
  } | null;
}
