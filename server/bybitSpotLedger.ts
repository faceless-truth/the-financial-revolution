import Decimal from "decimal.js";
import { buildSpotClosedReturns } from "./bybitSpotReturns";
import type {
  BybitSpotPortfolio, SpotBasisStatus, SpotExecution, SpotHolding,
  SpotInventoryChange, SpotLot, SpotOrderRecord, SpotPerformanceInput,
  SpotQuoteTotal, SpotSaleMatch,
} from "../shared/bybitSpot";

// Isolated from callers' Decimal configuration. Never round financial inputs via Number.
const D = Decimal.clone({ precision: 100, toExpNeg: -1000, toExpPos: 1000 });
const ZERO = new D(0);
const CASH = new Set(["USDT", "USDC"]);
const dec = (value: string | null): Decimal | null => {
  if (value === null || value.trim() === "") return null;
  try { const n = new D(value); return n.isFinite() ? n : null; } catch { return null; }
};
const text = (value: Decimal | null): string | null => value === null ? null : value.toFixed();
const sum = (values: Decimal[]): Decimal => values.reduce((a, b) => a.plus(b), ZERO);
const close = (a: Decimal, b: Decimal, tolerance: Decimal): boolean => a.minus(b).abs().lte(tolerance);
// Rounding tolerance must not turn genuine positive dust into a zero holding.
const inventoryClose = (a: Decimal, b: Decimal, tolerance: Decimal): boolean => a.eq(b)
  || (!a.isZero() && !b.isZero() && a.isPositive() === b.isPositive() && close(a, b, tolerance));
const valuationPriority = (quote: string): number => quote === "USDT" ? 0 : quote === "USDC" ? 1 : 2;
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const time = (value: string): number => Date.parse(value);
const returnPct = (pnl: Decimal | null, cost: Decimal | null): string | null =>
  pnl !== null && cost !== null && cost.gt(0) ? text(pnl.div(cost).times(100)) : null;

interface Lot {
  id: string; buyAt: string | null; orderId: string | null;
  quantity: Decimal; price: Decimal | null; cost: Decimal | null;
  quote: string | null; fees: boolean; reason: string | null;
}
interface Fill {
  execution: SpotExecution; quantity: Decimal; value: Decimal; price: Decimal;
  fee: Decimal | null; fees: boolean; quoteFee: Decimal;
  matched: boolean; inventory: Decimal; cost: Decimal | null;
  basisFees: boolean; matches: SpotSaleMatch[];
}
interface Asset {
  coin: string; lots: Lot[]; quantity: Decimal; gap: boolean; mismatch: boolean;
  borrowed: boolean; reconciled: boolean; notes: Set<string>;
}
interface Event { row: SpotInventoryChange; delta: Decimal; effective: Decimal; after: Decimal; before: Decimal; baseTrade: boolean }

/** A negative exhaustion residual is not automatically a loan. A completed,
 * corroborated positive-to-zero ledger transition may quantize sub-ledger-precision
 * financial units. Never apply this to positive remainders, zero-to-zero dust,
 * material debits, or quantities all exactly representable at ledger precision.
 * Callers additionally require complete coverage, consistent lots and no prior gap
 * or borrowing. This releases existing lots; it creates no units, prices or trade. */
function precisionZeroBoundary(balance: Decimal, event: Event, quantum: Decimal): boolean {
  const result = balance.plus(event.effective);
  const scale = quantum.decimalPlaces();
  // A recorded full TRANSFER_OUT can exhaust positive dust too: it creates no
  // realized trade profit. Do not grant that exception to tiny spot oversells.
  const positiveInventory = balance.gt(quantum) ||
    (event.row.type.toUpperCase() === "TRANSFER_OUT" && balance.gt(0));
  return event.after.isZero() && event.before.gt(0) && event.delta.lt(0)
    && positiveInventory && event.effective.lt(0) && result.lt(0) && result.abs().lte(quantum)
    && (balance.decimalPlaces() > scale || event.effective.decimalPlaces() > scale)
    && close(balance, event.before, quantum.times(2)) && close(event.effective, event.delta, quantum)
    && (event.row.type.toUpperCase() !== "TRADE" || event.baseTrade);
}

/** Normalization trims trailing zeroes, so infer the finest observed coin-ledger
 * scale with an 8dp floor (absolute tolerance never exceeds 1e-8). Higher-precision
 * ledgers retain their smaller quantum. This is not an asset-size-relative epsilon. */
function ledgerQuantum(events: Event[]): Decimal {
  let scale = 8;
  for (const e of events) scale = Math.max(scale, e.delta.decimalPlaces(), e.after.decimalPlaces());
  return new D(10).pow(-scale);
}

