import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { scryptSync } from "node:crypto";
import path from "node:path";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BybitAccountSnapshot } from "../shared/bybitAccount";
import type { AccountPerformance } from "../shared/cockpit";
import { buildAccountPerformance, createAccountPerformanceReader, type PerfFill, type PerfMovement, type PerformanceInput } from "./bybitPerformance";
import { createBybitRouter } from "./bybitRoutes";
import type { SpotHistoryStore } from "./bybitSpotHistory";

const DAY = 86_400_000;
const T0 = Date.parse("2026-09-01T00:00:00.000Z");
const NOW = Date.parse("2026-09-11T12:00:00.000Z"); // 10.5 days after T0
const at = (day: number, hour = 12) => T0 + day * DAY + hour * 3_600_000;
const move = (id: string, day: number, coin: string, change: string, after: string, type = "TRADE", hour = 12): PerfMovement =>
  ({ id, timestamp: at(day, hour), coin, change, balance_after: after, type, category: "spot" });

function input(extra: Partial<PerformanceInput> = {}): PerformanceInput {
  return {
    now: NOW, coverageFrom: T0, coverageThrough: NOW, movements: [], fills: [],
    wallet: [], positions: [], liveEquityUsd: null, asOf: "2026-09-11T12:00:00.000Z",
    spotClose: () => null, linearClose: () => null, ...extra,
  };
}

