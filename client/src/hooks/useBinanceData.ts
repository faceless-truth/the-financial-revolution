/**
 * useBinanceData — Unified Momentum Strategy v7.0
 * ================================================
 * Mirrors unified_momentum_strategy.py exactly:
 *
 * - 30-day pairwise momentum scoring (winners/losers) + directional vol ratio
 * - 5-regime market regime: STRONG_INVEST / INVEST / NEUTRAL / CASH / STRONG_CASH
 * - Confidence Score v3: F&G 55% + STH Proxy (BTC/90d MA) 45%
 * - Leverage gate: confidence_v3 >= 0.68 AND BTC > 200d MA → 2x
 * - Adaptive entry thresholds per regime
 * - Asset caps: BTC/ETH/SOL 100%, SUI/DOGE 60%
 * - Remainder Split when primary asset hits cap
 * - Actions: HOLD / BUY / SELL_ALL / ROTATE / REBALANCE / INCREASE / REDUCE
 * - Execution: 00:05 UTC daily
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ── Constants ──────────────────────────────────────────────────────────────────
export const MAJORS = ["BTC", "ETH", "SOL", "SUI", "DOGE"] as const;
export type Asset = (typeof MAJORS)[number];

const PAIRS: Record<Asset, string> = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  SUI: "SUIUSDT",
  DOGE: "DOGEUSDT",
};

export const PER_ASSET_CAPS: Record<Asset, number> = {
  BTC: 1.0,
  ETH: 1.0,
  SOL: 1.0,
  SUI: 0.6,
  DOGE: 0.6,
};

const MOMENTUM_PERIOD = 30;
const VOLATILITY_WINDOW = 14;
export const MIN_SCORE = 10.0;
export const SECOND_BEST_MIN_SCORE = 3.0;
export const LEVERAGE_MULTIPLIER = 2.0;
export const LEVERAGE_CONFIDENCE_THRESHOLD = 0.68;

export const ADAPTIVE_THRESHOLDS: Record<string, number> = {
  STRONG_INVEST: 3.0,
  INVEST: 5.0,
  NEUTRAL: 10.0,
  CASH: 15.0,
  STRONG_CASH: 20.0,
};

export const REGIME_ALLOCATION: Record<string, number> = {
  STRONG_INVEST: 1.0,
  INVEST: 1.0,
  NEUTRAL: 0.5,
  CASH: 0.0,
  STRONG_CASH: 0.0,
};

// ── Types ──────────────────────────────────────────────────────────────────────
export interface Candle {
  time: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AssetMetrics {
  symbol: Asset;
  price: number;
  momentum30: number;
  momentum5: number;
  pairwiseScore: number;
  riskAdjScore: number;
  volRatio: number;
  upsideVol: number;
  downsideVol: number;
  totalVol: number;
  drawdownFromHigh30: number;
  change24h: number;
  ma200: number;
  ma90: number;
  nearHigh30: boolean;
}

export interface ConfidenceV3 {
  score: number;
  zone: "LOW" | "MED-LOW" | "MED" | "MED-HIGH" | "HIGH";
  fngValue: number;
  fng30dAvg: number;
  sthRatio: number;
  btcAbove200: boolean;
  leverageFiring: boolean;
  leverageReason: string;
}

export type RegimeType = "STRONG_INVEST" | "INVEST" | "NEUTRAL" | "CASH" | "STRONG_CASH";

export interface MarketRegime {
  regime: RegimeType;
  compositeScore: number;
  allocation: number;
  entryThreshold: number;
}

export interface StrategySignal {
  action: "HOLD" | "BUY" | "SELL_ALL" | "ROTATE" | "REBALANCE" | "INCREASE" | "REDUCE";
  targetPositions: Partial<Record<Asset, number>>;
  allocationMode: "SINGLE" | "REMAINDER_SPLIT" | "REMAINDER_SINGLE" | "CASH";
  reason: string;
  leverage: number;
  leverageReason: string;
  entryThreshold: number;
  topAsset: Asset | null;
  secondBestScore: number;
  positionType: "first" | "second" | "remainder_split" | null;
  // Legacy fields kept for Portfolio page compatibility
  allocationMultiplier: number;
  momentumScores: Partial<Record<Asset, number>>;
  momentumRanked: Array<{ asset: Asset; score: number }>;
}

export interface BinanceDataResult {
  signal: StrategySignal | null;
  assets: Partial<Record<Asset, AssetMetrics>>;
  rankedAssets: Array<{ symbol: Asset; riskAdjScore: number; rank: number }>;
  regime: MarketRegime;
  confidence: ConfidenceV3;
  rawData: Partial<Record<Asset, Candle[]>>;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

// ── Math helpers ───────────────────────────────────────────────────────────────

function calcMomentum(candles: Candle[], period: number): number {
  if (candles.length < period + 1) return 0;
  const latest = candles[candles.length - 1].close;
  const past = candles[candles.length - 1 - period].close;
  return ((latest / past) - 1) * 100;
}

function calcMA(candles: Candle[], period: number): number {
  if (candles.length < period) return candles[candles.length - 1]?.close ?? 0;
  const slice = candles.slice(candles.length - period);
  return slice.reduce((a, c) => a + c.close, 0) / period;
}

function calcDirectionalVol(candles: Candle[], window: number) {
  if (candles.length < window + 1) return { total: 0, upside: 0, downside: 0, ratio: 1 };
  const slice = candles.slice(candles.length - window - 1);
  const returns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    returns.push((slice[i].close - slice[i - 1].close) / slice[i - 1].close);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const total = Math.sqrt(returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length);
  const ups = returns.filter(r => r > 0);
  const downs = returns.filter(r => r < 0);
  const upside = ups.length >= 2 ? Math.sqrt(ups.reduce((a, r) => a + r * r, 0) / ups.length) : 0;
  const downside = downs.length >= 2 ? Math.sqrt(downs.map(r => Math.abs(r)).reduce((a, r) => a + r * r, 0) / downs.length) : 0;
  let ratio = 1.0;
  if (upside < 0.001 && downside < 0.001) ratio = 1.0;
  else if (upside < 0.001) ratio = 0.5;
  else if (downside < 0.001) ratio = 2.0;
  else ratio = Math.max(0.5, Math.min(2.0, upside / downside));
  return { total, upside, downside, ratio };
}

function calcPairwiseScores(momentum30: Partial<Record<Asset, number>>): Partial<Record<Asset, number>> {
  const assets = MAJORS.filter(a => momentum30[a] !== undefined);
  const scores: Partial<Record<Asset, number>> = {};
  assets.forEach(a => { scores[a] = 0; });
  for (let i = 0; i < assets.length; i++) {
    for (let j = i + 1; j < assets.length; j++) {
      const a = assets[i], b = assets[j];
      const ma = momentum30[a] ?? 0, mb = momentum30[b] ?? 0;
      if (ma > mb) { scores[a] = (scores[a] ?? 0) + 1; scores[b] = (scores[b] ?? 0) - 1; }
      else if (mb > ma) { scores[b] = (scores[b] ?? 0) + 1; scores[a] = (scores[a] ?? 0) - 1; }
    }
  }
  return scores;
}

// ── Confidence Score v3 ────────────────────────────────────────────────────────

function scoreFng(v: number, avg30d: number): number {
  let base: number;
  if (v < 25) base = 0.10;
  else if (v < 40) base = 0.35;
  else if (v < 55) base = 0.60;
  else if (v < 75) base = 1.00;
  else base = 0.50;
  const trend = v - avg30d;
  if (trend > 20) base = Math.min(1.0, base + 0.12);
  else if (trend > 10) base = Math.min(1.0, base + 0.07);
  else if (trend > 4) base = Math.min(1.0, base + 0.03);
  else if (trend < -20) base = Math.max(0.0, base - 0.12);
  else if (trend < -10) base = Math.max(0.0, base - 0.07);
  else if (trend < -4) base = Math.max(0.0, base - 0.03);
  return base;
}

function scoreSth(s: number): number {
  if (s > 1.45) return 0.65;
  if (s > 1.20) return 1.00;
  if (s > 1.08) return 0.92;
  if (s > 0.97) return 0.72;
  if (s > 0.88) return 0.50;
  if (s > 0.75) return 0.25;
  return 0.05;
}

function confidenceZone(score: number): ConfidenceV3["zone"] {
  if (score >= 0.68) return "HIGH";
  if (score >= 0.55) return "MED-HIGH";
  if (score >= 0.40) return "MED";
  if (score >= 0.28) return "MED-LOW";
  return "LOW";
}

// ── Market Regime (proxy — mirrors composite score logic) ──────────────────────

function deriveRegime(btcCandles: Candle[], allMomentum14: Partial<Record<Asset, number>>): MarketRegime {
  if (btcCandles.length < 50) return { regime: "NEUTRAL", compositeScore: 0, allocation: 0.5, entryThreshold: 10 };
  const btcPrice = btcCandles[btcCandles.length - 1].close;
  const ma200 = calcMA(btcCandles, Math.min(200, btcCandles.length));
  const ma50 = calcMA(btcCandles, Math.min(50, btcCandles.length));
  const ma20 = calcMA(btcCandles, Math.min(20, btcCandles.length));
  const btcMom14 = allMomentum14["BTC"] ?? 0;
  const posCount = MAJORS.filter(a => (allMomentum14[a] ?? 0) > 0).length;
  const breadthScore = posCount / MAJORS.length;
  let trendScore = 0;
  if (btcPrice > ma200) trendScore += 0.4;
  if (btcPrice > ma50) trendScore += 0.3;
  if (btcPrice > ma20) trendScore += 0.3;
  let momScore = 0;
  if (btcMom14 > 5) momScore = 1.0;
  else if (btcMom14 > 0) momScore = 0.7;
  else if (btcMom14 > -5) momScore = 0.4;
  else if (btcMom14 > -15) momScore = 0.2;
  else momScore = 0.0;
  const compositeScore = Math.round((trendScore * 0.4 + momScore * 0.35 + breadthScore * 0.25) * 1000) / 1000;
  let regime: RegimeType;
  if (compositeScore >= 0.75 && btcMom14 > 5) regime = "STRONG_INVEST";
  else if (compositeScore >= 0.55) regime = "INVEST";
  else if (compositeScore >= 0.35) regime = "NEUTRAL";
  else if (compositeScore >= 0.20) regime = "CASH";
  else regime = "STRONG_CASH";
  return { regime, compositeScore, allocation: REGIME_ALLOCATION[regime], entryThreshold: ADAPTIVE_THRESHOLDS[regime] };
}

// ── Signal generation ──────────────────────────────────────────────────────────

function buildSignal(
  ranked: Array<{ symbol: Asset; riskAdjScore: number }>,
  regime: MarketRegime,
  confidence: ConfidenceV3,
  momentum30: Partial<Record<Asset, number>>
): StrategySignal {
  const baseAlloc = regime.allocation;
  const threshold = regime.entryThreshold;
  const leverage = confidence.leverageFiring ? LEVERAGE_MULTIPLIER : 1.0;
  const leverageReason = confidence.leverageReason;
  const momentumScores = momentum30 as Partial<Record<Asset, number>>;
  const momentumRanked = [...ranked].map(r => ({ asset: r.symbol, score: r.riskAdjScore }));

  if (baseAlloc === 0) {
    return { action: "SELL_ALL", targetPositions: {}, allocationMode: "CASH", reason: `${regime.regime} — exit all positions`, leverage: 1.0, leverageReason: "No leverage in cash regime", entryThreshold: threshold, topAsset: null, secondBestScore: ranked[1]?.riskAdjScore ?? 0, positionType: null, allocationMultiplier: 0, momentumScores, momentumRanked };
  }

  if (!ranked.length) {
    return { action: "HOLD", targetPositions: {}, allocationMode: "CASH", reason: "No assets available", leverage: 1.0, leverageReason: "", entryThreshold: threshold, topAsset: null, secondBestScore: 0, positionType: null, allocationMultiplier: baseAlloc, momentumScores, momentumRanked };
  }

  const top = ranked[0];
  const second = ranked[1] ?? null;
  const secondBestScore = second?.riskAdjScore ?? 0;

  if (top.riskAdjScore < threshold) {
    if (regime.regime === "NEUTRAL" && second && secondBestScore >= SECOND_BEST_MIN_SCORE && (momentum30[second.symbol] ?? 0) > 0) {
      const cap = PER_ASSET_CAPS[second.symbol];
      const alloc = Math.min(baseAlloc * 0.8, cap);
      return { action: "BUY", targetPositions: { [second.symbol]: alloc } as Partial<Record<Asset, number>>, allocationMode: "REMAINDER_SINGLE", reason: `${second.symbol} qualifies as second-best (${secondBestScore.toFixed(1)}) in NEUTRAL (threshold: ${SECOND_BEST_MIN_SCORE})`, leverage, leverageReason, entryThreshold: threshold, topAsset: second.symbol, secondBestScore, positionType: "second", allocationMultiplier: alloc, momentumScores, momentumRanked };
    }
    return { action: "HOLD", targetPositions: {}, allocationMode: "CASH", reason: `No qualifying positions in ${regime.regime} — top score ${top.riskAdjScore.toFixed(1)} < threshold ${threshold}`, leverage: 1.0, leverageReason: "", entryThreshold: threshold, topAsset: top.symbol, secondBestScore, positionType: null, allocationMultiplier: 0, momentumScores, momentumRanked };
  }

  const primaryCap = PER_ASSET_CAPS[top.symbol];
  const primaryAlloc = Math.min(baseAlloc, primaryCap);
  const targetPositions: Partial<Record<Asset, number>> = { [top.symbol]: primaryAlloc };
  let allocationMode: StrategySignal["allocationMode"] = "REMAINDER_SINGLE";

  if (primaryAlloc < baseAlloc && second && secondBestScore >= SECOND_BEST_MIN_SCORE) {
    const remainder = baseAlloc - primaryAlloc;
    const secondaryCap = PER_ASSET_CAPS[second.symbol];
    const secondaryAlloc = Math.min(remainder, secondaryCap);
    if (secondaryAlloc > 0.01) {
      targetPositions[second.symbol] = secondaryAlloc;
      allocationMode = "REMAINDER_SPLIT";
    }
  }

  const reason = allocationMode === "REMAINDER_SPLIT"
    ? `${top.symbol} (${(primaryAlloc * 100).toFixed(0)}%) + ${Object.keys(targetPositions)[1]} remainder split — ${regime.regime}`
    : `${top.symbol} qualifies (score: ${top.riskAdjScore.toFixed(1)}) in ${regime.regime} (threshold: ${threshold})`;

  return { action: "BUY", targetPositions, allocationMode, reason, leverage, leverageReason, entryThreshold: threshold, topAsset: top.symbol, secondBestScore, positionType: allocationMode === "REMAINDER_SPLIT" ? "remainder_split" : "first", allocationMultiplier: Object.values(targetPositions).reduce((a, b) => a + (b ?? 0), 0), momentumScores, momentumRanked };
}

// ── Fear & Greed ───────────────────────────────────────────────────────────────

async function fetchFearAndGreed(): Promise<{ current: number; avg30d: number }> {
  try {
    const resp = await fetch("https://api.alternative.me/fng/?limit=30&format=json");
    const json = await resp.json();
    const data: Array<{ value: string }> = json.data ?? [];
    const current = parseInt(data[0]?.value ?? "50", 10);
    const avg30d = data.length > 1 ? data.slice(0, 30).reduce((a, d) => a + parseInt(d.value, 10), 0) / Math.min(30, data.length) : current;
    return { current, avg30d };
  } catch {
    return { current: 50, avg30d: 50 };
  }
}

// ── Main hook ──────────────────────────────────────────────────────────────────

const DEFAULT_REGIME: MarketRegime = { regime: "NEUTRAL", compositeScore: 0, allocation: 0.5, entryThreshold: 10 };
const DEFAULT_CONF: ConfidenceV3 = { score: 0.5, zone: "MED", fngValue: 50, fng30dAvg: 50, sthRatio: 1.0, btcAbove200: false, leverageFiring: false, leverageReason: "" };

export function useBinanceData(refreshMs = 5 * 60 * 1000): BinanceDataResult {
  const [result, setResult] = useState<BinanceDataResult>({
    signal: null, assets: {}, rankedAssets: [], regime: DEFAULT_REGIME, confidence: DEFAULT_CONF, rawData: {}, loading: true, error: null, lastUpdated: null,
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const now = Date.now();
      const candlePromises = MAJORS.map(async (symbol) => {
        const url = `https://api.binance.com/api/v3/klines?symbol=${PAIRS[symbol]}&interval=1d&limit=220`;
        const resp = await fetch(url);
        const raw: any[][] = await resp.json();
        const candles: Candle[] = raw
          .filter(k => Number(k[6]) < now)
          .map(k => ({
            time: Number(k[0]),
            date: new Date(Number(k[0])).toISOString().slice(0, 10),
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
          }));
        return { symbol, candles };
      });

      const [candleResults, fng] = await Promise.all([Promise.all(candlePromises), fetchFearAndGreed()]);
      const candleMap: Partial<Record<Asset, Candle[]>> = {};
      candleResults.forEach(({ symbol, candles }) => { candleMap[symbol as Asset] = candles; });

      // Per-asset metrics
      const momentum30: Partial<Record<Asset, number>> = {};
      const assetMetrics: Partial<Record<Asset, AssetMetrics>> = {};

      for (const symbol of MAJORS) {
        const candles = candleMap[symbol];
        if (!candles || candles.length < MOMENTUM_PERIOD + 1) continue;
        const latest = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        const mom30 = calcMomentum(candles, MOMENTUM_PERIOD);
        const mom5 = calcMomentum(candles, 5);
        const vol = calcDirectionalVol(candles, VOLATILITY_WINDOW);
        const ma200 = calcMA(candles, Math.min(200, candles.length));
        const ma90 = calcMA(candles, Math.min(90, candles.length));
        const high30 = Math.max(...candles.slice(-30).map(c => c.high));
        const drawdown = ((latest.close - high30) / high30) * 100;
        const change24h = ((latest.close - prev.close) / prev.close) * 100;
        const nearHigh30 = (high30 - latest.close) / high30 <= 0.05;
        momentum30[symbol] = mom30;
        assetMetrics[symbol] = { symbol, price: latest.close, momentum30: mom30, momentum5: mom5, pairwiseScore: 0, riskAdjScore: 0, volRatio: vol.ratio, upsideVol: vol.upside, downsideVol: vol.downside, totalVol: vol.total, drawdownFromHigh30: drawdown, change24h, ma200, ma90, nearHigh30 };
      }

      // Pairwise + risk-adjusted scores
      const pairwise = calcPairwiseScores(momentum30);
      for (const symbol of MAJORS) {
        if (!assetMetrics[symbol]) continue;
        const raw = pairwise[symbol] ?? 0;
        const volRatio = assetMetrics[symbol]!.volRatio;
        const normalised = ((raw + 4) / 8) * 20;
        assetMetrics[symbol]!.pairwiseScore = raw;
        assetMetrics[symbol]!.riskAdjScore = Math.round(normalised * volRatio * 10) / 10;
      }

      // Ranked
      const ranked = MAJORS
        .filter(s => assetMetrics[s])
        .map(s => ({ symbol: s as Asset, riskAdjScore: assetMetrics[s]!.riskAdjScore }))
        .sort((a, b) => b.riskAdjScore - a.riskAdjScore)
        .map((a, i) => ({ ...a, rank: i + 1 }));

      // Regime
      const regime = deriveRegime(candleMap["BTC"] ?? [], momentum30);

      // Confidence v3
      const btcCandles = candleMap["BTC"] ?? [];
      const btcPrice = btcCandles[btcCandles.length - 1]?.close ?? 0;
      const ma200BTC = calcMA(btcCandles, Math.min(200, btcCandles.length));
      const ma90BTC = calcMA(btcCandles, Math.min(90, btcCandles.length));
      const sthRatio = ma90BTC > 0 ? btcPrice / ma90BTC : 1.0;
      const btcAbove200 = btcPrice > ma200BTC;
      const confScore = Math.round((scoreFng(fng.current, fng.avg30d) * 0.55 + scoreSth(sthRatio) * 0.45) * 10000) / 10000;
      const leverageFiring = confScore >= LEVERAGE_CONFIDENCE_THRESHOLD && btcAbove200;
      const leverageReason = leverageFiring
        ? `Confidence v3 ${confScore.toFixed(3)} ≥ ${LEVERAGE_CONFIDENCE_THRESHOLD} AND BTC > 200d MA`
        : confScore < LEVERAGE_CONFIDENCE_THRESHOLD
        ? `Confidence v3 ${confScore.toFixed(3)} < ${LEVERAGE_CONFIDENCE_THRESHOLD} threshold`
        : "BTC below 200d MA";
      const confidence: ConfidenceV3 = { score: confScore, zone: confidenceZone(confScore), fngValue: fng.current, fng30dAvg: fng.avg30d, sthRatio, btcAbove200, leverageFiring, leverageReason };

      // Signal
      const signal = buildSignal(ranked, regime, confidence, momentum30);

      setResult({ signal, assets: assetMetrics, rankedAssets: ranked, regime, confidence, rawData: candleMap, loading: false, error: null, lastUpdated: new Date() });
    } catch (err: any) {
      setResult(prev => ({ ...prev, loading: false, error: err?.message ?? "Fetch error" }));
    }
  }, []);

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, refreshMs);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchAll, refreshMs]);

  return result;
}
