import { createHash, createHmac } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isIP } from "node:net";
import { parse } from "dotenv";
import type { BybitAccountSnapshot, BybitCoinBalance, BybitPosition } from "../shared/bybitAccount";
import type { BybitSpotPortfolio } from "../shared/bybitSpot";
import type { AccountPerformance } from "../shared/cockpit";
import { createAccountPerformanceReader } from "./bybitPerformance";
import { createSpotHistoryReader, type SpotHistoryStore } from "./bybitSpotHistory";

const CREDENTIAL_FILE = "/etc/crypto-dashboard/bybit-readonly.env";
const MAX_CREDENTIAL_BYTES = 16 * 1024;
// Official V5 integration guide. Selection is configuration only; never fail over.
const ORIGINS = new Set([
  "https://api.bybit.com", "https://api.bytick.com", "https://api.bybit.nl",
  "https://api.bybit.tr", "https://api.bybit.kz", "https://api.bybitgeorgia.ge",
  "https://api.bybit.ae", "https://api.bybit.eu", "https://api.bybit.id",
  "https://api.manepa.jp", "https://api.spark-fintech.com",
]);
const PATHS = new Set([
  "/v5/market/time", "/v5/user/query-api", "/v5/account/info",
  "/v5/account/wallet-balance", "/v5/position/list",
  "/v5/execution/list", "/v5/account/transaction-log",
  "/v5/market/instruments-info", "/v5/market/tickers", "/v5/market/kline",
]);
const MESSAGES = {
  CONFIGURATION: "Bybit read-only credentials are unavailable or invalid.",
  READ_ONLY_REQUIRED: "Bybit requires an explicitly read-only API key.",
  UNSUPPORTED_ACCOUNT: "Only Bybit Unified Trading Account 2.0 is supported.",
  UPSTREAM_HTTP: "Bybit returned an unsuccessful HTTP response.",
  UPSTREAM_API: "Bybit rejected a read-only request.",
  UPSTREAM_UNAVAILABLE: "Bybit could not be reached securely within the time limit.",
  INVALID_RESPONSE: "Bybit returned incomplete or invalid account data.",
  CLOCK_INVALID: "Bybit server time could not be safely synchronized.",
  CACHE_INVALIDATED: "Bybit configuration or cache changed during collection; retry.",
} as const;
type ErrorCode = keyof typeof MESSAGES;

/** Only fixed local messages and numeric vendor codes are safe to expose. No cause. */
export class BybitReadOnlyError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: ErrorCode, retCode?: number) {
    super(MESSAGES[code]);
    this.name = "BybitReadOnlyError";
    this.code = code === "UPSTREAM_API" && Number.isSafeInteger(retCode)
      ? `BYBIT_${retCode}` : code;
    this.httpStatus = code === "CONFIGURATION" ? 503
      : code === "READ_ONLY_REQUIRED" || code === "UNSUPPORTED_ACCOUNT" ? 409
      : code === "CACHE_INVALIDATED" ? 503 : 502;
  }
}

// Private server-only dependency types. Never accept these through request input.
interface Credentials { apiKey: string; apiSecret: string; baseUrl?: string }
interface ClientOptions {
  credentialLoader?: () => Promise<Credentials>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  cacheTTL?: number;
  timeoutMs?: number;
  spotCacheDir?: string;
  spotStore?: SpotHistoryStore;
  performanceCacheDir?: string;
  performanceStore?: SpotHistoryStore;
}
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BybitReadOnlyError("INVALID_RESPONSE");
  }
  return value as JsonObject;
}
function decimal(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 256 || !/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw new BybitReadOnlyError("INVALID_RESPONSE");
  }
  return value;
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(value)) {
    throw new BybitReadOnlyError("INVALID_RESPONSE");
  }
  return value;
}
function credentials(value: Credentials): Required<Credentials> {
  const valid = (s: unknown): s is string => typeof s === "string" && s.length <= 4096
    && s.trim() === s && s.length > 0 && !/\s/.test(s)
    && !/(placeholder|change[-_]?me|replace[-_]?me|your[-_].*(key|secret)|<|>|^x+$)/i.test(s);
  if (!value || !valid(value.apiKey) || !valid(value.apiSecret)) {
    throw new BybitReadOnlyError("CONFIGURATION");
  }
  const baseUrl = value.baseUrl ?? "https://api.bybit.com";
  if (!ORIGINS.has(baseUrl)) throw new BybitReadOnlyError("CONFIGURATION");
  return { apiKey: value.apiKey, apiSecret: value.apiSecret, baseUrl };
}

