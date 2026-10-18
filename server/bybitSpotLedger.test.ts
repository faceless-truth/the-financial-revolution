import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { buildSpotPerformance } from "./bybitSpotLedger";
import type { SpotExecution, SpotInventoryChange, SpotPerformanceInput } from "../shared/bybitSpot";

const at = (day: number) => `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`;
function execution(id: string, side: "Buy" | "Sell", quantity: string, price: string, day: number, patch: Partial<SpotExecution> = {}): SpotExecution {
  return { id, order_id: `order-${id}`, order_link_id: null, timestamp: at(day),
    symbol: "BTCUSDT", base_coin: "BTC", quote_coin: "USDT", side, quantity, price,
    quote_value: new Decimal(quantity).times(price).toFixed(), fee: "0", fee_currency: "USDT",
    fee_currency_source: "zero", extra_fees_unknown: false, ...patch };
}
function movement(id: string, change: string, balance: string, day: number, patch: Partial<SpotInventoryChange> = {}): SpotInventoryChange {
  return { id: `log-${id}`, timestamp: at(day), coin: "BTC", change, balance_after: balance,
    type: "TRADE", category: "spot", trade_id: id, order_id: `order-${id}`, ...patch };
}
function input(executions: SpotExecution[] = [], movements: SpotInventoryChange[] = [], quantity = "0", patch: Partial<SpotPerformanceInput> = {}): SpotPerformanceInput {
  return { executions, movements, now: at(20),
    coverage: { from: "2024-01-01T00:00:00.000Z", through: at(20), last_synced_at: at(20),
      executions_complete: true, inventory_complete: { BTC: true, ETH: true, SOL: true },
      execution_count: executions.length, windows_checked: 1, windows_total: 1, syncing: false, error: null },
    wallets: [{ coin: "BTC", quantity, spot_borrow: "0" }],
    markets: [{ symbol: "BTCUSDT", base_coin: "BTC", quote_coin: "USDT", bid_price: "150", last_price: "999", observed_at: at(20) }],
    ...patch };
}
const basic = () => input([
  execution("b", "Buy", "2", "100", 2), execution("s", "Sell", "1", "120", 3),
], [movement("b", "2", "2", 2), movement("s", "-1", "1", 3)], "1");
const codes = (i: SpotPerformanceInput) => buildSpotPerformance(i).warnings.map(w => w.code);

