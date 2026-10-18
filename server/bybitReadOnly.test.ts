import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BybitReadOnlyError, createBybitClient } from "./bybitReadOnly";

// Absolute safety barrier: even default-loader tests can never read real credentials.
vi.mock("node:fs/promises", () => ({ open: vi.fn() }));
const NOW = 1_700_000_000_000;
const FAKE = { apiKey: "fake-key-for-tests", apiSecret: "fake-secret-for-tests" };
const LEAK = "NEVER_EXPOSE_SECRET_SIGNING_INPUT";
const ok = (result: unknown, extra = {}) => new Response(JSON.stringify({ retCode: 0, result, time: NOW, ...extra }));
const row = (extra = {}) => ({ symbol: "BTCUSDT", positionIdx: 0, size: "1.00000000000000000001",
  side: "Buy", avgPrice: "45000.00", markPrice: "46000.00", positionValue: "46000.00",
  unrealisedPnl: "1000.00", leverage: "", liqPrice: "", positionIM: "", updatedTime: String(NOW), ...extra });
const wallet = (extra = {}) => ({ accountType: "UNIFIED", totalEquity: "100.12345678901234567890",
  totalWalletBalance: "90.00", totalPerpUPL: "10.12345678901234567890", totalAvailableBalance: "",
  coin: [{ coin: "USDT", walletBalance: "90.00", equity: "100.12345678901234567890", usdValue: "100.12345678901234567890",
    spotBorrow: "2.50", locked: "0", unrealisedPnl: "10.12345678901234567890" }], ...extra });
type Handler = (url: URL, init: RequestInit) => Response | Promise<Response> | undefined;
function setup(handler?: Handler, extra: Parameters<typeof createBybitClient>[0] = {}) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const custom = await handler?.(url, init);
    if (custom) return custom;
    switch (url.pathname) {
      case "/v5/market/time": return ok({});
      case "/v5/user/query-api": return ok({ readOnly: 1, ips: ["192.0.2.1"], apiKey: LEAK, uid: LEAK, rsaPublicKey: LEAK });
      case "/v5/account/info": return ok({ unifiedMarginStatus: 5, marginMode: "REGULAR_MARGIN" });
      case "/v5/account/wallet-balance": return ok({ list: [wallet()] });
      case "/v5/position/list": return ok({ category: url.searchParams.get("category"), list: [], nextPageCursor: "" });
      default: throw new Error("Unexpected endpoint");
    }
  });
  const credentialLoader = vi.fn(async () => ({ ...FAKE }));
  const client = createBybitClient({ credentialLoader, fetchImpl: fetchImpl as typeof fetch, now: () => NOW, ...extra });
  return { client, calls, fetchImpl, credentialLoader };
}
function fakeFile(text: string, overrides = {}) {
  const data = Buffer.from(text);
  const stat = { isFile: () => true, uid: process.getuid?.() ?? 0, mode: 0o100600,
    size: data.length, mtimeMs: 1, ctimeMs: 1, ...overrides };
  const handle = { stat: vi.fn(async () => stat), close: vi.fn(async () => undefined),
    read: vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => {
      const bytesRead = data.copy(buffer, offset, position, Math.min(position + length, data.length));
      return { buffer, bytesRead };
    }) };
  vi.mocked(open).mockResolvedValue(handle as unknown as Awaited<ReturnType<typeof open>>);
  return handle;
}
const ENV = "BYBIT_API_KEY=fake-key-for-tests\nBYBIT_API_SECRET='fake-secret-for-tests'\n";

beforeEach(() => {
  vi.mocked(open).mockReset();
  vi.mocked(open).mockRejectedValue(new Error("Real credential access is forbidden in tests"));
});
afterEach(() => { vi.restoreAllMocks(); });

