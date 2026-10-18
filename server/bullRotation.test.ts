import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let directory: string;
let dashboard: string;
let comparison: string;
const paper = (value = 67428) => ({
  schema_version: 1, available: true, paper_only: true, candidate_promoted: false,
  phase: "initialized", health: "ok", sample_days: 0,
  accounts: { control: { id: "control", total_wealth_usd: value }, candidate: { id: "candidate", total_wealth_usd: value } },
  series: [], daily_history: [],
});

beforeEach(async () => {
  directory = await mkdtemp("/tmp/opencode/tfr-comparison-api-");
  dashboard = path.join(directory, "dashboard.json");
  comparison = path.join(directory, "comparison.json");
  vi.stubEnv("BULL_ROTATION_PAYLOAD_FILE", dashboard);
  vi.stubEnv("PROFIT_TRAIL_COMPARISON_FILE", comparison);
  vi.resetModules();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("Bull Rotation paired comparison passthrough", () => {
  it("reads the independently published pair instead of a stale main-payload copy", async () => {
    await writeFile(dashboard, JSON.stringify({ strategy_version: "v5.0", paper_comparison: paper(1) }));
    const expected = paper();
    await writeFile(comparison, JSON.stringify(expected));
    const { getBullRotationDashboard } = await import("./bullRotation");
    const result = await getBullRotationDashboard();
    expect(result.available).toBe(true);
    expect(result.strategy_version).toBe("v5.0");
    expect(result.paper_comparison).toEqual(expected);
  });

  it("reads a new daily publication on the next request without restart or main-payload regeneration", async () => {
    await writeFile(dashboard, JSON.stringify({ strategy_version: "v5.0" }));
    await writeFile(comparison, JSON.stringify(paper()));
    const { getBullRotationDashboard } = await import("./bullRotation");
    expect((await getBullRotationDashboard()).paper_comparison?.accounts.control?.total_wealth_usd).toBe(67428);
    await writeFile(comparison, JSON.stringify(paper(68000)));
    expect((await getBullRotationDashboard()).paper_comparison?.accounts.control?.total_wealth_usd).toBe(68000);
  });

  it("does not substitute old experiments or an embedded stale comparison for a missing snapshot", async () => {
    await writeFile(dashboard, JSON.stringify({ paper_comparison: paper(1), learning: { paper_trading: { candidates: [{ name: "old-test" }] } } }));
    const { getBullRotationDashboard } = await import("./bullRotation");
    expect((await getBullRotationDashboard()).paper_comparison).toBeNull();
  });

  it("keeps the pair readable if the separate main strategy payload is unavailable", async () => {
    await writeFile(comparison, JSON.stringify(paper()));
    const { getBullRotationDashboard } = await import("./bullRotation");
    const result = await getBullRotationDashboard();
    expect(result.available).toBe(false);
    expect(result.strategy_version).toBe("Unavailable");
    expect(result.paper_comparison).toEqual(paper());
  });

  it.each([
    "{broken", "null", JSON.stringify({ candidates: [] }),
    JSON.stringify({ ...paper(), schema_version: 2 }),
    JSON.stringify({ ...paper(), candidate_promoted: true }),
    JSON.stringify({ ...paper(), accounts: {} }),
  ])("fails closed for malformed or wrong-contract comparison %s", async raw => {
    await writeFile(comparison, raw);
    const { getBullRotationDashboard } = await import("./bullRotation");
    expect((await getBullRotationDashboard()).paper_comparison).toBeNull();
  });

  it("passes through an explicit unavailable snapshot without making up balances", async () => {
    const unavailable = { ...paper(), available: false, phase: "unavailable", health: "unavailable", accounts: {}, sample_days: null };
    await writeFile(comparison, JSON.stringify(unavailable));
    const { getBullRotationDashboard } = await import("./bullRotation");
    expect((await getBullRotationDashboard()).paper_comparison).toEqual(unavailable);
  });
});
