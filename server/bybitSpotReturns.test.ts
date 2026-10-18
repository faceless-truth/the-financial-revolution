import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { SPOT_INVESTMENT_ASSETS } from "../shared/bybitSpot";
import type { SpotExecution, SpotHistoryCoverage, SpotPerformanceInput } from "../shared/bybitSpot";
import { buildSpotClosedReturns, spotReturnCutoff } from "./bybitSpotReturns";
import type { SpotClosedSaleFill } from "./bybitSpotReturns";
import { buildSpotPerformance } from "./bybitSpotLedger";

const NOW = "2026-09-21T12:30:40.123Z";
const history = (patch: Partial<SpotHistoryCoverage> = {}): SpotHistoryCoverage => ({
  from: "2023-01-01T00:00:00.000Z", through: NOW, last_synced_at: NOW,
  executions_complete: true, inventory_complete: { BTC: true }, execution_count: 0,
  windows_checked: 1, windows_total: 1, syncing: false, error: null, ...patch,
});
const sale = (patch: Partial<SpotClosedSaleFill> = {}): SpotClosedSaleFill => ({
  timestamp: "2026-01-01T00:00:00.000Z", base_coin: "BTC", quote_coin: "USDT",
  realized_pnl: "20", matched_cost_basis: "100", ...patch,
});
const summary = (sales: SpotClosedSaleFill[] = [sale()], coverage: SpotHistoryCoverage | null = history()) =>
  buildSpotClosedReturns({ sales, history: coverage, now: NOW, present_assets: ["BTC"] });