function executionDelta(fill: Fill, coin: string): Decimal | null {
  const e = fill.execution;
  if (e.base_coin !== coin || fill.fee === null) return null;
  if (!fill.fee.isZero() && (e.fee_currency_source === "unknown" || !e.fee_currency)) return null;
  const baseFee = e.fee_currency === coin ? fill.fee : ZERO;
  return e.side === "Buy" ? fill.quantity.minus(baseFee) : fill.quantity.plus(baseFee).negated();
}
function matchingBaseEvent(row: SpotInventoryChange, fill: Fill | undefined, delta: Decimal): boolean {
  if (!fill || row.type.toUpperCase() !== "TRADE" || row.category.toLowerCase() !== "spot") return false;
  const e = fill.execution;
  if (e.base_coin !== row.coin || time(e.timestamp) > time(row.timestamp)) return false;
  const precise = executionDelta(fill, row.coin);
  const signed = precise ?? delta;
  // A rounded zero change can corroborate an actual, positive sub-tick fill.
  return e.side === "Buy" ? signed.gt(0) && delta.gte(0) : signed.lt(0) && delta.lte(0);
}

function unknownLot(id: string, quantity: Decimal, reason: string): Lot {
  return { id, quantity, buyAt: null, orderId: null, price: null, cost: null,
    quote: null, fees: false, reason };
}
function publicLot(lot: Lot): SpotLot {
  return { id: lot.id, buy_at: lot.buyAt, order_id: lot.orderId,
    quantity: lot.quantity.toFixed(), fill_price: text(lot.price),
    cost_basis: text(lot.cost), quote_coin: lot.quote,
    fees_complete: lot.fees, unknown_reason: lot.reason };
}
function feeKnown(e: SpotExecution, fee: Decimal | null): boolean {
  return fee !== null && !e.extra_fees_unknown && (fee.isZero()
    || (e.fee_currency_source !== "unknown"
      && (e.fee_currency === e.base_coin || e.fee_currency === e.quote_coin)));
}

/** Consume actual inventory, not gross execution quantity. Last portions release exact remainders. */
function consume(asset: Asset, quantity: Decimal, quote: string | null) {
  let remaining = quantity;
  let cost = ZERO;
  let known = true;
  let fees = true;
  const matches: SpotSaleMatch[] = [];
  while (remaining.gt(0) && asset.lots.length) {
    const lot = asset.lots[0];
    const taken = D.min(remaining, lot.quantity);
    const released = lot.cost === null ? null : taken.eq(lot.quantity)
      ? lot.cost : lot.cost.times(taken).div(lot.quantity);
    const compatible = released !== null && lot.quote === quote;
    if (compatible) cost = cost.plus(released);
    else known = false;
    fees = fees && lot.fees;
    matches.push({ buy_at: lot.buyAt, buy_order_id: lot.orderId,
      quantity: taken.toFixed(), buy_fill_price: text(lot.price),
      cost_basis: compatible ? text(released) : null });
    lot.quantity = lot.quantity.minus(taken);
    if (lot.cost !== null && released !== null) lot.cost = lot.cost.minus(released);
    remaining = remaining.minus(taken);
    if (lot.quantity.isZero()) asset.lots.shift();
  }
  if (remaining.gt(0)) {
    known = false;
    fees = false;
    asset.gap = true;
    asset.notes.add("Inventory debit exceeds the available transaction-ledger lots.");
    matches.push({ buy_at: null, buy_order_id: null, quantity: remaining.toFixed(),
      buy_fill_price: null, cost_basis: null });
  }
  return { cost: known ? cost : null, fees, matches };
}

/** A complete balance-chain is required. Explore ties, but never select an economic
 * ordering simply because it gives a better FIFO result. A bounded search fails closed. */
function chain(events: Event[], opening: Decimal | null, quantum: Decimal, allowZeroExhaustion: boolean, allowRounding = false): { events: Event[]; ambiguous: boolean } {
  // Seek exact chains first. The fallback checks both rounded fields against a
  // running precise balance, not a chain of repeatedly rounded cash balances.
  // before = rounded(after) - rounded(change), hence its bound is two quanta;
  // after and the reported change each have a one-quantum absolute bound.
  const compatible = (a: Decimal, b: Decimal, tolerance: Decimal) => allowRounding ? close(a, b, tolerance) : a.eq(b);
  const follows = (event: Event, balance: Decimal | null) => {
    const before = balance ?? event.before;
    return compatible(before, event.before, quantum.times(2))
      && compatible(event.effective, event.delta, quantum)
      && compatible(before.plus(event.effective), event.after, quantum);
  };
  const nextBalance = (event: Event, balance: Decimal | null) => {
    const before = balance ?? event.before;
    return allowZeroExhaustion && precisionZeroBoundary(before, event, quantum)
      ? ZERO : before.plus(event.effective);
  };
  const sorted = [...events].sort((a, b) => compare(a.row.id, b.row.id));
  const paths: Event[][] = [];
  let budget = 20000;
  let exhausted = false;
  const signature = (e: Event) => e.effective.isZero() ? `zero:${e.before.toFixed()}`
    : JSON.stringify([e.before.toFixed(), e.after.toFixed(), e.effective.toFixed(), e.row.type,
      e.row.category, e.row.trade_id, e.row.order_id]);
  // The usual case (one event or a monotone chain) avoids recursive depth entirely.
  let pending = sorted;
  let current = opening;
  const prefix: Event[] = [];
  while (pending.length) {
    let candidates = pending.filter(e => follows(e, current));
    if (current === null && pending.every(e => e.effective.gte(0))) {
      const minimum = D.min(...pending.map(e => e.before));
      candidates = candidates.filter(e => e.before.eq(minimum));
    } else if (current === null && pending.every(e => e.effective.lte(0))) {
      const maximum = D.max(...pending.map(e => e.before));
      candidates = candidates.filter(e => e.before.eq(maximum));
    }
    if (candidates.length !== 1) break;
    const next = candidates[0];
    prefix.push(next);
    pending = pending.filter(e => e !== next);
    current = nextBalance(next, current);
  }
  if (!pending.length) return { events: prefix, ambiguous: false };
  function visit(rest: Event[], balance: Decimal | null, path: Event[]) {
    if (--budget <= 0 || path.length > 512) { exhausted = true; return; }
    if (!rest.length) { paths.push(path); return; }
    const seen = new Set<string>();
    for (const e of rest) {
      if (!follows(e, balance)) continue;
      const key = signature(e);
      if (seen.has(key)) continue;
      seen.add(key);
      visit(rest.filter(other => other !== e), nextBalance(e, balance), [...path, e]);
      if (paths.length > 1 || exhausted) return;
    }
  }
  visit(pending, current, []);
  if (!paths.length && !exhausted && !allowRounding) return chain(events, opening, quantum, allowZeroExhaustion, true);
  return { events: paths.length ? [...prefix, ...paths[0]] : sorted,
    ambiguous: exhausted || paths.length !== 1 };
}