describe("account performance (pure)", () => {
  it("excludes deposits and withdrawals from P&L", () => {
    // 1,000 USDT transferred in on day 1; 500 USDT withdrawn on day 5; +200 trading gain on day 7.
    const r = buildAccountPerformance(input({
      wallet: [{ coin: "USDT", quantity: "700" }],
      movements: [
        move("a", 1, "USDT", "1000", "1000", "TRANSFER_IN"),
        move("b", 5, "USDT", "-500", "500", "TRANSFER_OUT"),
        move("c", 7, "USDT", "200", "700", "TRADE"),
      ],
    }));
    expect(r.series[0]).toEqual({ date: "2026-09-01", equity_usd: "0.00", net_flow_usd: "0.00" });
    expect(r.series.find(p => p.date === "2026-09-02")).toMatchObject({ equity_usd: "1000.00", net_flow_usd: "1000.00" });
    expect(r.series.find(p => p.date === "2026-09-06")).toMatchObject({ equity_usd: "500.00", net_flow_usd: "-500.00" });
    expect(r.periods.All).toEqual({ start_date: "2026-09-01", start_equity_usd: "0.00", end_equity_usd: "700.00",
      net_flows_usd: "500.00", pnl_usd: "200.00" });
    expect(r.periods["7D"]).toMatchObject({ start_date: "2026-09-03", net_flows_usd: "-500.00", pnl_usd: "200.00" });
  });

  it("walks balances back from the live wallet and prices each day's close", () => {
    // Held 1 BTC, bought a second on day 3 for 100 USDT.
    const prices: Record<string, string> = { "2026-09-01": "90", "2026-09-02": "95", "2026-09-03": "100",
      "2026-09-04": "110", "2026-09-05": "120", "2026-09-06": "120", "2026-09-07": "120", "2026-09-08": "120",
      "2026-09-09": "120", "2026-09-10": "130" };
    const r = buildAccountPerformance(input({
      wallet: [{ coin: "BTC", quantity: "2" }, { coin: "USDT", quantity: "0" }],
      movements: [move("buy-b", 2, "BTC", "1", "2"), move("buy-u", 2, "USDT", "-100", "0")],
      spotClose: (coin, day) => coin === "BTC" ? prices[day] ?? null : null,
    }));
    expect(r.series.map(p => [p.date, p.equity_usd]).slice(0, 4)).toEqual([
      ["2026-09-01", "190.00"], // 1 BTC @90 + 100 USDT
      ["2026-09-02", "195.00"],
      ["2026-09-03", "200.00"], // 2 BTC @100 after the buy
      ["2026-09-04", "220.00"],
    ]);
    expect(r.series[r.series.length - 1]).toEqual({ date: "2026-09-10", equity_usd: "260.00", net_flow_usd: "0.00" });
    expect(r.periods.All?.pnl_usd).toBe("70.00"); // a trade is never a flow
  });

  it("nulls periods longer than the history and says so", () => {
    const r = buildAccountPerformance(input({ wallet: [{ coin: "USDT", quantity: "10" }] }));
    expect(r.series).toHaveLength(10);
    expect(r.periods["7D"]).not.toBeNull();
    expect(r.periods["30D"]).toBeNull();
    expect(r.periods["12M"]).toBeNull();
    expect(r.coverage.complete).toBe(false);
    expect(r.coverage.notes).toContain("History starts 2026-09-01, so 30 days isn't available yet.");
  });

  it("stops the series at a balance-chain gap instead of inventing balances", () => {
    // Day 2 row claims a balance the later changes cannot explain: a row is missing.
    const r = buildAccountPerformance(input({
      wallet: [{ coin: "USDT", quantity: "300" }],
      movements: [move("a", 2, "USDT", "100", "100"), move("b", 6, "USDT", "100", "300")],
    }));
    expect(r.series[0].date).toBe("2026-09-07");
    expect(r.coverage.notes.some(n => n.includes("USDT history has a gap"))).toBe(true);
  });

  it("tolerates venue rounding on interest rows without letting it accumulate", () => {
    // Each logged cashBalance is ~1e-6 off the running sum, as Bybit's hourly interest is.
    const movements = Array.from({ length: 9 }, (_, i) =>
      move(`i${i}`, i + 1, "USDC", "-0.0000061", (-1.5 - 0.0000061 * (i + 1) - 0.00000101 * i).toFixed(8), "INTEREST"));
    const r = buildAccountPerformance(input({
      wallet: [{ coin: "USDC", quantity: movements[8].balance_after }], movements,
    }));
    expect(r.coverage.notes.join(" ")).not.toContain("gap");
    expect(r.series[0].date).toBe("2026-09-01");
  });

  it("refuses to use history when the wallet moved after the last imported row", () => {
    const r = buildAccountPerformance(input({
      wallet: [{ coin: "USDT", quantity: "999" }], movements: [move("a", 2, "USDT", "100", "100")],
    }));
    expect(r.available).toBe(false);
    expect(r.series).toEqual([]);
  });

  it("rebuilds open perpetual P&L from fills and requires it to reconcile", () => {
    const fills: PerfFill[] = [
      { id: "f1", timestamp: at(2), symbol: "SUIUSDT", side: "Sell", qty: "10", price: "2", exec_type: "Trade" },
      { id: "f2", timestamp: at(4), symbol: "SUIUSDT", side: "Sell", qty: "10", price: "3", exec_type: "Trade" },
    ];
    const sui: Record<string, string> = { "2026-09-03": "1.5", "2026-09-05": "2" };
    const ok = buildAccountPerformance(input({
      wallet: [{ coin: "USDT", quantity: "100" }], fills,
      positions: [{ category: "linear", symbol: "SUIUSDT", side: "Sell", size: "20", position_index: 0 }],
      linearClose: (s, day) => sui[day] ?? "2.5",
    }));
    expect(ok.series.find(p => p.date === "2026-09-03")?.equity_usd).toBe("105.00"); // short 10 from 2 at 1.5
    expect(ok.series.find(p => p.date === "2026-09-05")?.equity_usd).toBe("110.00"); // short 20 avg 2.5 at 2
    const bad = buildAccountPerformance(input({ wallet: [{ coin: "USDT", quantity: "100" }], fills, positions: [] }));
    expect(bad.available).toBe(false);
    expect(bad.coverage.notes.join(" ")).toContain("does not reconcile");
  });

  it("adds today's live account equity as the latest point", () => {
    const r = buildAccountPerformance(input({ wallet: [{ coin: "USDT", quantity: "10" }], liveEquityUsd: "12.346" }));
    expect(r.series[r.series.length - 1]).toEqual({ date: "2026-09-11", equity_usd: "12.35", net_flow_usd: "0.00" });
  });
});