describe("buildSpotPerformance synthetic transaction ledger", () => {
  it("reports actual purchase/sale dates, FIFO return and bid valuation, not wallet deposits as profit", () => {
    const result = buildSpotPerformance(basic());
    expect(result.status).toBe("ready");
    expect(result.sales[0]).toMatchObject({ first_fill_at: at(3), average_fill_price: "120",
      inventory_quantity: "1", matched_cost_basis: "100", net_proceeds: "120", realized_pnl: "20", realized_return_pct: "20" });
    expect(result.sales[0].matches).toEqual([{ buy_at: at(2), buy_order_id: "order-b", quantity: "1", buy_fill_price: "100", cost_basis: "100" }]);
    expect(result.holdings[0]).toMatchObject({ quantity: "1", first_buy_at: at(2), last_buy_at: at(2),
      average_fill_price: "100", unit_cost: "100", cost_basis: "100", bid_price: "150", market_value: "150", unrealized_pnl: "50" });
    expect(result.totals[0]).toMatchObject({ quote_coin: "USDT", realized_pnl: "20", unrealized_pnl: "50", combined_pnl: "70" });
    expect(result.orders.find(o => o.side === "Buy")).toMatchObject({ realized_pnl: null, matched_cost_basis: null, net_proceeds: null });
  });

  it("aggregates partial fills by order+symbol+side across days, weighted by actual quote values", () => {
    const i = input([
      execution("b1", "Buy", "1", "100", 2, { order_id: "same", fee: "1", fee_currency_source: "reported" }),
      execution("b2", "Buy", "3", "200", 3, { order_id: "same", fee: "2", fee_currency_source: "reported" }),
      execution("s1", "Sell", "1", "250", 4, { order_id: "sell" }),
      execution("s2", "Sell", "1", "260", 5, { order_id: "sell" }),
    ], [movement("b1", "1", "1", 2), movement("b2", "3", "4", 3), movement("s1", "-1", "3", 4), movement("s2", "-1", "2", 5)], "2");
    const r = buildSpotPerformance(i);
    expect(r.orders).toHaveLength(2);
    expect(r.orders[1]).toMatchObject({ fill_count: 2, first_fill_at: at(2), last_fill_at: at(3), average_fill_price: "175", fees: [{ coin: "USDT", amount: "3" }] });
    expect(r.sales[0]).toMatchObject({ fill_count: 2, average_fill_price: "255" });
    expect(r.sales[0].matches.map(m => m.buy_at)).toEqual([at(2), at(3)]);
    expect(r.holdings[0].average_fill_price).toBe("200");
  });

  it("releases multiple FIFO lots and preserves remaining dates and cost", () => {
    const r = buildSpotPerformance(input([
      execution("b1", "Buy", "2", "100", 2), execution("b2", "Buy", "3", "200", 3), execution("s", "Sell", "3", "250", 4),
    ], [movement("b1", "2", "2", 2), movement("b2", "3", "5", 3), movement("s", "-3", "2", 4)], "2"));
    expect(r.sales[0]).toMatchObject({ matched_cost_basis: "400", realized_pnl: "350" });
    expect(r.sales[0].matches.map(m => m.quantity)).toEqual(["2", "1"]);
    expect(r.holdings[0]).toMatchObject({ first_buy_at: at(3), last_buy_at: at(3), cost_basis: "400", quantity: "2" });
  });

  it("capitalizes quote buy fees and deducts quote sell fees including rebates", () => {
    const i = basic();
    i.executions[0] = { ...i.executions[0], fee: "2", fee_currency_source: "reported" };
    i.executions[1] = { ...i.executions[1], fee: "-1", fee_currency_source: "reported" };
    const r = buildSpotPerformance(i);
    expect(r.sales[0]).toMatchObject({ matched_cost_basis: "101", net_proceeds: "121", realized_pnl: "20" });
    expect(r.holdings[0]).toMatchObject({ cost_basis: "101", unit_cost: "101", average_fill_price: "100" });
    i.executions[0].fee = "-2";
    expect(buildSpotPerformance(i).holdings[0].cost_basis).toBe("99");
  });

  it("uses net base buy quantity without adding base fees again and sells gross quantity plus base fee", () => {
    const r = buildSpotPerformance(input([
      execution("b", "Buy", "10", "10", 2, { fee: "1", fee_currency: "BTC", fee_currency_source: "reported" }),
      execution("s", "Sell", "4", "20", 3, { fee: "0.5", fee_currency: "BTC", fee_currency_source: "reported" }),
    ], [movement("b", "9", "9", 2), movement("s", "-4.5", "4.5", 3)], "4.5"));
    expect(r.sales[0]).toMatchObject({ executed_quantity: "4", inventory_quantity: "4.5", matched_cost_basis: "50", net_proceeds: "80", realized_pnl: "30" });
    expect(r.holdings[0]).toMatchObject({ cost_basis: "50", average_fill_price: "10" });
  });

  it("supports base rebates in both directions", () => {
    const r = buildSpotPerformance(input([
      execution("b", "Buy", "9", "10", 2, { fee: "-1", fee_currency: "BTC", fee_currency_source: "reported" }),
      execution("s", "Sell", "6", "20", 3, { fee: "-1", fee_currency: "BTC", fee_currency_source: "reported" }),
    ], [movement("b", "10", "10", 2), movement("s", "-5", "5", 3)], "5"));
    expect(r.sales[0]).toMatchObject({ matched_cost_basis: "45", realized_pnl: "75", inventory_quantity: "5" });
    expect(r.holdings[0].cost_basis).toBe("45");
  });

  it.each([
    { fee: null, fee_currency: null, fee_currency_source: "unknown" as const },
    { fee: "1", fee_currency: "MNT", fee_currency_source: "reported" as const },
    { fee: "1", fee_currency: "USDT", fee_currency_source: "unknown" as const },
    { fee: "0", extra_fees_unknown: true },
  ])("keeps quote-only P&L separate when buy fees are unknown: %j", patch => {
    const i = basic(); i.executions[0] = { ...i.executions[0], ...patch };
    const r = buildSpotPerformance(i);
    expect(r.sales[0]).toMatchObject({ realized_pnl: null, pnl_before_unconverted_fees: "20", fees_complete: false, basis_status: "fees_incomplete" });
    expect(r.holdings[0]).toMatchObject({ unrealized_pnl: null, pnl_before_unconverted_fees: "50", cost_basis: "100", fees_complete: false });
    expect(r.totals[0]).toMatchObject({ realized_pnl: null, unrealized_pnl: null, combined_pnl: null, known_realized_pnl: "0" });
  });

  it("unknown sell fees suppress net proceeds/P&L without discarding the known released basis", () => {
    const i = basic(); i.executions[1].fee = null;
    const sale = buildSpotPerformance(i).sales[0];
    expect(sale).toMatchObject({ matched_cost_basis: "100", net_proceeds: null, realized_pnl: null, pnl_before_unconverted_fees: "20" });
  });

  it("uses documented base/quote fee conventions, but not unexplained currency guesses", () => {
    const i = basic(); i.executions[0].fee_currency_source = "documented_convention";
    i.executions[0].fee = "2";
    expect(buildSpotPerformance(i).holdings[0].cost_basis).toBe("101");
  });

  it("does not substitute last prices or last fills for a missing matching bid", () => {
    const i = basic(); i.markets[0].bid_price = null;
    const r = buildSpotPerformance(i);
    expect(r.holdings[0]).toMatchObject({ cost_basis: "100", bid_price: null, market_value: null, unrealized_pnl: null });
    expect(r.sales[0].realized_pnl).toBe("20");
    expect(r.totals[0]).toMatchObject({ unrealized_pnl: null, combined_pnl: null, current_value: null });
    i.markets[0].quote_coin = "USDC";
    expect(buildSpotPerformance(i).holdings[0].bid_price).toBeNull();
  });

  it("wallet-only holdings have unknown purchase price/date, never current mark as entry", () => {
    const r = buildSpotPerformance(input([], [], "2"));
    expect(r.orders).toHaveLength(0);
    expect(r.holdings[0]).toMatchObject({ quantity: "2", known_quantity: "0", unknown_quantity: "2", first_buy_at: null,
      average_fill_price: null, cost_basis: null, unit_cost: null, unrealized_pnl: null, market_value: "300", basis_status: "unknown" });
  });

  it("derives unknown opening inventory from cashBalance minus change", () => {
    const r = buildSpotPerformance(input([execution("s", "Sell", "1", "120", 3)], [movement("s", "-1", "2", 3)], "2"));
    expect(r.sales[0]).toMatchObject({ matched_cost_basis: null, realized_pnl: null, pnl_before_unconverted_fees: null, basis_status: "unknown" });
    expect(r.sales[0].matches[0]).toMatchObject({ quantity: "1", buy_at: null, cost_basis: null });
    expect(r.holdings[0].unknown_quantity).toBe("2");
  });

  it("nontrade credits, splits and transfers create unknown lots, not purchases", () => {
    for (const type of ["TRANSFER_IN", "STOCK_SPLIT", "ADJUSTMENT", "INTEREST"]) {
      const r = buildSpotPerformance(input([], [movement("credit", "3", "3", 2, { type, category: "", trade_id: null })], "3"));
      expect(r.orders).toHaveLength(0);
      expect(r.holdings[0]).toMatchObject({ cost_basis: null, first_buy_at: null, unknown_quantity: "3" });
    }
  });

  it("withdrawal followed by the same-sized return does not magically preserve basis", () => {
    const r = buildSpotPerformance(input([execution("b", "Buy", "2", "100", 2)], [
      movement("b", "2", "2", 2), movement("out", "-2", "0", 3, { type: "TRANSFER_OUT", trade_id: null }),
      movement("in", "2", "2", 4, { type: "TRANSFER_IN", trade_id: null }),
    ], "2"));
    expect(r.sales).toHaveLength(0);
    expect(r.holdings[0]).toMatchObject({ cost_basis: null, first_buy_at: null, unknown_quantity: "2", unrealized_pnl: null });
  });

  it("interest/other debits consume FIFO without creating sales or financing P&L", () => {
    const r = buildSpotPerformance(input([execution("b", "Buy", "2", "100", 2)], [
      movement("b", "2", "2", 2), movement("interest", "-0.5", "1.5", 3, { type: "INTEREST", category: "linear", trade_id: null }),
    ], "1.5"));
    expect(r.sales).toHaveLength(0);
    expect(r.holdings[0]).toMatchObject({ quantity: "1.5", cost_basis: "150", unrealized_pnl: "75" });
    expect(r.notes.join(" ")).toContain("financing costs are outside");
  });

  it("borrowed base inventory is not assumed owned and has no investment P&L", () => {
    const i = basic(); i.wallets[0].spot_borrow = "0.25";
    const r = buildSpotPerformance(i);
    expect(r.holdings[0]).toMatchObject({ basis_status: "borrowed", quantity: "1", cost_basis: null, unrealized_pnl: null });
    expect(r.sales[0]).toMatchObject({ basis_status: "borrowed", realized_pnl: null });
  });

  it("missing executions/transaction rows do not synthesize fills, date or zero-cost profit", () => {
    const missingExec = input([], [movement("missing", "2", "2", 2)], "2");
    expect(codes(missingExec)).toContain("UNMATCHED_SPOT_TRADE");
    expect(buildSpotPerformance(missingExec).holdings[0]).toMatchObject({ basis_status: "unknown", cost_basis: null, first_buy_at: null });
    const noLog = input([execution("s", "Sell", "1", "120", 3)]);
    expect(buildSpotPerformance(noLog).sales[0]).toMatchObject({ inventory_quantity: "0", realized_pnl: null, matches: [] });
    expect(codes(noLog)).toContain("MISSING_EXECUTION_MOVEMENT");
  });

  it("partial history and syncing null performance even when current units reconcile", () => {
    for (const field of ["executions", "inventory", "syncing", "error"]) {
      const i = basic();
      if (field === "executions") i.coverage.executions_complete = false;
      if (field === "inventory") i.coverage.inventory_complete.BTC = false;
      if (field === "syncing") i.coverage.syncing = true;
      if (field === "error") i.coverage.error = "incomplete window";
      const r = buildSpotPerformance(i);
      expect(r.holdings[0].unrealized_pnl).toBeNull();
      expect(r.sales[0].realized_pnl).toBeNull();
      expect(r.totals[0].combined_pnl).toBeNull();
    }
  });

  it("displays current wallet units on mismatch without changing historical FIFO matches or inventing a trade", () => {
    const i = basic();
    const original = buildSpotPerformance(i);
    i.wallets[0].quantity = "7";
    const r = buildSpotPerformance(i);
    expect(r.holdings).toHaveLength(1);
    expect(r.holdings[0]).toMatchObject({ quantity: "7", known_quantity: "0", unknown_quantity: "7",
      reconciled: false, basis_status: "mismatch", cost_basis: null, unit_cost: null, average_fill_price: null,
      first_buy_at: null, last_buy_at: null, unrealized_pnl: null, pnl_before_unconverted_fees: null,
      market_value: "1050", fees_complete: false });
    expect(r.holdings[0].lots).toHaveLength(1);
    expect(r.holdings[0].lots[0]).toMatchObject({ quantity: "7", buy_at: null, cost_basis: null, quote_coin: null });
    expect(r.holdings[0].note).toContain("original ledger ending quantity 1 and ledger lots quantity 1 are unchanged");
    expect(r.orders).toHaveLength(2);
    expect(r.sales[0].matches).toEqual(original.sales[0].matches);
    expect(r.sales[0]).toMatchObject({ inventory_quantity: "1", executed_quantity: "1", quote_value: "120",
      matched_cost_basis: null, realized_pnl: null, pnl_before_unconverted_fees: null });
    expect(codes(i)).toContain("WALLET_RECONCILIATION");
    // Rebuilding with the reconciled snapshot still recovers the untouched known lots.
    i.wallets[0].quantity = "1";
    expect(buildSpotPerformance(i)).toEqual(original);
  });

  it("flags ledger discontinuity even when the final wallet matches", () => {
    const i = basic(); i.movements[1].balance_after = "2"; i.wallets[0].quantity = "2";
    const r = buildSpotPerformance(i);
    expect(codes(i)).toContain("LEDGER_DISCONTINUITY");
    expect(r.holdings[0].unrealized_pnl).toBeNull();
    expect(r.sales[0].realized_pnl).toBeNull();
  });

  it("checks execution-vs-ledger net quantities without substituting gross quantities", () => {
    const i = basic(); i.movements[0].change = "1.9"; i.movements[0].balance_after = "1.9";
    i.movements[1].balance_after = "0.9"; i.wallets[0].quantity = "0.9";
    expect(codes(i)).toContain("EXECUTION_LEDGER_MISMATCH");
    expect(buildSpotPerformance(i).holdings[0]).toMatchObject({ quantity: "0.9", unrealized_pnl: null });
  });

  it("orders same-time trades by balance chain rather than IDs/input order", () => {
    const r = buildSpotPerformance(input([
      execution("z-buy", "Buy", "2", "100", 2), execution("a-sell", "Sell", "1", "120", 2),
    ], [movement("a-sell", "-1", "1", 2), movement("z-buy", "2", "2", 2)], "1"));
    expect(r.sales[0]).toMatchObject({ matched_cost_basis: "100", realized_pnl: "20" });
    expect(r.warnings).toHaveLength(0);
  });

  it("same-time monotone buys start at the smallest before-balance", () => {
    const r = buildSpotPerformance(input([
      execution("z", "Buy", "1", "100", 2), execution("a", "Buy", "1", "200", 2), execution("s", "Sell", "1", "150", 3),
    ], [movement("a", "1", "2", 2), movement("z", "1", "1", 2), movement("s", "-1", "1", 3)], "1"));
    expect(r.sales[0].realized_pnl).toBe("50");
    expect(r.holdings[0].cost_basis).toBe("200");
  });

  it("mixed same-time cycles with ambiguous opening never choose profitable FIFO", () => {
    const i = input([execution("b", "Buy", "1", "100", 2), execution("s", "Sell", "1", "200", 2)],
      [movement("b", "1", "1", 2), movement("s", "-1", "0", 2)], "0");
    const r = buildSpotPerformance(i);
    expect(codes(i)).toContain("AMBIGUOUS_BALANCE_CHAIN");
    expect(r.sales[0].realized_pnl).toBeNull();
    expect(buildSpotPerformance({ ...i, executions: [...i.executions].reverse(), movements: [...i.movements].reverse() })).toEqual(r);
  });

  it("zero-change tie events are safe and deterministic", () => {
    const i = basic();
    i.movements.push(movement("zero1", "0", "2", 2, { type: "ADJUSTMENT", trade_id: null }), movement("zero2", "0", "2", 2, { type: "ADJUSTMENT", trade_id: null }));
    expect(buildSpotPerformance(i).sales[0].realized_pnl).toBe("20");
  });

  it("does not attribute an earlier sell/transfer to a future purchase", () => {
    const i = input([execution("s", "Sell", "1", "120", 2), execution("b", "Buy", "1", "100", 3)],
      [movement("s", "-1", "0", 2), movement("b", "1", "1", 3)], "1");
    const r = buildSpotPerformance(i);
    expect(r.sales[0]).toMatchObject({ realized_pnl: null, matched_cost_basis: null });
    expect(r.sales[0].matches[0].buy_at).toBeNull();
    expect(r.holdings[0]).toMatchObject({ cost_basis: "100", first_buy_at: at(3) });
    i.movements[1].timestamp = at(2);
    expect(codes(i)).toContain("UNMATCHED_SPOT_TRADE");
  });

  it("deduplicates identical execution and movement IDs once", () => {
    const i = basic(); i.executions.push({ ...i.executions[0] }); i.movements.push({ ...i.movements[0] });
    const r = buildSpotPerformance(i);
    expect(r.orders).toHaveLength(2);
    expect(r.orders.find(o => o.side === "Buy")?.fill_count).toBe(1);
    expect(r.holdings[0].cost_basis).toBe("100");
  });

  it("conflicting duplicate execution IDs trust neither version", () => {
    const i = basic(); i.executions.push({ ...i.executions[0], price: "50", quote_value: "100" });
    const r = buildSpotPerformance(i);
    expect(codes(i)).toContain("CONFLICTING_EXECUTION");
    expect(r.sales[0].realized_pnl).toBeNull();
    expect(r.holdings[0].unrealized_pnl).toBeNull();
    expect(r.orders.filter(o => o.side === "Buy")).toHaveLength(0);
  });

  it("conflicting transaction IDs invalidate basis", () => {
    const i = basic(); i.movements.push({ ...i.movements[0], balance_after: "3" });
    expect(codes(i)).toContain("CONFLICTING_MOVEMENT");
    expect(buildSpotPerformance(i).sales[0].realized_pnl).toBeNull();
  });

  it("never converts native quote currencies or merges different quote-cost lots", () => {
    const i = input([
      execution("b1", "Buy", "1", "100", 2),
      execution("b2", "Buy", "1", "200", 3, { symbol: "BTCUSDC", quote_coin: "USDC" }),
    ], [movement("b1", "1", "1", 2), movement("b2", "1", "2", 3)], "2");
    i.markets.push({ ...i.markets[0], symbol: "BTCUSDC", quote_coin: "USDC", bid_price: "220" });
    const r = buildSpotPerformance(i);
    expect(r.holdings).toHaveLength(2);
    expect(r.totals.map(t => [t.quote_coin, t.unrealized_pnl])).toEqual([["USDC", "20"], ["USDT", "50"]]);
    i.executions.push(execution("s", "Sell", "1", "130", 4, { symbol: "BTCUSDC", quote_coin: "USDC" }));
    i.movements.push(movement("s", "-1", "1", 4)); i.wallets[0].quantity = "1";
    expect(buildSpotPerformance(i).sales[0].matched_cost_basis).toBeNull();
  });

  it("cross-asset quote spending consumes lots but flags unsupported disposal instead of fabricating gains", () => {
    const i = input([
      execution("b", "Buy", "2", "100", 2),
      execution("eth", "Buy", "10", "0.1", 3, { symbol: "ETHBTC", base_coin: "ETH", quote_coin: "BTC" }),
    ], [movement("b", "2", "2", 2), movement("eth", "-1", "1", 3), movement("eth", "10", "10", 3, { coin: "ETH" })], "1");
    i.wallets.push({ coin: "ETH", quantity: "10", spot_borrow: "0" });
    i.markets.push({ symbol: "ETHBTC", base_coin: "ETH", quote_coin: "BTC", bid_price: "0.2", last_price: "1", observed_at: at(20) });
    const r = buildSpotPerformance(i);
    expect(codes(i)).toContain("UNSUPPORTED_CROSS_CURRENCY");
    expect(r.sales).toHaveLength(0);
    expect(r.holdings.find(h => h.asset === "BTC")?.unrealized_pnl).toBeNull();
    expect(r.holdings.find(h => h.asset === "ETH")?.unrealized_pnl).toBe("1");
  });

  it("cash conversions remain execution history only; stablecoin holdings are excluded", () => {
    const i = input([execution("cash", "Sell", "100", "0.99", 2, { symbol: "USDCUSDT", base_coin: "USDC", quote_coin: "USDT" })]);
    i.wallets.push({ coin: "USDT", quantity: "10000", spot_borrow: "0" }, { coin: "USDC", quantity: "500", spot_borrow: "0" });
    const r = buildSpotPerformance(i);
    expect(r.holdings).toEqual([]);
    expect(r.totals).toEqual([]);
    expect(r.orders[0]).toMatchObject({ quote_value: "99", realized_pnl: null });
    expect(r.orders[0].note).toContain("Cash-conversion");
  });

  it("retains exact very large financial values and very small inventory quantities", () => {
    const i = input([execution("b", "Buy", "0.00000000000000000001", "1", 2,
      { quote_value: "123456789012345678901234567890.123456789012345678901" })],
      [movement("b", "0.00000000000000000001", "0.00000000000000000001", 2)], "0.00000000000000000001");
    i.markets[0].bid_price = "12345678901234567890123456789012345678901234567890.1";
    const r = buildSpotPerformance(i);
    expect(r.holdings[0].quantity).toBe("0.00000000000000000001");
    expect(r.holdings[0].cost_basis).toBe("123456789012345678901234567890.123456789012345678901");
    expect(r.holdings[0].market_value).toBe("123456789012345678901234567890.123456789012345678901");
    expect(r.holdings[0].unrealized_pnl).toBe("0");
  });

  it("releases prorated repeating-decimal cost exactly on the final portion", () => {
    const i = input([execution("b", "Buy", "3", "1", 2, { quote_value: "1" }),
      execution("s1", "Sell", "1", "1", 3), execution("s2", "Sell", "1", "1", 4), execution("s3", "Sell", "1", "1", 5)],
    [movement("b", "3", "3", 2), movement("s1", "-1", "2", 3), movement("s2", "-1", "1", 4), movement("s3", "-1", "0", 5)]);
    const r = buildSpotPerformance(i);
    const Exact = Decimal.clone({ precision: 110 });
    expect(r.sales.reduce((s, sale) => s.plus(sale.matched_cost_basis!), new Exact(0)).toFixed()).toBe("1");
    expect(r.holdings).toEqual([]);
  });

  it("only tolerates one absolute ledger quantum for wallet reconciliation", () => {
    const i = basic(); i.wallets[0].quantity = "1.0000000000001";
    expect(buildSpotPerformance(i).holdings[0].reconciled).toBe(true);
    i.wallets[0].quantity = "1.00000001";
    expect(buildSpotPerformance(i).holdings[0].reconciled).toBe(true);
    i.wallets[0].quantity = "1.0000000100001";
    expect(buildSpotPerformance(i).holdings[0].reconciled).toBe(false);
  });

  it("exact tiny same-time changes are not conflated by the reconciliation tolerance", () => {
    const i = input([
      execution("z", "Buy", "0.00000000000000000001", "100", 2),
      execution("a", "Buy", "0.00000000000000000001", "200", 2),
      execution("s", "Sell", "0.00000000000000000001", "150", 3),
    ], [movement("a", "0.00000000000000000001", "0.00000000000000000002", 2),
      movement("z", "0.00000000000000000001", "0.00000000000000000001", 2),
      movement("s", "-0.00000000000000000001", "0.00000000000000000001", 3)], "0.00000000000000000001");
    const r = buildSpotPerformance(i);
    expect(r.warnings).toHaveLength(0);
    expect(r.sales[0].realized_pnl).toBe("0.0000000000000000005");
    expect(r.holdings[0].cost_basis).toBe("0.000000000000000002");
  });

  it("missing sales and conflicting fills cannot turn affected quote totals into false zero", () => {
    const i = input([execution("b", "Buy", "1", "100", 2)], [], "0");
    const r = buildSpotPerformance(i);
    expect(r.totals[0]).toMatchObject({ realized_pnl: null, unrealized_pnl: null,
      combined_pnl: null, known_realized_pnl: "0", known_unrealized_pnl: "0" });
    i.executions.push({ ...i.executions[0], quantity: "2" });
    expect(buildSpotPerformance(i).totals[0].combined_pnl).toBeNull();
  });

  it("displays an explicitly unknown wallet holding when the ledger closes at zero", () => {
    const i = basic(); i.movements.push(movement("out", "-1", "0", 4, { type: "TRANSFER_OUT", trade_id: null }));
    const r = buildSpotPerformance(i);
    expect(r.holdings[0]).toMatchObject({ quantity: "1", unknown_quantity: "1", reconciled: false,
      cost_basis: null, first_buy_at: null, basis_status: "mismatch", unrealized_pnl: null });
    expect(r.holdings[0].note).toContain("ledger ending quantity 0");
    expect(r.orders).toHaveLength(2);
  });

  it("retains valid known P&L subtotals while unknown positions prevent a complete quote total", () => {
    const i = basic();
    i.wallets.push({ coin: "ETH", quantity: "1", spot_borrow: "0" });
    i.markets.push({ symbol: "ETHUSDT", base_coin: "ETH", quote_coin: "USDT", bid_price: "20", last_price: "25", observed_at: at(20) });
    const r = buildSpotPerformance(i);
    expect(r.totals[0]).toMatchObject({ known_realized_pnl: "20", known_unrealized_pnl: "50", realized_pnl: "20",
      unrealized_pnl: null, combined_pnl: null, unknown_position_count: 1, remaining_cost: null });
  });

  it("an anchored same-time buy/sell cycle has a unique known ordering", () => {
    const i = input([execution("b", "Buy", "1", "100", 3), execution("s", "Sell", "1", "200", 3)],
      [movement("anchor", "0", "0", 2, { type: "ADJUSTMENT", trade_id: null }),
        movement("s", "-1", "0", 3), movement("b", "1", "1", 3)], "0");
    const r = buildSpotPerformance(i);
    expect(r.sales[0].realized_pnl).toBe("100");
    expect(r.warnings).toHaveLength(0);
  });

  it("invalid zero/missing quote values do not create free lots", () => {
    const i = basic(); i.executions[0].quote_value = "0";
    expect(codes(i)).toContain("INVALID_EXECUTION");
    expect(buildSpotPerformance(i).sales[0].realized_pnl).toBeNull();
    i.executions[0].quote_value = "";
    expect(buildSpotPerformance(i).holdings[0].cost_basis).toBeNull();
  });

  it("does not merge reused order IDs across symbols or sides and sums actual fee currencies separately", () => {
    const i = input([
      execution("b1", "Buy", "1", "100", 2, { order_id: "shared", fee: "1", fee_currency_source: "reported" }),
      execution("b2", "Buy", "1", "200", 3, { order_id: "shared", fee: "0.1", fee_currency: "BTC", fee_currency_source: "reported" }),
      execution("s", "Sell", "1", "150", 4, { order_id: "shared" }),
      execution("eth", "Buy", "1", "20", 5, { order_id: "shared", base_coin: "ETH", symbol: "ETHUSDT" }),
    ], [movement("b1", "1", "1", 2), movement("b2", "0.9", "1.9", 3), movement("s", "-1", "0.9", 4),
      movement("eth", "1", "1", 5, { coin: "ETH" })], "0.9");
    i.wallets.push({ coin: "ETH", quantity: "1", spot_borrow: "0" });
    const r = buildSpotPerformance(i);
    expect(r.orders).toHaveLength(3);
    expect(r.sales).toHaveLength(1);
    expect(r.orders[0].symbol).toBe("ETHUSDT");
    expect(r.orders[2]).toMatchObject({ executed_quantity: "2", inventory_quantity: "1.9", average_fill_price: "150",
      fees: [{ coin: "BTC", amount: "0.1" }, { coin: "USDT", amount: "1" }] });
  });

  it("mixed known/unknown FIFO basis remains unknown until the unknown units are consumed", () => {
    const i = input([execution("b", "Buy", "2", "100", 3), execution("s", "Sell", "2", "150", 4)],
      [movement("transfer", "1", "1", 2, { type: "TRANSFER_IN", trade_id: null }), movement("b", "2", "3", 3), movement("s", "-2", "1", 4)], "1");
    const r = buildSpotPerformance(i);
    expect(r.sales[0]).toMatchObject({ realized_pnl: null, matched_cost_basis: null, pnl_before_unconverted_fees: null });
    expect(r.sales[0].matches.map(m => m.cost_basis)).toEqual([null, "100"]);
    expect(r.holdings[0]).toMatchObject({ cost_basis: "100", unrealized_pnl: "50", first_buy_at: at(3) });
  });

  it("missing borrowing metadata cannot silently classify all wallet units as owned", () => {
    const i = basic(); i.wallets[0].spot_borrow = null;
    expect(codes(i)).toContain("UNKNOWN_BORROW");
    expect(buildSpotPerformance(i).holdings[0].unrealized_pnl).toBeNull();
  });

  it.each(["0", "-1", null])("omits phantom ledger holdings when current wallet quantity is %s", quantity => {
    const i = basic(); i.wallets[0].quantity = quantity;
    const r = buildSpotPerformance(i);
    expect(r.holdings).toEqual([]);
    expect(r.sales).toHaveLength(1);
    expect(r.sales[0].matches).toEqual([{ buy_at: at(2), buy_order_id: "order-b", quantity: "1", buy_fill_price: "100", cost_basis: "100" }]);
    expect(r.sales[0].realized_pnl).toBeNull();
    expect(r.orders).toHaveLength(2);
    expect(codes(i)).toContain("WALLET_RECONCILIATION");
    expect(r.totals[0].combined_pnl).toBeNull();
  });

  it("omits old lots for a coin absent from the current wallet response", () => {
    const i = basic(); i.wallets = [];
    const r = buildSpotPerformance(i);
    expect(r.holdings).toEqual([]);
    expect(r.sales).toHaveLength(1);
    expect(codes(i)).toContain("WALLET_RECONCILIATION");
  });

  it("collapses mismatched multi-quote ledger lots into one unknown current-wallet row", () => {
    const i = input([
      execution("b1", "Buy", "1", "100", 2),
      execution("b2", "Buy", "2", "200", 3, { symbol: "BTCUSDC", quote_coin: "USDC" }),
    ], [movement("b1", "1", "1", 2), movement("b2", "2", "3", 3)], "0.5");
    const r = buildSpotPerformance(i);
    expect(r.holdings).toHaveLength(1);
    expect(r.holdings[0]).toMatchObject({ quantity: "0.5", known_quantity: "0", unknown_quantity: "0.5",
      cost_basis: null, first_buy_at: null, quote_coin: "USDT", basis_status: "mismatch" });
    expect(r.holdings[0].note).toContain("ledger ending quantity 3");
    expect(r.orders.map(o => o.executed_quantity)).toEqual(["2", "1"]);
    expect(r.sales).toEqual([]);
  });

  it("prefers USDT, then USDC, then deterministic other valuation quotes for unknown basis", () => {
    const i = input([], [], "2");
    const template = i.markets[0];
    i.markets = [
      { ...template, symbol: "BTCBRL", quote_coin: "BRL", bid_price: "1000" },
      { ...template, symbol: "BTCUSDC", quote_coin: "USDC", bid_price: "149" },
      template,
      { ...template, symbol: "BTCEUR", quote_coin: "EUR", bid_price: "130" },
    ];
    for (const [quote, value] of [["USDT", "300"], ["USDC", "298"], ["BRL", "2000"]]) {
      const h = buildSpotPerformance(i).holdings[0];
      expect(h).toMatchObject({ quote_coin: quote, market_value: value, cost_basis: null, first_buy_at: null,
        average_fill_price: null, unit_cost: null, unrealized_pnl: null });
      expect(h.lots[0].quote_coin).toBeNull();
      expect(h.note).toContain(`${quote} is the current valuation quote only, not a known purchase quote`);
      i.markets = i.markets.filter(m => m.quote_coin !== quote);
    }
  });

  it("keeps the known purchase quote even when a USDT valuation market exists", () => {
    const i = input([execution("b", "Buy", "1", "100", 2, { quote_coin: "BRL", symbol: "BTCBRL" })],
      [movement("b", "1", "1", 2)], "1");
    i.markets.push({ ...i.markets[0], quote_coin: "BRL", symbol: "BTCBRL", bid_price: "110" });
    expect(buildSpotPerformance(i).holdings[0]).toMatchObject({ quote_coin: "BRL", market_value: "110", unrealized_pnl: "10" });
  });

  it("does not create or erase positive dust using the absolute rounding tolerance", () => {
    const dust = "0.00000000000000000001";
    const i = basic();
    i.movements.push(movement("out", "-1", "0", 4, { type: "TRANSFER_OUT", trade_id: null }));
    i.wallets[0].quantity = dust;
    expect(buildSpotPerformance(i).holdings[0]).toMatchObject({ quantity: dust, unknown_quantity: dust,
      known_quantity: "0", reconciled: false, basis_status: "mismatch", cost_basis: null, first_buy_at: null });
    const tiny = input([execution("dust", "Buy", dust, "100", 2)], [movement("dust", dust, dust, 2)], "0");
    expect(buildSpotPerformance(tiny).holdings).toEqual([]);
    expect(codes(tiny)).toContain("WALLET_RECONCILIATION");
    tiny.wallets[0].quantity = dust;
    expect(buildSpotPerformance(tiny).holdings[0]).toMatchObject({ quantity: dust, known_quantity: dust,
      unknown_quantity: "0", reconciled: true, basis_status: "known" });
  });

  it("retains precise FIFO units and basis for a tolerated wallet rounding difference without rescaling", () => {
    const i = basic(); i.wallets[0].quantity = "1.0000000000001";
    const r = buildSpotPerformance(i);
    expect(r.holdings[0]).toMatchObject({ quantity: "1", known_quantity: "1", unknown_quantity: "0",
      reconciled: true, basis_status: "known", cost_basis: "100", unit_cost: "100", unrealized_pnl: "50" });
    expect(r.holdings[0].note).toContain("Exact fill quantity reconciles with the wallet at its reported precision");
    expect(r.holdings[0].note).toContain("reported wallet quantity 1.0000000000001 BTC");
    expect(r.sales[0]).toMatchObject({ matched_cost_basis: "100", realized_pnl: "20" });
  });

  it.each(["before", "after"])("suppresses P&L for executions %s the declared coverage range", direction => {
    const i = basic();
    if (direction === "before") i.coverage.from = at(3);
    else i.coverage.through = at(2);
    const r = buildSpotPerformance(i);
    expect(codes(i)).toContain("EXECUTION_OUTSIDE_COVERAGE");
    expect(r.orders).toHaveLength(2);
    expect(r.sales[0].realized_pnl).toBeNull();
    expect(r.holdings[0].unrealized_pnl).toBeNull();
    expect(r.totals[0].combined_pnl).toBeNull();
  });

  it("syncing never publishes net or before-fees P&L, including executions past the current through cutoff", () => {
    const i = basic(); i.coverage.syncing = true; i.coverage.through = at(2);
    i.executions[0].fee = null;
    const r = buildSpotPerformance(i);
    expect(r.status).toBe("syncing");
    expect(r.sales[0]).toMatchObject({ realized_pnl: null, pnl_before_unconverted_fees: null });
    expect(r.holdings[0]).toMatchObject({ unrealized_pnl: null, pnl_before_unconverted_fees: null });
    expect(r.totals[0]).toMatchObject({ realized_pnl: null, unrealized_pnl: null, combined_pnl: null });
  });

  it("uses precise base-fee net units across rounded partial fills without accumulating ledger drift", () => {
    const Exact = Decimal.clone({ precision: 100 });
    const net = new Exact("0.123332544"); // 0.123456 gross less an actual 9dp base fee.
    const i = input([], [movement("anchor", "0", "0", 1, { type: "ADJUSTMENT", trade_id: null })]);
    for (let n = 1; n <= 7; n++) {
      i.executions.push(execution(`b${n}`, "Buy", "0.123456", "100", n + 1,
        { order_id: "partial-buy", fee: "0.000123456", fee_currency: "BTC", fee_currency_source: "reported" }));
      i.movements.push(movement(`b${n}`, net.toDecimalPlaces(8).toFixed(), net.times(n).toDecimalPlaces(8).toFixed(), n + 1));
    }
    i.wallets[0].quantity = net.times(7).toFixed();
    const roundedChangeSum = net.toDecimalPlaces(8).times(7);
    expect(new Exact(i.movements[7].balance_after).minus(roundedChangeSum).toFixed()).toBe("0.00000003");
    const purchases = buildSpotPerformance(i);
    expect(purchases.warnings).toEqual([]);
    expect(purchases.holdings[0]).toMatchObject({ quantity: "0.863327808", known_quantity: "0.863327808",
      cost_basis: "86.4192", average_fill_price: "100", basis_status: "known", reconciled: true });
    expect(purchases.orders[0]).toMatchObject({ fill_count: 7, inventory_quantity: "0.863327808", quote_value: "86.4192" });
    expect(purchases.holdings[0].lots.every(l => l.quantity === net.toFixed())).toBe(true);
    expect(purchases.holdings[0].note).toContain("absolute 0.00000001 BTC quantum");

    // Precisely release one full lot, then half of the next; both sell changes
    // are independently rounded in the ledger, and base sale fees remain 9dp.
    let remaining = net.times(7);
    for (const [id, removed, day] of [["s1", net, 9], ["s2", net.div(2), 10]] as const) {
      const gross = removed.minus("0.000000009");
      remaining = remaining.minus(removed);
      i.executions.push(execution(id, "Sell", gross.toFixed(), "120", day,
        { fee: "0.000000009", fee_currency: "BTC", fee_currency_source: "reported" }));
      i.movements.push(movement(id, removed.negated().toDecimalPlaces(8).toFixed(), remaining.toDecimalPlaces(8).toFixed(), day));
    }
    i.wallets[0].quantity = remaining.toFixed();
    const r = buildSpotPerformance(i);
    expect(r.warnings).toEqual([]);
    expect(r.holdings[0]).toMatchObject({ quantity: "0.678328992", cost_basis: "67.9008", first_buy_at: at(3),
      last_buy_at: at(8), basis_status: "known", reconciled: true });
    expect(r.sales.map(s => s.matched_cost_basis)).toEqual(["6.1728", "12.3456"]);
    expect(r.sales.map(s => s.inventory_quantity)).toEqual(["0.061666272", "0.123332544"]);
    expect(r.sales.every(s => s.realized_pnl !== null)).toBe(true);
    const released = r.sales.reduce((total, sale) => total.plus(sale.matched_cost_basis!), new Exact(0));
    expect(released.plus(r.holdings[0].cost_basis!).toFixed()).toBe("86.4192");
    expect(r.holdings[0].lots[0].quantity).toBe("0.061666272");

    // A rounded wallet corroborates, but never rewrites, genuine precise lots.
    i.wallets[0].quantity = remaining.toDecimalPlaces(8).toFixed();
    const roundedWallet = buildSpotPerformance(i);
    expect(roundedWallet.holdings[0]).toMatchObject({ quantity: "0.678328992", reconciled: true,
      cost_basis: "67.9008", basis_status: "known", unrealized_pnl: r.holdings[0].unrealized_pnl });
    expect(roundedWallet.holdings[0].lots).toEqual(r.holdings[0].lots);
    expect(roundedWallet.holdings[0].note).toContain("Exact fill quantity reconciles with the wallet at its reported precision");
    expect(roundedWallet.holdings[0].note).toContain("reported wallet quantity 0.67832899 BTC");
    expect(roundedWallet.sales.map(s => s.matched_cost_basis)).toEqual(["6.1728", "12.3456"]);
    expect(codes(i)).not.toContain("WALLET_RECONCILIATION");
  });

  it("orders rounded same-time changes against the precise running balance, not cumulative rounded deltas", () => {
    const Exact = Decimal.clone({ precision: 100 });
    const net = new Exact("0.123332544");
    const i = input([], [movement("anchor", "0", "0", 1, { type: "ADJUSTMENT", trade_id: null })]);
    for (let n = 1; n <= 7; n++) {
      i.executions.push(execution(`b${n}`, "Buy", "0.123456", "100", 2,
        { fee: "0.000123456", fee_currency: "BTC", fee_currency_source: "reported" }));
      i.movements.push(movement(`b${n}`, net.toDecimalPlaces(8).toFixed(), net.times(n).toDecimalPlaces(8).toFixed(), 2));
    }
    i.movements.reverse();
    i.wallets[0].quantity = net.times(7).toFixed();
    const r = buildSpotPerformance(i);
    expect(r.warnings).toEqual([]);
    expect(r.holdings[0]).toMatchObject({ quantity: "0.863327808", cost_basis: "86.4192", reconciled: true, basis_status: "known" });
    expect(r.holdings[0].lots.map(l => l.id)).toEqual(["b1", "b2", "b3", "b4", "b5", "b6", "b7"]);
  });

  it("preserves 18dp ledger precision instead of loosening it to an 8dp tolerance", () => {
    const qty = "0.123456789012345678";
    const i = input([execution("b", "Buy", qty, "1", 2)], [movement("b", qty, qty, 2)], qty);
    expect(buildSpotPerformance(i).holdings[0]).toMatchObject({ quantity: qty, basis_status: "known", reconciled: true });
    expect(buildSpotPerformance(i).holdings[0].note).toContain("absolute 0.000000000000000001 BTC quantum");
    i.wallets[0].quantity = "0.12345678901234568";
    expect(codes(i)).toContain("WALLET_RECONCILIATION");
    i.wallets[0].quantity = qty;
    i.executions[0].quantity = "0.123456789012345680";
    expect(codes(i)).toContain("EXECUTION_LEDGER_MISMATCH");
    expect(buildSpotPerformance(i).holdings[0].unrealized_pnl).toBeNull();
  });

  it("infers precision per asset so a coarsely reported other coin does not weaken precise BTC checks", () => {
    const qty = "0.000000000000000001";
    const i = input([execution("b", "Buy", qty, "1", 2)], [movement("b", qty, qty, 2)], "0.000000000000000004");
    i.movements.push(movement("eth-credit", "1", "1", 2, { coin: "ETH", type: "TRANSFER_IN", trade_id: null }));
    i.wallets.push({ coin: "ETH", quantity: "1", spot_borrow: "0" });
    expect(buildSpotPerformance(i).holdings.find(h => h.asset === "BTC")).toMatchObject({ basis_status: "mismatch", reconciled: false });
  });

  it("rejects a material reported change or cash-balance mismatch beyond the bounded quantum", () => {
    const i = input([execution("b", "Buy", "0.123456", "100", 2,
      { fee: "0.000123456", fee_currency: "BTC", fee_currency_source: "reported" })],
      [movement("b", "0.12333252", "0.12333252", 2)], "0.123332544");
    expect(codes(i)).toContain("EXECUTION_LEDGER_MISMATCH");
    expect(buildSpotPerformance(i).holdings[0].unrealized_pnl).toBeNull();
    i.movements[0].change = "0.12333254";
    i.movements[0].balance_after = "0.12333254";
    i.movements.unshift(movement("anchor", "0", "0", 1, { type: "ADJUSTMENT", trade_id: null }));
    i.movements[1].balance_after = "0.12333256"; // after differs by 1.6 quanta.
    expect(codes(i)).toContain("LEDGER_DISCONTINUITY");
    expect(buildSpotPerformance(i).holdings[0].unrealized_pnl).toBeNull();
  });

  it("does not hide an absolute material gap on large balances behind a relative tolerance", () => {
    const i = input([execution("b", "Buy", "100000000000000000000", "1", 2)],
      [movement("b", "100000000000000000000", "100000000000000000000", 2)], "100000000000000000000.00000002");
    expect(codes(i)).toContain("WALLET_RECONCILIATION");
  });

  it("allows two quanta for derived before balances but only one for reported after balances", () => {
    const i = input([execution("b1", "Buy", "1.000000005", "1", 2), execution("b2", "Buy", "1.000000005", "1", 3)],
      [movement("b1", "1", "1", 2), movement("b2", "1.00000001", "2", 3)], "2.00000001");
    // The second derived before is 0.99999999, 1.5 quanta below the running
    // 1.000000005; its after balance differs by exactly one quantum.
    const r = buildSpotPerformance(i);
    expect(r.warnings).toEqual([]);
    expect(r.holdings[0]).toMatchObject({ quantity: "2.00000001", cost_basis: "2.00000001", reconciled: true, basis_status: "known" });
    i.movements[1].balance_after = "1.99999999";
    expect(codes(i)).toContain("LEDGER_DISCONTINUITY");
    expect(buildSpotPerformance(i).holdings[0].unrealized_pnl).toBeNull();
  });

  it("uses precise base rebates rather than rounded net credit quantities", () => {
    const i = input([execution("b", "Buy", "0.123456", "100", 2,
      { fee: "-0.000123456", fee_currency: "BTC", fee_currency_source: "reported" })],
      [movement("b", "0.12357946", "0.12357946", 2)], "0.123579456");
    const r = buildSpotPerformance(i);
    expect(r.warnings).toEqual([]);
    expect(r.holdings[0]).toMatchObject({ quantity: "0.123579456", cost_basis: "12.3456", reconciled: true });
    expect(r.orders[0].inventory_quantity).toBe("0.123579456");
  });

  it("uses the corroborated ledger change when base fees are unknown, without assuming a zero fee", () => {
    const i = input([execution("b", "Buy", "0.123456", "100", 2,
      { fee: null, fee_currency: "BTC", fee_currency_source: "reported" })],
      [movement("b", "0.12333254", "0.12333254", 2)], "0.12333254");
    const r = buildSpotPerformance(i);
    expect(r.holdings[0]).toMatchObject({ quantity: "0.12333254", cost_basis: "12.3456", fees_complete: false,
      basis_status: "fees_incomplete", unrealized_pnl: null, reconciled: true });
    expect(r.orders[0].inventory_quantity).toBe("0.12333254");
    expect(codes(i)).not.toContain("EXECUTION_LEDGER_MISMATCH");
  });

  it("keeps rounding-ambiguous tiny same-time cycles unknown rather than choosing profitable FIFO", () => {
    const i = input([execution("b", "Buy", "0.000000002", "100", 2), execution("s", "Sell", "0.000000001", "200", 2)],
      [movement("b", "0", "0", 2), movement("s", "0", "0", 2)], "0.000000001");
    const r = buildSpotPerformance(i);
    expect(codes(i)).toContain("AMBIGUOUS_BALANCE_CHAIN");
    expect(r.sales[0].realized_pnl).toBeNull();
    expect(r.holdings[0].unrealized_pnl).toBeNull();
  });

  it("preserves precise positive execution dust even when its corroborating ledger fields round to zero", () => {
    const i = input([execution("b", "Buy", "0.000000001", "100", 2)],
      [movement("b", "0", "0", 2)], "0.000000001");
    const r = buildSpotPerformance(i);
    expect(r.warnings).toEqual([]);
    expect(r.holdings[0]).toMatchObject({ quantity: "0.000000001", known_quantity: "0.000000001",
      basis_status: "known", reconciled: true });
    expect(r.orders[0].inventory_quantity).toBe("0.000000001");
  });

  it("keeps known current P&L when a rounded 8dp wallet corroborates precise 9dp fill inventory", () => {
    const i = input([execution("b", "Buy", "0.123456784", "100", 2)],
      [movement("b", "0.12345678", "0.12345678", 2)], "0.12345678");
    const r = buildSpotPerformance(i);
    expect(r.status).toBe("ready");
    expect(r.warnings).toEqual([]);
    expect(r.holdings[0]).toMatchObject({ quantity: "0.123456784", known_quantity: "0.123456784", unknown_quantity: "0",
      reconciled: true, basis_status: "known", first_buy_at: at(2), average_fill_price: "100", unit_cost: "100",
      cost_basis: "12.3456784", market_value: "18.5185176", unrealized_pnl: "6.1728392" });
    expect(r.holdings[0].lots[0]).toMatchObject({ id: "b", quantity: "0.123456784", cost_basis: "12.3456784" });
    expect(r.holdings[0].note).toContain("Exact fill quantity reconciles with the wallet at its reported precision");
    expect(r.holdings[0].note).toContain("reported wallet quantity 0.12345678 BTC");
    expect(r.totals[0]).toMatchObject({ unrealized_pnl: "6.1728392", combined_pnl: "6.1728392" });

    // Material differences retain the wallet-only unknown-basis fallback.
    i.wallets[0].quantity = "0.1234567";
    const material = buildSpotPerformance(i);
    expect(material.holdings[0]).toMatchObject({ quantity: "0.1234567", known_quantity: "0", unknown_quantity: "0.1234567",
      reconciled: false, basis_status: "mismatch", cost_basis: null, unit_cost: null, first_buy_at: null, unrealized_pnl: null });
    expect(material.holdings[0].note).not.toContain("Exact fill quantity reconciles");
    i.wallets[0].quantity = "0";
    expect(buildSpotPerformance(i).holdings).toEqual([]);
  });

  it.each(["borrowed", "history-gap", "unknown-fee", "extra-fees"])("wallet precision reconciliation does not bypass %s safeguards", kind => {
    const i = input([execution("b", "Buy", "0.123456784", "100", 2)],
      [movement("b", "0.12345678", "0.12345678", 2)], "0.12345678");
    if (kind === "borrowed") i.wallets[0].spot_borrow = "0.01";
    if (kind === "history-gap") i.coverage.inventory_complete.BTC = false;
    if (kind === "unknown-fee") i.executions[0].fee = null;
    if (kind === "extra-fees") i.executions[0].extra_fees_unknown = true;
    const r = buildSpotPerformance(i);
    expect(r.holdings[0].reconciled).toBe(true);
    expect(r.holdings[0].basis_status).not.toBe("known");
    expect(r.holdings[0].unrealized_pnl).toBeNull();
    expect(r.totals[0].unrealized_pnl).toBeNull();
    expect(r.totals[0].combined_pnl).toBeNull();
  });

  it("releases the entire known lot cost at a verified sub-precision full-sale boundary and prices a fresh cycle", () => {
    const i = input([
      execution("old-buy", "Buy", "0.123456", "100", 2,
        { fee: "0.000123456", fee_currency: "BTC", fee_currency_source: "reported" }),
      execution("close", "Sell", "0.12333255", "120", 3),
      execution("new-buy", "Buy", "1", "200", 4),
    ], [movement("old-buy", "0.12333254", "0.12333254", 2), movement("close", "-0.12333255", "0", 3),
      movement("new-buy", "1", "1", 4)], "1");
    const r = buildSpotPerformance(i);
    expect(r.warnings).toEqual([]);
    expect(r.sales[0]).toMatchObject({ executed_quantity: "0.12333255", inventory_quantity: "0.123332544",
      quote_value: "14.799906", matched_cost_basis: "12.3456", realized_pnl: "2.454306", basis_status: "known" });
    expect(r.sales[0].matches).toEqual([{ buy_at: at(2), buy_order_id: "order-old-buy", quantity: "0.123332544",
      buy_fill_price: "100", cost_basis: "12.3456" }]);
    expect(r.sales[0].note).toContain("Verified venue-zero quantization");
    expect(r.sales[0].note).toContain("exhaustion residual 0.000000006 BTC");
    expect(r.holdings[0]).toMatchObject({ quantity: "1", known_quantity: "1", cost_basis: "200", unit_cost: "200",
      average_fill_price: "200", first_buy_at: at(4), last_buy_at: at(4), unrealized_pnl: "-50", reconciled: true, basis_status: "known" });
    expect(r.holdings[0].lots.map(l => l.id)).toEqual(["new-buy"]);
    expect(new Decimal(r.sales[0].matched_cost_basis!).plus(r.holdings[0].cost_basis!).toFixed()).toBe("212.3456");

    const flat = input(i.executions.slice(0, 2), i.movements.slice(0, 2), "0");
    const closed = buildSpotPerformance(flat);
    expect(closed.holdings).toEqual([]);
    expect(closed.sales[0].realized_pnl).toBe("2.454306");
    expect(closed.warnings).toEqual([]);
  });

  it.each(["TRANSFER_OUT", "INTEREST", "ADJUSTMENT"])("handles a rounded %s exhaustion at reported zero without inventing a sale or poisoning later buys", type => {
    const i = input([
      execution("old-buy", "Buy", "0.123456", "100", 2,
        { fee: "0.000123456", fee_currency: "BTC", fee_currency_source: "reported" }),
      execution("new-buy", "Buy", "1", "200", 4),
    ], [movement("old-buy", "0.12333254", "0.12333254", 2),
      movement("out", "-0.12333255", "0", 3, { type, trade_id: null }), movement("new-buy", "1", "1", 4)], "1");
    const r = buildSpotPerformance(i);
    expect(r.warnings).toEqual([]);
    expect(r.sales).toEqual([]);
    expect(r.orders).toHaveLength(2);
    expect(r.holdings[0]).toMatchObject({ quantity: "1", cost_basis: "200", first_buy_at: at(4),
      unrealized_pnl: "-50", reconciled: true, basis_status: "known" });
    expect(r.holdings[0].note).toContain("Verified venue-zero quantization");
    expect(r.holdings[0].lots).toHaveLength(1);
    expect(r.holdings[0].lots[0].id).toBe("new-buy");
  });

  it("uses the verified zero boundary when a fresh buy shares the liquidation timestamp", () => {
    const i = input([
      execution("old", "Buy", "0.123456", "100", 2,
        { fee: "0.000123456", fee_currency: "BTC", fee_currency_source: "reported" }),
      execution("a-new", "Buy", "1", "200", 3), execution("z-close", "Sell", "0.12333255", "120", 3),
    ], [movement("old", "0.12333254", "0.12333254", 2), movement("a-new", "1", "1", 3), movement("z-close", "-0.12333255", "0", 3)], "1");
    const r = buildSpotPerformance(i);
    expect(r.warnings).toEqual([]);
    expect(r.sales[0].matches.map(m => m.buy_order_id)).toEqual(["order-old"]);
    expect(r.sales[0].matched_cost_basis).toBe("12.3456");
    expect(r.holdings[0]).toMatchObject({ quantity: "1", cost_basis: "200", unrealized_pnl: "-50", reconciled: true });
    expect(r.holdings[0].lots.map(l => l.id)).toEqual(["a-new"]);
  });

  it("does not forgive material negative exhaustion beyond a quantum, even at a reported zero", () => {
    const i = input([
      execution("old", "Buy", "0.123456", "100", 2,
        { fee: "0.000123456", fee_currency: "BTC", fee_currency_source: "reported" }),
      execution("s", "Sell", "0.12333256", "120", 3), execution("new", "Buy", "1", "200", 4),
    ], [movement("old", "0.12333254", "0.12333254", 2), movement("s", "-0.12333256", "0", 3), movement("new", "1", "1", 4)], "1");
    const r = buildSpotPerformance(i);
    expect(codes(i)).toContain("NEGATIVE_INVENTORY");
    expect(codes(i)).toContain("WALLET_RECONCILIATION");
    expect(r.sales[0].realized_pnl).toBeNull();
    expect(r.holdings[0]).toMatchObject({ quantity: "1", cost_basis: null, unrealized_pnl: null, basis_status: "mismatch" });
    expect(r.holdings[0].note).not.toContain("Verified venue-zero quantization");
  });

  it.each([
    ["1", "1.00000001"], ["0.000000000000000001", "0.000000000000000002"],
  ])("does not forgive an exactly representable one-tick oversell: buy %s / sell %s", (buy, sell) => {
    const i = input([execution("b", "Buy", buy, "100", 2), execution("s", "Sell", sell, "120", 3)],
      [movement("b", buy, buy, 2), movement("s", new Decimal(sell).negated().toFixed(), "0", 3)], "0");
    const r = buildSpotPerformance(i);
    expect(codes(i)).toContain("NEGATIVE_INVENTORY");
    expect(codes(i)).toContain("WALLET_RECONCILIATION");
    expect(r.sales[0].realized_pnl).toBeNull();
    expect(r.sales[0].matches.some(m => m.cost_basis === null)).toBe(true);
    expect(r.sales[0].note).not.toContain("Verified venue-zero quantization");
  });

  it("does not forgive genuine sub-tick trades just because their ledger fields all round to zero", () => {
    const i = input([execution("b", "Buy", "0.000000001", "100", 2), execution("s", "Sell", "0.000000002", "120", 3)],
      [movement("b", "0", "0", 2), movement("s", "0", "0", 3)], "0");
    const r = buildSpotPerformance(i);
    expect(codes(i)).toContain("NEGATIVE_INVENTORY");
    expect(r.sales[0].realized_pnl).toBeNull();
    expect(r.sales[0].note).not.toContain("Verified venue-zero quantization");
  });

  it("retains genuine positive dust rather than forcing every rounded ledger zero flat", () => {
    const i = input([execution("b", "Buy", "1.000000004", "100", 2), execution("s", "Sell", "1", "150", 3)],
      [movement("b", "1", "1", 2), movement("s", "-1", "0", 3)], "0.000000004");
    const r = buildSpotPerformance(i);
    expect(r.warnings).toEqual([]);
    expect(r.holdings[0]).toMatchObject({ quantity: "0.000000004", known_quantity: "0.000000004", cost_basis: "0.0000004",
      unrealized_pnl: "0.0000002", first_buy_at: at(2), basis_status: "known" });
    expect(r.sales[0].matched_cost_basis).toBe("100");
    expect(r.holdings[0].note).not.toContain("Verified venue-zero quantization");
  });

  it("unknown opening basis stays unknown on its sale, while a genuinely new position after confirmed zero can be known", () => {
    const i = input([
      execution("b", "Buy", "0.123456", "100", 2,
        { fee: "0.000123456", fee_currency: "BTC", fee_currency_source: "reported" }),
      execution("s", "Sell", "1.12333255", "120", 3), execution("new", "Buy", "1", "200", 4),
    ], [movement("transfer", "1", "1", 1, { type: "TRANSFER_IN", trade_id: null }),
      movement("b", "0.12333254", "1.12333254", 2), movement("s", "-1.12333255", "0", 3), movement("new", "1", "1", 4)], "1");
    const before = input(i.executions.slice(0, 1), i.movements.slice(0, 2), "1.123332544");
    expect(buildSpotPerformance(before).holdings.some(h => h.unknown_quantity === "1" && h.cost_basis === null)).toBe(true);
    expect(buildSpotPerformance(before).totals[0].unrealized_pnl).toBeNull();
    const r = buildSpotPerformance(i);
    expect(r.sales[0]).toMatchObject({ matched_cost_basis: null, realized_pnl: null });
    expect(r.sales[0].matches.map(m => m.cost_basis)).toEqual([null, "12.3456"]);
    expect(r.holdings[0]).toMatchObject({ quantity: "1", cost_basis: "200", first_buy_at: at(4), unrealized_pnl: "-50", basis_status: "known" });
    expect(codes(i)).not.toContain("NEGATIVE_INVENTORY");
    expect(r.totals[0].realized_pnl).toBeNull();
  });

  it.each(["borrowed", "incomplete-history", "prior-material-gap", "nonzero-after"])("does not use zero quantization to erase %s", kind => {
    const i = input([
      execution("b", "Buy", "0.123456", "100", 2,
        { fee: "0.000123456", fee_currency: "BTC", fee_currency_source: "reported" }),
      execution("s", "Sell", "0.12333255", "120", 3), execution("new", "Buy", "1", "200", 4),
    ], [movement("b", "0.12333254", "0.12333254", 2), movement("s", "-0.12333255", "0", 3), movement("new", "1", "1", 4)], "1");
    if (kind === "borrowed") i.wallets[0].spot_borrow = "0.1";
    if (kind === "incomplete-history") i.coverage.inventory_complete.BTC = false;
    if (kind === "prior-material-gap") i.movements.unshift(movement("gap", "0", "1", 1, { type: "ADJUSTMENT", trade_id: null }));
    if (kind === "nonzero-after") i.movements[1].balance_after = "0.00000001";
    const r = buildSpotPerformance(i);
    expect(r.holdings[0].unrealized_pnl).toBeNull();
    expect(r.sales[0].realized_pnl).toBeNull();
    expect(r.holdings[0].note).not.toContain("Verified venue-zero quantization");
  });

  it("a genuinely negative reported balance is never treated as a venue-zero rounding boundary", () => {
    const i = input([execution("b", "Buy", "1", "100", 2), execution("new", "Buy", "1", "200", 5)], [
      movement("b", "1", "1", 2), movement("debit", "-1.1", "-0.1", 3, { type: "TRANSFER_OUT", trade_id: null }),
      movement("repay", "0.1", "0", 4, { type: "TRANSFER_IN", trade_id: null }), movement("new", "1", "1", 5),
    ], "1");
    const r = buildSpotPerformance(i);
    expect(codes(i)).toContain("NEGATIVE_INVENTORY");
    expect(r.holdings[0].unrealized_pnl).toBeNull();
    expect(r.holdings[0].note).not.toContain("Verified venue-zero quantization");
  });

  it("conserves all remaining costs across multiple lots on sub-precision complete liquidation", () => {
    const fee = { fee: "0.000123456", fee_currency: "BTC", fee_currency_source: "reported" as const };
    const i = input([execution("b1", "Buy", "0.123456", "100", 2, fee), execution("b2", "Buy", "0.123456", "200", 3, fee),
      execution("s", "Sell", "0.24666509", "250", 4)],
      [movement("b1", "0.12333254", "0.12333254", 2), movement("b2", "0.12333254", "0.24666509", 3),
        movement("s", "-0.24666509", "0", 4)], "0");
    const r = buildSpotPerformance(i);
    expect(r.warnings).toEqual([]);
    expect(r.holdings).toEqual([]);
    expect(r.sales[0]).toMatchObject({ executed_quantity: "0.24666509", inventory_quantity: "0.246665088",
      matched_cost_basis: "37.0368", realized_pnl: "24.6294725" });
    expect(r.sales[0].matches.map(m => m.cost_basis)).toEqual(["12.3456", "24.6912"]);
    expect(r.sales[0].matches.map(m => m.quantity)).toEqual(["0.123332544", "0.123332544"]);
  });

  it("does not turn unknown fees into net profit at a quantized zero, while clean subsequent buys retain their own basis", () => {
    const i = input([
      execution("old", "Buy", "0.123456", "100", 2,
        { fee: "0.000123456", fee_currency: "BTC", fee_currency_source: "reported", extra_fees_unknown: true }),
      execution("s", "Sell", "0.12333255", "120", 3), execution("new", "Buy", "1", "200", 4),
    ], [movement("old", "0.12333254", "0.12333254", 2), movement("s", "-0.12333255", "0", 3), movement("new", "1", "1", 4)], "1");
    const r = buildSpotPerformance(i);
    expect(r.sales[0]).toMatchObject({ matched_cost_basis: "12.3456", fees_complete: false, realized_pnl: null });
    expect(r.holdings[0]).toMatchObject({ quantity: "1", cost_basis: "200", fees_complete: true, basis_status: "known", unrealized_pnl: "-50" });
    expect(codes(i)).not.toContain("NEGATIVE_INVENTORY");
  });

  it("does not mutate inputs or use callers' Decimal precision settings", () => {
    const i = basic(); const snapshot = JSON.stringify(i);
    const old = Decimal.precision;
    try {
      Decimal.set({ precision: 2 });
      expect(buildSpotPerformance(i).sales[0].realized_pnl).toBe("20");
    } finally { Decimal.set({ precision: old }); }
    expect(JSON.stringify(i)).toBe(snapshot);
  });
});
