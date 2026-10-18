import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AccountPerformance, LearningTest, StrategyCurve } from "@shared/cockpit";
import {
  accountModel, changesSinceStart, choosePerformanceSource, deriveExits, dollarsBelowPeak, exitHeadline,
  formatSignedUsd, formatUsd, isStale, overviewTitle, rotationNote, strategyModel,
  type CockpitForecast, type CockpitParams, type CockpitStatus,
} from "../client/src/lib/cockpit";
import {
  LearningView, PerformanceView, TradesView, WhatEndsThisTrade,
} from "../client/src/components/cockpit/CockpitViews";

// Real 2026-09-26 payload values (SUI entered that day after reconciliation).
const params: CockpitParams = {
  stop_loss_pct: 0.15, crash_dd_threshold: 0.25, min_hold_days: 7,
  regime_exit_threshold: -5, rotation_threshold: 30, msb_wait_limit: 5,
};
function status(over: Partial<CockpitStatus> = {}): CockpitStatus {
  return {
    position: "SUI", invested: true, entry_price: 1.177444, entry_date: "2026-09-26", hold_days: 0,
    action: "ROTATE", reason: "Rotating to SUI (Score: 56.6 vs BTC: 6.7 — lead 49.9 ≥ 30 pts)",
    portfolio_value_usd: 73593.2, reserve_usd: 0, total_wealth_usd: 73593.2,
    assets: {
      BTC: { price: 84099.99, score: 6.68, mom_30: 6.42, mom_14: 8.9, mom_7: 3.98, dd_30: -0.0291 },
      ETH: { price: 2691.61, score: 6.38, mom_30: 7.37, mom_14: 6.96, mom_7: 3.04, dd_30: -0.0305 },
      SOL: { price: 122.15, score: 17.27, mom_30: 19.67, mom_14: 19.22, mom_7: 8.37, dd_30: 0 },
      DOGE: { price: 0.09897, score: 14.28, mom_30: 12.85, mom_14: 17.4, mom_7: 13.15, dd_30: -0.0146 },
      SUI: { price: 1.1949, score: 56.58, mom_30: 55.69, mom_14: 64.65, mom_7: 46.72, dd_30: 0 },
    },
    ...over,
  };
}
const forecast: CockpitForecast = {
  mode: "HOLDING",
  conditions: [
    { label: "Stop-loss", detail: "Exit if SUI closes below $1.00.", distance_pct: -16.24 },
    { label: "Structure exit (bearish MSB)", detail: "After the 7-day hold, exit if SUI closes below $0.54.", distance_pct: -54.89 },
    { label: "Regime exit", detail: "Exit to cash if BTC 30-day momentum falls below -5%.", distance_pct: null },
    { label: "Crash backstop", detail: "Hard exit if BTC 30-day drawdown reaches −25%.", distance_pct: null },
  ],
};

describe("dollar formatting from decimal strings", () => {
  it("formats venue decimals exactly, with grouping and signs", () => {
    expect(formatUsd("97932.59518939")).toBe("$97,933");
    expect(formatUsd("12345678901234.505", 2)).toBe("$12,345,678,901,234.51");
    expect(formatSignedUsd("45007.4")).toBe("+$45,007");
    expect(formatSignedUsd("-11040.8")).toBe("−$11,041");
    expect(formatSignedUsd("0.3")).toBe("$0");
    expect(formatSignedUsd("-0.4")).toBe("$0");
    expect(formatUsd(null)).toBe("—");
    expect(formatUsd("not a number")).toBe("—");
  });
});

describe("exit derivation", () => {
  it("derives levels, arming date and destinations from the payload", () => {
    const m = deriveExits(status(), params, forecast)!;
    const by = Object.fromEntries(m.rules.map(r => [r.kind, r]));
    expect(by.stop.level).toBeCloseTo(1.0008274, 6);          // entry × (1 − 15%)
    expect(by.structure.level).toBeCloseTo(0.53903, 4);        // last close × (1 − 54.89%)
    expect(m.minHold.armsOn).toBe("2026-10-03");
    expect([by.stop.live, by.structure.live, by.regime.live, by.crash.live]).toEqual([true, false, false, true]);
    // From an altcoin, stop and structure exits go to BTC; regime and crash go to cash.
    expect([by.stop.destination, by.structure.destination, by.regime.destination, by.crash.destination])
      .toEqual(["BTC", "BTC", "CASH", "CASH"]);
    expect(by.regime.now).toBeCloseTo(6.42);
    expect(by.crash.now).toBeCloseTo(-2.91);
    expect(by.crash.level).toBe(-25);
  });

  it("sends a BTC position's stop and structure exits to cash", () => {
    const m = deriveExits(status({ position: "BTC", entry_price: 66556.16 }), params, forecast)!;
    expect(m.rules.find(r => r.kind === "stop")!.destination).toBe("CASH");
    expect(m.rules.find(r => r.kind === "structure")!.destination).toBe("CASH");
  });

  it("has nothing to exit in cash", () => {
    expect(deriveExits(status({ position: "CASH" }), params, forecast)).toBeNull();
  });
});