describe("closed sale-fill return summary", () => {
  it("exports precisely the six supported assets in display order", () => {
    expect(SPOT_INVESTMENT_ASSETS).toEqual(["BTC", "SOL", "SUI", "DOGE", "HYPE", "ETH"]);
  });

  it("provides 12-month default then 18/24 with exact inclusive UTC calendar cutoffs", () => {
    const r = summary();
    expect(r.map(p => p.months)).toEqual([12, 18, 24]);
    expect(r.map(p => p.from)).toEqual([
      "2025-09-21T12:30:40.123Z", "2025-03-21T12:30:40.123Z", "2024-09-21T12:30:40.123Z",
    ]);
    for (const period of r) {
      const start = Date.parse(period.from);
      const fills = [-1, 0, 1].map(ms => sale({ timestamp: new Date(start + ms).toISOString() }));
      const result = summary(fills).find(p => p.months === period.months)!;
      expect(result.quotes[0].included_sales).toBe(2);
      expect(result.coverage_complete).toBe(true);
    }
  });

  it.each([
    ["2024-02-29T23:59:59.999Z", 12, "2023-02-28T23:59:59.999Z"],
    ["2026-08-31T01:02:03.004Z", 18, "2025-02-28T01:02:03.004Z"],
    ["2025-08-31T01:02:03.004Z", 18, "2024-02-29T01:02:03.004Z"],
    ["2026-02-28T01:02:03.004Z", 24, "2024-02-28T01:02:03.004Z"],
  ] as const)("clamps calendar end-of-month %s minus %i", (end, months, expected) => {
    expect(spotReturnCutoff(end, months)).toBe(expected);
  });

  it("uses summed costs, not an average of individual sale returns", () => {
    const q = summary([sale({ realized_pnl: "100" }), sale({ realized_pnl: "-90", matched_cost_basis: "900" })])[0].quotes[0];
    expect(q).toEqual({ quote_coin: "USDT", realized_pnl: "10", matched_cost_basis: "1000",
      return_pct: "1", included_sales: 2, excluded_sales: 0 });
  });

  it.each([["20", "20"], ["-20", "-20"], ["0", "0"]])("preserves positive/negative/zero net P&L %s", (pnl, pct) => {
    expect(summary([sale({ realized_pnl: pnl })])[0].quotes[0].return_pct).toBe(pct);
  });

  it("uses isolated 100-digit Decimal precision without Number conversion", () => {
    const old = Decimal.precision;
    try {
      Decimal.set({ precision: 4 });
      expect(summary([sale({ realized_pnl: "1", matched_cost_basis: "3" })])[0].quotes[0].return_pct)
        .toBe(`33.${"3".repeat(98)}`);
      const value = "123456789012345678901234567890.1234567890123456789";
      expect(summary([sale({ realized_pnl: value, matched_cost_basis: value })])[0].quotes[0])
        .toMatchObject({ return_pct: "100", realized_pnl: value, matched_cost_basis: value });
    } finally { Decimal.set({ precision: old }); }
  });

  it("keeps native quotes separate and limits the summary to verified supported bases", () => {
    const r = summary([
      ...SPOT_INVESTMENT_ASSETS.map(base_coin => sale({ base_coin })),
      sale({ quote_coin: "USDC", realized_pnl: "-10" }), sale({ quote_coin: "BTC" }),
      sale({ base_coin: "USDT" }), sale({ base_coin: "XRP" }), sale({ base_coin: null }),
    ])[0];
    expect(r.quotes.map(q => q.quote_coin)).toEqual(["BTC", "USDC", "USDT"]);
    expect(r.quotes[1]).toMatchObject({ return_pct: "-10", included_sales: 1 });
    expect(r.quotes[2]).toMatchObject({ return_pct: "20", included_sales: 6, matched_cost_basis: "600" });
  });

  it("counts unknown basis/fees and missing quotes as excluded while showing the known subset", () => {
    const r = summary([sale(), sale({ matched_cost_basis: null }), sale({ realized_pnl: null }),
      sale({ quote_coin: null }), sale({ matched_cost_basis: "0" }), sale({ matched_cost_basis: "-1" })])[0];
    expect(r.excluded_sales).toBe(5);
    expect(r.quotes[0]).toMatchObject({ included_sales: 1, excluded_sales: 4, return_pct: "20", matched_cost_basis: "100" });
  });

  it("has null values, not zero profit, without included positive cost", () => {
    expect(summary([sale({ realized_pnl: null })])[0].quotes[0]).toEqual({
      quote_coin: "USDT", realized_pnl: null, matched_cost_basis: null, return_pct: null,
      included_sales: 0, excluded_sales: 1,
    });
    expect(summary([])[0].quotes).toEqual([]);
  });

  it.each([
    { executions_complete: false }, { error: "synthetic error" }, { syncing: true },
    { inventory_complete: { BTC: false } }, { from: "2025-10-01T00:00:00.000Z" },
  ])("marks incomplete coverage without hiding known subsets: %j", patch => {
    const r = summary([sale()], history(patch))[0];
    expect(r.coverage_complete).toBe(false);
    expect(r.quotes[0].return_pct).toBe("20");
  });

  it("ignores absent assets' inventory flags and unrelated bases", () => {
    expect(summary([sale()], history({ inventory_complete: { SOL: false, XRP: false } }))[0].coverage_complete).toBe(true);
    const r = buildSpotClosedReturns({ sales: [sale()], now: NOW,
      history: history({ inventory_complete: { BTC: true, SOL: false, XRP: false } }), present_assets: ["BTC", "SOL", "XRP"] });
    expect(r[0].coverage_complete).toBe(false);
  });

  it("anchors to synced history a few seconds before now rather than permanently partial coverage", () => {
    const end = "2026-09-21T12:30:35.123Z";
    const r = summary([sale({ timestamp: end }), sale({ timestamp: NOW })], history({ through: end }))[0];
    expect(r).toMatchObject({ through: end, from: "2025-09-21T12:30:35.123Z", coverage_complete: true });
    expect(r.quotes[0].included_sales).toBe(1);
  });

  it("caps future history at now and excludes future fills", () => {
    const r = summary([sale({ timestamp: NOW }), sale({ timestamp: "2026-09-21T12:30:40.124Z" })],
      history({ through: "2027-01-01T00:00:00.000Z" }))[0];
    expect(r.through).toBe(NOW);
    expect(r.quotes[0].included_sales).toBe(1);
    expect(r.excluded_sales).toBe(0);
  });

  it("represents no history as incomplete, with an empty summary anchored at now", () => {
    expect(summary([], null)[0]).toMatchObject({ through: NOW, coverage_complete: false, quotes: [], excluded_sales: 0 });
  });
});

