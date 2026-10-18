import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBybitClient } from "./bybitReadOnly";
import { normalizeSpotExecution, normalizeSpotMovement, spotAccountRef, type SpotHistoryStore } from "./bybitSpotHistory";

// No test can open real credentials/cache, or make a real HTTP request.
vi.mock("node:fs/promises", () => ({
  open: vi.fn(() => { throw new Error("Filesystem forbidden in unit tests"); }),
  lstat: vi.fn(() => { throw new Error("Filesystem forbidden in unit tests"); }),
  mkdir: vi.fn(() => { throw new Error("Filesystem forbidden in unit tests"); }),
  rename: vi.fn(() => { throw new Error("Filesystem forbidden in unit tests"); }),
  unlink: vi.fn(() => { throw new Error("Filesystem forbidden in unit tests"); }),
}));
const DAY = 86_400_000;
const WEEK = DAY * 7;
const NOW = Date.parse("2026-05-28T12:00:00.000Z");
const FAKE = { apiKey: "fake-spot-test-key", apiSecret: "fake-spot-test-secret" };
const PAIRS = { BTCUSDT: { base: "BTC", quote: "USDT" } };
const fill = (extra = {}) => ({ execId: "fill-a", orderId: "order-a", orderLinkId: "", execType: "Trade",
  symbol: "BTCUSDT", side: "Buy", execTime: String(NOW - 1000), execQty: "1.00", execPrice: "100.00",
  execValue: "100.00", execFee: "0", feeCurrency: "BTC", ...extra });
const movement = (extra = {}) => ({ id: "move-a", transactionTime: String(NOW - 1000), currency: "BTC",
  change: "1", cashBalance: "1", type: "TRADE", category: "spot", tradeId: "fill-a", orderId: "order-a", ...extra });
function memoryStore() {
  const files = new Map<string, string>();
  const writes: Array<{ ref: string; value: string }> = [];
  const locks = new Set<string>();
  const store: SpotHistoryStore = {
    async withLock(ref, work) {
      if (locks.has(ref)) throw new Error("busy");
      locks.add(ref);
      try {
        return await work({ read: async () => files.get(ref) ?? null, write: async (value, assertCurrent) => {
          assertCurrent(); files.set(ref, value); writes.push({ ref, value });
        } });
      } finally { locks.delete(ref); }
    },
  };
  return { store, files, writes };
}
type Handler = (url: URL, init: RequestInit) => unknown | Promise<unknown>;
function setup(handler?: Handler, storage = memoryStore()) {
  let time = NOW;
  let uid = 777;
  let creds = { ...FAKE };
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input)); calls.push({ url, init });
    let result = await handler?.(url, init);
    if (result instanceof Response) return result;
    if (result === undefined) switch (url.pathname) {
      case "/v5/market/time": result = {}; break;
      case "/v5/user/query-api": result = { readOnly: 1, userID: uid }; break;
      case "/v5/account/info": result = { unifiedMarginStatus: 5 }; break;
      case "/v5/market/instruments-info": result = { list: [{ symbol: "BTCUSDT", baseCoin: "BTC", quoteCoin: "USDT" }] }; break;
      case "/v5/market/tickers": result = { list: [{ symbol: "BTCUSDT", bid1Price: "110", lastPrice: "111" }] }; break;
      case "/v5/account/wallet-balance": result = { list: [{ accountType: "UNIFIED", coin: [
        { coin: "BTC", walletBalance: "1", spotBorrow: "0" }, { coin: "USDT", walletBalance: "10", spotBorrow: "0" },
      ] }] }; break;
      case "/v5/execution/list": {
        const start = Number(url.searchParams.get("startTime")), end = Number(url.searchParams.get("endTime"));
        result = { category: "spot", list: start <= NOW - 1000 && end >= NOW - 1000 ? [fill()] : [], nextPageCursor: "" };
        time += 10; break;
      }
      case "/v5/account/transaction-log": result = { list: [movement()], nextPageCursor: "" }; time += 10; break;
      default: throw new Error("Unmocked endpoint");
    }
    return new Response(JSON.stringify({ retCode: 0, result, time }));
  });
  const options = { credentialLoader: async () => ({ ...creds }), fetchImpl: fetchImpl as typeof fetch,
    now: () => time, spotStore: storage.store };
  return { client: createBybitClient(options), options, calls, storage,
    advance: (n: number) => { time += n; }, setUid: (n: number) => { uid = n; },
    rotateKey: () => { creds = { apiKey: "rotated-test-key", apiSecret: "rotated-test-secret" }; } };
}
const executionCalls = (s: ReturnType<typeof setup>) => s.calls.filter(c => c.url.pathname === "/v5/execution/list");
const archive = (s: ReturnType<typeof setup>) => JSON.parse(JSON.parse(Array.from(s.storage.files.values())[0]).body);
afterEach(() => vi.restoreAllMocks());