describe("read-only security boundary", () => {
  it("is lazy, verifies read-only before all account calls, and uses only allowed GET paths", async () => {
    const { client, calls, credentialLoader } = setup();
    expect(credentialLoader).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    const snapshot = await client.getSnapshot();
    expect(calls.map(c => c.url.pathname)).toEqual([
      "/v5/market/time", "/v5/user/query-api", "/v5/account/info", "/v5/account/wallet-balance",
      "/v5/position/list", "/v5/position/list", "/v5/position/list",
    ]);
    for (const { url, init } of calls) {
      expect(url.origin).toBe("https://api.bybit.com");
      expect(init.method).toBe("GET");
      expect(init.redirect).toBe("error");
      expect(init.body).toBeUndefined();
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(calls[0].init.headers).toEqual({ Accept: "application/json" });
    expect(calls[3].url.search).toBe("?accountType=UNIFIED");
    expect(calls.slice(4).map(c => c.url.search)).toEqual([
      "?category=linear&settleCoin=USDT&limit=200", "?category=linear&settleCoin=USDC&limit=200", "?category=inverse&limit=200",
    ]);
    expect(snapshot).toMatchObject({ status: "connected", read_only_verified: true, ip_restricted: true,
      account_type: "UNIFIED", coverage: { wallet: true, linear_usdt: true, linear_usdc: true, inverse: true } });
    expect(JSON.stringify(snapshot)).not.toMatch(/NEVER_EXPOSE|apiKey|uid|rsaPublicKey/);
  });

  it.each([0, undefined, null, "1", true, 2])("fails closed for readOnly=%s without financial calls", async readOnly => {
    const { client, calls } = setup(url => url.pathname === "/v5/user/query-api" ? ok({ readOnly }) : undefined);
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: "READ_ONLY_REQUIRED", httpStatus: 409 });
    expect(calls.map(c => c.url.pathname)).toEqual(["/v5/market/time", "/v5/user/query-api"]);
  });

  it.each([1, 3, 4, "5", undefined])("does not portray unsupported account mode %s as empty", async unifiedMarginStatus => {
    const { client, calls } = setup(url => url.pathname === "/v5/account/info" ? ok({ unifiedMarginStatus }) : undefined);
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: "UNSUPPORTED_ACCOUNT" });
    expect(calls).toHaveLength(3);
  });

  it.each([[], ["*"], ["0.0.0.0"], ["::"], undefined, ["unrecognized"]])("only emits a boolean and warning for unrestricted IPs %j", async ips => {
    const { client } = setup(url => url.pathname === "/v5/user/query-api" ? ok({ readOnly: 1, ips }) : undefined);
    const snapshot = await client.getSnapshot();
    expect(snapshot.ip_restricted).toBe(false);
    expect(snapshot.warnings.map(w => w.code)).toContain("IP_UNRESTRICTED");
    expect(JSON.stringify(snapshot)).not.toContain("192.0.2.1");
  });

  it.each(["http://api.bybit.com", "https://api.bybit.com/", "https://api.bybit.com.evil.test", "https://api.bybit.com:443",
    "https://user@api.bybit.com", "https://api.bybit.com/path", "https://api.bybit.com?x=1", "https://api-testnet.bybit.com",
    "https://api.bybit.invalid", "https://api.bybit.us", "https://127.0.0.1"])("rejects unapproved origin %s before any network call", async baseUrl => {
    const { client, calls } = setup(undefined, { credentialLoader: async () => ({ ...FAKE, baseUrl }) });
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: "CONFIGURATION" });
    expect(calls).toHaveLength(0);
  });

  it.each(["https://api.bybit.nl", "https://api.bybit.tr", "https://api.bybit.kz", "https://api.bybitgeorgia.ge", "https://api.bybit.ae", "https://api.bybit.eu", "https://api.bybit.id"])("uses configured official regional origin without fallback: %s", async baseUrl => {
    const { client, calls } = setup(() => new Response(LEAK, { status: 403 }), { credentialLoader: async () => ({ ...FAKE, baseUrl }) });
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: "UPSTREAM_HTTP" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url.origin).toBe(baseUrl);
  });

  it("rejects redirect responses without parsing their body", async () => {
    const { client, calls } = setup(() => new Response(LEAK, { status: 302, headers: { Location: "https://evil.test" } }));
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: "UPSTREAM_HTTP" });
    expect(calls).toHaveLength(1);
  });

  it.each(["", " ", "YOUR_API_KEY", "placeholder", "changeme", "replace-me", "xxxx", "fake\nkey"])("rejects missing/placeholder credentials %j", async apiKey => {
    const { client, calls } = setup(undefined, { credentialLoader: async () => ({ ...FAKE, apiKey }) });
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: "CONFIGURATION" });
    expect(calls).toHaveLength(0);
  });

  it("redacts vendor messages, transport errors, loader failures and emits no logs", async () => {
    const spies = ["log", "warn", "error", "info", "debug"].map(method => vi.spyOn(console, method as "log").mockImplementation(() => undefined));
    const failures: Handler[] = [
      () => ok({}, { retCode: 10004, retMsg: LEAK }),
      () => { throw new Error(LEAK); },
      () => new Response(LEAK, { status: 401 }),
      () => new Response(LEAK),
    ];
    for (const failure of failures) {
      const { client } = setup(failure);
      const error = await client.getSnapshot().catch(e => e);
      expect(error).toBeInstanceOf(BybitReadOnlyError);
      expect(`${error.stack}${JSON.stringify(error)}`).not.toContain(LEAK);
      expect(error.cause).toBeUndefined();
    }
    const { client } = setup(undefined, { credentialLoader: async () => { throw new Error(LEAK); } });
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: "CONFIGURATION" });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("returns only a numeric vendor error code", async () => {
    const { client } = setup(() => ok({}, { retCode: 10004, retMsg: LEAK }));
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: "BYBIT_10004", message: "Bybit rejected a read-only request." });
  });

  it("bounds even a transport which ignores its AbortSignal", async () => {
    const { client, calls } = setup(() => new Promise(() => undefined), { timeoutMs: 5 });
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(calls[0].init.signal?.aborted).toBe(true);
  });
});

