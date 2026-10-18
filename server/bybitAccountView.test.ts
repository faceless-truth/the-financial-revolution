import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import BybitAccount, {
  BybitAccessNotice,
  BybitAuthorizedSnapshot,
  BybitSnapshotView,
  bybitRequestError,
  formatBybitDecimal,
} from "../client/src/components/BybitAccount";
import type { BybitAccountSnapshot, BybitPosition } from "../shared/bybitAccount";

// Entirely synthetic, scoped UI fixtures. Never read live account state or credentials.
function fakePosition(overrides: Partial<BybitPosition> = {}): BybitPosition {
  return {
    category: "linear", symbol: "FAKEUSDT", position_index: 1, side: "Buy",
    size: "3.000", settle_coin: "USDT", avg_price: "100.10", mark_price: "101.20",
    position_value: "987654321.12345", unrealised_pnl: "3.30", leverage: "2.00",
    liquidation_price: null, initial_margin: "88888.88", updated_at: null,
    ...overrides,
  };
}
function fakeSnapshot(overrides: Partial<BybitAccountSnapshot> = {}): BybitAccountSnapshot {
  return {
    status: "connected", retrieved_at: "2026-09-20T12:34:56.000Z",
    read_only_verified: true, ip_restricted: true, account_type: "UNIFIED",
    unified_margin_status: 5, margin_mode: "REGULAR_MARGIN",
    totals: {
      equity_usd: "1234.567890123456789", wallet_balance_usd: "1200.00",
      perpetual_unrealised_pnl_usd: "34.567890123456789", available_balance_usd: null,
    },
    balances: [{ coin: "FAKE", wallet_balance: "90071992547409931234567890.123456789012345678900",
      equity: "1.000", usd_value: "10.000", spot_borrow: "0.100", locked: null, unrealised_pnl: null }],
    positions: [fakePosition(), fakePosition({ position_index: 2, side: "Sell", unrealised_pnl: "-1.10" }),
      fakePosition({ symbol: "FAKEUSDC", settle_coin: "USDC" }),
      fakePosition({ category: "inverse", symbol: "FAKEBTCUSD", settle_coin: "BTC", unrealised_pnl: "0.000000000000123456789" }),
      fakePosition({ category: "inverse", symbol: "UNKNOWNUSD", settle_coin: null, unrealised_pnl: "-0.00002" })],
    coverage: { wallet: true, linear_usdt: true, linear_usdc: true, inverse: true },
    warnings: [], ...overrides,
  };
}
const renderSnapshot = (snapshot = fakeSnapshot()) => renderToStaticMarkup(React.createElement(BybitSnapshotView, { snapshot }));
const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