/** Account-wide actual spot executions + coin transaction ledger; pure, no I/O. */
export function buildSpotPerformance(input: SpotPerformanceInput): BybitSpotPortfolio {
  const warnings: BybitSpotPortfolio["warnings"] = [];
  const warningKeys = new Set<string>();
  const warn = (code: string, message: string) => {
    const key = `${code}:${message}`;
    if (!warningKeys.has(key)) { warningKeys.add(key); warnings.push({ code, message }); }
  };
  const assets = new Map<string, Asset>();
  const assetFor = (coin: string): Asset => {
    let asset = assets.get(coin);
    if (!asset) {
      asset = { coin, lots: [], quantity: ZERO, gap: false, mismatch: false,
        borrowed: false, reconciled: false, notes: new Set() };
      assets.set(coin, asset);
    }
    return asset;
  };
  const gap = (coin: string | null, code: string, message: string) => {
    warn(code, message);
    if (coin && !CASH.has(coin)) { const a = assetFor(coin); a.gap = true; a.notes.add(message); }
  };
  if (!input.coverage.executions_complete || input.coverage.error) {
    warn("INCOMPLETE_HISTORY", "Execution history is incomplete; performance is not a complete account profit figure.");
  }
  const rawExecutions = new Map<string, SpotExecution>();
  const conflicts = new Set<string>();
  // Explicit field ordering also deduplicates objects whose property insertion order differs.
  const executionKey = (e: SpotExecution) => JSON.stringify([
    e.id, e.order_id, e.order_link_id, e.timestamp, e.symbol, e.base_coin, e.quote_coin,
    e.side, e.quantity, e.price, e.quote_value, e.fee, e.fee_currency,
    e.fee_currency_source, e.extra_fees_unknown,
  ]);
  for (const e of input.executions) {
    const previous = rawExecutions.get(e.id);
    if (previous && executionKey(previous) !== executionKey(e)) {
      conflicts.add(e.id);
      gap(previous.base_coin, "CONFLICTING_EXECUTION", `Conflicting execution ID ${e.id}; no version is trusted for basis.`);
      gap(e.base_coin, "CONFLICTING_EXECUTION", `Conflicting execution ID ${e.id}; no version is trusted for basis.`);
    } else if (!previous) rawExecutions.set(e.id, e);
  }
  const fills = new Map<string, Fill>();
  for (const e of Array.from(rawExecutions.values())) {
    if (conflicts.has(e.id)) continue;
    const quantity = dec(e.quantity), value = dec(e.quote_value), price = dec(e.price), fee = dec(e.fee);
    if (!quantity?.gt(0) || !value?.gt(0) || !price?.gt(0) || !Number.isFinite(time(e.timestamp))) {
      gap(e.base_coin, "INVALID_EXECUTION", `Invalid execution ${e.id}; its financial values are not used.`);
      continue;
    }
    if (time(e.timestamp) < time(input.coverage.from) || time(e.timestamp) > time(input.coverage.through)) {
      gap(e.base_coin, "EXECUTION_OUTSIDE_COVERAGE", `${e.symbol} execution ${e.id} falls outside the declared history range; complete performance is unavailable.`);
    }
    if (!e.base_coin || !e.quote_coin) gap(e.base_coin, "UNVERIFIED_PAIR", `Verified base/quote metadata is missing for ${e.symbol}.`);
    if (e.base_coin && !CASH.has(e.base_coin)) assetFor(e.base_coin);
    const quoteFee = fee !== null && e.fee_currency_source !== "unknown" && e.fee_currency === e.quote_coin ? fee : ZERO;
    fills.set(e.id, { execution: e, quantity, value, price, fee,
      fees: feeKnown(e, fee), quoteFee, matched: false, inventory: ZERO,
      cost: null, basisFees: false, matches: [] });
  }
  const eventsByCoin = new Map<string, Event[]>();
  const rawMovements = new Map<string, SpotInventoryChange>();
  const movementKey = (r: SpotInventoryChange) => JSON.stringify([
    r.timestamp, r.coin, r.change, r.balance_after, r.type, r.category, r.trade_id, r.order_id,
  ]);
  for (const row of input.movements) {
    if (CASH.has(row.coin)) continue;
    assetFor(row.coin);
    const key = `${row.coin}:${row.id}`;
    const previous = rawMovements.get(key);
    if (previous) {
      if (movementKey(previous) !== movementKey(row)) gap(row.coin, "CONFLICTING_MOVEMENT", `Conflicting transaction-log row for ${row.coin}.`);
      continue;
    }
    rawMovements.set(key, row);
    const delta = dec(row.change), after = dec(row.balance_after);
    if (delta === null || after === null || !Number.isFinite(time(row.timestamp))) {
      gap(row.coin, "INVALID_MOVEMENT", `Invalid transaction-log values for ${row.coin}.`);
      continue;
    }
    const fill = row.trade_id ? fills.get(row.trade_id) : undefined;
    const baseTrade = matchingBaseEvent(row, fill, delta);
    const effective = fill && baseTrade ? executionDelta(fill, row.coin) ?? delta : delta;
    const event = { row, delta, effective, after, before: after.minus(delta), baseTrade };
    const list = eventsByCoin.get(row.coin) ?? [];
    list.push(event);
    eventsByCoin.set(row.coin, list);
  }
  const wallets = new Map(input.wallets.map(w => [w.coin, w]));
  for (const w of input.wallets) {
    if (!CASH.has(w.coin) && (dec(w.quantity)?.gt(0) || dec(w.spot_borrow)?.gt(0))) assetFor(w.coin);
  }
  for (const asset of Array.from(assets.values())) {
    const coin = asset.coin;
    const wallet = wallets.get(coin);
    const walletQuantity = wallet ? dec(wallet.quantity) : ZERO;
    asset.borrowed = (dec(wallet?.spot_borrow ?? "0")?.gt(0) ?? false)
      || (walletQuantity?.lt(0) ?? false);
    if (asset.borrowed) warn("BORROWED_BASE", `${coin} has borrowed base inventory; wallet balance is not assumed to be wholly owned.`);
    if (wallet && dec(wallet.spot_borrow) === null) gap(coin, "UNKNOWN_BORROW", `${coin} borrowing metadata is unavailable.`);
    if (!input.coverage.executions_complete || input.coverage.error || input.coverage.inventory_complete[coin] !== true) {
      gap(coin, "INCOMPLETE_HISTORY", `${coin} execution or inventory history is incomplete.`);
    }
    const events = (eventsByCoin.get(coin) ?? []).sort((a, b) => time(a.row.timestamp) - time(b.row.timestamp) || compare(a.row.id, b.row.id));
    const quantum = ledgerQuantum(events);
    if (events.length) asset.notes.add(`Ledger corroboration uses an inferred absolute ${quantum.toFixed()} ${coin} quantum (maximum observed ledger scale, at least 8 decimal places): change/after/wallet within one quantum, before within two. Matched execution quantities and published fees retain full precision; rounded ledger changes are not cumulatively substituted for them.`);
    let started = false;
    for (let index = 0; index < events.length;) {
      let end = index + 1;
      while (end < events.length && time(events[end].row.timestamp) === time(events[index].row.timestamp)) end++;
      const allowZeroExhaustion = !asset.gap && !asset.borrowed && !input.coverage.syncing;
      const ordered = chain(events.slice(index, end), started ? asset.quantity : null, quantum, allowZeroExhaustion);
      if (ordered.ambiguous) gap(coin, "AMBIGUOUS_BALANCE_CHAIN", `${coin} transaction-log ordering or balance continuity is unclear.`);
      for (const event of ordered.events) {
        const { row, delta, before, after } = event;
        if (!started) {
          asset.quantity = before;
          if (before.gt(0)) asset.lots.push(unknownLot(`${coin}:opening`, before, "Opening inventory predates the available ledger; acquisition date and cost are unknown."));
          if (before.lt(0)) gap(coin, "NEGATIVE_INVENTORY", `${coin} ledger includes negative inventory.`);
          started = true;
        }
        if (!close(asset.quantity, before, quantum.times(2))) {
          gap(coin, "LEDGER_DISCONTINUITY", `${coin} transaction-log before balance is discontinuous beyond two reported-precision quanta; missing inventory is not assigned a purchase price.`);
        }
        const isTrade = row.type.toUpperCase() === "TRADE" && row.category.toLowerCase() === "spot";
        const fill = row.trade_id ? fills.get(row.trade_id) : undefined;
        const e = fill?.execution;
        const matching = fill && e && !fill.matched && matchingBaseEvent(row, fill, delta);
        // Actual executed units and actual paid base fees are the precision
        // authority; ledger delta may have already rounded those net units.
        const effective = matching ? executionDelta(fill, coin) ?? delta : delta;
        const venueZero = !asset.gap && !asset.borrowed && !input.coverage.syncing
          && sum(asset.lots.map(l => l.quantity)).eq(asset.quantity)
          && precisionZeroBoundary(asset.quantity, { ...event, effective, baseTrade: !!matching }, quantum);
        // A verified sub-precision exhaustion releases each existing lot in full,
        // including its exact remaining cost. Execution history retains its actual
        // gross quantity and fees; inventory_quantity records the FIFO units really
        // released. No extra zero-cost match or balancing trade is added.
        const inventoryDebit = venueZero ? asset.quantity : effective.abs();
        if (matching) {
          fill.matched = true;
          if (!close(delta, effective, quantum)) gap(coin, "EXECUTION_LEDGER_MISMATCH", `${coin} execution ${e.id} differs from its reported base inventory change by more than one ledger quantum.`);
          fill.inventory = inventoryDebit;
          if (e.side === "Buy") {
            const cost = fill.value.plus(fill.quoteFee);
            asset.lots.push({ id: e.id, buyAt: e.timestamp, orderId: e.order_id,
              quantity: effective, price: fill.price, cost: e.quote_coin ? cost : null,
              quote: e.quote_coin, fees: fill.fees, reason: null });
          } else {
            const released = consume(asset, inventoryDebit, e.quote_coin);
            fill.cost = released.cost;
            fill.basisFees = released.fees;
            fill.matches = released.matches;
          }
        } else {
          let reason = "Non-purchase inventory credit; acquisition date and cost are unknown.";
          if (isTrade && e && e.quote_coin === coin && e.base_coin !== coin) {
            reason = "Cross-currency quote flow has no supported acquisition/disposal basis.";
            gap(coin, "UNSUPPORTED_CROSS_CURRENCY", `${coin} is the quote currency of a spot trade; its disposal/acquisition performance is unsupported.`);
          } else if (isTrade) {
            reason = "Spot transaction has no matching, usable base execution.";
            gap(coin, "UNMATCHED_SPOT_TRADE", `${coin} spot transaction ${row.id} has no matching, usable base execution.`);
          }
          if (delta.gt(0)) asset.lots.push(unknownLot(`${coin}:${row.id}`, delta, reason));
          else if (delta.lt(0)) consume(asset, inventoryDebit, null);
        }
        if (venueZero) {
          const residual = asset.quantity.plus(effective).abs();
          asset.notes.add(`Verified venue-zero quantization at ledger row ${row.id}: negative sub-precision exhaustion residual ${residual.toFixed()} ${coin} is within the ${quantum.toFixed()} reported quantum. Observed inventory debit ${effective.abs().toFixed()} ${coin}; FIFO inventory released ${inventoryDebit.toFixed()} ${coin}. All remaining FIFO quantity and cost were released exactly; actual execution quantities are unchanged. No balancing trade or acquisition cost was invented.`);
          asset.quantity = ZERO;
        } else asset.quantity = asset.quantity.plus(effective);
        if (!close(asset.quantity, after, quantum)) {
          gap(coin, "LEDGER_DISCONTINUITY", `${coin} transaction-log after balance differs from the precise running inventory by more than one reported-precision quantum; no balancing inventory was invented.`);
        }
        if (after.lt(0) || asset.quantity.lt(0)) gap(coin, "NEGATIVE_INVENTORY", `${coin} ledger includes negative inventory.`);
      }
      index = end;
    }
    if (!started && walletQuantity?.gt(0)) {
      // A wallet is evidence of units only, never of a purchase at today's mark.
      asset.quantity = walletQuantity;
      asset.lots.push(unknownLot(`${coin}:wallet`, walletQuantity, "Current wallet inventory has no transaction-ledger acquisition history."));
    }
    asset.reconciled = walletQuantity !== null && inventoryClose(asset.quantity, walletQuantity, quantum)
      && sum(asset.lots.map(l => l.quantity)).eq(D.max(asset.quantity, ZERO));
    if (!asset.reconciled) {
      asset.mismatch = true;
      const message = `${coin} ledger ending quantity ${asset.quantity.toFixed()} differs from wallet quantity ${text(walletQuantity) ?? "unknown"}, or its lots do not reconcile; possible API lag or missing transactions. No balancing trade was invented.`;
      warn("WALLET_RECONCILIATION", message);
      asset.notes.add(message);
    }
  }
  // Missing log rows never receive quantities inferred from fills or later trades.
  for (const fill of Array.from(fills.values())) {
    const e = fill.execution;
    if (e.base_coin && !CASH.has(e.base_coin) && !fill.matched) {
      gap(e.base_coin, "MISSING_EXECUTION_MOVEMENT", `${e.base_coin} execution ${e.id} has no matched inventory-log row.`);
    }
    if (!fill.fees) warn("UNCONVERTED_FEES", `${e.symbol} execution ${e.id} has unknown or unconverted fees; net performance is unavailable.`);
  }
  const statusFor = (asset: Asset | undefined, known: boolean, fees: boolean): SpotBasisStatus => {
    if (asset?.borrowed) return "borrowed";
    if (asset?.mismatch) return "mismatch";
    if (input.coverage.syncing) return "syncing";
    if (!asset || asset.gap || !known) return "unknown";
    return fees ? "known" : "fees_incomplete";
  };
  const usable = (asset: Asset | undefined) => !!asset && !asset.gap && !asset.borrowed
    && asset.reconciled && !input.coverage.syncing;

  const holdings: SpotHolding[] = [];
  for (const asset of Array.from(assets.values())) {
    const walletQuantity = dec(wallets.get(asset.coin)?.quantity ?? null);
    // Historical FIFO lots are not evidence of a CURRENT positive holding.
    // Missing, zero and negative wallet quantities never display phantom assets.
    if (!walletQuantity?.gt(0)) continue;
    const lotQuantity = sum(asset.lots.map(l => l.quantity));
    const displayOnly = asset.mismatch || !lotQuantity.gt(0);
    // A wallet corroborated at venue precision does not replace genuine precise
    // execution lots. Only material mismatches (or absent lots) need a wallet-only
    // display row; no financial quantities, costs or prices are rescaled.
    const roundingNote = !displayOnly && asset.reconciled && !lotQuantity.eq(walletQuantity)
      ? `Exact fill quantity reconciles with the wallet at its reported precision. Precise inventory quantity ${lotQuantity.toFixed()} ${asset.coin}; reported wallet quantity ${walletQuantity.toFixed()} ${asset.coin}. FIFO lots and cost basis are unchanged.`
      : null;
    const displayLots = displayOnly ? [unknownLot(`${asset.coin}:wallet-display`, walletQuantity,
      `Current wallet quantity ${walletQuantity.toFixed()} is display-only with unknown basis; original ledger ending quantity ${asset.quantity.toFixed()} and ledger lots quantity ${lotQuantity.toFixed()} are unchanged. No acquisition or balancing trade is inferred.`)] : asset.lots;
    const groups = new Map<string | null, Lot[]>();
    for (const lot of displayLots) {
      if (!lot.quantity.gt(0)) continue;
      const group = groups.get(lot.quote) ?? [];
      group.push(lot);
      groups.set(lot.quote, group);
    }
    for (const [basisQuote, lots] of Array.from(groups)) {
      const markets = input.markets.filter(m => m.base_coin === asset.coin && (!basisQuote || m.quote_coin === basisQuote))
        .sort((a, b) => valuationPriority(a.quote_coin) - valuationPriority(b.quote_coin)
          || compare(a.quote_coin, b.quote_coin) || compare(a.symbol, b.symbol)
          || time(b.observed_at) - time(a.observed_at));
      const market = markets[0];
      const quote = basisQuote ?? market?.quote_coin ?? null;
      const quantity = sum(lots.map(l => l.quantity));
      const knownLots = lots.filter(l => l.cost !== null);
      const knownQuantity = sum(knownLots.map(l => l.quantity));
      const allKnown = knownLots.length === lots.length;
      const cost = allKnown ? sum(knownLots.map(l => l.cost!)) : null;
      const fees = allKnown && lots.every(l => l.fees);
      const bid = dec(market?.bid_price ?? null);
      const validBid = bid?.gt(0) ? bid : null;
      const value = validBid === null ? null : quantity.times(validBid);
      const beforeFees = usable(asset) && cost !== null && value !== null ? value.minus(cost) : null;
      const pnl = fees ? beforeFees : null;
      const dates = knownLots.flatMap(l => l.buyAt ? [l.buyAt] : []).sort((a, b) => time(a) - time(b));
      const pricesKnown = lots.every(l => l.price !== null);
      const basisStatus = statusFor(asset, allKnown, fees);
      if (validBid === null) warn("MISSING_BID", `${asset.coin}${quote ? `/${quote}` : ""} has no current matching-pair bid; last price and last fill are not valuation substitutes.`);
      holdings.push({ id: `${asset.coin}:${basisQuote ?? "unknown"}`, asset: asset.coin,
        quote_coin: quote, symbol: market?.symbol ?? null, quantity: quantity.toFixed(),
        known_quantity: knownQuantity.toFixed(), unknown_quantity: quantity.minus(knownQuantity).toFixed(),
        first_buy_at: dates[0] ?? null, last_buy_at: dates[dates.length - 1] ?? null,
        average_fill_price: pricesKnown ? text(sum(lots.map(l => l.price!.times(l.quantity))).div(quantity)) : null,
        unit_cost: usable(asset) && cost !== null ? text(cost.div(quantity)) : null,
        cost_basis: usable(asset) ? text(cost) : null, bid_price: text(validBid), market_value: text(value),
        unrealized_pnl: text(pnl), unrealized_return_pct: returnPct(pnl, cost),
        pnl_before_unconverted_fees: !fees ? text(beforeFees) : null,
        basis_status: basisStatus, fees_complete: fees, reconciled: asset.reconciled,
        note: [...Array.from(asset.notes), ...lots.flatMap(l => l.reason ? [l.reason] : []),
          ...(roundingNote ? [roundingNote] : []),
          ...(basisQuote === null && quote ? [`${quote} is the current valuation quote only, not a known purchase quote; no FX conversion or acquisition price is inferred.`] : []),
          ...(asset.borrowed ? ["Borrowed base inventory: owned cost basis is unavailable."] : []),
          ...(!fees && allKnown ? ["Known quote cost excludes unconverted or unknown fees; this is not net P&L."] : [])].join(" ") || null,
        lots: lots.map(publicLot) });
    }
  }
  holdings.sort((a, b) => compare(a.asset, b.asset) || compare(a.id, b.id));

  const orderGroups = new Map<string, Fill[]>();
  for (const fill of Array.from(fills.values())) {
    const e = fill.execution;
    const key = JSON.stringify([e.order_id, e.symbol, e.side]);
    const group = orderGroups.get(key) ?? [];
    group.push(fill);
    orderGroups.set(key, group);
  }
  const orders: SpotOrderRecord[] = [];
  for (const group of Array.from(orderGroups.values())) {
    group.sort((a, b) => time(a.execution.timestamp) - time(b.execution.timestamp) || compare(a.execution.id, b.execution.id));
    const first = group[0].execution;
    const asset = first.base_coin ? assets.get(first.base_coin) : undefined;
    const sale = first.side === "Sell";
    const cash = !!first.base_coin && CASH.has(first.base_coin);
    const metadata = !!first.base_coin && !!first.quote_coin && group.every(f => f.execution.base_coin === first.base_coin && f.execution.quote_coin === first.quote_coin);
    const quantity = sum(group.map(f => f.quantity));
    const value = sum(group.map(f => f.value));
    const inventory = sum(group.map(f => f.inventory));
    const matched = metadata && group.every(f => f.matched);
    const known = matched && (!sale || group.every(f => f.cost !== null));
    const cost = sale && known ? sum(group.map(f => f.cost!)) : null;
    const fees = group.every(f => f.fees && (!sale || f.basisFees));
    const quotedProceeds = sale ? value.minus(sum(group.map(f => f.quoteFee))) : null;
    const beforeFees = sale && usable(asset) && known && cost !== null ? quotedProceeds!.minus(cost) : null;
    const pnl = fees ? beforeFees : null;
    const feeGroups = new Map<string | null, Decimal | null>();
    for (const f of group) {
      const coin = f.execution.fee_currency;
      const previous = feeGroups.get(coin);
      feeGroups.set(coin, f.fee === null || previous === null ? null : (previous ?? ZERO).plus(f.fee));
    }
    const record: SpotOrderRecord = {
      order_id: first.order_id, symbol: first.symbol, base_coin: first.base_coin,
      quote_coin: first.quote_coin, side: first.side, first_fill_at: first.timestamp,
      last_fill_at: group[group.length - 1].execution.timestamp, fill_count: group.length,
      executed_quantity: quantity.toFixed(), inventory_quantity: inventory.toFixed(),
      average_fill_price: value.div(quantity).toFixed(), quote_value: value.toFixed(),
      fees: Array.from(feeGroups).sort(([a], [b]) => compare(a ?? "", b ?? "")).map(([coin, amount]) => ({ coin, amount: text(amount) })),
      fees_complete: fees, matched_cost_basis: usable(asset) ? text(cost) : null,
      net_proceeds: sale && group.every(f => f.fees) && metadata && !cash ? text(quotedProceeds) : null,
      realized_pnl: text(pnl), realized_return_pct: returnPct(pnl, cost),
      pnl_before_unconverted_fees: !fees ? text(beforeFees) : null,
      basis_status: statusFor(asset, known, fees), matches: group.flatMap(f => f.matches),
      note: cash ? "Cash-conversion execution; excluded from investment performance. No stablecoin USD parity is assumed."
        : [...Array.from(asset?.notes ?? []), ...(!matched ? ["No complete matched base-inventory ledger for these fills."] : []),
          ...(!fees ? ["Unknown or unconverted fees: any before-fees P&L is not net profit."] : []),
          ...(asset?.borrowed ? ["Borrowed base inventory: owned cost basis is unavailable."] : [])].join(" ") || null,
    };
    orders.push(record);
  }
  orders.sort((a, b) => time(b.last_fill_at) - time(a.last_fill_at) || compare(a.order_id, b.order_id) || compare(a.symbol, b.symbol) || compare(a.side, b.side));
  const sales = orders.filter(o => o.side === "Sell");
  const investmentSales = sales.filter(o => o.base_coin && !CASH.has(o.base_coin));
  const investmentExecutions = Array.from(rawExecutions.values()).filter(e => !e.base_coin || !CASH.has(e.base_coin));
  const quotes = new Set([...holdings.map(h => h.quote_coin), ...investmentSales.map(s => s.quote_coin),
    ...investmentExecutions.map(e => e.quote_coin)]);
  // Gaps can hide sales completely, so an empty sales array is not proof of zero
  // realized P&L. Preserve known subtotals, but invalidate affected quote totals.
  const uncertainQuotes = new Set<string>();
  let unallocatedGap = investmentExecutions.some(e => !e.base_coin || !e.quote_coin);
  for (const asset of Array.from(assets.values())) {
    if (!asset.gap && !asset.mismatch && !asset.borrowed) continue;
    const relevant = new Set([...investmentExecutions.filter(e => e.base_coin === asset.coin).map(e => e.quote_coin),
      ...holdings.filter(h => h.asset === asset.coin).map(h => h.quote_coin)]);
    const knownQuotes = Array.from(relevant).filter((q): q is string => q !== null);
    if (!knownQuotes.length) unallocatedGap = true;
    for (const quote of knownQuotes) uncertainQuotes.add(quote);
  }
  const totals: SpotQuoteTotal[] = [];
  for (const quote of Array.from(quotes).filter((q): q is string => q !== null).sort(compare)) {
    const positions = holdings.filter(h => h.quote_coin === quote);
    const exits = investmentSales.filter(s => s.quote_coin === quote);
    const unknownRealized = exits.filter(s => s.realized_pnl === null).length;
    const unknownPositions = positions.filter(h => h.unrealized_pnl === null).length;
    const knownRealized = sum(exits.flatMap(s => s.realized_pnl === null ? [] : [new D(s.realized_pnl)]));
    const knownUnrealized = sum(positions.flatMap(h => h.unrealized_pnl === null ? [] : [new D(h.unrealized_pnl)]));
    const historyComplete = input.coverage.executions_complete && !input.coverage.error && !input.coverage.syncing
      && !unallocatedGap && !uncertainQuotes.has(quote);
    const realized = historyComplete && !unknownRealized ? knownRealized : null;
    const unrealized = historyComplete && !unknownPositions ? knownUnrealized : null;
    totals.push({ quote_coin: quote, realized_pnl: text(realized), known_realized_pnl: knownRealized.toFixed(),
      unrealized_pnl: text(unrealized), known_unrealized_pnl: knownUnrealized.toFixed(),
      combined_pnl: realized !== null && unrealized !== null ? text(realized.plus(unrealized)) : null,
      remaining_cost: positions.every(h => h.cost_basis !== null) ? text(sum(positions.map(h => new D(h.cost_basis!)))) : null,
      current_value: positions.every(h => h.market_value !== null) ? text(sum(positions.map(h => new D(h.market_value!)))) : null,
      unknown_realized_count: unknownRealized, unknown_position_count: unknownPositions,
      fees_complete: positions.every(h => h.fees_complete) && exits.every(s => s.fees_complete) });
  }
  // Summarize deduplicated individual fills, not order timestamps: a single
  // order can straddle a calendar cutoff. Existing FIFO and order results stay unchanged.
  const closedReturns = buildSpotClosedReturns({
    now: input.now, history: input.coverage, present_assets: assets.keys(),
    sales: Array.from(fills.values()).filter(f => f.execution.side === "Sell").map(f => {
      const e = f.execution;
      const asset = e.base_coin ? assets.get(e.base_coin) : undefined;
      const known = usable(asset) && f.matched && f.cost !== null && f.fees && f.basisFees
        && !!e.base_coin && !!e.quote_coin;
      return { timestamp: e.timestamp, base_coin: e.base_coin, quote_coin: e.quote_coin,
        realized_pnl: known ? f.value.minus(f.quoteFee).minus(f.cost!).toFixed() : null,
        matched_cost_basis: known ? text(f.cost) : null };
    }),
  });
  const partial = warnings.length > 0 || holdings.some(h => h.basis_status !== "known")
    || investmentSales.some(s => s.realized_pnl === null);
  return {
    status: input.coverage.syncing ? "syncing" : partial ? "partial" : "ready",
    retrieved_at: input.now, method: "FIFO", history: { ...input.coverage,
      inventory_complete: { ...input.coverage.inventory_complete } }, holdings, sales, orders, totals, warnings,
    closed_returns: closedReturns,
    notes: [
      "Actual account-wide spot API executions only; orders are not attributed to a script or to model trades.",
      "FIFO is informational bookkeeping, not tax advice. Opening and transferred inventory has unknown acquisition cost and date.",
      "Values and performance remain in each native quote currency; USDT and USDC are not assumed equal to USD or to each other. Cash holdings and conversions are excluded from investment P&L.",
      "Current value uses the matching pair's bid before future exit fees. Last prices and historical fills are not current valuation marks.",
      "Loan interest, funding and other financing costs are outside this spot-performance P&L; their base-coin inventory debits still reduce FIFO lots. Deposits, withdrawals and account equity are not profit.",
      "Known P&L subtotals exclude unknown portions and are not complete account profit. Unknown or third-currency fees are not treated as zero net fees.",
    ],
  };
}
