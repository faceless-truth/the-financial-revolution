import fs from "fs/promises";
import path from "path";

const FIXED_CAPITAL_USD = Number(process.env.PORTFOLIO_FIXED_CAPITAL_USD ?? 71_000);
const DASHBOARD_ROOT = process.env.CRYPTO_DASHBOARD_ROOT ?? "/root/crypto_dashboard";
const STATE_FILE = process.env.CRYPTO_DASHBOARD_STATE_FILE ?? path.join(DASHBOARD_ROOT, "optimized_trading_state.json");
const STRATEGY_FILE = process.env.CRYPTO_DASHBOARD_STRATEGY_FILE ?? path.join(DASHBOARD_ROOT, "optimized_strategy_data.json");
const SIGNAL_HISTORY_FILE = process.env.CRYPTO_DASHBOARD_SIGNAL_HISTORY_FILE ?? path.join(DASHBOARD_ROOT, "optimized_signal_history.json");
const ANALYTICS_FILE = process.env.CRYPTO_DASHBOARD_ANALYTICS_FILE ?? path.join(DASHBOARD_ROOT, "paleologo_analytics.json");

export type AssetCode = "BTC" | "ETH" | "SOL" | "SUI" | "DOGE" | "CASH";

interface TradingStateFile {
  positions?: Record<string, number>;
  entry_dates?: Record<string, string>;
  entry_prices?: Record<string, number>;
  hold_days?: number;
  current_value?: number;
  last_update?: string;
  in_full_cash?: boolean;
  trades_executed?: number;
  rotations?: number;
  cash_exits?: number;
  all_neg_exits?: number;
  all_neg_blocked?: number;
  partial_cash_days?: number;
  rule2_blocks?: number;
  rule3_blocks?: number;
  rule3_force_btc?: number;
  rule4_blocks?: number;
  asset?: string | null;
  allocation?: number;
  entry_date?: string | null;
  entry_price?: number | null;
}

interface StrategyDataFile {
  strategy?: string;
  strategy_version?: string;
  allocation_mode?: string;
  current_positions?: Record<string, number>;
  current_position?: string | null;
  current_allocation?: number;
  allocation_pct?: string;
  positions_string?: string;
  per_asset_caps?: Record<string, number>;
  last_update?: string;
  market_regime?: string;
  regime_confidence?: string;
  composite_score?: number;
  regime_allocation?: string;
  parameters?: Record<string, unknown>;
  btc_health?: {
    drawdown_from_30d_high?: number;
    [key: string]: unknown;
  };
  reentry_trigger?: {
    current_btc_price?: number;
    trigger_price?: number;
    gap_dollars?: number;
    gap_pct?: number;
    momentum_positive?: boolean;
    [key: string]: unknown;
  };
  confidence_v3?: {
    score?: number;
    label?: string;
    fg_value?: number;
    fg_10d_avg?: number;
    sth_proxy?: number;
    btc_above_200ma?: boolean;
    note?: string;
  };
  performance?: {
    trades_executed?: number;
    rotations?: number;
    cash_exits?: number;
    all_neg_exits?: number;
    all_neg_blocked?: number;
    partial_cash_days?: number;
    rule2_blocks?: number;
    rule3_blocks?: number;
    rule3_force_btc?: number;
    rule4_blocks?: number;
    current_value?: number;
    total_return?: number;
  };
  latest_signal?: {
    action?: string;
    allocation_mode?: string;
    target_positions?: Record<string, number>;
    target?: string | null;
    target_allocation?: number;
    confidence?: number;
    volatility_pass?: boolean;
    momentum_scores?: Record<string, number>;
    second_best_score?: number;
    top_asset_momentum?: number;
    reason?: string;
    rule_fired?: number;
    all_negative?: boolean;
    leverage?: number;
    leverage_reason?: string;
  };
  paleologo_analytics?: {
    fused_signals?: Record<string, number>;
    risk_adjusted_scores?: Record<string, number>;
    portfolio_weights_capped?: Record<string, number>;
    paleologo_confidence?: number;
    factor_loadings?: Record<string, unknown>;
  };
  macro_outlook?: {
    bias?: string;
    confidence?: number;
    data?: unknown;
  };
}

interface SignalHistoryRow {
  timestamp?: string;
  signal_date?: string;
  action?: string;
  current_position?: string | null;
  target_position?: string | null;
  current_allocation?: number;
  target_allocation?: number;
  reason?: string;
  confidence?: number;
  momentum_scores?: Record<string, number>;
  volatility_pass?: boolean;
  [key: string]: unknown;
}

interface AnalyticsFile {
  timestamp?: string;
  date?: string;
  momentum_scores?: Record<string, number>;
  fused_signals?: Record<string, number>;
  risk_adjusted_scores?: Record<string, number>;
  paleologo_confidence?: number;
  rvw_weights?: Record<string, number>;
  factor_loadings?: Record<string, unknown>;
}

