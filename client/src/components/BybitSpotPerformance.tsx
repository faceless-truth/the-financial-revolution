import React, { useState } from "react";
import Decimal from "decimal.js";
import type { BybitOwnerSession } from "@shared/bybitAccount";
import { SPOT_INVESTMENT_ASSETS, type BybitSpotPortfolio, type SpotBasisStatus, type SpotClosedReturnPeriod, type SpotHolding, type SpotOrderRecord } from "@shared/bybitSpot";

/** Presentation only. Never coerce venue decimals to floating point or calculate PnL here. */
export function formatSpotDecimal(value: string | null | undefined, places = 8, signed = false): string {
  if (value == null || value.trim() === "") return "Unknown";
  try {
    const decimal = new Decimal(value);
    if (!decimal.isFinite()) return "Unknown";
    let text = decimal.toFixed(places);
    // A real nonzero quantity or loss must never look like zero after rounding.
    if (!decimal.isZero() && new Decimal(text).isZero()) text = decimal.toExponential(7);
    else text = text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    const [mantissa, exponent] = text.split("e");
    const [integer, fraction] = mantissa.split(".");
    text = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? `.${fraction}` : "") + (exponent ? `e${exponent}` : "");
    return `${signed && decimal.isPositive() && !decimal.isZero() ? "+" : ""}${text}`;
  } catch {
    return "Unknown";
  }
}

export function formatSpotDate(value: string | null | undefined): string {
  if (!value) return "Unknown date";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().replace("T", " ").replace(".000Z", " UTC").replace("Z", " UTC") : "Unknown date";
}

function Amount({ value, coin, signed = false, places = 8 }: { value: string | null | undefined; coin?: string | null; signed?: boolean; places?: number }) {
  const text = formatSpotDecimal(value, places, signed);
  const color = signed && text !== "Unknown" ? (text.startsWith("-") ? "text-rose-300" : text.startsWith("+") ? "text-emerald-300" : "") : "";
  return <span className={`mono-data break-all ${color}`} title={value ?? undefined}>{text}{coin ? `${coin === "%" ? "" : " "}${coin}` : ""}</span>;
}

const basisReasons: Record<SpotBasisStatus, string> = {
  known: "Result not available",
  fees_incomplete: "Fees incomplete",
  unknown: "Purchase history needed",
  mismatch: "Inventory not reconciled",
  borrowed: "Borrowing needs reconciliation",
  syncing: "History syncing",
};
const assets: readonly string[] = SPOT_INVESTMENT_ASSETS;
const scopeLabel = `${SPOT_INVESTMENT_ASSETS.join(" · ")} only`;
const buttonClass = "rounded-lg border border-border/50 px-3 py-2 text-xs font-semibold hover:bg-white/5";
const cellClass = "p-2 align-top";

function isPositive(value: string): boolean {
  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() && decimal.greaterThan(0);
  } catch {
    return false;
  }
}

function Unknown({ reason }: { reason: string }) {
  return <span className="text-xs text-amber-200">Unknown <span className="text-muted-foreground">— {reason}</span></span>;
}

function Holding({ holding: h }: { holding: SpotHolding }) {
  const known = h.basis_status === "known" && h.fees_complete && h.reconciled && h.quote_coin &&
    h.unrealized_pnl !== null && h.unrealized_return_pct !== null;
  const reason = !h.fees_complete ? "Fees incomplete" : h.basis_status !== "known" ? basisReasons[h.basis_status] :
    !h.reconciled ? "Inventory not reconciled" : !h.bid_price ? "Current price unavailable" : "Result not available";
  return <article className="panel flex flex-wrap items-center justify-between gap-2 px-4 py-3" aria-label={`${h.asset} unrealised P&L`}>
    <h4 className="text-sm font-semibold">{h.asset}</h4>
    {known ? <div className="flex flex-wrap gap-3 text-sm"><Amount value={h.unrealized_pnl} coin={h.quote_coin} signed /><Amount value={h.unrealized_return_pct} coin="%" signed places={2} /></div> : <Unknown reason={reason} />}
  </article>;
}

function OrderHistory({ orders }: { orders: SpotOrderRecord[] }) {
  const [visible, setVisible] = useState(5);
  const sorted = orders.filter(o => o.base_coin && assets.includes(o.base_coin) && isPositive(o.executed_quantity))
    .sort((a, b) => Date.parse(b.last_fill_at) - Date.parse(a.last_fill_at) || b.order_id.localeCompare(a.order_id));
  return <section className="space-y-3" aria-label="Spot trades">
    <h3 className="text-sm font-semibold">Spot trades</h3>
    {sorted.length > 0 ? <div className="overflow-x-auto"><table className="w-full text-left text-xs">
      <caption className="sr-only">{scopeLabel} — newest first; actual fills aggregated per order</caption>
      <thead className="text-muted-foreground"><tr>{["Trade", "Date (UTC)", "Price", "Quantity", "Realised P&L"].map(label => <th key={label} scope="col" className={cellClass}>{label}</th>)}</tr></thead>
      <tbody>{sorted.slice(0, visible).map(o => <tr key={o.order_id} data-spot-order={o.side} className="border-t border-border/30">
        <th scope="row" className={cellClass}>{o.side} <span className="block">{o.symbol}</span></th>
        <td className={`${cellClass} min-w-40`}><time dateTime={o.last_fill_at} title={`First fill: ${formatSpotDate(o.first_fill_at)}`}>{formatSpotDate(o.last_fill_at)}</time></td>
        <td className={cellClass}><Amount value={o.average_fill_price} coin={o.quote_coin} /></td>
        <td className={cellClass}><Amount value={o.executed_quantity} coin={o.base_coin} /><span className="block text-muted-foreground">{o.fill_count} fill{o.fill_count === 1 ? "" : "s"}</span></td>
        <td className={cellClass}>{o.side === "Buy" ? <span aria-label="Not applicable">—</span> :
          o.basis_status === "known" && o.fees_complete && o.quote_coin && o.matched_cost_basis !== null && o.realized_pnl !== null ?
            <Amount value={o.realized_pnl} coin={o.quote_coin} signed /> :
            <Unknown reason={!o.fees_complete ? "Fees incomplete" : basisReasons[o.basis_status]} />}</td>
      </tr>)}</tbody>
    </table></div> : <p className="text-xs text-muted-foreground">No spot trades available for these assets.</p>}
    <div className="flex gap-2">
      {sorted.length > visible && <button type="button" className={buttonClass} onClick={() => setVisible(count => count + 5)}>Show 5 more</button>}
      {visible > 5 && <button type="button" className={buttonClass} onClick={() => setVisible(5)}>Show fewer</button>}
    </div>
  </section>;
}