describe("strict descriptor-based credential loading", () => {
  it("reads lazily with NOFOLLOW, bounds bytes, closes, and parses dotenv without executing", async () => {
    const file = fakeFile(ENV + "UNUSED=$(touch /never-execute)\n");
    const { fetchImpl } = setup();
    const client = createBybitClient({ fetchImpl: fetchImpl as typeof fetch, now: () => NOW });
    expect(open).not.toHaveBeenCalled();
    await client.getSnapshot();
    expect(open).toHaveBeenCalledWith("/etc/crypto-dashboard/bybit-readonly.env", constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    expect(file.close).toHaveBeenCalledOnce();
    expect(file.stat).toHaveBeenCalledTimes(2);
  });

  it.each([{ mode: 0o100640 }, { mode: 0o100604 }, { mode: 0o100611 }, { uid: 999999 },
    { isFile: () => false }, { size: 0 }, { size: 16 * 1024 + 1 }])("rejects unsafe file metadata before read: %j", async metadata => {
    const file = fakeFile(ENV, metadata);
    const fetchImpl = vi.fn();
    const client = createBybitClient({ fetchImpl });
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: "CONFIGURATION" });
    expect(file.read).not.toHaveBeenCalled();
    expect(file.close).toHaveBeenCalledOnce();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a symlink/open failure and ignores environment credentials", async () => {
    vi.mocked(open).mockRejectedValue(Object.assign(new Error(LEAK), { code: "ELOOP" }));
    const fetchImpl = vi.fn();
    const client = createBybitClient({ fetchImpl });
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: "CONFIGURATION" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects mutation during read", async () => {
    const file = fakeFile(ENV);
    const initial = await file.stat();
    file.stat.mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, ctimeMs: 2 });
    const client = createBybitClient({ fetchImpl: vi.fn() });
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: "CONFIGURATION" });
  });

  it("rejects bytes growing beyond 16KB even if the first stat was small", async () => {
    const file = fakeFile(ENV + "#".repeat(17 * 1024), { size: ENV.length });
    const client = createBybitClient({ fetchImpl: vi.fn() });
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: "CONFIGURATION" });
    expect(file.read.mock.calls[0][0].length).toBe(16 * 1024 + 1);
  });
});