describe("Bybit private account display", () => {
  it("preserves full decimal precision without floating-point financial calculations", () => {
    expect(formatBybitDecimal("90071992547409931234567890.123456789012345678900"))
      .toBe("90,071,992,547,409,931,234,567,890.1234567890123456789");
    expect(formatBybitDecimal("-1234.00000000000000000001")).toBe("-1,234.00000000000000000001");
    expect(formatBybitDecimal("0.000")).toBe("0");
    expect(formatBybitDecimal("1200.5000")).toBe("1,200.5");
    expect(renderSnapshot()).toContain("90,071,992,547,409,931,234,567,890.1234567890123456789");
  });

  it("renders unavailable and blank fields as em dashes, never invented zero", () => {
    for (const value of [null, undefined, "", " "]) expect(formatBybitDecimal(value)).toBe("—");
    const html = renderSnapshot(fakeSnapshot({ totals: {
      equity_usd: null, wallet_balance_usd: null, perpetual_unrealised_pnl_usd: null, available_balance_usd: null,
    }, positions: [fakePosition({ avg_price: "", mark_price: null, leverage: "", liquidation_price: null })] }));
    expect(html).toContain("Available margin (USD)");
    expect(html.match(/>—<\/span>/g)?.length).toBeGreaterThanOrEqual(8);
    expect(html).not.toContain("$0");
  });

  it("does not expose fixture data, permissions or totals while locked or unconfigured", () => {
    for (const session of [null, { authenticated: false, login_configured: true },
      { authenticated: false, login_configured: false }, { authenticated: true, login_configured: false }]) {
      const html = renderToStaticMarkup(React.createElement(BybitAuthorizedSnapshot, { session, snapshot: fakeSnapshot() }));
      expect(html).toBe("");
    }
    const checking = renderToStaticMarkup(React.createElement(BybitAccount));
    expect(checking).toContain("Checking secure owner session");
    expect(checking).toContain("Investment portfolio — Bybit spot");
    expect(checking).not.toContain("Unified equity (USD)");
    expect(checking).not.toContain("Read-only verified");
    const setup = renderToStaticMarkup(React.createElement(BybitAccessNotice, { loginConfigured: false }));
    expect(setup).toContain("Secure login setup needed");
    expect(setup).not.toContain("FAKE");
    const locked = renderToStaticMarkup(React.createElement(BybitAccessNotice, { loginConfigured: true }));
    expect(locked).toContain("not the public site password or a Bybit API secret");
  });

  it("shows only vendor totals, never adds position value, margin or P&L into NAV", () => {
    const html = renderSnapshot();
    expect(html).toContain("1,234.567890123456789");
    expect(html).toContain("Vendor-reported totals, not a sum of rows");
    expect(html).toContain("do not add position notional, margin or P&amp;L on top");
    expect(html).not.toContain("987,654,321");
    expect(html).not.toContain("88,888.88");
    expect(html).not.toContain("NAV");
    expect(html).toContain("Wallet balance is not net ownership or freely spendable cash");
    expect(html).toContain("Spot borrow");
    expect(html).toContain("Locked");
  });

  it("keeps mixed settlement currencies, unknown inverse units and both hedge legs", () => {
    const html = renderSnapshot();
    expect(html.match(/>FAKEUSDT<\/th>/g)).toHaveLength(2);
    expect(html).toContain("Hedge leg index");
    expect(html).toContain('>Buy</td><td class="p-2">1</td>');
    expect(html).toContain('>Sell</td><td class="p-2">2</td>');
    expect(html).toContain("<span>USDT</span>");
    expect(html).toContain("<span>USDC</span>");
    expect(html).toContain("<span>BTC</span>");
    expect(html).toContain("0.000000000000123456789");
    const unknownRow = html.match(/<tr[^>]*><th[^>]*>UNKNOWNUSD<\/th>[\s\S]*?<\/tr>/)?.[0];
    expect(unknownRow).toContain("Native settlement units");
    expect(unknownRow).not.toContain("(USD)");
    expect(unknownRow).not.toContain("<span>USD</span>");
    expect(html).toContain("mixed currencies are not summed");
  });

  it("shows actual missing scopes and never calls incomplete coverage successfully empty", () => {
    const html = renderSnapshot(fakeSnapshot({ status: "partial", positions: [], balances: [],
      coverage: { wallet: false, linear_usdt: true, linear_usdc: false, inverse: false },
      warnings: [{ code: "FAKE_COVERAGE", message: "Synthetic coverage warning." }],
    }));
    expect(html).toContain("Partial snapshot — coverage incomplete");
    expect(html).toContain("Missing scopes: Unified wallet, USDC-settled linear positions, Inverse positions.");
    expect(html).toContain("Synthetic coverage warning.");
    expect(html).toContain("no-open-positions status is not confirmed");
    expect(html).toContain("an empty account is not confirmed");
    expect(html).not.toContain("No open positions in the covered");
    expect(html).not.toContain("1,234.567890123456789");
    const partialDespiteFlags = renderSnapshot(fakeSnapshot({ status: "partial", positions: [] }));
    expect(partialDespiteFlags).toContain("no-open-positions status is not confirmed");
  });

  it("distinguishes truly empty complete scopes and discloses scope, time and read-only status", () => {
    const html = renderSnapshot(fakeSnapshot({ balances: [], positions: [] }));
    expect(html).toContain("No open positions in the covered linear and inverse scopes");
    expect(html).toContain("No coin balances reported in the covered Unified wallet");
    expect(html).not.toContain("Partial snapshot");
    expect(html).toContain("Read-only verified");
    expect(html).toContain("IP restrictions: Verified");
    expect(html).toContain("2026-09-20 12:34:56.000 UTC");
    expect(html).toContain("Funding wallet and options positions are omitted");
    expect(html).toContain("not executed orders");
    expect(html).toContain("can include options value and derivative P&amp;L");
  });

  it("uses controlled errors rather than private response or request details", () => {
    expect(bybitRequestError(401, "account")).toContain("session expired");
    expect(bybitRequestError(401, "login")).toContain("password not accepted");
    expect(bybitRequestError(429, "login")).toContain("Wait");
    expect(bybitRequestError(503, "login")).toContain("setup needed");
    expect(bybitRequestError(500, "account")).toContain("Unable to retrieve");
  });

  it("mounts independently above strategy loading/error and keeps paper views separate", () => {
    const portfolio = source("../client/src/pages/Portfolio.tsx");
    expect(portfolio).toContain('import BybitAccount from "@/components/BybitAccount"');
    expect(portfolio).toMatch(/<\/header>\s*<div className="container py-6 space-y-6">\s*<BybitAccount \/>\s*\{loading \? \(/);
    expect(portfolio).toContain("Unable to load live portfolio snapshot.");
    expect(source("../client/src/components/PaperComparison.tsx")).not.toContain("BybitAccount");
    expect(source("../client/src/pages/BullRotation.tsx")).not.toContain("BybitAccount");
  });

  it("keeps authentication transient and requests private, with lifecycle cancellation guards", () => {
    const component = source("../client/src/components/BybitAccount.tsx");
    expect(component).not.toMatch(/localStorage|sessionStorage|console\.|https?:\/\/|import\.meta\.env/);
    expect(component).toContain('credentials: "same-origin", cache: "no-store"');
    expect(component).toContain('minLength={12} maxLength={512}');
    expect(component).toContain('const length = Array.from(password).length');
    expect(component).toContain('length > 256');
    expect(component).toContain('autoComplete="current-password"');
    expect(component).toContain('value="bybit-owner"');
    expect(component).toContain('document.addEventListener("visibilitychange"');
    expect(component).toContain('window.addEventListener("pageshow"');
    expect(component).toContain("60_000");
    expect(component).toContain("sequence.current === id");
    expect(component).toContain("pending.current?.abort()");
    expect(component).toContain("server logout could not be confirmed");
    expect(component).not.toMatch(/parseFloat|parseInt|Number\(.*(?:balance|equity|pnl|price)/i);
  });
});
