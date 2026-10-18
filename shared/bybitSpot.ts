/** Investment assets, in display order; cash conversions and other bases are excluded. */
export const SPOT_INVESTMENT_ASSETS = ["BTC", "SOL", "SUI", "DOGE", "HYPE", "ETH"] as const;

/** Private spot-performance contract; no credentials or account identifiers. */
export interface SpotExecution {
  id: string;
  order_id: string;
  order_link_id: string | null;
  timestamp: string;
  symbol: string;
  base_coin: string | null;
  quote_coin: string | null;
  side: "Buy" | "Sell";
  quantity: string;
  price: string;
  quote_value: string;
  fee: string | null;
  fee_currency: string | null;
  fee_currency_source: "reported" | "documented_convention" | "zero" | "unknown";
  extra_fees_unknown: boolean;
}

export interface SpotInventoryChange {
  id: string;
  timestamp: string;
  coin: string;
  change: string;
  balance_after: string;
  type: string;
  category: string;
  trade_id: string | null;
  order_id: string | null;
}

export interface SpotWallet {
  coin: string;
  quantity: string | null;
  spot_borrow: string | null;
}

export interface SpotMarket {
  symbol: string;
  base_coin: string;
  quote_coin: string;
  bid_price: string | null;
  last_price: string | null;
  observed_at: string;
}

export interface SpotHistoryCoverage {
  from: string;
  through: string;
  last_synced_at: string | null;
  executions_complete: boolean;
  inventory_complete: Record<string, boolean>;
  execution_count: number;
  windows_checked: number;
  windows_total: number;
  syncing: boolean;
  error: string | null;
}

export interface SpotLot {
  id: string;
  buy_at: string | null;
  order_id: string | null;
  quantity: string;
  fill_price: string | null;
  cost_basis: string | null;
  quote_coin: string | null;
  fees_complete: boolean;
  unknown_reason: string | null;
}

export type SpotBasisStatus = "known" | "fees_incomplete" | "unknown" | "mismatch" | "borrowed" | "syncing";

export interface SpotHolding {
  id: string;
  asset: string;
  quote_coin: string | null;
  symbol: string | null;
  quantity: string;
  known_quantity: string;
  unknown_quantity: string;
  first_buy_at: string | null;
  last_buy_at: string | null;
  average_fill_price: string | null;
  unit_cost: string | null;
  cost_basis: string | null;
  bid_price: string | null;
  market_value: string | null;
  unrealized_pnl: string | null;
  unrealized_return_pct: string | null;
  pnl_before_unconverted_fees: string | null;
  basis_status: SpotBasisStatus;
  fees_complete: boolean;
  reconciled: boolean;
  note: string | null;
  lots: SpotLot[];
}

export interface SpotSaleMatch {
  buy_at: string | null;
  buy_order_id: string | null;
  quantity: string;
  buy_fill_price: string | null;
  cost_basis: string | null;
}

export interface SpotOrderRecord {
  order_id: string;
  symbol: string;
  base_coin: string | null;
  quote_coin: string | null;
  side: "Buy" | "Sell";
  first_fill_at: string;
  last_fill_at: string;
  fill_count: number;
  executed_quantity: string;
  inventory_quantity: string;
  average_fill_price: string;
  quote_value: string;
  fees: Array<{ coin: string | null; amount: string | null }>;
  fees_complete: boolean;
  matched_cost_basis: string | null;
  net_proceeds: string | null;
  realized_pnl: string | null;
  realized_return_pct: string | null;
  pnl_before_unconverted_fees: string | null;
  basis_status: SpotBasisStatus;
  matches: SpotSaleMatch[];
  note: string | null;
}

export interface SpotQuoteTotal {
  quote_coin: string;
  realized_pnl: string | null;
  known_realized_pnl: string;
  unrealized_pnl: string | null;
  known_unrealized_pnl: string;
  combined_pnl: string | null;
  remaining_cost: string | null;
  current_value: string | null;
  unknown_realized_count: number;
  unknown_position_count: number;
  fees_complete: boolean;
}

/** All sales counts are individual execution fills, not aggregated orders.
 * Known-subset return = SUM(net realized P&L) / SUM(matched sold cost) * 100.
 * Not an average of percentages, annualized return, or account-equity return.
 * Native quotes are never combined; unknown basis/fees are excluded, not zeroed. */
export interface SpotClosedReturnQuote {
  quote_coin: string;
  return_pct: string | null;
  realized_pnl: string | null;
  matched_cost_basis: string | null;
  included_sales: number;
  excluded_sales: number;
}

export interface SpotClosedReturnPeriod {
  months: 12 | 18 | 24;
  /** Inclusive UTC calendar-month window, with end-of-month clamping. */
  from: string;
  /** Earlier of available history.through and retrieval time. */
  through: string;
  /** History coverage, independent of whether individual fills have known basis/fees. */
  coverage_complete: boolean;
  /** Includes unattributable quote currencies, but only the six supported bases. */
  excluded_sales: number;
  quotes: SpotClosedReturnQuote[];
}

export interface BybitSpotPortfolio {
  status: "ready" | "partial" | "syncing" | "unavailable";
  retrieved_at: string;
  method: "FIFO";
  history: SpotHistoryCoverage;
  holdings: SpotHolding[];
  sales: SpotOrderRecord[];
  orders: SpotOrderRecord[];
  totals: SpotQuoteTotal[];
  /** 12-month default first, followed by 18 and 24; optional for older snapshots. */
  closed_returns?: SpotClosedReturnPeriod[];
  warnings: Array<{ code: string; message: string }>;
  notes: string[];
}

export interface SpotPerformanceInput {
  executions: SpotExecution[];
  movements: SpotInventoryChange[];
  coverage: SpotHistoryCoverage;
  wallets: SpotWallet[];
  markets: SpotMarket[];
  now: string;
}
