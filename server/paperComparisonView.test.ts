import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import PaperComparison, { getPaperFreshness } from "../client/src/components/PaperComparison";
import type { PaperAccount, PaperComparisonPayload } from "@shared/paperComparison";

const NOW = Date.parse("2026-09-19T18:00:00Z");
function account(id: "control" | "candidate"): PaperAccount {
  return {
    id, label: id === "control" ? "Current v5.0 rules" : "Frozen 50% / 20% paper",
    description: "Recorded virtual account", strategy_version: "v5.0", position: "CASH",
    portfolio_value_usd: 67428, reserve_usd: 0, total_wealth_usd: 67428,
    pnl_usd: 0, return_pct: 0, max_drawdown_pct: 0, transition_count: 0,
    fees_usd: 0, hold_days: 0, entry_price: null, entry_date: null,
    last_action: "INITIALIZE", last_reason: "Same starting cash",
  };
}
function seed(): PaperComparisonPayload {
  return {
    schema_version: 1, available: true, generated_at: "2026-09-19T12:00:00Z",
    phase: "initialized", health: "ok", message: "Initialized from recorded seed.",
    paper_only: true, candidate_promoted: false, start_date: "2026-09-19",
    last_observation_date: null, last_updated_at: "2026-09-19T12:00:00Z", last_quote_at: null,
    schedule_utc: "00:15 UTC", next_update_due_at: "2026-09-20T00:15:00Z",
    stale_after: "2026-09-20T01:15:00Z", sample_days: 0, divergence_days: 0,
    trail_exit_count: 0, starting_capital_usd: 67428,
    live_reference: {
      strategy_version: "v5.0", as_of_date: "2026-09-19", live_position: "CASH",
      control_position: "CASH", strategy_version_matches: true, position_matches: true,
      control_matches_live: true, separately_seeded: true,
      live_return_pct: null, control_return_pct: null, return_gap_pp: null,
    },
    accounts: { control: account("control"), candidate: account("candidate") },
    comparison: { lead_usd: 0, lead_return_pp: 0 },
    series: [{ date: "2026-09-19", control: 67428, candidate: 67428, is_seed: true }],
    daily_history: [], last_run: { status: "initialized", started_at: null, completed_at: null, message: null },
    notes: ["Same capital, dates and costs for a fair comparison.", "No automatic promotion."],
  };
}
function render(data?: PaperComparisonPayload | null, now = NOW) {
  return renderToStaticMarkup(createElement(PaperComparison, { data, now }));
}
function mature() {
  const data = seed();
  data.phase = "collecting";
  data.sample_days = 2;
  data.divergence_days = 1;
  data.last_observation_date = "2026-09-21";
  data.last_quote_at = "2026-09-21T00:00:00Z";
  data.next_update_due_at = "2026-09-22T00:15:00Z";
  data.stale_after = "2026-09-22T01:15:00Z";
  data.comparison = { lead_usd: 123.45, lead_return_pp: 0.18 };
  data.accounts.candidate = {
    ...account("candidate"), position: "BTC", total_wealth_usd: 68551.45,
    entry_price: 60000, entry_date: "2026-09-20", return_pct: 1.67, pnl_usd: 1123.45,
    trail: { activation_pct: 50, distance_pct: 20, armed: true, peak_price: 90000, trigger_price: 72000 },
  };
  data.daily_history = ["2026-09-20", "2026-09-21"].map(date => ({
    date, signal_date: date, quote_at: `${date}T00:00:00Z`,
    control: { position: "CASH", action: "WAIT", reason: null, wealth: 67428, return_pct: 0, fees_usd: 0, transition: false },
    candidate: { position: "BTC", action: "HOLD", reason: "Recorded reason", wealth: 68551.45, return_pct: 1.67, fees_usd: 4, transition: false },
    lead_usd: 123.45, lead_return_pp: 0.18, divergent: true, trail_exit: false,
  }));
  data.series.push({ date: "2026-09-20", control: 67428, candidate: 68551.45, is_seed: false });
  return data;
}