describe("state-to-copy", () => {
  it("writes the exit headline for each state", () => {
    expect(exitHeadline(deriveExits(status(), params, forecast)))
      .toBe("Four ways out. Only the stop-loss and crash backstop are live until 3 Oct.");
    expect(exitHeadline(deriveExits(status({ hold_days: 7 }), params, forecast)))
      .toBe("Four ways out. All four are live.");
    expect(exitHeadline(null)).toBe("Nothing to exit. The strategy is in cash.");
  });

  it("titles the overview from the position", () => {
    expect(overviewTitle(status())).toBe("You're holding SUI");
    expect(overviewTitle(status({ position: "CASH" }))).toBe("You're in cash");
    expect(overviewTitle(null)).toBe("Strategy status unavailable");
  });

  it("explains the rotation line from the real v5.0 rule", () => {
    const note = rotationNote(status(), params);
    expect(note).toContain("minimum hold (day 0 now)");
    expect(note).toContain("SUI still ranks first at 56.6");
    expect(note).toContain("SOL (17.3)");
    // A different alt that ranks first and clears BTC + 30 is a rotation target.
    const sol = status({ hold_days: 9, assets: { ...status().assets, SOL: { score: 45 }, SUI: { price: 1.19, score: 20 } } });
    expect(rotationNote(sol, params)).toBe("SOL ranks first at 45.0 and clears the line at 36.7. It would be the rotation target at the next eligible close.");
  });
});

describe("freshness", () => {
  it("flags a payload once a newer decision should exist", () => {
    expect(isStale("2026-09-26", new Date("2026-09-26T05:00:00Z"))).toBe(false);
    expect(isStale("2026-09-26", new Date("2026-09-27T00:40:00Z"))).toBe(false);
    expect(isStale("2026-09-26", new Date("2026-09-27T01:30:00Z"))).toBe(true);
    expect(isStale("2026-09-24", new Date("2026-09-26T00:10:00Z"))).toBe(true);
    expect(isStale(null)).toBe(true);
  });
});

// ── Performance ──────────────────────────────────────────────────────────────
const curve: StrategyCurve = {
  available: true, basis_usd: 10000, start_date: "2026-09-20", end_date: "2026-09-26",
  method: "Price-based: the held asset's daily closes and the live 0.4% switch fee.",
  series: [
    { date: "2026-09-20", value_usd: 10000, position: "BTC" },
    { date: "2026-09-21", value_usd: 10150, position: "BTC" },
    { date: "2026-09-22", value_usd: 9900, position: "BTC" },
    { date: "2026-09-23", value_usd: 10400, position: "BTC" },
    { date: "2026-09-24", value_usd: 10300, position: "BTC" },
    { date: "2026-09-25", value_usd: 10600, position: "BTC" },
    { date: "2026-09-26", value_usd: 10560, position: "SUI" },
  ],
  periods: { "7D": { start_date: "2026-09-20", start_usd: 10000, end_usd: 10560, change_usd: 560 }, "30D": null, All: { start_date: "2026-09-20", start_usd: 10000, end_usd: 10560, change_usd: 560 } },
};
const account: AccountPerformance = {
  available: true, as_of: "2026-09-26T05:00:00Z",
  coverage: { start_date: "2026-09-23", complete: false, notes: ["Transfers before 2024-09-26 are outside Bybit's two-year window."] },
  series: [
    { date: "2026-09-23", equity_usd: "90000.00", net_flow_usd: "0" },
    { date: "2026-09-24", equity_usd: "95100.50", net_flow_usd: "5000.00" },  // deposit, not profit
    { date: "2026-09-25", equity_usd: "96000.25", net_flow_usd: "0" },
    { date: "2026-09-26", equity_usd: "97932.60", net_flow_usd: "0" },
  ],
  periods: { "7D": { start_date: "2026-09-23", start_equity_usd: "90000.00", end_equity_usd: "97932.60", net_flows_usd: "5000.00", pnl_usd: "2932.60" } },
};