describe("signing and synchronized time", () => {
  it("matches a known fake-key HMAC vector using the exact escaped query sent", async () => {
    const { client, calls } = setup(url => {
      if (url.pathname === "/v5/position/list" && url.searchParams.get("settleCoin") === "USDT") {
        return ok({ category: "linear", list: [], nextPageCursor: url.searchParams.has("cursor") ? "" : "a+b/= &" });
      }
    });
    await client.getSnapshot();
    const call = calls.find(c => c.url.searchParams.has("cursor"))!;
    expect(call.url.search).toBe("?category=linear&settleCoin=USDT&limit=200&cursor=a%2Bb%2F%3D+%26");
    expect(call.init.headers).toMatchObject({ "X-BAPI-API-KEY": FAKE.apiKey, "X-BAPI-TIMESTAMP": String(NOW),
      "X-BAPI-RECV-WINDOW": "5000", "X-BAPI-SIGN": "913937d0ccb464a35bbb8e2e1a4e4e25c0741df23d05ef618ee5cd03b51f6718" });
  });

  it("advances server time by elapsed time, rather than signing with a stale observation", async () => {
    let local = NOW;
    const { client, calls } = setup(url => {
      if (url.pathname === "/v5/market/time") return ok({}, { time: NOW + 2000 });
      if (url.pathname === "/v5/user/query-api") local += 100;
    }, { now: () => local });
    await client.getSnapshot();
    expect(calls[1].init.headers).toMatchObject({ "X-BAPI-TIMESTAMP": String(NOW + 2000) });
    expect(calls[2].init.headers).toMatchObject({ "X-BAPI-TIMESTAMP": String(NOW + 2100) });
  });

  it.each([NOW - 300001, NOW + 300001, 0, "1700000000000", null, 1.5])("rejects invalid or excessive clock skew %s", async time => {
    const { client, calls } = setup(() => ok({}, { time }));
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: "CLOCK_INVALID" });
    expect(calls).toHaveLength(1);
  });
});