function memoryStore(): SpotHistoryStore {
  const files = new Map<string, string>();
  return {
    async withLock(ref, work) {
      return work({ read: async () => files.get(ref) ?? null, write: async (value, assertCurrent) => { assertCurrent(); files.set(ref, value); } });
    },
  };
}
const snapshot = (usdt: string): BybitAccountSnapshot => ({
  status: "connected", retrieved_at: new Date(NOW).toISOString(), read_only_verified: true, ip_restricted: true,
  account_type: "UNIFIED", unified_margin_status: 5, margin_mode: null,
  totals: { equity_usd: usdt, wallet_balance_usd: usdt, perpetual_unrealised_pnl_usd: "0", available_balance_usd: usdt },
  balances: [{ coin: "USDT", wallet_balance: usdt, equity: usdt, usd_value: usdt, spot_borrow: "0", locked: "0", unrealised_pnl: "0" }],
  positions: [], coverage: { wallet: true, linear_usdt: true, linear_usdc: true, inverse: true }, warnings: [],
});

describe("account performance import", () => {
  it("imports all-currency transaction pages and linear fills, then builds from the archive", async () => {
    let time = NOW;
    const request = vi.fn(async (p: string, params: Record<string, string> = {}) => {
      time += 5;
      const start = Number(params.startTime), end = Number(params.endTime);
      if (p === "/v5/account/transaction-log") {
        expect(params.currency).toBeUndefined();
        const row = { id: "t1", transactionTime: String(at(3)), currency: "USDT", change: "50", cashBalance: "50", type: "TRANSFER_IN", category: "" };
        return { result: { list: start <= at(3) && end >= at(3) ? [row] : [], nextPageCursor: "" } };
      }
      if (p === "/v5/execution/list") {
        expect(params.category).toBe("linear");
        return { result: { list: [], nextPageCursor: "" } };
      }
      throw new Error(`Unexpected ${p}`);
    });
    const reader = createAccountPerformanceReader({ store: memoryStore(), now: () => time });
    const run = await reader({ origin: "https://api.bybit.com", key: { userID: 7 }, request, assertCurrent: () => undefined,
      snapshot: async () => snapshot("50"), maxSyncMs: 60_000 });
    expect(run.syncing).toBe(false);
    expect(run.performance.available).toBe(true);
    expect(run.performance.series.find(p => p.date === "2026-09-04")).toMatchObject({ equity_usd: "50.00", net_flow_usd: "50.00" });
    expect(run.performance.periods["7D"]?.pnl_usd).toBe("0.00");
  });
});

