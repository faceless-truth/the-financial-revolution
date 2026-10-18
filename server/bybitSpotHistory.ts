import { createHash, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import Decimal from "decimal.js";
import type {
  BybitSpotPortfolio, SpotExecution, SpotHistoryCoverage, SpotInventoryChange, SpotMarket, SpotWallet,
} from "../shared/bybitSpot";
import { buildSpotPerformance } from "./bybitSpotLedger";

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const DEFAULT_DIRECTORY = "/var/lib/crypto-dashboard-private/bybit-spot";
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_PAGES = 100;
const MAX_ROWS = 100_000;
const ERROR = "Spot history could not be completely synchronized; saved history has been retained.";
type Obj = Record<string, unknown>;
type Instrument = { base: string; quote: string };
type Range = { from: number; through: number };
type Pending = Range & { coin: string | null; cursor: string; cursors: string[]; pages: number; rows: number };
interface Archive {
  version: 1;
  accountRef: string;
  from: number;
  target: number;
  executionThrough: number | null;
  scanFrom: number;
  nextEnd: number | null;
  ranges: Range[];
  windowsChecked: number;
  inventory: Record<string, Range>;
  executions: SpotExecution[];
  movements: SpotInventoryChange[];
  instruments: Record<string, Instrument>;
  pending: Pending | null;
  syncedAt: string | null;
}

/** Server-only seam. Implementations must serialize the whole read/modify/write cycle. */
export interface SpotHistoryStore {
  withLock<T>(accountRef: string, work: (io: {
    read(): Promise<string | null>;
    write(value: string, assertCurrent: () => void): Promise<void>;
  }) => Promise<T>): Promise<T>;
}
function fail(): never { throw new Error("Private spot history is unavailable."); }
function obj(v: unknown): Obj {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail();
  return v as Obj;
}
function text(v: unknown, optional = false): string {
  if (optional && (v === undefined || v === null || v === "")) return "";
  if (typeof v !== "string" || !v.length || v.length > 256 || /[\x00-\x1f\x7f]/.test(v)) return fail();
  return v;
}
function coin(v: unknown): string {
  const s = text(v);
  if (!/^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(s)) return fail();
  return s;
}
function dec(v: unknown, positive = false, optional = false): string | null {
  if (optional && (v === undefined || v === null || v === "")) return null;
  if (typeof v !== "string" || v.length > 256 || !/^-?\d+(?:\.\d+)?$/.test(v)) return fail();
  const n = new Decimal(v);
  if (!n.isFinite() || (positive && !n.gt(0))) return fail();
  return n.toFixed();
}
function timestamp(v: unknown): string {
  if (typeof v !== "string" || !/^\d{1,15}$/.test(v)) return fail();
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0 || n > 8.64e15) return fail();
  return new Date(n).toISOString();
}
function millis(v: unknown): number {
  if (!Number.isSafeInteger(v) || (v as number) <= 0 || (v as number) > 8.64e15) return fail();
  return v as number;
}
function iso(v: unknown): string {
  const s = text(v);
  if (!Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== s) return fail();
  return s;
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const map = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

/** Namespace is stable across key rotation; no raw UID ever leaves this function. */
export function spotAccountRef(origin: string, key: Obj): string {
  let uid: string;
  if (typeof key.userIDInt64 === "string" && /^\d+$/.test(key.userIDInt64)
    && key.userIDInt64.length <= 32 && /[1-9]/.test(key.userIDInt64)) {
    uid = BigInt(key.userIDInt64).toString();
  } else if (typeof key.userID === "number" && Number.isSafeInteger(key.userID) && key.userID > 0) {
    uid = String(key.userID);
  } else return fail();
  return hash(`${origin}\n${uid}`);
}

/** File store is intentionally outside the web tree. Marker + checksum detect lost
 * or damaged archives rather than silently replacing purchase history with empty data.
 * Only verified ESRCH owners permit abandoned-lock recovery; age is never evidence.
 * A short-lived exclusive recovery guard serializes reapers so a second reaper
 * cannot unlink a replacement writer's lock. An abandoned/malformed recovery
 * guard itself fails busy and requires operator inspection with writers stopped. */
export function createFileSpotHistoryStore(directory = DEFAULT_DIRECTORY): SpotHistoryStore {
  const root = resolve(directory);
  if (root === sep || /(?:^|\/)(?:public|data)(?:\/|$)/.test(root)) return fail();
  async function secureDirectory() {
    let current: string = sep;
    for (const component of root.split(sep).filter(Boolean)) {
      current = join(current, component);
      try { await mkdir(current, { mode: 0o700 }); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
      const s = await lstat(current);
      if (!s.isDirectory() || s.isSymbolicLink()) return fail();
      if (current === root && ((s.mode & 0o7777) !== 0o700 || s.uid !== process.getuid?.())) return fail();
    }
  }
  async function readFile(path: string): Promise<string | null> {
    let f: Awaited<ReturnType<typeof open>> | undefined;
    try {
      f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const s = await f.stat();
      if (!s.isFile() || s.nlink !== 1 || (s.mode & 0o7777) !== 0o600 || s.uid !== process.getuid?.()
        || s.size <= 0 || s.size > MAX_ARCHIVE_BYTES) return fail();
      const value = await f.readFile("utf8");
      const after = await f.stat();
      if (s.size !== after.size || s.mtimeMs !== after.mtimeMs || s.ctimeMs !== after.ctimeMs) return fail();
      return value;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      return fail();
    } finally { await f?.close(); }
  }
  async function syncDirectory() {
    const f = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await f.sync(); } finally { await f.close(); }
  }
  const safeLock = (s: Stats) => s.isFile() && s.nlink === 1 && (s.mode & 0o7777) === 0o600
    && s.uid === process.getuid?.() && s.size > 0 && s.size <= 1024;
  const sameFile = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino
    && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs
    && a.mode === b.mode && a.uid === b.uid && a.nlink === b.nlink;
  async function readLock(path: string) {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await file.stat();
      if (!safeLock(before)) return fail();
      const value = await file.readFile("utf8");
      if (!sameFile(before, await file.stat())) return fail();
      const data = obj(JSON.parse(value));
      if (!Number.isSafeInteger(data.pid) || (data.pid as number) <= 0 || (data.pid as number) > 2_147_483_647
        || typeof data.nonce !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(data.nonce)) return fail();
      const current = await lstat(path);
      if (!safeLock(current) || !sameFile(before, current)) return fail();
      return { stat: before, value, pid: data.pid as number, nonce: data.nonce };
    } finally { await file.close(); }
  }
  function definitelyGone(pid: number): boolean {
    try { process.kill(pid, 0); return false; }
    catch (e) { return (e as NodeJS.ErrnoException).code === "ESRCH"; }
  }
  async function recoverDeadLock(path: string) {
    const original = await readLock(path);
    if (!definitelyGone(original.pid)) return fail();
    const guardPath = `${path}.recover`;
    const guardValue = JSON.stringify({ nonce: randomUUID(), pid: process.pid });
    // All recovery attempts use this same O_EXCL guard. Normal writers can win
    // acquisition after the old lock is unlinked, but are never removed by us.
    const guard = await open(guardPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await guard.writeFile(guardValue);
      await guard.sync();
      const current = await readLock(path);
      if (!sameFile(original.stat, current.stat) || original.value !== current.value
        || original.nonce !== current.nonce || !definitelyGone(current.pid)) return fail();
      // Reopen and compare nonce and inode after the second PID check. A reused
      // PID, replacement inode, or edited lock always fails closed.
      const final = await readLock(path);
      if (!sameFile(original.stat, final.stat) || original.value !== final.value || original.nonce !== final.nonce) return fail();
      await unlink(path);
      await syncDirectory();
    } finally {
      const owned = await guard.stat();
      await guard.close();
      if (await readFile(guardPath) === guardValue && sameFile(owned, await lstat(guardPath))) await unlink(guardPath);
    }
  }
  async function acquireLock(path: string) {
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
    try { return await open(path, flags, 0o600); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") return fail(); }
    try {
      await recoverDeadLock(path);
      return await open(path, flags, 0o600);
    } catch { return fail(); }
  }
  return {
    async withLock<T>(accountRef: string, work: (io: { read(): Promise<string | null>; write(value: string, assertCurrent: () => void): Promise<void> }) => Promise<T>) {
      if (!/^[a-f0-9]{64}$/.test(accountRef)) return fail();
      await secureDirectory();
      const archive = join(root, `${accountRef}.json`);
      const marker = join(root, `${accountRef}.marker`);
      const lockPath = join(root, `${accountRef}.lock`);
      const nonce = randomUUID();
      const lock = await acquireLock(lockPath);
      let known = false;
      try {
        await lock.writeFile(JSON.stringify({ nonce, pid: process.pid }));
        await lock.sync();
        return await work({
          async read() {
            const [value, identity] = await Promise.all([readFile(archive), readFile(marker)]);
            if (identity !== null && identity !== accountRef) return fail();
            if ((value === null) !== (identity === null)) return fail();
            known = value !== null;
            return value;
          },
          async write(value, assertCurrent) {
            assertCurrent();
            if (Buffer.byteLength(value) > MAX_ARCHIVE_BYTES) return fail();
            if (!known) {
              const f = await open(marker, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
              try { await f.writeFile(accountRef); await f.sync(); } finally { await f.close(); }
              await syncDirectory();
              known = true;
            } else {
              // Refuse replacement if an established archive disappeared or changed permissions.
              if (await readFile(marker) !== accountRef || await readFile(archive) === null) return fail();
            }
            const temporary = `${archive}.${nonce}.tmp`;
            const f = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
            try {
              await f.writeFile(value);
              await f.sync();
              await f.close();
              assertCurrent();
              await rename(temporary, archive);
              await syncDirectory();
            } finally {
              await f.close().catch(() => undefined);
              await unlink(temporary).catch(() => undefined);
            }
          },
        });
      } finally {
        await lock.close();
        // Never remove another writer's lock.
        if (await readFile(lockPath) === JSON.stringify({ nonce, pid: process.pid })) await unlink(lockPath);
      }
    },
  };
}

export function normalizeSpotExecution(value: unknown, instruments: Record<string, Instrument>): SpotExecution | null {
  const r = obj(value);
  if (text(r.execType) !== "Trade") return null;
  if (r.category !== undefined && r.category !== "spot") return fail();
  const symbol = coin(r.symbol);
  const instrument = own(instruments, symbol) ? instruments[symbol] : undefined;
  if (r.side !== "Buy" && r.side !== "Sell") return fail();
  const fee = dec(r.execFee, false, true);
  let feeCurrency = text(r.feeCurrency, true) || null;
  let source: SpotExecution["fee_currency_source"] = feeCurrency ? "reported" : "unknown";
  if (feeCurrency) feeCurrency = coin(feeCurrency);
  if (!feeCurrency && fee !== null && new Decimal(fee).isZero()) source = "zero";
  else if (!feeCurrency && instrument && typeof r.isMaker === "boolean") {
    const rate = dec(r.feeRate, false, true);
    if (rate !== null && !new Decimal(rate).isZero()) {
      const reverse = r.isMaker && new Decimal(rate).lt(0);
      feeCurrency = (r.side === "Buy") !== reverse ? instrument.base : instrument.quote;
      source = "documented_convention";
    }
  }
  const extras = r.extraFees;
  const extraUnknown = extras !== undefined && extras !== null && extras !== ""
    && !(typeof extras === "string" && ["{}", "[]"].includes(extras.trim()))
    && !(typeof extras === "object" && Object.keys(extras).length === 0);
  return {
    id: text(r.execId), order_id: text(r.orderId), order_link_id: text(r.orderLinkId, true) || null,
    timestamp: timestamp(r.execTime), symbol, base_coin: instrument?.base ?? null, quote_coin: instrument?.quote ?? null,
    side: r.side, quantity: dec(r.execQty, true)!, price: dec(r.execPrice, true)!, quote_value: dec(r.execValue, true)!,
    fee, fee_currency: feeCurrency, fee_currency_source: source, extra_fees_unknown: extraUnknown,
  };
}
export function normalizeSpotMovement(value: unknown): SpotInventoryChange {
  const r = obj(value);
  return {
    id: text(r.id), timestamp: timestamp(r.transactionTime), coin: coin(r.currency),
    change: dec(r.change)!, balance_after: dec(r.cashBalance)!, type: text(r.type),
    category: text(r.category, true), trade_id: text(r.tradeId, true) || null, order_id: text(r.orderId, true) || null,
  };
}

function mergeExecution(a: SpotExecution, b: SpotExecution): SpotExecution {
  // Numeric strings are canonicalized before comparison. Only previously absent
  // fee/metadata fields may be enriched; immutable execution conflicts fail closed.
  const out = { ...a };
  const enrich = new Set(["base_coin", "quote_coin", "fee", "fee_currency", "order_link_id"]);
  for (const key of Object.keys(a) as (keyof SpotExecution)[]) {
    if (key === "fee_currency_source" || key === "extra_fees_unknown") continue;
    if (a[key] === b[key]) continue;
    if (enrich.has(key) && (a[key] === null || b[key] === null)) {
      if (a[key] === null) Object.assign(out, { [key]: b[key] });
    } else return fail();
  }
  if (out.fee_currency) {
    out.fee_currency_source = a.fee_currency_source === "reported" || b.fee_currency_source === "reported"
      ? "reported" : "documented_convention";
  } else if (out.fee !== null && new Decimal(out.fee).isZero()) out.fee_currency_source = "zero";
  out.extra_fees_unknown = a.extra_fees_unknown || b.extra_fees_unknown;
  return out;
}
function mergeExecutions(existing: SpotExecution[], incoming: SpotExecution[]): SpotExecution[] {
  const rows = new Map(existing.map(e => [e.id, e]));
  for (const e of incoming) rows.set(e.id, rows.has(e.id) ? mergeExecution(rows.get(e.id)!, e) : e);
  return Array.from(rows.values());
}
function mergeMovements(existing: SpotInventoryChange[], incoming: SpotInventoryChange[]): SpotInventoryChange[] {
  const key = (e: SpotInventoryChange) => `${e.coin}:${e.id}`;
  const rows = new Map(existing.map(e => [key(e), e]));
  for (const e of incoming) {
    const previous = rows.get(key(e));
    if (previous && JSON.stringify(previous) !== JSON.stringify(e)) return fail();
    rows.set(key(e), e);
  }
  return Array.from(rows.values());
}
function encode(a: Archive): string {
  const body = JSON.stringify(a);
  return JSON.stringify({ checksum: hash(body), body });
}
function decode(value: string, accountRef: string): Archive {
  const wrapper = obj(JSON.parse(value));
  if (typeof wrapper.body !== "string" || hash(wrapper.body) !== wrapper.checksum) return fail();
  const a = obj(JSON.parse(wrapper.body));
  if (a.version !== 1 || a.accountRef !== accountRef) return fail();
  const range = (v: unknown): Range => {
    const r = obj(v);
    const from = millis(r.from), through = millis(r.through);
    if (from > through) return fail();
    return { from, through };
  };
  millis(a.from); millis(a.target); millis(a.scanFrom);
  if (a.executionThrough !== null) millis(a.executionThrough);
  if (a.nextEnd !== null) millis(a.nextEnd);
  if (!Array.isArray(a.ranges) || !Array.isArray(a.executions) || !Array.isArray(a.movements)) return fail();
  a.ranges.forEach(range);
  if (!Number.isSafeInteger(a.windowsChecked) || (a.windowsChecked as number) < 0) return fail();
  for (const [c, r] of Object.entries(obj(a.inventory))) { coin(c); range(r); }
  for (const [symbol, v] of Object.entries(obj(a.instruments))) {
    coin(symbol); const i = obj(v); coin(i.base); coin(i.quote);
  }
  for (const v of a.executions) {
    const e = obj(v);
    text(e.id); text(e.order_id); if (e.order_link_id !== null) text(e.order_link_id);
    iso(e.timestamp); coin(e.symbol);
    if (e.base_coin !== null) coin(e.base_coin);
    if (e.quote_coin !== null) coin(e.quote_coin);
    if (e.side !== "Buy" && e.side !== "Sell") return fail();
    dec(e.quantity, true); dec(e.price, true); dec(e.quote_value, true);
    dec(e.fee, false, true); if (e.fee_currency !== null) coin(e.fee_currency);
    if (!["reported", "documented_convention", "zero", "unknown"].includes(e.fee_currency_source as string)
      || typeof e.extra_fees_unknown !== "boolean") return fail();
  }
  for (const v of a.movements) {
    const m = obj(v); text(m.id); iso(m.timestamp); coin(m.coin); dec(m.change); dec(m.balance_after);
    text(m.type); text(m.category, true); if (m.trade_id !== null) text(m.trade_id); if (m.order_id !== null) text(m.order_id);
  }
  if (new Set(a.executions.map(e => obj(e).id)).size !== a.executions.length
    || new Set(a.movements.map(e => `${obj(e).coin}:${obj(e).id}`)).size !== a.movements.length) return fail();
  if (a.syncedAt !== null) iso(a.syncedAt);
  if (a.pending !== null) {
    const p = obj(a.pending); const r = range(p);
    if (r.through - r.from >= WEEK || (p.coin !== null && !coin(p.coin))
      || typeof p.cursor !== "string" || p.cursor.length > 4096 || !Array.isArray(p.cursors)
      || !p.cursors.every(c => typeof c === "string" && c.length <= 4096)
      || !Number.isSafeInteger(p.pages) || (p.pages as number) < 0 || (p.pages as number) > MAX_PAGES
      || !Number.isSafeInteger(p.rows) || (p.rows as number) < 0 || (p.rows as number) > MAX_ROWS) return fail();
  }
  if ((a.from as number) > (a.target as number) || (a.scanFrom as number) < (a.from as number)
    || (a.scanFrom as number) > (a.target as number)) return fail();
  return a as unknown as Archive;
}

function retentionStart(end: number): number {
  const date = new Date(end);
  // Calendar-year arithmetic (not 730 days); preserve the UTC time of day
  // so the extra day also leaves room for the opening-inventory lookup.
  date.setUTCFullYear(date.getUTCFullYear() - 2);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.getTime();
}
function assetStarts(a: Archive): Record<string, number> {
  const starts = map<number>();
  for (const e of a.executions) {
    if (!e.base_coin || ["USDT", "USDC"].includes(e.base_coin)) continue;
    const start = Date.parse(e.timestamp) - DAY;
    starts[e.base_coin] = Math.min(starts[e.base_coin] ?? Infinity, start);
  }
  return starts;
}
function complete(a: Archive): boolean {
  if (a.nextEnd !== null || a.pending || a.executionThrough !== a.target) return false;
  return Object.entries(assetStarts(a)).every(([c, from]) => own(a.inventory, c)
    && a.inventory[c].from <= from && a.inventory[c].through >= a.target);
}
function coverage(a: Archive, error: string | null): SpotHistoryCoverage {
  const inventory = map<boolean>();
  for (const [c, from] of Object.entries(assetStarts(a))) inventory[c] = own(a.inventory, c)
    && a.inventory[c].from <= from && a.inventory[c].through >= a.target;
  const remaining = a.nextEnd === null ? 0 : Math.ceil((a.nextEnd - a.scanFrom + 1) / WEEK);
  return {
    from: new Date(a.from).toISOString(), through: new Date(a.target).toISOString(), last_synced_at: a.syncedAt,
    executions_complete: a.nextEnd === null && a.executionThrough === a.target,
    inventory_complete: inventory, execution_count: a.executions.length, windows_checked: a.windowsChecked,
    windows_total: a.windowsChecked + remaining, syncing: !complete(a), error,
  };
}

interface ReaderContext {
  origin: string;
  key: Obj;
  request(path: string, params?: Record<string, string>): Promise<Obj>;
  assertCurrent(): void;
  readWallet(): Promise<SpotWallet[]>;
  maxSyncMs?: number;
}

/** History owns import/checkpoints, never auth or PNL. The verified client supplies
 * GET transport and fresh wallet; the pure ledger owns reconciliation and FIFO. */
export function createSpotHistoryReader(options: { directory?: string; store?: SpotHistoryStore; now?: () => number } = {}) {
  const store = options.store ?? createFileSpotHistoryStore(options.directory);
  const now = options.now ?? Date.now;
  // Public metadata is refreshed on each process start/day, not every import chunk.
  const metadata = new Map<string, { at: number; instruments: Record<string, Instrument> }>();
  return async (context: ReaderContext): Promise<BybitSpotPortfolio> => {
    const accountRef = spotAccountRef(context.origin, context.key);
    const requested = context.maxSyncMs ?? 20_000;
    const budget = Number.isFinite(requested) ? Math.min(90_000, Math.max(1, requested)) : 20_000;
    const started = now(), deadline = started + budget;
    return store.withLock(accountRef, async io => {
      context.assertCurrent();
      const raw = await io.read();
      let a: Archive = raw === null ? {
        version: 1, accountRef, from: retentionStart(started), target: started,
        scanFrom: retentionStart(started), nextEnd: started, executionThrough: null,
        ranges: [], windowsChecked: 0, inventory: map<Range>(), executions: [], movements: [], instruments: map<Instrument>(),
        pending: null, syncedAt: null,
      } : decode(raw, accountRef);
      async function save(next: Archive) {
        context.assertCurrent();
        await io.write(encode(next), context.assertCurrent);
        context.assertCurrent();
        a = next;
      }
      if (raw === null) await save(a);
      // A finished archive starts a bounded overlapping refresh; older records are
      // never pruned, even after falling outside the rolling vendor retention.
      if (complete(a) && started > a.target) {
        const inventory = map<Range>();
        // Transaction rows may arrive late too; replay the same recent overlap.
        for (const [c, r] of Object.entries(a.inventory)) {
          const through = Math.min(r.through, a.target - WEEK);
          if (through >= r.from) inventory[c] = { from: r.from, through };
        }
        await save({ ...a, inventory, target: started,
          scanFrom: Math.max(a.from, a.target - WEEK + 1), nextEnd: started, pending: null });
      }
      let error: string | null = null;
      try {
        let cached = metadata.get(context.origin);
        if (!cached || now() < cached.at || now() - cached.at >= DAY) {
          const result = obj((await context.request("/v5/market/instruments-info", { category: "spot" })).result);
          if (!Array.isArray(result.list) || result.list.length > 100_000
            || (result.category !== undefined && result.category !== "spot")
            || (result.nextPageCursor !== undefined && result.nextPageCursor !== "")) return fail();
          const instruments = map<Instrument>();
          for (const value of result.list) {
            const r = obj(value), symbol = coin(r.symbol);
            const i = { base: coin(r.baseCoin), quote: coin(r.quoteCoin) };
            if (own(instruments, symbol) && JSON.stringify(instruments[symbol]) !== JSON.stringify(i)) return fail();
            instruments[symbol] = i;
          }
          cached = { at: now(), instruments };
          metadata.set(context.origin, cached);
        }
        const instruments = { ...a.instruments };
        for (const [symbol, i] of Object.entries(cached.instruments)) {
          if (own(instruments, symbol) && JSON.stringify(instruments[symbol]) !== JSON.stringify(i)) return fail();
          instruments[symbol] = i;
        }
        const executions = a.executions.map(e => {
          const i = own(instruments, e.symbol) ? instruments[e.symbol] : undefined;
          return i ? mergeExecution(e, { ...e, base_coin: i.base, quote_coin: i.quote }) : e;
        });
        await save({ ...a, instruments, executions });
        let runRows = 0;
        while (now() < deadline) {
          context.assertCurrent();
          let p = a.pending;
          if (!p && a.nextEnd !== null) {
            p = { from: Math.max(a.scanFrom, a.nextEnd - WEEK + 1), through: a.nextEnd,
              coin: null, cursor: "", cursors: [], pages: 0, rows: 0 };
          }
          if (!p) {
            for (const [c, from] of Object.entries(assetStarts(a)).sort(([a], [b]) => a.localeCompare(b))) {
              const covered = own(a.inventory, c) ? a.inventory[c] : undefined;
              const next = !covered || covered.from > from ? from : covered.through + 1;
              const end = covered && covered.from > from ? covered.from - 1 : a.target;
              if (next <= end) {
                p = { from: next, through: Math.min(end, next + WEEK - 1), coin: c,
                  cursor: "", cursors: [], pages: 0, rows: 0 };
                break;
              }
            }
          }
          if (!p) break;
          if (p.pages >= MAX_PAGES || p.rows >= MAX_ROWS || runRows >= MAX_ROWS) return fail();
          const params: Record<string, string> = p.coin === null
            ? { category: "spot", limit: "100" }
            : { accountType: "UNIFIED", currency: p.coin, limit: "50" };
          params.startTime = String(p.from); params.endTime = String(p.through);
          if (p.cursor) params.cursor = p.cursor;
          const result = obj((await context.request(p.coin === null ? "/v5/execution/list" : "/v5/account/transaction-log", params)).result);
          const limit = p.coin === null ? 100 : 50;
          if (!Array.isArray(result.list) || result.list.length > limit
            || (p.coin === null && result.category !== undefined && result.category !== "spot")) return fail();
          // Bybit may return an explicit null cursor on the empty terminal page
          // following a short transaction-log page. Never infer completion from
          // null on a nonempty page, or from a missing cursor field.
          const cursor = result.nextPageCursor === null && result.list.length === 0 ? "" : result.nextPageCursor;
          if (typeof cursor !== "string" || cursor.length > 4096) return fail();
          if (cursor && (p.cursors.includes(cursor) || cursor === p.cursor)) return fail();
          const next = structuredClone(a);
          if (p.coin === null) {
            const rows = result.list.map(v => normalizeSpotExecution(v, a.instruments)).filter((e): e is SpotExecution => e !== null);
            if (rows.some(e => Date.parse(e.timestamp) < p!.from || Date.parse(e.timestamp) > p!.through)) return fail();
            next.executions = mergeExecutions(a.executions, rows);
          } else {
            const rows = result.list.map(normalizeSpotMovement);
            if (rows.some(e => e.coin !== p!.coin || Date.parse(e.timestamp) < p!.from || Date.parse(e.timestamp) > p!.through)) return fail();
            next.movements = mergeMovements(a.movements, rows);
          }
          runRows += result.list.length;
          if (cursor) {
            next.pending = { ...p, cursor, cursors: [...p.cursors, cursor], pages: p.pages + 1, rows: p.rows + result.list.length };
          } else {
            next.pending = null;
            if (p.coin === null) {
              // Store the union of certified ranges, not an unbounded log of
              // overlapping polls. The checked-window counter remains explicit.
              const ranges = [...next.ranges, { from: p.from, through: p.through }].sort((a, b) => a.from - b.from);
              next.ranges = [];
              for (const range of ranges) {
                const previous = next.ranges[next.ranges.length - 1];
                if (previous && previous.through + 1 >= range.from) previous.through = Math.max(previous.through, range.through);
                else next.ranges.push({ ...range });
              }
              next.windowsChecked++;
              next.nextEnd = p.from > a.scanFrom ? p.from - 1 : null;
              if (next.nextEnd === null) next.executionThrough = a.target;
            } else {
              const covered = own(next.inventory, p.coin) ? next.inventory[p.coin] : undefined;
              next.inventory[p.coin] = { from: Math.min(covered?.from ?? p.from, p.from), through: Math.max(covered?.through ?? p.through, p.through) };
            }
          }
          // Partial page data/cursor are durable, but a range is only certified
          // complete after its final page. Errors never mutate the previous archive.
          await save(next);
        }
        if (complete(a)) await save({ ...a, syncedAt: new Date(now()).toISOString() });
      } catch {
        context.assertCurrent();
        error = ERROR;
      }
      // Fresh independent observations deliberately aren't used to 'fix' history.
      // The ledger reports API-race mismatches instead of inventing purchases.
      const wallets = await context.readWallet();
      let markets: SpotMarket[] = [];
      try {
        const result = obj((await context.request("/v5/market/tickers", { category: "spot" })).result);
        if (!Array.isArray(result.list) || result.list.length > 100_000
          || (result.category !== undefined && result.category !== "spot")) return fail();
        const observed = new Date(now()).toISOString();
        const positiveOrNull = (v: unknown) => {
          try { return dec(v, true, true); } catch { return null; }
        };
        const symbols = new Set<string>();
        markets = result.list.flatMap(v => {
          const r = obj(v), symbol = coin(r.symbol);
          if (symbols.has(symbol)) return fail();
          symbols.add(symbol);
          const i = own(a.instruments, symbol) ? a.instruments[symbol] : undefined;
          return i ? [{ symbol, base_coin: i.base, quote_coin: i.quote,
            bid_price: positiveOrNull(r.bid1Price), last_price: positiveOrNull(r.lastPrice), observed_at: observed }] : [];
        });
      } catch { context.assertCurrent(); error = ERROR; }
      context.assertCurrent();
      const result = buildSpotPerformance({ executions: a.executions, movements: a.movements,
        coverage: coverage(a, error), wallets, markets, now: new Date(now()).toISOString() });
      if (error && result.status === "ready") result.status = "partial";
      return result;
    });
  };
}