export interface LivePortfolioResponse {
  source: {
    root: string;
    fixedCapitalUsd: number;
    stateFile: string;
    strategyFile: string;
    signalHistoryFile: string;
    analyticsFile: string;
  };
  summary: {
    strategy: string;
    strategyVersion: string;
    lastUpdate: string | null;
    currentAsset: AssetCode;
    currentAllocation: number;
    positions: Record<string, number>;
    positionsString: string;
    entryDate: string | null;
    entryPrice: number | null;
    holdDays: number;
    isInCash: boolean;
    fixedCapitalUsd: number;
    liveStrategyValueUsd: number;
    displayedPortfolioValueUsd: number;
    displayedCashValueUsd: number;
    displayedInvestedValueUsd: number;
    displayedUnits: number;
    totalReturnPct: number;
    pnlUsd: number;
    marketRegime: string;
    regimeConfidence: string;
    confidenceScore: number;
    confidenceLabel: string;
    ruleReason: string;
    signalAction: string;
    targetAsset: string | null;
    targetPositions: Record<string, number>;
    btcPrice: number | null;
    btcDrawdownPct: number;
    reentryTriggerPrice: number | null;
    reentryGapPct: number | null;
    reentryGapUsd: number | null;
  };
  performance: {
    tradesExecuted: number;
    rotations: number;
    cashExits: number;
    allNegativeExits: number;
    allNegativeBlocked: number;
    partialCashDays: number;
    rule2Blocks: number;
    rule3Blocks: number;
    rule3ForceBtc: number;
    rule4Blocks: number;
  };
  rankings: {
    momentumScores: Array<{ asset: string; score: number }>;
    fusedSignals: Array<{ asset: string; score: number }>;
    riskAdjustedScores: Array<{ asset: string; score: number }>;
  };
  tradeHistory: Array<{
    id: string;
    timestamp: string | null;
    signalDate: string | null;
    action: string;
    currentPosition: string | null;
    targetPosition: string | null;
    currentAllocation: number | null;
    targetAllocation: number | null;
    confidence: number | null;
    reason: string;
    volatilityPass: boolean | null;
  }>;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toAssetCode(value: string | null | undefined): AssetCode {
  const normalized = String(value ?? "CASH").toUpperCase();
  if (["BTC", "ETH", "SOL", "SUI", "DOGE"].includes(normalized)) {
    return normalized as AssetCode;
  }
  return "CASH";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sortScoreMap(map: Record<string, number> | undefined): Array<{ asset: string; score: number }> {
  return Object.entries(map ?? {})
    .map(([asset, score]) => ({ asset, score: Number(score ?? 0) }))
    .sort((a, b) => b.score - a.score);
}

function normalizeDate(value: string | null | undefined): string | null {
  return value ? String(value).slice(0, 10) : null;
}

export async function getLivePortfolioData(): Promise<LivePortfolioResponse> {
  const [state, strategy, signalHistory, analytics] = await Promise.all([
    readJsonFile<TradingStateFile>(STATE_FILE, {}),
    readJsonFile<StrategyDataFile>(STRATEGY_FILE, {}),
    readJsonFile<SignalHistoryRow[]>(SIGNAL_HISTORY_FILE, []),
    readJsonFile<AnalyticsFile>(ANALYTICS_FILE, {}),
  ]);

  const currentAsset = toAssetCode(strategy.current_position ?? state.asset ?? null);
  const positions = strategy.current_positions ?? state.positions ?? (currentAsset === "CASH" ? {} : { [currentAsset]: 1 });
  const currentAllocation = Number(strategy.current_allocation ?? state.allocation ?? Object.values(positions).reduce((sum, value) => sum + Number(value || 0), 0) ?? 0);
  const entryDate = strategy.current_position ? normalizeDate(state.entry_dates?.[strategy.current_position] ?? state.entry_date) : normalizeDate(state.entry_date);
  const entryPrice = currentAsset !== "CASH"
    ? Number(state.entry_prices?.[currentAsset] ?? state.entry_price ?? 0) || null
    : null;
  const btcPrice = Number(strategy.reentry_trigger?.current_btc_price ?? 0) || null;
  const liveStrategyValueUsd = Number(strategy.performance?.current_value ?? state.current_value ?? FIXED_CAPITAL_USD);
  const displayedPortfolioValueUsd = round2(FIXED_CAPITAL_USD * (liveStrategyValueUsd / 10_000));
  const displayedInvestedValueUsd = currentAsset === "CASH" ? 0 : round2(displayedPortfolioValueUsd * currentAllocation);
  const displayedCashValueUsd = round2(Math.max(0, displayedPortfolioValueUsd - displayedInvestedValueUsd));
  const displayedUnits = currentAsset !== "CASH" && entryPrice && entryPrice > 0
    ? displayedInvestedValueUsd / entryPrice
    : 0;
  const totalReturnPct = Number(strategy.performance?.total_return ?? 0);
  const pnlUsd = round2(displayedPortfolioValueUsd - FIXED_CAPITAL_USD);

  return {
    source: {
      root: DASHBOARD_ROOT,
      fixedCapitalUsd: FIXED_CAPITAL_USD,
      stateFile: STATE_FILE,
      strategyFile: STRATEGY_FILE,
      signalHistoryFile: SIGNAL_HISTORY_FILE,
      analyticsFile: ANALYTICS_FILE,
    },
    summary: {
      strategy: String(strategy.strategy ?? "TREND_CONFIRM"),
      strategyVersion: String(strategy.strategy_version ?? ""),
      lastUpdate: strategy.last_update ?? state.last_update ?? analytics.timestamp ?? null,
      currentAsset,
      currentAllocation,
      positions,
      positionsString: String(strategy.positions_string ?? (Object.entries(positions).map(([asset, weight]) => `${asset}:${Math.round((Number(weight) || 0) * 100)}%`).join(", ") || "CASH")),
      entryDate,
      entryPrice,
      holdDays: Number(state.hold_days ?? 0),
      isInCash: Boolean(state.in_full_cash) || currentAsset === "CASH",
      fixedCapitalUsd: FIXED_CAPITAL_USD,
      liveStrategyValueUsd: round2(liveStrategyValueUsd),
      displayedPortfolioValueUsd,
      displayedCashValueUsd,
      displayedInvestedValueUsd,
      displayedUnits,
      totalReturnPct,
      pnlUsd,
      marketRegime: String(strategy.market_regime ?? "UNKNOWN"),
      regimeConfidence: String(strategy.regime_confidence ?? "UNKNOWN"),
      confidenceScore: Number(strategy.confidence_v3?.score ?? analytics.paleologo_confidence ?? 0),
      confidenceLabel: String(strategy.confidence_v3?.label ?? "UNKNOWN"),
      ruleReason: String(strategy.latest_signal?.reason ?? "No reason available"),
      signalAction: String(strategy.latest_signal?.action ?? "HOLD"),
      targetAsset: strategy.latest_signal?.target ?? null,
      targetPositions: strategy.latest_signal?.target_positions ?? {},
      btcPrice,
      btcDrawdownPct: Number(strategy.btc_health?.drawdown_from_30d_high ?? 0),
      reentryTriggerPrice: Number(strategy.reentry_trigger?.trigger_price ?? 0) || null,
      reentryGapPct: Number(strategy.reentry_trigger?.gap_pct ?? 0) || null,
      reentryGapUsd: Number(strategy.reentry_trigger?.gap_dollars ?? 0) || null,
    },
    performance: {
      tradesExecuted: Number(strategy.performance?.trades_executed ?? state.trades_executed ?? 0),
      rotations: Number(strategy.performance?.rotations ?? state.rotations ?? 0),
      cashExits: Number(strategy.performance?.cash_exits ?? state.cash_exits ?? 0),
      allNegativeExits: Number(strategy.performance?.all_neg_exits ?? state.all_neg_exits ?? 0),
      allNegativeBlocked: Number(strategy.performance?.all_neg_blocked ?? state.all_neg_blocked ?? 0),
      partialCashDays: Number(strategy.performance?.partial_cash_days ?? state.partial_cash_days ?? 0),
      rule2Blocks: Number(strategy.performance?.rule2_blocks ?? state.rule2_blocks ?? 0),
      rule3Blocks: Number(strategy.performance?.rule3_blocks ?? state.rule3_blocks ?? 0),
      rule3ForceBtc: Number(strategy.performance?.rule3_force_btc ?? state.rule3_force_btc ?? 0),
      rule4Blocks: Number(strategy.performance?.rule4_blocks ?? state.rule4_blocks ?? 0),
    },
    rankings: {
      momentumScores: sortScoreMap(strategy.latest_signal?.momentum_scores ?? analytics.momentum_scores),
      fusedSignals: sortScoreMap(strategy.paleologo_analytics?.fused_signals ?? analytics.fused_signals),
      riskAdjustedScores: sortScoreMap(strategy.paleologo_analytics?.risk_adjusted_scores ?? analytics.risk_adjusted_scores),
    },
    tradeHistory: [...signalHistory]
      .reverse()
      .map((row, index) => ({
        id: `${row.timestamp ?? row.signal_date ?? index}-${index}`,
        timestamp: row.timestamp ?? null,
        signalDate: normalizeDate(row.signal_date),
        action: String(row.action ?? "UNKNOWN"),
        currentPosition: row.current_position ? String(row.current_position) : null,
        targetPosition: row.target_position ? String(row.target_position) : null,
        currentAllocation: typeof row.current_allocation === "number" ? row.current_allocation : null,
        targetAllocation: typeof row.target_allocation === "number" ? row.target_allocation : null,
        confidence: typeof row.confidence === "number" ? row.confidence : null,
        reason: String(row.reason ?? ""),
        volatilityPass: typeof row.volatility_pass === "boolean" ? row.volatility_pass : null,
      })),
  };
}