describe("spot normalization without invented finance", () => {
  it("preserves reported signed fees, exact precision and IDs", () => {
    expect(normalizeSpotExecution(fill({ execQty: "1.000000000000000000001", execFee: "-0.00000001", feeCurrency: "MNT" }), PAIRS))
      .toMatchObject({ id: "fill-a", quantity: "1.000000000000000000001", fee: "-0.00000001", fee_currency: "MNT", fee_currency_source: "reported" });
  });
  it.each([
    ["Buy", false, "0.001", "BTC"], ["Sell", false, "0.001", "USDT"],
    ["Buy", true, "0.001", "BTC"], ["Sell", true, "0.001", "USDT"],
    ["Buy", true, "-0.001", "USDT"], ["Sell", true, "-0.001", "BTC"],
    ["Buy", false, "-0.001", "BTC"],
  ])("official convention %s maker=%s rate=%s", (side, isMaker, feeRate, expected) => {
    expect(normalizeSpotExecution(fill({ side, isMaker, feeRate, execFee: "0.1", feeCurrency: "" }), PAIRS))
      .toMatchObject({ fee_currency: expected, fee_currency_source: "documented_convention" });
  });
  it.each([{ isMaker: "true", feeRate: "0.01" }, { isMaker: true, feeRate: "0" }, {}, { feeRate: "0.01" }])
    ("does not guess fee currency without official evidence %j", extra => {
      expect(normalizeSpotExecution(fill({ execFee: "0.1", feeCurrency: "", ...extra }), PAIRS))
        .toMatchObject({ fee_currency: null, fee_currency_source: "unknown" });
    });
  it("never guesses symbol suffixes or absent fees", () => {
    expect(normalizeSpotExecution(fill({ execFee: undefined, feeCurrency: "" }), {}))
      .toMatchObject({ base_coin: null, quote_coin: null, fee: null, fee_currency: null, fee_currency_source: "unknown" });
    expect(normalizeSpotExecution(fill({ feeCurrency: "" }), PAIRS)?.fee_currency_source).toBe("zero");
  });
  it.each(["[]", "{}", [], {}, "", undefined])("empty extra fees %j", extraFees => {
    expect(normalizeSpotExecution(fill({ extraFees }), PAIRS)?.extra_fees_unknown).toBe(false);
  });
  it.each(["[{fee:1}]", [{ fee: "1" }], { x: "1" }])("nonempty extra fees %j", extraFees => {
    expect(normalizeSpotExecution(fill({ extraFees }), PAIRS)?.extra_fees_unknown).toBe(true);
  });
  it.each(["NaN", "Infinity", "1e-8", 0.1, "-1", "0", "1.2.3"])("rejects invalid positive decimals %s", execQty => {
    expect(() => normalizeSpotExecution(fill({ execQty }), PAIRS)).toThrow();
  });
  it("preserves negative movement balances and empty categories", () => {
    expect(normalizeSpotMovement(movement({ change: "-0.100", cashBalance: "-3", category: "" })))
      .toMatchObject({ change: "-0.1", balance_after: "-3", category: "", trade_id: "fill-a" });
  });
  it("does not silently certify malformed execution rows as an empty window", () => {
    expect(() => normalizeSpotExecution({}, PAIRS)).toThrow();
  });
  it("ignores non-Trade execution events", () => {
    expect(normalizeSpotExecution({ execType: "Funding" }, PAIRS)).toBeNull();
  });
  it("namespaces by official origin and canonical verified UID, never by API key", () => {
    const ref = spotAccountRef("https://api.bybit.com", { userID: 777 });
    expect(ref).toMatch(/^[a-f0-9]{64}$/);
    expect(spotAccountRef("https://api.bybit.com", { userIDInt64: "000777", userID: 3 })).toBe(ref);
    expect(spotAccountRef("https://api.bybit.com", { userIDInt64: "0", userID: 777 })).toBe(ref);
    expect(spotAccountRef("https://api.bybit.eu", { userID: 777 })).not.toBe(ref);
    expect(() => spotAccountRef("https://api.bybit.com", { userID: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
    expect(() => spotAccountRef("https://api.bybit.com", {})).toThrow();
  });
});

describe("verified, resumable private spot import", () => {
  it("imports actual buys, FIFO basis, current bid PNL; signs only private GET endpoints", async () => {
    const s = setup(); const result = await s.client.getPortfolio();
    expect(result.history.executions_complete).toBe(true);
    expect(result.history.inventory_complete.BTC).toBe(true);
    expect(result.history.from).toBe("2024-05-29T12:00:00.000Z");
    expect(result.orders).toHaveLength(1);
    expect(result.holdings.find(h => h.asset === "BTC")).toMatchObject({ quantity: "1", cost_basis: "100", bid_price: "110", unrealized_pnl: "10" });
    expect(s.calls.slice(0, 3).map(c => c.url.pathname)).toEqual(["/v5/market/time", "/v5/user/query-api", "/v5/account/info"]);
    for (const { url, init } of s.calls) {
      expect(init.method).toBe("GET"); expect(init.redirect).toBe("error"); expect(init.body).toBeUndefined();
      const headers = init.headers as Record<string, string>;
      if (url.pathname.startsWith("/v5/market/")) expect(headers).toEqual({ Accept: "application/json" });
      else {
        expect(headers["X-BAPI-API-KEY"]).toBe(FAKE.apiKey);
        expect(headers["X-BAPI-SIGN"]).toBe(createHmac("sha256", FAKE.apiSecret)
          .update(headers["X-BAPI-TIMESTAMP"] + FAKE.apiKey + "5000" + url.search.slice(1)).digest("hex"));
      }
    }
    expect(JSON.stringify(result)).not.toMatch(/fake-spot|accountRef|777|\/var\/lib|apiKey|signature/i);
    const saved = Array.from(s.storage.files.values()).join("");
    expect(saved).not.toMatch(/fake-spot|apiSecret|userID|X-BAPI/);
    expect(saved).toContain("fee_currency");
  });
  it("uses descending contiguous <=7-day execution windows and base-currency ALL-type movement requests", async () => {
    const s = setup(); await s.client.getPortfolio();
    const requests = executionCalls(s);
    expect(requests.length).toBeGreaterThan(100);
    for (let n = 0; n < requests.length; n++) {
      const q = requests[n].url.searchParams;
      expect(Number(q.get("endTime")) - Number(q.get("startTime"))).toBeLessThan(WEEK);
      expect(q.get("limit")).toBe("100"); expect(q.get("category")).toBe("spot");
      if (n) expect(Number(q.get("endTime"))).toBe(Number(requests[n - 1].url.searchParams.get("startTime")) - 1);
    }
    const tx = s.calls.filter(c => c.url.pathname === "/v5/account/transaction-log");
    expect(tx).toHaveLength(1);
    expect(tx[0].url.searchParams.get("startTime")).toBe(String(NOW - 1000 - DAY));
    expect(tx[0].url.searchParams.get("currency")).toBe("BTC");
    expect(tx[0].url.searchParams.get("accountType")).toBe("UNIFIED");
    expect(tx[0].url.searchParams.get("limit")).toBe("50");
    expect(tx[0].url.searchParams.has("category")).toBe(false);
    expect(tx[0].url.searchParams.has("type")).toBe(false);
  });
  it("checkpoints budget-limited chunks, returns real history but withholds PNL, resumes on the next call", async () => {
    const s = setup(); const first = await s.client.getPortfolio({ maxSyncMs: 25 });
    expect(first.status).toBe("syncing"); expect(first.history.executions_complete).toBe(false);
    expect(first.orders).toHaveLength(1);
    expect(first.holdings.find(h => h.asset === "BTC")?.unrealized_pnl).toBeNull();
    const count = executionCalls(s).length; expect(count).toBe(3);
    const previousStart = Number(executionCalls(s)[count - 1].url.searchParams.get("startTime"));
    const second = await s.client.getPortfolio();
    expect(Number(executionCalls(s)[count].url.searchParams.get("endTime"))).toBe(previousStart - 1);
    expect(second.history.executions_complete).toBe(true); expect(second.orders).toHaveLength(1);
    expect(s.calls.filter(c => c.url.pathname === "/v5/market/instruments-info")).toHaveLength(1);
    expect(s.calls.filter(c => c.url.pathname === "/v5/market/tickers")).toHaveLength(2);
    expect(s.calls.filter(c => c.url.pathname === "/v5/account/wallet-balance")).toHaveLength(2);
  });
  it("follows even short pages with a cursor, persists partial pages without certifying the range", async () => {
    let s: ReturnType<typeof setup>;
    s = setup(url => {
      if (url.pathname !== "/v5/execution/list" || Number(url.searchParams.get("endTime")) !== NOW) return;
      s.advance(10);
      return { category: "spot", list: [fill()], nextPageCursor: url.searchParams.has("cursor") ? "" : "next & cursor" };
    });
    const first = await s.client.getPortfolio({ maxSyncMs: 1 });
    expect(first.history.windows_checked).toBe(0); expect(first.history.execution_count).toBe(1);
    expect(archive(s).pending.cursor).toBe("next & cursor");
    const second = await s.client.getPortfolio();
    expect(executionCalls(s)[1].url.searchParams.get("cursor")).toBe("next & cursor");
    expect(second.history.executions_complete).toBe(true); expect(second.history.execution_count).toBe(1);
  });
  it("repeated cursor fails incomplete, preserves last good page and uses generic error", async () => {
    let s: ReturnType<typeof setup>;
    s = setup(url => url.pathname === "/v5/execution/list" ? { category: "spot", list: [fill()], nextPageCursor: "repeat" } : undefined);
    const result = await s.client.getPortfolio();
    expect(result.history.executions_complete).toBe(false); expect(result.history.windows_checked).toBe(0);
    expect(result.history.error).toContain("saved history");
    expect(result.orders).toHaveLength(1); expect(executionCalls(s)).toHaveLength(2);
  });
  it("caps pathological pagination at 100 pages and does not pretend the range completed", async () => {
    let page = 0;
    const s = setup(url => url.pathname === "/v5/execution/list" ? { category: "spot", list: [], nextPageCursor: String(++page) } : undefined);
    const result = await s.client.getPortfolio();
    expect(page).toBe(100); expect(result.history.windows_checked).toBe(0); expect(result.history.error).not.toBeNull();
  });
  it("rejects conflicting immutable execution data without overwriting saved ledger", async () => {
    let page = 0;
    const s = setup(url => {
      if (url.pathname === "/v5/execution/list") return { category: "spot", list: [fill({ execQty: ++page === 1 ? "1" : "2" })], nextPageCursor: String(page) };
    });
    const result = await s.client.getPortfolio();
    expect(result.history.error).not.toBeNull(); expect(archive(s).executions[0].quantity).toBe("1");
    expect(archive(s).pending.pages).toBe(1);
  });
  it("allows newly reported fee metadata to enrich a previously absent fee", async () => {
    let page = 0;
    const s = setup(url => {
      if (url.pathname === "/v5/execution/list" && Number(url.searchParams.get("endTime")) === NOW) {
        page++; return { category: "spot", list: [fill(page === 1 ? { execFee: "", feeCurrency: "" } : {})], nextPageCursor: page === 1 ? "fee-page" : "" };
      }
    });
    const result = await s.client.getPortfolio();
    expect(result.history.execution_count).toBe(1); expect(archive(s).executions[0]).toMatchObject({ fee: "0", fee_currency: "BTC", fee_currency_source: "reported" });
  });
  it("keeps completed coverage on an API error without claiming the remaining windows", async () => {
    let n = 0;
    const s = setup(url => {
      if (url.pathname === "/v5/execution/list" && ++n === 3) throw new Error("raw SECRET upstream private info");
    });
    const result = await s.client.getPortfolio();
    expect(result.history.windows_checked).toBe(2); expect(result.history.executions_complete).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/SECRET|upstream private/);
    const resumed = await s.client.getPortfolio(); expect(resumed.history.executions_complete).toBe(true);
  });
  it("refreshes recent overlap without double counting and replays currency movements", async () => {
    const s = setup(); await s.client.getPortfolio();
    const firstCount = executionCalls(s).length;
    s.advance(DAY);
    const result = await s.client.getPortfolio();
    const subsequent = executionCalls(s).slice(firstCount);
    expect(subsequent.length).toBe(2);
    expect(Number(subsequent[subsequent.length - 1].url.searchParams.get("startTime"))).toBe(NOW - WEEK + 1);
    expect(result.history.execution_count).toBe(1); expect(archive(s).movements).toHaveLength(1);
    expect(s.calls.filter(c => c.url.pathname === "/v5/account/transaction-log")).toHaveLength(2);
  });
  it("retains captured executions forever after they age outside the rolling two-year API window", async () => {
    const oldTime = Date.parse("2024-05-30T12:00:00.000Z");
    const oldFill = fill({ execTime: String(oldTime) });
    const oldMovement = movement({ transactionTime: String(oldTime) });
    const s = setup(url => {
      if (!["/v5/execution/list", "/v5/account/transaction-log"].includes(url.pathname)) return;
      const within = Number(url.searchParams.get("startTime")) <= oldTime && Number(url.searchParams.get("endTime")) >= oldTime;
      return { list: within ? [url.pathname === "/v5/execution/list" ? oldFill : oldMovement] : [], nextPageCursor: "" };
    });
    await s.client.getPortfolio();
    s.advance(10 * DAY);
    const result = await s.client.getPortfolio();
    expect(result.history.executions_complete).toBe(true);
    expect(result.history.from).toBe("2024-05-29T12:00:00.000Z");
    expect(archive(s).executions).toHaveLength(1);
    expect(archive(s).executions[0].timestamp).toBe(new Date(oldTime).toISOString());
    expect(result.holdings.find(h => h.asset === "BTC")?.cost_basis).toBe("100");
  });
  it("paginates currency movements, deduplicates IDs, and checkpoints only completed ranges", async () => {
    let pages = 0;
    const s = setup(url => {
      if (url.pathname === "/v5/account/transaction-log") {
        pages++; return { list: [movement()], nextPageCursor: url.searchParams.has("cursor") ? "" : "tx-next" };
      }
    });
    const result = await s.client.getPortfolio();
    expect(pages).toBe(2); expect(result.history.inventory_complete.BTC).toBe(true);
    expect(archive(s).movements).toHaveLength(1);
    const tx = s.calls.filter(c => c.url.pathname === "/v5/account/transaction-log");
    expect(tx[1].url.searchParams.get("cursor")).toBe("tx-next");
  });
  it("resumes eight cached movement rows when the next empty page has an explicit null cursor", async () => {
    let s: ReturnType<typeof setup>;
    const rows = Array.from({ length: 8 }, (_, n) => movement({ id: `move-${n}`,
      transactionTime: String(NOW - 1000 + n), change: n ? "0" : "1", cashBalance: "1",
      type: n ? "INTEREST" : "TRADE", category: n ? "" : "spot", tradeId: n ? "" : "fill-a" }));
    s = setup(url => {
      if (url.pathname !== "/v5/account/transaction-log") return;
      if (url.searchParams.has("cursor")) return { list: [], nextPageCursor: null };
      s.advance(20_000);
      return { list: rows, nextPageCursor: "eight-rows-next" };
    });
    const partial = await s.client.getPortfolio();
    expect(partial.history.executions_complete).toBe(true);
    expect(partial.history.inventory_complete.BTC).toBe(false);
    expect(archive(s).pending).toMatchObject({ coin: "BTC", cursor: "eight-rows-next", pages: 1, rows: 8 });
    const savedRows = archive(s).movements;
    expect(savedRows).toHaveLength(8);
    const result = await s.client.getPortfolio();
    expect(result.history.error).toBeNull(); expect(result.history.inventory_complete.BTC).toBe(true);
    expect(result.history.syncing).toBe(false); expect(archive(s).pending).toBeNull();
    expect(archive(s).movements).toEqual(savedRows);
    const requests = s.calls.filter(c => c.url.pathname === "/v5/account/transaction-log");
    expect(requests).toHaveLength(2);
    expect(requests[1].url.searchParams.get("cursor")).toBe("eight-rows-next");
    expect(requests[1].url.searchParams.get("startTime")).toBe(requests[0].url.searchParams.get("startTime"));
    expect(requests[1].url.searchParams.get("endTime")).toBe(requests[0].url.searchParams.get("endTime"));
  });
  it("also accepts an explicit null cursor on an empty terminal execution page", async () => {
    const s = setup(url => {
      if (url.pathname !== "/v5/execution/list" || Number(url.searchParams.get("endTime")) !== NOW) return;
      return url.searchParams.has("cursor") ? { list: [], nextPageCursor: null }
        : { list: [fill()], nextPageCursor: "exec-next" };
    });
    const result = await s.client.getPortfolio();
    expect(result.history.executions_complete).toBe(true); expect(result.history.execution_count).toBe(1);
    expect(result.history.error).toBeNull();
  });
  it.each([null, undefined])("does not certify nonempty execution pages with cursor=%s", async nextPageCursor => {
    const s = setup(url => url.pathname === "/v5/execution/list" ? { list: [fill()], nextPageCursor } : undefined);
    const result = await s.client.getPortfolio();
    expect(result.history.executions_complete).toBe(false); expect(result.history.windows_checked).toBe(0);
    expect(result.history.error).not.toBeNull();
  });
  it.each([null, undefined])("keeps previous movement pages when a nonempty next page has cursor=%s", async nextPageCursor => {
    const s = setup(url => url.pathname !== "/v5/account/transaction-log" ? undefined
      : url.searchParams.has("cursor") ? { list: [movement()], nextPageCursor }
        : { list: [movement()], nextPageCursor: "tx-next" });
    const result = await s.client.getPortfolio();
    expect(result.history.inventory_complete.BTC).toBe(false); expect(result.history.error).not.toBeNull();
    expect(archive(s).movements).toHaveLength(1); expect(archive(s).pending.pages).toBe(1);
  });
  it("still fails closed on a missing cursor, even on an empty page", async () => {
    const s = setup(url => url.pathname === "/v5/execution/list" ? { list: [] } : undefined);
    const result = await s.client.getPortfolio();
    expect(result.history.executions_complete).toBe(false); expect(result.history.error).not.toBeNull();
  });
  it("does not treat an empty movement page with a repeated nonempty cursor as terminal", async () => {
    const s = setup(url => url.pathname === "/v5/account/transaction-log"
      ? { list: url.searchParams.has("cursor") ? [] : [movement()], nextPageCursor: "tx-repeat" } : undefined);
    const result = await s.client.getPortfolio();
    expect(result.history.inventory_complete.BTC).toBe(false); expect(result.history.error).not.toBeNull();
    expect(archive(s).movements).toHaveLength(1); expect(archive(s).pending.pages).toBe(1);
  });
  it("conflicting movement data fails closed and never overwrites the first page", async () => {
    let page = 0;
    const s = setup(url => url.pathname === "/v5/account/transaction-log"
      ? { list: [movement({ cashBalance: ++page === 1 ? "1" : "2" })], nextPageCursor: String(page) } : undefined);
    const result = await s.client.getPortfolio();
    expect(result.history.executions_complete).toBe(true); expect(result.history.inventory_complete.BTC).toBe(false);
    expect(result.history.error).not.toBeNull(); expect(archive(s).movements[0].balance_after).toBe("1");
  });
  it("preserves unmapped execution history without suffix guessing or invented marks", async () => {
    const s = setup(url => url.pathname === "/v5/market/instruments-info" ? { list: [] } : undefined);
    const result = await s.client.getPortfolio();
    expect(result.orders[0]).toMatchObject({ base_coin: null, quote_coin: null });
    expect(result.warnings.some(w => w.code === "UNVERIFIED_PAIR")).toBe(true);
    expect(result.holdings.find(h => h.asset === "BTC")?.cost_basis).toBeNull();
    expect(s.calls.some(c => c.url.pathname === "/v5/account/transaction-log")).toBe(false);
  });
  it("keeps cash conversions in trade history but does not query cash investment inventory", async () => {
    const s = setup(url => {
      if (url.pathname === "/v5/market/instruments-info") return { list: [{ symbol: "USDCUSDT", baseCoin: "USDC", quoteCoin: "USDT" }] };
      if (url.pathname === "/v5/execution/list") return { list: Number(url.searchParams.get("endTime")) === NOW ? [fill({ symbol: "USDCUSDT", feeCurrency: "USDC" })] : [], nextPageCursor: "" };
    });
    const result = await s.client.getPortfolio();
    expect(result.orders[0].symbol).toBe("USDCUSDT");
    expect(s.calls.some(c => c.url.pathname === "/v5/account/transaction-log")).toBe(false);
  });
  it("uses fresh wallet balance and borrow metadata, reporting quantity races instead of reconciling silently", async () => {
    const s = setup(url => url.pathname === "/v5/account/wallet-balance"
      ? { list: [{ accountType: "UNIFIED", coin: [{ coin: "BTC", walletBalance: "1.5", spotBorrow: "0.2" }] }] } : undefined);
    const result = await s.client.getPortfolio();
    expect(result.holdings.find(h => h.asset === "BTC")).toMatchObject({ quantity: "1.5", reconciled: false, unrealized_pnl: null, basis_status: "borrowed" });
    expect(archive(s).executions).toHaveLength(1);
  });
  it.each(["0", "-1", "NaN", "", null])("invalid current bids become unavailable, never a zero mark (%s)", async bid1Price => {
    const s = setup(url => url.pathname === "/v5/market/tickers" ? { list: [{ symbol: "BTCUSDT", bid1Price, lastPrice: "111" }] } : undefined);
    const result = await s.client.getPortfolio();
    expect(result.holdings.find(h => h.asset === "BTC")?.bid_price).toBeNull();
    expect(result.holdings.find(h => h.asset === "BTC")?.unrealized_pnl).toBeNull();
  });
  it("caps CLI history budgets at 90 seconds and still returns a partial snapshot", async () => {
    let s: ReturnType<typeof setup>;
    s = setup(url => {
      if (url.pathname !== "/v5/execution/list") return;
      s.advance(10_000); return { list: [], nextPageCursor: "" };
    });
    const result = await s.client.getPortfolio({ maxSyncMs: 999_999 });
    expect(result.status).toBe("syncing"); expect(executionCalls(s)).toHaveLength(9);
  });
  it("rejects a context older than 120 seconds before committing a late page", async () => {
    let s: ReturnType<typeof setup>;
    s = setup(url => {
      if (url.pathname !== "/v5/execution/list") return;
      s.advance(120_001); return { list: [fill()], nextPageCursor: "" };
    });
    await expect(s.client.getPortfolio()).rejects.toMatchObject({ code: "CLOCK_INVALID" });
    expect(archive(s).executions).toHaveLength(0);
  });
  it("resumes after process restart, refreshes public metadata and preserves delisted mappings", async () => {
    const s = setup(); await s.client.getPortfolio({ maxSyncMs: 1 });
    const storage = s.storage;
    const second = setup(url => url.pathname === "/v5/market/instruments-info" ? { list: [] } : undefined, storage);
    const result = await second.client.getPortfolio();
    expect(result.history.executions_complete).toBe(true);
    expect(archive(second).instruments.BTCUSDT).toEqual(PAIRS.BTCUSDT);
    expect(result.orders[0].base_coin).toBe("BTC");
  });
  it("enriches previously unknown pair metadata after a process restart without changing the fill", async () => {
    const first = setup(url => url.pathname === "/v5/market/instruments-info" ? { list: [] } : undefined);
    await first.client.getPortfolio({ maxSyncMs: 1 });
    expect(archive(first).executions[0].base_coin).toBeNull();
    const second = setup(undefined, first.storage);
    const result = await second.client.getPortfolio();
    expect(archive(second).executions[0]).toMatchObject({ base_coin: "BTC", quote_coin: "USDT", quantity: "1", price: "100" });
    expect(result.holdings.find(h => h.asset === "BTC")?.cost_basis).toBe("100");
  });
  it("refuses to mix an intact archive copied from another verified account", async () => {
    const s = setup(); await s.client.getPortfolio({ maxSyncMs: 1 });
    const firstRef = Array.from(s.storage.files.keys())[0];
    s.setUid(888); await s.client.getPortfolio({ maxSyncMs: 1 });
    const secondRef = Array.from(s.storage.files.keys()).find(ref => ref !== firstRef)!;
    s.storage.files.set(firstRef, s.storage.files.get(secondRef)!);
    s.setUid(777);
    await expect(s.client.getPortfolio()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("does not query years of interest for cash or a holding without any executions", async () => {
    const s = setup(url => url.pathname === "/v5/execution/list" ? { category: "spot", list: [], nextPageCursor: "" } : undefined);
    const result = await s.client.getPortfolio();
    expect(s.calls.some(c => c.url.pathname === "/v5/account/transaction-log")).toBe(false);
    expect(result.holdings.find(h => h.asset === "BTC")?.cost_basis).toBeNull();
  });
  it("isolates accounts while preserving same-account archive across key rotation", async () => {
    const s = setup(); await s.client.getPortfolio({ maxSyncMs: 1 });
    const old = Array.from(s.storage.files.keys())[0];
    s.rotateKey(); await s.client.getPortfolio({ maxSyncMs: 1 });
    expect(s.storage.files.size).toBe(1); expect(archive(s).windowsChecked).toBe(2);
    s.setUid(888); s.rotateKey(); s.client.clearCache(); await s.client.getPortfolio({ maxSyncMs: 1 });
    expect(s.storage.files.size).toBe(2);
    expect(JSON.parse(JSON.parse(s.storage.files.get(old)!).body).windowsChecked).toBe(2);
  });
  it("fails closed on corrupt or wrong-account archive rather than treating it as empty", async () => {
    const s = setup(); await s.client.getPortfolio({ maxSyncMs: 1 });
    const ref = Array.from(s.storage.files.keys())[0]; s.storage.files.set(ref, "{broken");
    const count = executionCalls(s).length;
    await expect(s.client.getPortfolio()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(executionCalls(s)).toHaveLength(count);
  });
  it.each([0, "1", undefined])("portfolio requires verified readOnly=1 (%s)", async readOnly => {
    const s = setup(url => url.pathname === "/v5/user/query-api" ? { readOnly, userID: 777 } : undefined);
    await expect(s.client.getPortfolio()).rejects.toMatchObject({ code: "READ_ONLY_REQUIRED" });
    expect(s.calls).toHaveLength(2); expect(s.storage.files.size).toBe(0);
  });
  it.each([1, 3, 4, "5", undefined])("portfolio rejects unsupported UTA mode %s", async unifiedMarginStatus => {
    const s = setup(url => url.pathname === "/v5/account/info" ? { unifiedMarginStatus } : undefined);
    await expect(s.client.getPortfolio()).rejects.toMatchObject({ code: "UNSUPPORTED_ACCOUNT" });
    expect(s.calls).toHaveLength(3); expect(s.storage.files.size).toBe(0);
  });
  it("UID is required for portfolio, without exposing metadata or initializing a cache", async () => {
    const s = setup(url => url.pathname === "/v5/user/query-api" ? { readOnly: 1, userID: "777" } : undefined);
    await expect(s.client.getPortfolio()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(s.storage.files.size).toBe(0);
  });
  it("deduplicates concurrent requests but never caches incomplete portfolio snapshots", async () => {
    const s = setup();
    const [a, b] = await Promise.all([s.client.getPortfolio({ maxSyncMs: 1 }), s.client.getPortfolio({ maxSyncMs: 1 })]);
    expect(a).toEqual(b); expect(executionCalls(s)).toHaveLength(1);
    await s.client.getPortfolio({ maxSyncMs: 1 }); expect(executionCalls(s)).toHaveLength(2);
  });
  it("invalidates an old credential flight before it can commit a returned page", async () => {
    let release!: (v: unknown) => void;
    let blocked = false;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const s = setup(url => {
      if (url.pathname === "/v5/execution/list" && !blocked) {
        blocked = true; entered(); return new Promise(resolve => { release = resolve; });
      }
    });
    const old = s.client.getPortfolio().catch(e => e);
    await waiting;
    s.rotateKey();
    // A new flight observes the changed credentials. Same-account writer stays busy.
    await expect(s.client.getPortfolio()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    const writes = s.storage.writes.length;
    release({ list: [fill()], nextPageCursor: "", category: "spot" });
    expect(await old).toMatchObject({ code: "CACHE_INVALIDATED" });
    expect(s.storage.writes).toHaveLength(writes); expect(archive(s).executions).toHaveLength(0);
  });
});
