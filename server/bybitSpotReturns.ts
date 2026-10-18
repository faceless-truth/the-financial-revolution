import Decimal from "decimal.js";
import { SPOT_INVESTMENT_ASSETS } from "../shared/bybitSpot";
import type { SpotClosedReturnPeriod, SpotClosedReturnQuote, SpotHistoryCoverage } from "../shared/bybitSpot";

const D = Decimal.clone({ precision: 100, toExpNeg: -1000, toExpPos: 1000 });
const ASSETS = new Set<string>(SPOT_INVESTMENT_ASSETS);
const MONTHS = [12, 18, 24] as const;

/** Already deduplicated ledger sale fills. Null P&L means the ledger cannot
 * establish usable, matched, known-cost, fee-complete net realized performance. */
export interface SpotClosedSaleFill {
  timestamp: string;
  base_coin: string | null;
  quote_coin: string | null;
  realized_pnl: string | null;
  matched_cost_basis: string | null;
}

function decimal(value: string | null): Decimal | null {
  if (value === null || value.trim() === "") return null;
  try { const n = new D(value); return n.isFinite() ? n : null; } catch { return null; }
}

/** Subtract UTC calendar months, retaining time and clamping (including leap days). */
export function spotReturnCutoff(through: string, months: 12 | 18 | 24): string {
  const end = new Date(through);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() - months);
  const last = new Date(end.getTime());
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  end.setUTCDate(Math.min(day, last.getUTCDate()));
  return end.toISOString();
}

/** Pure summary; never performs FIFO matching, conversion, or private API I/O.
 * A known subset remains visible even if history coverage is partial. All counts
 * refer to sale fills inside the inclusive window, never whole sale orders. */
export function buildSpotClosedReturns(input: {
  sales: SpotClosedSaleFill[];
  history: SpotHistoryCoverage | null;
  now: string;
  present_assets: Iterable<string>;
}): SpotClosedReturnPeriod[] {
  const now = Date.parse(input.now);
  const historyEnd = input.history ? Date.parse(input.history.through) : NaN;
  const end = Number.isFinite(historyEnd) ? Math.min(now, historyEnd) : now;
  const through = new Date(end).toISOString();
  const present = Array.from(input.present_assets).filter(asset => ASSETS.has(asset));
  const sales = input.sales.filter(s => s.base_coin !== null && ASSETS.has(s.base_coin));
  return MONTHS.map(months => {
    const from = spotReturnCutoff(through, months);
    const start = Date.parse(from);
    const history = input.history;
    const coverageComplete = !!history && Number.isFinite(historyEnd)
      && history.executions_complete && !history.error && !history.syncing
      && Date.parse(history.from) <= start
      && present.every(asset => history.inventory_complete[asset] !== false);
    const quotes = new Map<string, {
      pnl: Decimal; cost: Decimal; included: number; excluded: number;
    }>();
    let excludedSales = 0;
    for (const sale of sales) {
      const timestamp = Date.parse(sale.timestamp);
      if (!Number.isFinite(timestamp) || timestamp < start || timestamp > end) continue;
      if (!sale.quote_coin) { excludedSales++; continue; }
      let quote = quotes.get(sale.quote_coin);
      if (!quote) {
        quote = { pnl: new D(0), cost: new D(0), included: 0, excluded: 0 };
        quotes.set(sale.quote_coin, quote);
      }
      const pnl = decimal(sale.realized_pnl);
      const cost = decimal(sale.matched_cost_basis);
      if (pnl === null || cost === null || !cost.gt(0)) {
        quote.excluded++;
        excludedSales++;
        continue;
      }
      quote.pnl = quote.pnl.plus(pnl);
      quote.cost = quote.cost.plus(cost);
      quote.included++;
    }
    const rows: SpotClosedReturnQuote[] = Array.from(quotes)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([coin, q]) => ({
        quote_coin: coin,
        return_pct: q.included ? q.pnl.div(q.cost).times(100).toFixed() : null,
        realized_pnl: q.included ? q.pnl.toFixed() : null,
        matched_cost_basis: q.included ? q.cost.toFixed() : null,
        included_sales: q.included,
        excluded_sales: q.excluded,
      }));
    return { months, from, through, coverage_complete: coverageComplete,
      excluded_sales: excludedSales, quotes: rows };
  });
}