describe("financial data and independent derivatives coverage", () => {
  it("preserves precise decimals, liabilities, nulls, hedge legs and native inverse units without double counting", async () => {
    const { client } = setup(url => {
      if (url.pathname !== "/v5/position/list") return;
      const category = url.searchParams.get("category");
      const usdc = url.searchParams.get("settleCoin") === "USDC";
      const rows = category === "inverse" ? [row({ symbol: "BTCUSD", positionValue: "0.001", unrealisedPnl: "-0.0001" })]
        : usdc ? [row({ symbol: "BTCPERP", settleCoin: "USDC" })]
          : [row({ positionIdx: 1 }), row({ positionIdx: 2, side: "Sell" }), row({ size: "0.000", side: "", positionIdx: 0 })];
      return ok({ category, list: rows, nextPageCursor: "" });
    });
    const snapshot = await client.getSnapshot();
    expect(snapshot.positions).toHaveLength(4);
    expect(snapshot.totals).toEqual({ equity_usd: "100.12345678901234567890", wallet_balance_usd: "90.00",
      perpetual_unrealised_pnl_usd: "10.12345678901234567890", available_balance_usd: null });
    expect(snapshot.balances[0]).toMatchObject({ spot_borrow: "2.50", locked: "0" });
    expect(snapshot.positions[0]).toMatchObject({ size: "1.00000000000000000001", position_index: 1,
      settle_coin: "USDT", liquidation_price: null, leverage: null, initial_margin: null, updated_at: new Date(NOW).toISOString() });
    expect(snapshot.positions[1].position_index).toBe(2);
    expect(snapshot.positions[3]).toMatchObject({ category: "inverse", settle_coin: null, position_value: "0.001", unrealised_pnl: "-0.0001" });
  });

  it.each([undefined, null, "", "0", "-0.1234567890123456789"])("preserves optional total value %j without turning absence into zero", async totalEquity => {
    const { client } = setup(url => url.pathname === "/v5/account/wallet-balance" ? ok({ list: [wallet({ totalEquity })] }) : undefined);
    expect((await client.getSnapshot()).totals.equity_usd).toBe(totalEquity === "" || totalEquity == null ? null : totalEquity);
  });

  it.each([0, 10, "NaN", "Infinity", "1e3", " 1", "1,000", "1.", ".1", "+1", LEAK])("fails on invalid decimal %j instead of inventing balances", async totalEquity => {
    const { client } = setup(url => url.pathname === "/v5/account/wallet-balance" ? ok({ list: [wallet({ totalEquity })] }) : undefined);
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it.each([[], [wallet(), wallet()], [{ ...wallet(), accountType: "SPOT" }], [{ ...wallet(), coin: null }]])("requires one unambiguous Unified wallet %j", async list => {
    const { client } = setup(url => url.pathname === "/v5/account/wallet-balance" ? ok({ list }) : undefined);
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("wallet failure fails the whole snapshot while a truly empty wallet is valid", async () => {
    const failure = setup(url => url.pathname === "/v5/account/wallet-balance" ? ok({}, { retCode: 10005, retMsg: LEAK }) : undefined);
    await expect(failure.client.getSnapshot()).rejects.toMatchObject({ code: "BYBIT_10005" });
    expect(failure.calls).toHaveLength(4);
    const empty = setup(url => url.pathname === "/v5/account/wallet-balance" ? ok({ list: [wallet({ coin: [], totalEquity: "0" })] }) : undefined);
    expect(await empty.client.getSnapshot()).toMatchObject({ status: "connected", balances: [], totals: { equity_usd: "0" } });
  });

  it("follows pagination in all three scopes and retains hedge legs", async () => {
    const { client, calls } = setup(url => {
      if (url.pathname !== "/v5/position/list") return;
      const category = url.searchParams.get("category");
      const symbol = category === "inverse" ? "BTCUSD" : url.searchParams.get("settleCoin") === "USDC" ? "BTCPERP" : "BTCUSDT";
      const second = url.searchParams.has("cursor");
      return ok({ category, list: [row({ symbol, positionIdx: second ? 2 : 1, side: second ? "Sell" : "Buy" })], nextPageCursor: second ? "" : "page2" });
    });
    expect((await client.getSnapshot()).positions).toHaveLength(6);
    expect(calls.filter(c => c.url.searchParams.get("cursor") === "page2")).toHaveLength(3);
  });

  it("discards an entire failed scope, preserves other scopes, and sanitizes its warning", async () => {
    const { client, calls } = setup(url => {
      if (url.pathname !== "/v5/position/list") return;
      if (url.searchParams.get("settleCoin") === "USDT") {
        return url.searchParams.has("cursor") ? ok({}, { retCode: 10005, retMsg: LEAK })
          : ok({ category: "linear", list: [row()], nextPageCursor: "page2" });
      }
      if (url.searchParams.get("category") === "inverse") return ok({ category: "inverse", list: [row({ symbol: "ETHUSD", settleCoin: "ETH" })], nextPageCursor: "" });
    });
    const snapshot = await client.getSnapshot();
    expect(snapshot).toMatchObject({ status: "partial", coverage: { wallet: true, linear_usdt: false, linear_usdc: true, inverse: true } });
    expect(snapshot.positions).toHaveLength(1);
    expect(snapshot.positions[0].settle_coin).toBe("ETH");
    expect(JSON.stringify(snapshot)).not.toContain(LEAK);
    const count = calls.length;
    await client.getSnapshot();
    expect(calls.length).toBeGreaterThan(count); // Partial/error snapshots do not populate cache.
  });

  it.each(["repeat", "limit", "duplicate", "category", "cursor"])("rejects incomplete or ambiguous pagination: %s", async mode => {
    let pages = 0;
    const { client } = setup(url => {
      if (url.pathname !== "/v5/position/list" || url.searchParams.get("settleCoin") !== "USDT") return;
      pages++;
      return ok({ category: mode === "category" ? "inverse" : "linear", list: mode === "duplicate" ? [row(), row()] : [],
        nextPageCursor: mode === "repeat" ? "again" : mode === "limit" ? String(pages) : mode === "cursor" ? null : "" });
    });
    const snapshot = await client.getSnapshot();
    expect(snapshot.status).toBe("partial");
    expect(snapshot.coverage.linear_usdt).toBe(false);
    expect(snapshot.positions).toEqual([]);
    expect(pages).toBe(mode === "limit" ? 20 : mode === "repeat" ? 2 : 1);
  });

  it.each([{ symbol: "" }, { symbol: undefined }, { size: undefined }, { size: "" }, { size: "-1" }, { size: "1e-100" },
    { positionIdx: undefined }, { positionIdx: "0" }, { positionIdx: 3 }, { side: "" }, { settleCoin: "USDC" }])("treats invalid critical position fields as scope failure: %j", async bad => {
    const { client } = setup(url => url.pathname === "/v5/position/list" && url.searchParams.get("settleCoin") === "USDT"
      ? ok({ category: "linear", list: [row(bad)], nextPageCursor: "" }) : undefined);
    expect(await client.getSnapshot()).toMatchObject({ status: "partial", coverage: { linear_usdt: false, linear_usdc: true, inverse: true } });
  });

  it("rejects duplicate position identities across linear settlement scopes", async () => {
    const { client } = setup(url => url.pathname === "/v5/position/list" && url.searchParams.get("category") === "linear"
      ? ok({ category: "linear", list: [row()], nextPageCursor: "" }) : undefined);
    expect(await client.getSnapshot()).toMatchObject({ status: "partial", positions: [],
      coverage: { linear_usdt: false, linear_usdc: false, inverse: true } });
  });
});

describe("memory-only freshness and cache races", () => {
  it("deduplicates in-flight collections, caches for 30s, rechecks credentials each time, and isolates returned objects", async () => {
    let time = NOW;
    const { client, calls, credentialLoader } = setup(undefined, { now: () => time });
    const [first, second] = await Promise.all([client.getSnapshot(), client.getSnapshot()]);
    expect(calls).toHaveLength(7);
    expect(credentialLoader).toHaveBeenCalledTimes(2);
    first.totals.equity_usd = "modified";
    expect(second.totals.equity_usd).toBe("100.12345678901234567890");
    time += 29_999;
    expect((await client.getSnapshot()).totals.equity_usd).not.toBe("modified");
    expect(calls).toHaveLength(7);
    time++;
    await client.getSnapshot();
    expect(calls).toHaveLength(14);
    client.clearCache();
    await client.getSnapshot();
    expect(calls).toHaveLength(21);
  });

  it("invalidates stale data on credential rotation, read-only denial, and loader failure", async () => {
    let creds = { ...FAKE };
    let writable = false;
    let broken = false;
    const { client, calls } = setup(url => url.pathname === "/v5/user/query-api" && writable ? ok({ readOnly: 0 }) : undefined,
      { credentialLoader: async () => { if (broken) throw new Error(LEAK); return creds; } });
    await client.getSnapshot();
    creds = { ...FAKE, apiSecret: "rotated-fake-secret" };
    writable = true;
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: "READ_ONLY_REQUIRED" });
    expect(calls).toHaveLength(9);
    writable = false;
    await client.getSnapshot();
    expect(calls).toHaveLength(16);
    broken = true;
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: "CONFIGURATION" });
    broken = false;
    await client.getSnapshot();
    expect(calls).toHaveLength(23);
  });

  it("does not serve an expired snapshot after an upstream failure", async () => {
    let time = NOW;
    let fail = false;
    const { client, calls } = setup(url => fail && url.pathname === "/v5/account/wallet-balance"
      ? ok({}, { retCode: 10005, retMsg: LEAK }) : undefined, { now: () => time, cacheTTL: 10 });
    await client.getSnapshot();
    time += 10;
    fail = true;
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: "BYBIT_10005" });
    fail = false;
    await client.getSnapshot();
    expect(calls).toHaveLength(18);
  });

  it.each(["clear", "rotate"])("prevents an old in-flight result from repopulating cache on %s", async mode => {
    let release!: (response: Response) => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    let block = true;
    let creds = { ...FAKE };
    const { client, calls } = setup(url => {
      if (block && url.pathname === "/v5/account/wallet-balance") {
        block = false;
        entered();
        return new Promise<Response>(resolve => { release = resolve; });
      }
    }, { credentialLoader: async () => creds });
    const old = client.getSnapshot().catch(error => error);
    await waiting;
    if (mode === "clear") client.clearCache();
    else creds = { ...FAKE, apiKey: "rotated-fake-key" };
    const fresh = await client.getSnapshot();
    release(ok({ list: [wallet({ totalEquity: "999999" })] }));
    expect(await old).toMatchObject({ code: "CACHE_INVALIDATED" });
    expect(fresh.totals.equity_usd).toBe("100.12345678901234567890");
    const count = calls.length;
    expect((await client.getSnapshot()).totals.equity_usd).toBe(fresh.totals.equity_usd);
    expect(calls).toHaveLength(count);
  });
});