let directory: string | undefined;
let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("private performance route", () => {
  async function fixture(getPerformance: () => Promise<AccountPerformance>) {
    directory = await mkdtemp("/tmp/opencode/perf-route-");
    const authFile = path.join(directory, "owner.json");
    const password = "synthetic-owner-test-password";
    const salt = Buffer.alloc(32, 29);
    await writeFile(authFile, JSON.stringify({ version: 1, kdf: "scrypt", N: 16384, r: 8, p: 1, keylen: 64,
      salt: salt.toString("hex"), password_hash: scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex"),
      created_at: "2026-09-21T00:00:00Z" }), { mode: 0o600 });
    const app = express();
    app.use("/api/bybit", createBybitRouter({ getSnapshot: vi.fn(), getPerformance, ownerAuthFile: authFile,
      allowedOrigins: ["https://owner.example"], requireHttps: false }));
    server = createServer(app);
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test server address");
    const base = `http://127.0.0.1:${address.port}`;
    const login = async () => {
      const response = await fetch(base + "/api/bybit/login", { method: "POST",
        headers: { Origin: "https://owner.example", "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      expect(response.status).toBe(200);
      return response.headers.get("set-cookie")!.split(";")[0];
    };
    return { base, login };
  }
  const privateBody: AccountPerformance = { available: true, as_of: null,
    coverage: { start_date: "2026-01-01", complete: true, notes: [] },
    series: [{ date: "2026-01-01", equity_usd: "424242.00", net_flow_usd: "0.00" }], periods: {} };

  it("rejects unauthenticated requests without reading any account data", async () => {
    const getPerformance = vi.fn().mockResolvedValue(privateBody);
    const f = await fixture(getPerformance);
    const response = await fetch(f.base + "/api/bybit/performance");
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).not.toContain("424242");
    expect(getPerformance).not.toHaveBeenCalled();
  });

  it("serves the owner after login", async () => {
    const getPerformance = vi.fn().mockResolvedValue(privateBody);
    const f = await fixture(getPerformance);
    const cookie = await f.login();
    const response = await fetch(f.base + "/api/bybit/performance", { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(privateBody);
  });
});

describe("account performance import rows", () => {
  it("flags the last good result as refreshing while a routine refresh catches up", async () => {
    let time = NOW;
    const request = vi.fn(async () => { time += 5; return { result: { list: [], nextPageCursor: "" } }; });
    const reader = createAccountPerformanceReader({ store: memoryStore(), now: () => time });
    const ctx = { origin: "https://api.bybit.com", key: { userID: 10 }, request, assertCurrent: () => undefined,
      snapshot: async () => snapshot("50") };
    const first = await reader({ ...ctx, maxSyncMs: 60_000 });
    expect(first.syncing).toBe(false);
    expect(first.performance.refreshing).toBeUndefined();

    time += 10 * DAY; // more than one import window behind: a 1ms budget cannot finish
    const stale = await reader({ ...ctx, maxSyncMs: 1 });
    expect(stale.syncing).toBe(true);
    expect(stale.performance.refreshing).toBe(true);
    expect(stale.performance.series).toEqual(first.performance.series);

    const fresh = await reader({ ...ctx, maxSyncMs: 60_000 });
    expect(fresh.syncing).toBe(false);
    expect(fresh.performance.refreshing).toBeUndefined();
    expect(fresh.performance.series.length).toBeGreaterThan(first.performance.series.length);
  });
  it("skips balance-less informational ledger rows but still rejects malformed ones", async () => {
    let time = NOW;
    const rows = [
      { id: "x1", transactionTime: String(at(3)), currency: "USDT", change: "", cashBalance: "", type: "EXEMPTED_INTEREST", category: "" },
      { id: "t1", transactionTime: String(at(3)), currency: "USDT", change: "50", cashBalance: "50", type: "TRANSFER_IN", category: "" },
    ];
    const request = vi.fn(async (p: string, params: Record<string, string> = {}) => {
      time += 5;
      const start = Number(params.startTime), end = Number(params.endTime);
      if (p === "/v5/account/transaction-log") return { result: { list: start <= at(3) && end >= at(3) ? rows : [], nextPageCursor: "" } };
      return { result: { list: [], nextPageCursor: "" } };
    });
    const reader = createAccountPerformanceReader({ store: memoryStore(), now: () => time });
    const run = await reader({ origin: "https://api.bybit.com", key: { userID: 8 }, request, assertCurrent: () => undefined,
      snapshot: async () => snapshot("50"), maxSyncMs: 60_000 });
    expect(run.syncing).toBe(false);
    expect(run.performance.coverage.notes.join(" ")).not.toContain("could not be fully refreshed");

    rows[0] = { ...rows[0], change: "", cashBalance: "7" }; // half-empty is malformed, never guessed
    const strict = createAccountPerformanceReader({ store: memoryStore(), now: () => time });
    const bad = await strict({ origin: "https://api.bybit.com", key: { userID: 9 }, request, assertCurrent: () => undefined,
      snapshot: async () => snapshot("50"), maxSyncMs: 60_000 });
    expect(bad.performance.coverage.notes).toContain("Bybit history could not be fully refreshed just now; saved history is shown.");
  });
});