async function loadCredentials(): Promise<Credentials> {
  // Open the descriptor before stat/read to avoid a final-component symlink race.
  // NONBLOCK prevents a malicious FIFO from hanging before the regular-file check.
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    file = await open(CREDENTIAL_FILE, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await file.stat();
    const safe = (s: typeof before) => s.isFile() && (s.uid === 0 || s.uid === process.getuid?.())
      && (s.mode & 0o077) === 0 && s.size > 0 && s.size <= MAX_CREDENTIAL_BYTES;
    if (!safe(before)) throw new BybitReadOnlyError("CONFIGURATION");
    const buffer = Buffer.alloc(MAX_CREDENTIAL_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await file.stat();
    if (!safe(after) || length > MAX_CREDENTIAL_BYTES || length !== after.size
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new BybitReadOnlyError("CONFIGURATION");
    }
    const parsed = parse(buffer.subarray(0, length));
    return credentials({ apiKey: parsed.BYBIT_API_KEY, apiSecret: parsed.BYBIT_API_SECRET,
      baseUrl: parsed.BYBIT_API_BASE_URL });
  } catch {
    throw new BybitReadOnlyError("CONFIGURATION");
  } finally {
    await file?.close().catch(() => undefined);
  }
}

function coinBalance(value: unknown): BybitCoinBalance {
  const row = object(value);
  return { coin: identifier(row.coin), wallet_balance: decimal(row.walletBalance),
    equity: decimal(row.equity), usd_value: decimal(row.usdValue), spot_borrow: decimal(row.spotBorrow),
    locked: decimal(row.locked), unrealised_pnl: decimal(row.unrealisedPnl) };
}
type Scope = { key: "linear_usdt" | "linear_usdc" | "inverse"; category: "linear" | "inverse"; settleCoin?: string };
const SCOPES: Scope[] = [
  { key: "linear_usdt", category: "linear", settleCoin: "USDT" },
  { key: "linear_usdc", category: "linear", settleCoin: "USDC" },
  { key: "inverse", category: "inverse" },
];
function position(value: unknown, scope: Scope): BybitPosition | null {
  const row = object(value);
  const symbol = identifier(row.symbol);
  const size = decimal(row.size);
  if (size === null || size.startsWith("-") || ![0, 1, 2].includes(row.positionIdx as number)
    || (row.category !== undefined && row.category !== scope.category)) {
    throw new BybitReadOnlyError("INVALID_RESPONSE");
  }
  // Test decimal positivity without a floating-point conversion or underflow.
  if (!/[1-9]/.test(size)) return null;
  if (row.side !== "Buy" && row.side !== "Sell") throw new BybitReadOnlyError("INVALID_RESPONSE");
  const settleCoin = row.settleCoin === undefined || row.settleCoin === null || row.settleCoin === ""
    ? scope.settleCoin ?? null : identifier(row.settleCoin);
  if (scope.settleCoin && settleCoin !== scope.settleCoin) throw new BybitReadOnlyError("INVALID_RESPONSE");
  let updatedAt: string | null = null;
  if (row.updatedTime !== undefined && row.updatedTime !== null && row.updatedTime !== "") {
    if (typeof row.updatedTime !== "string" || !/^\d{1,15}$/.test(row.updatedTime)
      || Number(row.updatedTime) > 8.64e15) throw new BybitReadOnlyError("INVALID_RESPONSE");
    updatedAt = new Date(Number(row.updatedTime)).toISOString();
  }
  return { category: scope.category, symbol, position_index: row.positionIdx as number,
    side: row.side, size, settle_coin: settleCoin, avg_price: decimal(row.avgPrice),
    mark_price: decimal(row.markPrice), position_value: decimal(row.positionValue),
    unrealised_pnl: decimal(row.unrealisedPnl), leverage: decimal(row.leverage),
    liquidation_price: decimal(row.liqPrice), initial_margin: decimal(row.positionIM), updated_at: updatedAt };
}
const positionKey = (p: BybitPosition) => `${p.category}:${p.symbol}:${p.position_index}`;

/** Server-only, lazy client. Construction/import performs no file access or HTTP. */
export function createBybitClient(options: ClientOptions = {}): {
  getSnapshot(): Promise<BybitAccountSnapshot>;
  getPortfolio(options?: { maxSyncMs?: number }): Promise<BybitSpotPortfolio>;
  getPerformance(options?: { maxSyncMs?: number }): Promise<AccountPerformance>;
  clearCache(): void;
} {
  const credentialLoader = options.credentialLoader ?? loadCredentials;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const ttl = Math.min(30_000, Math.max(0, options.cacheTTL ?? 30_000));
  const timeoutMs = Math.min(15_000, Math.max(1, options.timeoutMs ?? 8_000));
  let generation = 0;
  let fingerprint: string | undefined;
  let cache: { snapshot: BybitAccountSnapshot; expires: number } | undefined;
  let flight: { generation: number; promise: Promise<BybitAccountSnapshot> } | undefined;
  let portfolioFlight: { generation: number; promise: Promise<BybitSpotPortfolio> } | undefined;
  const spotHistory = createSpotHistoryReader({ directory: options.spotCacheDir, store: options.spotStore, now });
  const performanceHistory = createAccountPerformanceReader({ directory: options.performanceCacheDir, store: options.performanceStore, now });
  let performanceCache: { value: AccountPerformance; expires: number; generation: number } | undefined;
  let performanceFlight: { generation: number; promise: Promise<AccountPerformance> } | undefined;
  let performanceBackground: Promise<unknown> | undefined;
  let performanceLast: { value: AccountPerformance; generation: number } | undefined;
  // Serialize credential loads only, not collection, so concurrent checks cannot overtake.
  let credentialQueue: Promise<unknown> = Promise.resolve();
  function clearCache() {
    generation++;
    cache = undefined;
    flight = undefined;
    portfolioFlight = undefined;
    performanceCache = undefined;
    performanceFlight = undefined;
    performanceLast = undefined;
  }

  // One transport/signing implementation shared by both readers. Data endpoints are
  // available only after the key and UTA2 checks have succeeded.
  async function verifiedContext(config: Required<Credentials>, epoch: number) {
    let clock: { serverMs: number; observedMs: number } | undefined;
    let verified = false;
    const startedAt = now();
    const assertCurrent = () => {
      if (generation !== epoch) throw new BybitReadOnlyError("CACHE_INVALIDATED");
      if (now() < startedAt || now() - startedAt > 120_000) throw new BybitReadOnlyError("CLOCK_INVALID");
    };
    async function request(path: string, params: Record<string, string> = {}): Promise<JsonObject> {
      assertCurrent();
      if (!PATHS.has(path)) throw new BybitReadOnlyError("CONFIGURATION");
      const query = new URLSearchParams(params).toString();
      const headers: Record<string, string> = { Accept: "application/json" };
      if (!path.startsWith("/v5/market/")) {
        if (!verified && path !== "/v5/user/query-api" && path !== "/v5/account/info") {
          throw new BybitReadOnlyError("READ_ONLY_REQUIRED");
        }
        if (!clock) throw new BybitReadOnlyError("CLOCK_INVALID");
        const elapsed = now() - clock.observedMs;
        if (elapsed < 0 || elapsed > 120_000) throw new BybitReadOnlyError("CLOCK_INVALID");
        const timestamp = String(Math.trunc(clock.serverMs + elapsed));
        headers["X-BAPI-API-KEY"] = config.apiKey;
        headers["X-BAPI-TIMESTAMP"] = timestamp;
        headers["X-BAPI-RECV-WINDOW"] = "5000";
        headers["X-BAPI-SIGN"] = createHmac("sha256", config.apiSecret)
          .update(timestamp + config.apiKey + "5000" + query).digest("hex");
      }
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const work = async () => {
          const response = await fetchImpl(`${config.baseUrl}${path}${query ? `?${query}` : ""}`, {
            method: "GET", headers, redirect: "error", signal: controller.signal,
          });
          if (!response.ok || response.redirected) throw new BybitReadOnlyError("UPSTREAM_HTTP");
          const body = object(await response.json());
          if (!Number.isSafeInteger(body.retCode)) throw new BybitReadOnlyError("INVALID_RESPONSE");
          if (body.retCode !== 0) throw new BybitReadOnlyError("UPSTREAM_API", body.retCode as number);
          assertCurrent();
          return body;
        };
        return await Promise.race([work(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new BybitReadOnlyError("UPSTREAM_UNAVAILABLE"));
          }, timeoutMs);
        })]);
      } catch (error) {
        if (error instanceof BybitReadOnlyError) throw error;
        throw new BybitReadOnlyError("UPSTREAM_UNAVAILABLE");
      } finally {
        clearTimeout(timer);
      }
    }
    const time = await request("/v5/market/time");
    const observedMs = now();
    if (typeof time.time !== "number" || !Number.isSafeInteger(time.time)
      || time.time <= 0 || Math.abs(time.time - observedMs) > 300_000) {
      throw new BybitReadOnlyError("CLOCK_INVALID");
    }
    clock = { serverMs: time.time, observedMs };
    const key = object((await request("/v5/user/query-api")).result);
    if (key.readOnly !== 1) throw new BybitReadOnlyError("READ_ONLY_REQUIRED");
    // Missing/unrecognized IP metadata is conservatively treated as unrestricted.
    const ipRestricted = Array.isArray(key.ips) && key.ips.length > 0
      && key.ips.every(ip => typeof ip === "string" && isIP(ip) !== 0 && ip !== "0.0.0.0" && ip !== "::");
    const info = object((await request("/v5/account/info")).result);
    if (info.unifiedMarginStatus !== 5 && info.unifiedMarginStatus !== 6) {
      throw new BybitReadOnlyError("UNSUPPORTED_ACCOUNT");
    }
    verified = true;
    return { request, assertCurrent, key, info, ipRestricted };
  }

  async function readWallet(request: (path: string, params?: Record<string, string>) => Promise<JsonObject>) {
    const wallet = object((await request("/v5/account/wallet-balance", { accountType: "UNIFIED" })).result);
    if (!Array.isArray(wallet.list) || wallet.list.length !== 1) throw new BybitReadOnlyError("INVALID_RESPONSE");
    const account = object(wallet.list[0]);
    if (account.accountType !== "UNIFIED" || !Array.isArray(account.coin)) throw new BybitReadOnlyError("INVALID_RESPONSE");
    const balances = account.coin.map(coinBalance);
    if (new Set(balances.map(b => b.coin)).size !== balances.length) throw new BybitReadOnlyError("INVALID_RESPONSE");
    return { account, balances };
  }

  async function collect(config: Required<Credentials>, epoch: number): Promise<BybitAccountSnapshot> {
    const { request, assertCurrent, info, ipRestricted } = await verifiedContext(config, epoch);
    const { account, balances } = await readWallet(request);
    const snapshot: BybitAccountSnapshot = {
      status: "connected", retrieved_at: "", read_only_verified: true, ip_restricted: ipRestricted,
      account_type: "UNIFIED", unified_margin_status: info.unifiedMarginStatus as number,
      margin_mode: ["ISOLATED_MARGIN", "REGULAR_MARGIN", "PORTFOLIO_MARGIN"].includes(info.marginMode as string)
        ? info.marginMode as string : null,
      totals: { equity_usd: decimal(account.totalEquity), wallet_balance_usd: decimal(account.totalWalletBalance),
        perpetual_unrealised_pnl_usd: decimal(account.totalPerpUPL), available_balance_usd: decimal(account.totalAvailableBalance) },
      balances, positions: [], coverage: { wallet: true, linear_usdt: false, linear_usdc: false, inverse: false },
      warnings: ipRestricted ? [] : [{ code: "IP_UNRESTRICTED", message: "API key IP restrictions are absent or could not be verified." }],
    };
    async function positions(scope: Scope): Promise<BybitPosition[]> {
      let cursor = "";
      const cursors = new Set<string>();
      const seen = new Set<string>();
      const rows: BybitPosition[] = [];
      for (let page = 0; page < 20; page++) {
        const params: Record<string, string> = { category: scope.category };
        if (scope.settleCoin) params.settleCoin = scope.settleCoin;
        params.limit = "200";
        if (cursor) params.cursor = cursor;
        const result = object((await request("/v5/position/list", params)).result);
        if (result.category !== scope.category || !Array.isArray(result.list) || result.list.length > 200
          || typeof result.nextPageCursor !== "string" || result.nextPageCursor.length > 4096) {
          throw new BybitReadOnlyError("INVALID_RESPONSE");
        }
        for (const value of result.list) {
          const p = position(value, scope);
          if (!p) continue;
          const id = positionKey(p);
          if (seen.has(id)) throw new BybitReadOnlyError("INVALID_RESPONSE");
          seen.add(id);
          rows.push(p);
        }
        cursor = result.nextPageCursor;
        if (!cursor) return rows;
        if (cursors.has(cursor)) throw new BybitReadOnlyError("INVALID_RESPONSE");
        cursors.add(cursor);
      }
      throw new BybitReadOnlyError("INVALID_RESPONSE");
    }
    const results = await Promise.all(SCOPES.map(async scope => {
      try { return { scope, rows: await positions(scope), complete: true }; }
      catch { return { scope, rows: [] as BybitPosition[], complete: false }; }
    }));
    // Duplicates across settlement scopes invalidate both scopes, never silently merge.
    const owners = new Map<string, (typeof results)[number]>();
    for (const result of results) {
      for (const p of result.rows) {
        const previous = owners.get(positionKey(p));
        if (previous) { previous.complete = false; result.complete = false; }
        else owners.set(positionKey(p), result);
      }
    }
    for (const result of results) {
      snapshot.coverage[result.scope.key] = result.complete;
      if (result.complete) snapshot.positions.push(...result.rows);
      else {
        snapshot.status = "partial";
        snapshot.warnings.push({ code: `POSITIONS_${result.scope.key.toUpperCase()}_INCOMPLETE`,
          message: "This derivatives scope could not be completely retrieved; its positions are unavailable." });
      }
    }
    assertCurrent();
    snapshot.retrieved_at = new Date(now()).toISOString();
    return snapshot;
  }

  async function checkedCredentials() {
    const check = credentialQueue.then(async () => {
      try {
        const config = credentials(await credentialLoader());
        const nextFingerprint = createHash("sha256").update(JSON.stringify(config)).digest("hex");
        if (nextFingerprint !== fingerprint) { clearCache(); fingerprint = nextFingerprint; }
        return { config, epoch: generation };
      } catch {
        clearCache();
        fingerprint = undefined;
        throw new BybitReadOnlyError("CONFIGURATION");
      }
    });
    credentialQueue = check.then(() => undefined, () => undefined);
    const { config, epoch } = await check;
    if (epoch !== generation) throw new BybitReadOnlyError("CACHE_INVALIDATED");
    return { config, epoch };
  }

  async function getSnapshot(): Promise<BybitAccountSnapshot> {
    const { config, epoch } = await checkedCredentials();
    if (cache && now() < cache.expires && now() >= cache.expires - ttl) return structuredClone(cache.snapshot);
    if (flight?.generation === epoch) return structuredClone(await flight.promise);
    const promise = collect(config, epoch).then(snapshot => {
      if (epoch !== generation) throw new BybitReadOnlyError("CACHE_INVALIDATED");
      // Partial failures are never cached, and no stale snapshot is used on error.
      cache = snapshot.status === "connected" ? { snapshot, expires: now() + ttl } : undefined;
      return snapshot;
    }).catch(error => {
      if (epoch === generation) cache = undefined;
      if (error instanceof BybitReadOnlyError) throw error;
      throw new BybitReadOnlyError("UPSTREAM_UNAVAILABLE");
    }).finally(() => {
      if (flight?.promise === promise) flight = undefined;
    });
    flight = { generation: epoch, promise };
    return structuredClone(await promise);
  }
  async function getPortfolio(syncOptions: { maxSyncMs?: number } = {}): Promise<BybitSpotPortfolio> {
    const { config, epoch } = await checkedCredentials();
    if (portfolioFlight?.generation === epoch) return structuredClone(await portfolioFlight.promise);
    const promise = (async () => {
      const context = await verifiedContext(config, epoch);
      const result = await spotHistory({
        ...context, origin: config.baseUrl, maxSyncMs: syncOptions.maxSyncMs,
        readWallet: async () => (await readWallet(context.request)).balances.map(b => ({
          coin: b.coin, quantity: b.wallet_balance, spot_borrow: b.spot_borrow,
        })),
      });
      context.assertCurrent();
      return result;
    })().catch(error => {
      if (error instanceof BybitReadOnlyError) throw error;
      throw new BybitReadOnlyError("INVALID_RESPONSE");
    }).finally(() => {
      if (portfolioFlight?.promise === promise) portfolioFlight = undefined;
    });
    portfolioFlight = { generation: epoch, promise };
    // Never cache a portfolio response: every call verifies the account and reads
    // fresh wallet/marks. Only the private, account-scoped history is persistent.
    return structuredClone(await promise);
  }
  async function runPerformance(config: Required<Credentials>, epoch: number, maxSyncMs: number) {
    const context = await verifiedContext(config, epoch);
    const run = await performanceHistory({ ...context, origin: config.baseUrl, maxSyncMs, snapshot: getSnapshot });
    context.assertCurrent();
    return run;
  }
  /** Owner-only. Responds from the private archive within a short sync budget; a
   * first import continues in the background (one at a time) after the response. */
  async function getPerformance(syncOptions: { maxSyncMs?: number } = {}): Promise<AccountPerformance> {
    const { config, epoch } = await checkedCredentials();
    if (performanceCache && performanceCache.generation === epoch && now() < performanceCache.expires
      && now() >= performanceCache.expires - 60_000) return structuredClone(performanceCache.value);
    if (performanceFlight?.generation === epoch) return structuredClone(await performanceFlight.promise);
    // The background import holds the archive lock; serve its latest result meanwhile.
    if (performanceBackground && performanceLast?.generation === epoch) return structuredClone(performanceLast.value);
    const promise = (async () => {
      const run = await runPerformance(config, epoch, syncOptions.maxSyncMs ?? 4_000);
      if (epoch === generation) {
        performanceCache = { value: run.performance, expires: now() + 60_000, generation: epoch };
        performanceLast = { value: run.performance, generation: epoch };
      }
      if (run.syncing && !performanceBackground) {
        performanceBackground = (async () => {
          for (let i = 0; i < 20; i++) {
            const next = await runPerformance(config, epoch, 80_000);
            if (epoch === generation) {
              performanceCache = { value: next.performance, expires: now() + 60_000, generation: epoch };
              performanceLast = { value: next.performance, generation: epoch };
            }
            if (!next.syncing) break;
          }
        })().catch(() => undefined).finally(() => { performanceBackground = undefined; });
      }
      return run.performance;
    })().catch(error => {
      if (error instanceof BybitReadOnlyError) throw error;
      throw new BybitReadOnlyError("INVALID_RESPONSE");
    }).finally(() => {
      if (performanceFlight?.promise === promise) performanceFlight = undefined;
    });
    performanceFlight = { generation: epoch, promise };
    return structuredClone(await promise);
  }
  return { getSnapshot, getPortfolio, getPerformance, clearCache };
}
