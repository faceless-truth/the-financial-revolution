import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import CandidateWatch from "../client/src/components/CandidateWatch";
import type { CandidateWatchPayload } from "@shared/candidateWatch";

function watch(over: Partial<CandidateWatchPayload> = {}): CandidateWatchPayload {
  return {
    schema_version: 1, available: true, name: "v3-wait3",
    label: "Faster re-entry (3-day wait)",
    plain_summary: "Waits 3 days instead of 5 before buying back in.",
    start_date: "2026-09-26", as_of_date: "2026-09-26", days_running: 1,
    candidate_position: "SUI", live_position: "SUI",
    candidate_return_pct: -0.4, live_return_pct: 0, gap_pp: -0.4,
    separately_seeded: true,
    divergent_days: 0, divergence_target: 10, rotations: 0, rotation_target: 1,
    gate_met: false, promoted: false, decision_window: "February 2027",
    note: "If the forward result holds up, this could replace the live script around February 2027.",
    backtest: {
      candidate_return_pct: 374.4, live_return_pct: 229.7,
      candidate_maxdd_pct: -50.4, live_maxdd_pct: -55.7,
      windows_won: 5, windows: 6, psr: 0.958, dsr: 0.488, dsr_bar: 0.95,
      verdict: "INCONCLUSIVE", summary: "Roughly double the return with a smaller worst-case loss.",
    },
    ...over,
  };
}
const render = (d?: CandidateWatchPayload | null) =>
  renderToStaticMarkup(createElement(CandidateWatch, { data: d }));

describe("candidate watch card", () => {
  it("compares the candidate with live on returns and never on balances", () => {
    const html = render(watch());
    expect(html).toContain("Faster re-entry (3-day wait)");
    expect(html).toContain("Your live script");
    expect(html).toContain("-0.40%");      // candidate return since its own start
    expect(html).toContain("0.00%");       // live over the same window
    expect(html).toContain("-0.40 pp");    // the gap
    // Dollar balances are never comparable across separately seeded books.
    expect(html).not.toMatch(/\$\d/);
  });

  it("labels it paper-only and never claims it is live", () => {
    const html = render(watch());
    expect(html).toContain("Paper only");
    expect(html).toContain("not live");
    expect(html).not.toContain("Promoted");
  });

  it("shows evidence progress against the divergence target", () => {
    const html = render(watch({ divergent_days: 4, rotations: 1 }));
    expect(html).toContain("4 of 10 days where it disagreed with live");
    expect(html).toContain("1 of 1 rotations");
  });

  it("shows the February window with a pending-performance qualifier", () => {
    const html = render(watch());
    expect(html).toContain("February 2027");
    expect(html).toContain("pending performance");
  });

  it("switches to a review prompt once the evidence gate is met", () => {
    const html = render(watch({ gate_met: true, divergent_days: 10, rotations: 2 }));
    expect(html).toContain("Enough evidence collected");
  });

  it("surfaces the backtest as historical and shows it is below the promotion bar", () => {
    const html = render(watch());
    expect(html).toContain("historical, not live");
    expect(html).toContain("0.488");
    expect(html).toContain("needs 0.95 to promote");
  });

  it("renders a safe placeholder when no result is published", () => {
    const html = render(watch({ available: false, message: "No result published yet." }));
    expect(html).toContain("No result published yet.");
    expect(html).not.toContain("Evidence collected");
  });

  it("renders nothing when the payload is absent", () => {
    expect(render(null)).toBe("");
  });

  it("is wired into the Testing tab ahead of the paper comparison", () => {
    const page = readFileSync(new URL("../client/src/pages/BullRotation.tsx", import.meta.url), "utf8");
    expect(page).toContain("<CandidateWatch data={data?.candidate_watch} />");
    expect(page.indexOf("CandidateWatch data=")).toBeLessThan(page.indexOf("PaperComparison data="));
  });
});