describe("performance source", () => {
  it("shows the owner's account only for an authenticated session with data", () => {
    expect(choosePerformanceSource({ authenticated: true }, account, curve)).toBe("account");
    expect(choosePerformanceSource({ authenticated: false }, account, curve)).toBe("strategy");
    expect(choosePerformanceSource(null, account, curve)).toBe("strategy");
    expect(choosePerformanceSource({ authenticated: true }, null, curve)).toBe("strategy");
    expect(choosePerformanceSource({ authenticated: true }, { ...account, available: false }, curve)).toBe("strategy");
    expect(choosePerformanceSource({ authenticated: false }, null, { ...curve, available: false })).toBe("none");
  });

  it("never counts a deposit as a gain", () => {
    const m = accountModel(account);
    const ch = changesSinceStart(m, m.periods["7D"]!);
    expect(ch["2026-09-24"]).toBe("100.5");     // 95,100.50 − 90,000 − 5,000 deposit
    expect(ch["2026-09-26"]).toBe("2932.6");
    expect(dollarsBelowPeak([0, 100, 50, 200, 120])).toEqual([0, 0, -50, 0, -80]);
  });

  it("renders the public curve in dollars only, with the sign-in pointer", () => {
    const html = renderToStaticMarkup(createElement(PerformanceView, {
      model: strategyModel(curve),
      notice: createElement("p", null, "Sign in on the Portfolio page"),
    }));
    expect(html).toContain("$10,000 following the strategy");
    expect(html).toContain("+$560");
    expect(html).toContain("$10,000 → $10,560");
    expect(html).toContain("Sign in on the Portfolio page");
    // Dollars instead of percentages in every figure (the method footnote may cite the fee).
    const figures = html.slice(0, html.lastIndexOf('<p class="note">'));
    expect(figures).not.toContain("%");
    expect(html).not.toMatch(/sample/i);
    expect(html).toMatch(/id="seg-30D"[^>]*disabled/);
  });

  it("renders the account view with net flows and coverage notes", () => {
    const html = renderToStaticMarkup(createElement(PerformanceView, { model: accountModel(account), notice: null }));
    expect(html).toContain("Your Bybit account");
    expect(html).toContain("How the account has done");
    expect(html).toContain("+$2,933");
    expect(html).toContain("net deposits/withdrawals +$5,000");
    expect(html).toContain("History is incomplete.");
    expect(html).toContain("deposits and withdrawals excluded");
    expect(html).not.toContain("%");
  });
});

describe("views", () => {
  it("renders what ends this trade from derived levels", () => {
    const s = status();
    const html = renderToStaticMarkup(createElement(WhatEndsThisTrade, { exits: deriveExits(s, params, forecast)!, status: s }));
    expect(html).toContain("What ends this trade");
    expect(html).toContain("$1.0008");
    expect(html).toContain("$0.5390");
    expect(html).toContain("Arms 3 Oct");
    expect(html).toContain("Sells SUI and moves to BTC.");
    expect(html).toContain("0 of 7 days");
  });

  it("puts the open trade above closed trades", () => {
    const html = renderToStaticMarkup(createElement(TradesView, {
      trades: {
        open_trade: { asset: "SUI", entry_date: "2026-09-26", exit_date: null, hold_days: 0, pnl_pct: 0, exit_action: null, open: true },
        closed_trades: [{ asset: "BTC", entry_date: "2026-07-22", exit_date: "2026-09-26", hold_days: 66, pnl_pct: 25.85, exit_action: "ROTATE", win: true }],
        stats: { n: 1, wins: 1, losses: 0, win_rate: 100, compounded_pct: 25.85, best: 25.85, worst: 25.85, avg_hold_days: 66 },
      },
    }));
    expect(html.indexOf("Open</span>")).toBeLessThan(html.indexOf("Rotated"));
    expect(html).toContain("+25.85%");
  });

  it("renders learning tests and degrades when they are absent", () => {
    const test: LearningTest = {
      id: "v3-wait3", name: "Faster re-entry (3-day wait)", plain: "Buys back in after 3 days instead of 5.",
      status: "watching", verdict_label: "Watching", started: "2026-09-26", days_running: 1,
      progress: { done: 0, need: 10, label: "days it disagreed with live" },
      live_return_pct: 0, test_return_pct: -0.4, decision: "Earliest decision around February 2027",
      backtest: { test_return_pct: 374.4, live_return_pct: 229.7, test_maxdd_pct: -50.4, live_maxdd_pct: -55.7, windows_won: "5 of 6", confidence: 0.488, bar: 0.95, summary: null },
    };
    const html = renderToStaticMarkup(createElement(LearningView, { tests: [test] }));
    expect(html).toContain("Faster re-entry (3-day wait)");
    expect(html).toContain("0 of 10 days it disagreed with live");
    expect(html).toContain("0.488");
    expect(renderToStaticMarkup(createElement(LearningView, { tests: undefined }))).toContain("No paper test summaries yet");
  });
});