function ledgerInput(): SpotPerformanceInput {
  const execution = (id: string, side: "Buy" | "Sell", timestamp: string, value: string): SpotExecution => ({
    id, order_id: side === "Sell" ? "one-sale-order" : id, order_link_id: null, timestamp,
    symbol: "BTCUSDT", base_coin: "BTC", quote_coin: "USDT", side, quantity: side === "Buy" ? "2" : "1",
    price: side === "Buy" ? "100" : value, quote_value: value,
    fee: "0", fee_currency: "USDT", fee_currency_source: "zero", extra_fees_unknown: false,
  });
  const executions = [execution("buy", "Buy", "2025-09-01T00:00:00.000Z", "200"),
    execution("before", "Sell", "2025-09-21T12:30:40.122Z", "200"),
    execution("on", "Sell", "2025-09-21T12:30:40.123Z", "120")];
  return { now: NOW, coverage: history(), executions, wallets: [], markets: [],
    movements: executions.map((e, i) => ({ id: `log-${e.id}`, timestamp: e.timestamp, coin: "BTC",
      change: e.side === "Buy" ? "2" : "-1", balance_after: String(2 - i), type: "TRADE",
      category: "spot", trade_id: e.id, order_id: e.order_id })) };
}

describe("ledger integration leaves FIFO intact and summarizes fills", () => {
  it("splits a straddling order by exact fill timestamps and deduplicates fills via the ledger", () => {
    const input = ledgerInput();
    input.executions.push({ ...input.executions[2] });
    input.movements.push({ ...input.movements[2] });
    const result = buildSpotPerformance(input);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0]).toMatchObject({ fill_count: 2, realized_pnl: "120", matched_cost_basis: "200" });
    expect(result.closed_returns![0].quotes[0]).toMatchObject({ return_pct: "20", realized_pnl: "20", matched_cost_basis: "100", included_sales: 1 });
    expect(result.closed_returns![1].quotes[0]).toMatchObject({ return_pct: "60", included_sales: 2 });
  });

  it.each([0, 2])("excludes unknown buy/sale fees at execution %i", index => {
    const input = ledgerInput();
    input.executions[index].fee = null;
    const q = buildSpotPerformance(input).closed_returns![0].quotes[0];
    expect(q).toMatchObject({ return_pct: null, included_sales: 0, excluded_sales: 1 });
  });

  it("includes known sale fills even when the same order contains an unknown-basis fill", () => {
    const input = ledgerInput();
    // Unknown opening unit sells first, then the known purchased unit sells.
    input.executions[0].quantity = "1";
    input.executions[0].quote_value = "100";
    input.movements[0].change = "1";
    const result = buildSpotPerformance(input);
    expect(result.sales[0].realized_pnl).toBeNull();
    expect(result.closed_returns![0].quotes[0]).toMatchObject({ return_pct: "20", included_sales: 1 });
    expect(result.closed_returns![1].quotes[0]).toMatchObject({ return_pct: "20", included_sales: 1, excluded_sales: 1 });
  });

  it("does not turn unusable or unmatched inventory into realized return", () => {
    const input = ledgerInput();
    input.movements.pop();
    expect(buildSpotPerformance(input).closed_returns![0].quotes[0])
      .toMatchObject({ return_pct: null, included_sales: 0, excluded_sales: 1 });
  });

  it("uses net sale proceeds and fee-inclusive matched sold cost", () => {
    const input = ledgerInput();
    input.executions[0].fee = "2";
    input.executions[0].fee_currency_source = "reported";
    input.executions[2].fee = "1";
    input.executions[2].fee_currency_source = "reported";
    expect(buildSpotPerformance(input).closed_returns![0].quotes[0])
      .toMatchObject({ realized_pnl: "18", matched_cost_basis: "101", included_sales: 1 });
  });
});