function ClosedReturns({ periods }: { periods: SpotClosedReturnPeriod[] | undefined }) {
  const [months, setMonths] = useState<12 | 18 | 24>(12);
  const period = periods?.find(row => row.months === months);
  return <section className="space-y-3" aria-label="Closed P&L">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-semibold">Closed P&L</h3>
      <select aria-label="Closed P&L period" className="rounded-lg border border-border/50 bg-background px-3 py-2 text-xs" value={months}
        onChange={event => setMonths(event.target.value === "18" ? 18 : event.target.value === "24" ? 24 : 12)}>
        <option value={12}>Last 12 months</option><option value={18}>Last 18 months</option><option value={24}>Last 24 months</option>
      </select>
    </div>
    <p className="text-xs text-muted-foreground">Net return on matched sold cost · {scopeLabel}</p>
    {!period || period.quotes.length === 0 ? <p className="text-sm">Unavailable</p> : <ul className="space-y-2">
      {period.quotes.map(quote => <li key={quote.quote_coin} className="text-sm">
        {quote.included_sales > 0 && quote.return_pct !== null && quote.realized_pnl !== null && quote.matched_cost_basis !== null && formatSpotDecimal(quote.return_pct) !== "Unknown" ?
          <><Amount value={quote.return_pct} coin="%" signed places={2} /> <span>({quote.quote_coin} trades)</span></> :
          <span>Unavailable ({quote.quote_coin} trades)</span>}
        <span className="ml-2 text-xs text-muted-foreground">{quote.included_sales} eligible sale fill{quote.included_sales === 1 ? "" : "s"}</span>
      </li>)}
    </ul>}
    {period && <div className="space-y-1 text-xs text-muted-foreground">
      <p title={`${formatSpotDate(period.from)} – ${formatSpotDate(period.through)}`}>{period.coverage_complete ? "History coverage complete" : "Partial history coverage — available sales only"}</p>
      {period.excluded_sales > 0 && <p className="text-amber-200">{period.excluded_sales} sale fill{period.excluded_sales === 1 ? "" : "s"} excluded — unknown cost or fees. Known results only.</p>}
    </div>}
  </section>;
}

/** Pure presentation of server bookkeeping; no live requests, credentials or model returns. */
export function SpotPerformanceView({ portfolio: p }: { portfolio: BybitSpotPortfolio }) {
  const historyIncomplete = !p.history.executions_complete || p.history.syncing || !!p.history.error || p.status === "unavailable";
  const holdings = p.holdings.filter(h => assets.includes(h.asset) && isPositive(h.quantity))
    .sort((a, b) => assets.indexOf(a.asset) - assets.indexOf(b.asset) || (a.quote_coin ?? "").localeCompare(b.quote_coin ?? ""));
  return <div className="space-y-6">
    {historyIncomplete && <p role="status" className="text-xs text-amber-200">{p.history.error || p.status === "unavailable" ? "History unavailable or incomplete — retry refresh." : p.history.syncing ? "Syncing trade history — results may be incomplete." : "Partial trade history — results may be incomplete."}</p>}
    <section aria-label="Current unrealised P&L" className="space-y-3">
      <h3 className="text-sm font-semibold">Current unrealised P&L</h3>
      <p className="text-xs text-muted-foreground">{scopeLabel}</p>
      {holdings.map(holding => <Holding key={holding.id} holding={holding} />)}
      {holdings.length === 0 && <p className="text-xs text-muted-foreground">{historyIncomplete ? "Current investments not yet confirmed." : "No current investments in these assets."}</p>}
    </section>
    <OrderHistory orders={p.orders} />
    <ClosedReturns periods={p.closed_returns} />
    <footer className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
      <span>Updated <time dateTime={p.retrieved_at}>{formatSpotDate(p.retrieved_at)}</time></span>
      <span tabIndex={0} title="Server-calculated FIFO. Identified paid fees included; unrealised P&L uses the current bid, excluding future exit fees. Closed return = summed net realised P&L / summed matched sold cost × 100, separately per quote. Unknown costs or fees excluded. Not annualised or a whole-account return.">FIFO · net of paid fees</span>
    </footer>
  </div>;
}

export function BybitAuthorizedSpotPerformance({ session, portfolio }: { session: BybitOwnerSession | null; portfolio: BybitSpotPortfolio | null }) {
  return session?.authenticated && session.login_configured && portfolio ? <SpotPerformanceView portfolio={portfolio} /> : null;
}
