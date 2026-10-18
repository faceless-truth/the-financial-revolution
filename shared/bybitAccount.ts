/** Private account display contract. Never contains API credentials or account IDs. */
export interface BybitCoinBalance {
  coin: string;
  wallet_balance: string | null;
  equity: string | null;
  usd_value: string | null;
  spot_borrow: string | null;
  locked: string | null;
  unrealised_pnl: string | null;
}

export interface BybitPosition {
  category: "linear" | "inverse";
  symbol: string;
  position_index: number;
  side: "Buy" | "Sell";
  size: string;
  settle_coin: string | null;
  avg_price: string | null;
  mark_price: string | null;
  position_value: string | null;
  unrealised_pnl: string | null;
  leverage: string | null;
  liquidation_price: string | null;
  initial_margin: string | null;
  updated_at: string | null;
}

export interface BybitAccountSnapshot {
  status: "connected" | "partial";
  retrieved_at: string;
  read_only_verified: true;
  ip_restricted: boolean;
  account_type: "UNIFIED";
  unified_margin_status: number;
  margin_mode: string | null;
  totals: {
    equity_usd: string | null;
    wallet_balance_usd: string | null;
    perpetual_unrealised_pnl_usd: string | null;
    available_balance_usd: string | null;
  };
  balances: BybitCoinBalance[];
  positions: BybitPosition[];
  coverage: { wallet: boolean; linear_usdt: boolean; linear_usdc: boolean; inverse: boolean };
  warnings: Array<{ code: string; message: string }>;
}

export interface BybitOwnerSession {
  authenticated: boolean;
  login_configured: boolean;
}
