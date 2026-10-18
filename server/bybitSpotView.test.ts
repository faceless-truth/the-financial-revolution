import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BybitAuthorizedSpotPerformance, SpotPerformanceView, formatSpotDate, formatSpotDecimal } from "../client/src/components/BybitSpotPerformance";
import { SPOT_INVESTMENT_ASSETS, type BybitSpotPortfolio, type SpotClosedReturnPeriod, type SpotHolding, type SpotOrderRecord } from "../shared/bybitSpot";

// Synthetic records only. No credentials, live requests or model trades.
const bought = "2026-02-03T04:05:06.000Z";
const sold = "2026-04-08T10:11:12.000Z";
function order(overrides: Partial<SpotOrderRecord> = {}): SpotOrderRecord {
  return {
    order_id: "synthetic-sale", symbol: "BTCUSDT", base_coin: "BTC", quote_coin: "USDT", side: "Sell",
    first_fill_at: sold, last_fill_at: "2026-04-08T10:12:13.000Z", fill_count: 2,
    executed_quantity: "0.4", inventory_quantity: "0.4", average_fill_price: "150.125", quote_value: "60.05",
    fees: [{ coin: "USDT", amount: "0.05" }], fees_complete: true,
    matched_cost_basis: "40.04", net_proceeds: "60", realized_pnl: "19.96", realized_return_pct: "49.85",
    pnl_before_unconverted_fees: null, basis_status: "known", note: null,
    matches: [{ buy_at: bought, buy_order_id: "synthetic-buy", quantity: "0.4", buy_fill_price: "100", cost_basis: "40.04" }],
    ...overrides,
  };
}
function holding(overrides: Partial<SpotHolding> = {}): SpotHolding {
  return {
    id: "BTC-USDT", asset: "BTC", quote_coin: "USDT", symbol: "BTCUSDT", quantity: "0.6", known_quantity: "0.6", unknown_quantity: "0",
    first_buy_at: bought, last_buy_at: bought, average_fill_price: "100", unit_cost: "100.1", cost_basis: "60.06",
    bid_price: "90", market_value: "54", unrealized_pnl: "-6.06", unrealized_return_pct: "-10.0899",
    pnl_before_unconverted_fees: null, basis_status: "known", fees_complete: true, reconciled: true, note: null,
    lots: [{ id: "lot-1", buy_at: bought, order_id: "synthetic-buy", quantity: "0.6", fill_price: "100", cost_basis: "60.06", quote_coin: "USDT", fees_complete: true, unknown_reason: null }],
    ...overrides,
  };
}
function period(overrides: Partial<SpotClosedReturnPeriod> = {}): SpotClosedReturnPeriod {
  return {
    months: 12, from: "2025-04-09T00:00:00.000Z", through: "2026-04-09T00:00:00.000Z", coverage_complete: true, excluded_sales: 0,
    quotes: [{ quote_coin: "USDT", return_pct: "12.345", realized_pnl: "12.345", matched_cost_basis: "100", included_sales: 2, excluded_sales: 0 }],
    ...overrides,
  };
}
function portfolio(overrides: Partial<BybitSpotPortfolio> = {}): BybitSpotPortfolio {
  const sale = order();
  const buy = order({ order_id: "synthetic-buy", side: "Buy", first_fill_at: bought, last_fill_at: bought,
    executed_quantity: "1", average_fill_price: "100", quote_value: "100", fill_count: 1,
    matched_cost_basis: null, net_proceeds: null, realized_pnl: null, realized_return_pct: null, matches: [] });
  return {
    status: "ready", retrieved_at: "2026-04-09T00:00:00.000Z", method: "FIFO",
    history: { from: "2025-04-09T00:00:00.000Z", through: "2026-04-09T00:00:00.000Z", last_synced_at: "2026-04-09T00:00:00.000Z",
      executions_complete: true, inventory_complete: { BTC: true }, execution_count: 3, windows_checked: 15, windows_total: 15, syncing: false, error: null },
    holdings: [holding()], sales: [sale], orders: [buy, sale], closed_returns: [period(), period({ months: 18, coverage_complete: false }), period({ months: 24, coverage_complete: false })],
    totals: [{ quote_coin: "USDT", realized_pnl: "19.96", known_realized_pnl: "19.96", unrealized_pnl: "-6.06", known_unrealized_pnl: "-6.06",
      combined_pnl: "13.9", remaining_cost: "60.06", current_value: "54", unknown_realized_count: 0, unknown_position_count: 0, fees_complete: true }],
    warnings: [], notes: [], ...overrides,
  };
}
const render = (p = portfolio()) => renderToStaticMarkup(React.createElement(SpotPerformanceView, { portfolio: p }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const section = (html: string, name: string) => html.split("<section").find(part => part.includes(`aria-label="${name}"`))?.split("</section>")[0] ?? "";

describe("focused private spot performance", () => {
  it("shows only three sections in order, with concise current unrealised results", () => {
    const html = render();
    expect([...html.matchAll(/<section[^>]*aria-label="([^"]+)"/g)].map(match => match[1]))
      .toEqual(["Current unrealised P&amp;L", "Spot trades", "Closed P&amp;L"]);
    const current = text(section(html, "Current unrealised P&amp;L"));
    expect(current).toContain("BTC -6.06 USDT -10.09%");
    expect(current).not.toMatch(/quantity|buy price|cost basis|current value|purchase lots|first purchase|last purchase/i);
    expect(text(html)).not.toMatch(/Trading performance by quote|Combined trading|Sales \/|windows checked|executions imported|Data-quality notes|Account details/i);
    expect(html).toContain("text-emerald-300");
    expect(html).toContain("text-rose-300");
  });

  it("includes only positive current holdings in the six-asset allowlist, without placeholder positions", () => {
    const positive = SPOT_INVESTMENT_ASSETS.map(asset => holding({ id: asset, asset }));
    const html = render(portfolio({ holdings: [...positive, holding({ id: "xrp", asset: "XRP" }), holding({ id: "cash", asset: "USDT" }),
      holding({ id: "zero", asset: "BTC", quantity: "0" }), holding({ id: "negative", asset: "ETH", quantity: "-1" }),
      holding({ id: "bad", asset: "SOL", quantity: "NaN" })] }));
    expect(html.match(/<article/g)).toHaveLength(6);
    expect(html).not.toContain("XRP");
    expect(render(portfolio({ holdings: [holding()] })).match(/<article/g)).toHaveLength(1);
    expect(render(portfolio({ holdings: [holding({ quantity: "0" })] }))).toContain("No current investments in these assets.");
  });

  it("preserves tiny and huge decimals without floating-point conversion", () => {
    expect(formatSpotDecimal("90071992547409931234567890.1234567890123456789")).toBe("90,071,992,547,409,931,234,567,890.12345679");
    expect(formatSpotDecimal("0.000000000000000000123456789")).toBe("1.2345679e-19");
    expect(formatSpotDecimal("-0.000000000000000000123456789", 2, true)).toBe("-1.2345679e-19");
    expect(formatSpotDecimal("5.12000", 8, true)).toBe("+5.12");
    expect(formatSpotDecimal("0.0000", 8, true)).toBe("0");
    for (const value of [null, undefined, "", " ", "NaN", "Infinity", "bad"]) expect(formatSpotDecimal(value)).toBe("Unknown");
    const tiny = "0.000000000000000000123456789";
    const html = render(portfolio({ holdings: [holding({ quantity: tiny, unrealized_pnl: `-${tiny}` })], orders: [order({ executed_quantity: tiny })] }));
    expect(html).toContain(`title="${tiny}"`);
    expect(text(html)).toContain("1.2345679e-19 BTC");
    expect(text(html)).toContain("-1.2345679e-19 USDT");
    expect(html.match(/<article/g)).toHaveLength(1);
  });

  it("uses actual UTC execution dates, prices, quantities and eligible net sale P&L in one list", () => {
    const html = render();
    const trades = section(html, "Spot trades");
    expect(formatSpotDate(bought)).toBe("2026-02-03 04:05:06 UTC");
    expect(formatSpotDate(null)).toBe("Unknown date");
    expect(formatSpotDate("bad")).toBe("Unknown date");
    expect(trades.match(/data-spot-order=/g)).toHaveLength(2);
    expect(trades.indexOf('data-spot-order="Sell"')).toBeLessThan(trades.indexOf('data-spot-order="Buy"'));
    expect(text(trades)).toContain("2026-04-08 10:12:13 UTC");
    expect(text(trades)).toContain("150.125 USDT");
    expect(text(trades)).toContain("0.4 BTC 2 fills");
    expect(text(trades)).toContain("+19.96 USDT");
    expect(trades).toContain('aria-label="Not applicable"');
    expect(html.match(/<table/g)).toHaveLength(1);
  });

  it("renders exactly five newest trades, not hidden rows, and scopes history before pagination", () => {
    const records = Array.from({ length: 183 }, (_, index) => order({ order_id: `sale-${String(index).padStart(3, "0")}`, symbol: `BTCUSDT-${index}` }));
    const html = render(portfolio({ orders: [...records, order({ order_id: "other", base_coin: "XRP", symbol: "XRPUSDT" })], sales: records }));
    expect(html.match(/data-spot-order=/g)).toHaveLength(5);
    expect(html).toContain("Show 5 more");
    expect(html).not.toContain("Show 30");
    expect(html).not.toContain("Show fewer");
    expect(html).toContain("BTCUSDT-182");
    expect(html).toContain("BTCUSDT-178");
    expect(html).not.toContain("BTCUSDT-177");
    expect(html).not.toContain("XRP");
    expect(render()).not.toContain("Show 5 more");
  });

  it("shows Unknown with a short reason, never pre-fee amounts or inferred zero P&L", () => {
    const html = render(portfolio({ holdings: [holding({ fees_complete: false, basis_status: "fees_incomplete", unrealized_pnl: null,
      unrealized_return_pct: null, pnl_before_unconverted_fees: "987.654", note: "verbose diagnostic to hide" })],
      orders: [order({ fees_complete: false, basis_status: "fees_incomplete", realized_pnl: null, pnl_before_unconverted_fees: "876.543" })] }));
    expect(text(html).match(/Unknown — Fees incomplete/g)).toHaveLength(2);
    expect(html).not.toMatch(/987\.654|876\.543|verbose diagnostic|Before unconverted/);
    for (const [basis_status, reason] of [["unknown", "Purchase history needed"], ["mismatch", "Inventory not reconciled"], ["borrowed", "Borrowing needs reconciliation"], ["syncing", "History syncing"]] as const) {
      const current = text(section(render(portfolio({ holdings: [holding({ basis_status, unrealized_pnl: null })] })), "Current unrealised P&amp;L"));
      expect(current).toContain(`Unknown — ${reason}`);
      expect(current).not.toContain("0 USDT");
    }
    expect(render(portfolio({ holdings: [holding({ bid_price: null, unrealized_pnl: null })] }))).toContain("Current price unavailable");
  });

  it("defaults to server-calculated 12-month net percentages, with 18/24 selectors and no mixed-quote sum", () => {
    const quotes = [...period().quotes, { ...period().quotes[0], quote_coin: "USDC", return_pct: "-2.5" }];
    const html = render(portfolio({ closed_returns: [period({ quotes }), period({ months: 18, quotes: [{ ...quotes[0], return_pct: "888.88" }] }), period({ months: 24 })] }));
    const closed = section(html, "Closed P&amp;L");
    expect(closed).toContain('aria-label="Closed P&amp;L period"');
    expect(closed).toContain('<option value="12" selected="">Last 12 months</option>');
    expect(closed).toContain('<option value="18">Last 18 months</option>');
    expect(closed).toContain('<option value="24">Last 24 months</option>');
    expect(text(closed)).toContain("+12.35% (USDT trades)");
    expect(text(closed)).toContain("-2.5% (USDC trades)");
    expect(closed).not.toContain("888.88");
    expect(text(closed)).toContain("2 eligible sale fills");
    expect(text(closed)).toContain("BTC · SOL · SUI · DOGE · HYPE · ETH only");
    expect(html).toContain("summed net realised P&amp;L / summed matched sold cost");
    expect(html).toContain("Identified paid fees included");
    expect(html).toContain("Not annualised or a whole-account return");
  });

  it("shows partial coverage and excluded sale fills even while eligible percentages are available", () => {
    const html = render(portfolio({ closed_returns: [period({ coverage_complete: false, excluded_sales: 3,
      quotes: [{ ...period().quotes[0], excluded_sales: 2 }] })] }));
    const closed = text(section(html, "Closed P&amp;L"));
    expect(closed).toContain("+12.35% (USDT trades)");
    expect(closed).toContain("Partial history coverage — available sales only");
    expect(closed).toContain("3 sale fills excluded — unknown cost or fees. Known results only.");
    expect(closed).not.toContain("History coverage complete");
  });

  it("shows Unavailable, never zero, for missing periods, no eligible sales or null return data", () => {
    const quote = period().quotes[0];
    for (const closed_returns of [undefined, [], [period({ months: 18 })], [period({ quotes: [] })],
      [period({ quotes: [{ ...quote, included_sales: 0 }] })], [period({ quotes: [{ ...quote, return_pct: null }] })],
      [period({ quotes: [{ ...quote, realized_pnl: null }] })], [period({ quotes: [{ ...quote, matched_cost_basis: null }] })]]) {
      const closed = text(section(render(portfolio({ closed_returns })), "Closed P&amp;L"));
      expect(closed).toContain("Unavailable");
      expect(closed).not.toContain("0%");
      expect(closed).not.toContain("+12.35%");
    }
    expect(text(section(render(portfolio({ closed_returns: [period({ quotes: [{ ...quote, return_pct: "0", realized_pnl: "0" }] })] })), "Closed P&amp;L"))).toContain("0% (USDT trades)");
  });

  it("keeps incomplete-history notices short and hides raw diagnostics", () => {
    const base = portfolio();
    const html = render(portfolio({ status: "syncing", holdings: [], warnings: [{ code: "test", message: "secret verbose warning" }], notes: ["verbose note"],
      history: { ...base.history, syncing: true, executions_complete: false, windows_checked: 4, windows_total: 20 } }));
    expect(html).toContain("Syncing trade history — results may be incomplete.");
    expect(html).toContain("Current investments not yet confirmed.");
    expect(html).not.toMatch(/secret verbose warning|verbose note|4 \/ 20|windows checked/);
    expect(render()).not.toContain('role="status"');
    expect(render(portfolio({ status: "partial" }))).not.toContain('role="status"');
    const failed = render(portfolio({ history: { ...base.history, error: "private raw error" } }));
    expect(failed).toContain("History unavailable or incomplete — retry refresh.");
    expect(failed).not.toContain("private raw error");
  });

  it("requires both server session flags and a portfolio to display private data", () => {
    for (const session of [null, { authenticated: false, login_configured: true }, { authenticated: true, login_configured: false }, { authenticated: false, login_configured: false }]) {
      expect(renderToStaticMarkup(React.createElement(BybitAuthorizedSpotPerformance, { session, portfolio: portfolio() }))).toBe("");
    }
    const session = { authenticated: true, login_configured: true };
    expect(renderToStaticMarkup(React.createElement(BybitAuthorizedSpotPerformance, { session, portfolio: null }))).toBe("");
    expect(renderToStaticMarkup(React.createElement(BybitAuthorizedSpotPerformance, { session, portfolio: portfolio() }))).toContain("BTCUSDT");
  });

  it("remains presentation-only without requests, browser storage or floating-point financial parsing", () => {
    const source = readFileSync(new URL("../client/src/components/BybitSpotPerformance.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/localStorage|sessionStorage|console\.|fetch\(|parseFloat|parseInt|Number\(/);
    expect(source).toContain("SPOT_INVESTMENT_ASSETS");
    expect(source).not.toContain("p.sales");
    expect(source).not.toContain("p.totals");
  });
});