describe("paper comparison view", () => {
  it("renders actual seed funds and two virtual accounts without invented observations or a leader", () => {
    const html = render(seed());
    expect(html).toContain("Awaiting first daily observation");
    expect(html).toContain("2026-09-20 00:15:00 UTC");
    expect(html).toContain("$67,428.00");
    expect(html).toContain("0.00%");
    // The two account-card position badges; the live-reference card names CASH too.
    expect(html.match(/text-xl font-semibold"[^>]*>CASH</g)).toHaveLength(2);
    expect(html.match(/>Current v5.0 rules</g)).toHaveLength(1);
    expect(html.match(/>Frozen 50% \/ 20% paper</g)).toHaveLength(1);
    expect(html).toContain("it is not the actual account on Dashboard");
    expect(html).not.toContain("Recorded paper equity");
    expect(html).not.toContain("Candidate minus control");
    expect(html).toContain("No daily observations recorded yet");
    expect(html).toMatch(/Entry price<\/dt><dd[^>]*>—<\/dd>/);
  });

  it("does not fabricate a cash entry price even when the stored cash entry is zero", () => {
    const data = seed();
    data.accounts.candidate!.entry_price = 0;
    const html = render(data);
    expect(html.match(/Entry price<\/dt><dd[^>]*>—<\/dd>/g)).toHaveLength(2);
    expect(html).not.toContain("Peak price");
  });

  it("handles missing and unavailable payloads without legacy or zero-filled accounts", () => {
    for (const data of [undefined, null, { ...seed(), available: false, message: "Snapshot not ready." }]) {
      const html = render(data);
      expect(html).toContain("Paper comparison unavailable");
      expect(html).not.toContain("$67,428");
      expect(html).not.toContain("$0.00");
      expect(html).not.toContain("Current v5.0 rules");
    }
    const partial = seed();
    partial.accounts = {};
    partial.starting_capital_usd = null;
    partial.sample_days = null;
    expect(render(partial)).toMatch(/Total wealth<\/div><div[^>]*>—<\/div>/);
    expect(render(partial)).not.toContain("Candidate minus control");
  });

  it("renders mature recorded metrics, trail, quotes, and percentage-point lead", () => {
    const html = render(mature());
    expect(html).toContain("Recorded paper equity");
    expect(html).toContain("Initial balance, not an observation");
    expect(html).toContain("$123.45");
    expect(html).toContain("+0.18 pp");
    expect(html).not.toContain("+0.18%");
    expect(html).toContain("$68,551.45");
    expect(html).toContain("Armed");
    expect(html).toContain("$72,000.00");
    expect(html).toContain("2026-09-21 00:00:00 UTC");
    const table = html.slice(html.indexOf("<tbody>"));
    expect(table.indexOf("2026-09-21")).toBeLessThan(table.indexOf("2026-09-20"));
  });

  it("previews 30 history rows and offers all records without mutating the payload", () => {
    const data = mature();
    const row = data.daily_history[0];
    data.daily_history = Array.from({ length: 35 }, (_, i) => ({ ...row, date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10) }));
    const before = JSON.stringify(data.daily_history);
    const html = render(data);
    expect(html.match(/<tr /g)).toHaveLength(31); // heading plus 30 preview rows
    expect(html).toContain("Show all 35 days");
    expect(JSON.stringify(data.daily_history)).toBe(before);
  });

  it("shows failure details and overdue warnings even during initialization", () => {
    const data = seed();
    data.health = "error";
    data.last_run = { status: "error", started_at: null, completed_at: null, message: "Daily quote provider unavailable." };
    const html = render(data, Date.parse("2026-09-21T00:00:00Z"));
    expect(html).toContain("Paper comparison update failed");
    expect(html).toContain("Daily quote provider unavailable.");
    expect(html).toContain("Daily update overdue");
    expect(html).toContain("Awaiting first daily observation");
    expect(html).toContain("last recorded snapshot");
  });

  it("detects publisher silence locally, without relying on the emitted phase or health", () => {
    const data = seed();
    expect(render(data, Date.parse(data.stale_after!) + 1)).toContain("Daily update overdue");
    expect(render(data, Date.parse(data.stale_after!))).not.toContain("Daily update overdue");
  });

  it("warns if frozen control no longer matches the live script", () => {
    const data = mature();
    data.live_reference = {
      ...data.live_reference, strategy_version: "v5.1", as_of_date: "2026-09-21",
      strategy_version_matches: false, control_matches_live: false,
    };
    expect(render(data)).toContain("no longer matches the live current version (v5.1)");
  });

  it("warns on a positional divergence even when the rules version still matches", () => {
    const data = mature();
    data.live_reference = {
      ...data.live_reference, strategy_version: "v5.0", strategy_version_matches: true,
      live_position: "SUI", control_position: "BTC", position_matches: false,
      control_matches_live: false,
    };
    const html = render(data);
    // The old version-only check called this a match; it is not one.
    expect(html).toContain("The control holds BTC while the live script holds SUI");
    expect(html).toContain("Diverged from live");
    expect(html).not.toContain("no longer matches the live current version");
  });

  it("shows the live-vs-control return gap over the shared window, never a dollar gap", () => {
    const data = mature();
    data.live_reference = {
      ...data.live_reference, live_position: "SUI", control_position: "BTC",
      position_matches: false, control_matches_live: false,
      live_return_pct: 3.560314, control_return_pct: -3.156184, return_gap_pp: -6.716498,
    };
    const html = render(data);
    expect(html).toContain("Control vs the live script");
    expect(html).toContain("+3.56%");
    expect(html).toContain("-3.16%");
    expect(html).toContain("-6.72 pp");
    expect(html).toContain("a dollar comparison between the two would be meaningless");
  });

  it("shows no gap when the live record cannot cover the window", () => {
    const data = mature();
    data.live_reference = { ...data.live_reference, live_return_pct: null, return_gap_pp: null };
    expect(render(data)).toContain("The live return is unavailable for this window");
  });

  it("removes old experiment UI while preserving Learning help and permanent history", () => {
    const page = readFileSync(new URL("../client/src/pages/BullRotation.tsx", import.meta.url), "utf8");
    expect(page).toContain('value="testing"');
    expect(page).toContain("data?.paper_comparison");
    expect(page).toContain("How Bull Rotation works");
    expect(page).toContain("Live parameters");
    expect(page).toContain("Bull Rotation — trade record");
    expect(page).toContain("Daily decision log");
    for (const old of ["paper_trading", "weekly_reflection", "learning.decay", "live-v4", "PROMOTE_PAPER", "Weekly self-reflection", "Idea backlog"]) {
      expect(page).not.toContain(old);
      expect(render(mature())).not.toContain(old);
    }
  });
});

describe("getPaperFreshness", () => {
  it("does not label a recovered book as failed because of an older run error", () => {
    const data = mature();
    data.last_updated_at = "2026-09-21T00:16:00Z";
    data.last_run = { status: "error", started_at: "2026-09-20T00:15:00Z",
      completed_at: "2026-09-20T00:15:10Z", message: "Earlier update failure superseded by validated paper data." };
    expect(getPaperFreshness(data, Date.parse("2026-09-21T01:00:00Z"))).toBe("current");
    expect(render(data, Date.parse("2026-09-21T01:00:00Z"))).not.toContain("Paper comparison update failed");
    data.last_run.completed_at = "2026-09-21T00:17:00Z";
    expect(getPaperFreshness(data, Date.parse("2026-09-21T01:00:00Z"))).toBe("error");
  });
  it("handles absent, initialized, current, error and expired snapshots", () => {
    expect(getPaperFreshness(null, NOW)).toBe("unavailable");
    expect(getPaperFreshness({ ...seed(), available: false }, NOW)).toBe("unavailable");
    expect(getPaperFreshness(seed(), NOW)).toBe("awaiting");
    expect(getPaperFreshness(mature(), NOW)).toBe("current");
    expect(getPaperFreshness({ ...seed(), health: "error" }, NOW)).toBe("error");
    expect(getPaperFreshness(seed(), Date.parse("2026-09-21T00:00:00Z"))).toBe("overdue");
    expect(getPaperFreshness({ ...seed(), health: "stale" }, NOW)).toBe("overdue");
    expect(getPaperFreshness({ ...mature(), stale_after: "invalid" }, NOW)).toBe("unknown");
  });
});
