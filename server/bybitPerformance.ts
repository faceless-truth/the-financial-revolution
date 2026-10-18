import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type { BybitAccountSnapshot } from "../shared/bybitAccount";
import type {
  AccountPerformance, AccountPerformancePeriod, AccountPerformancePoint, PeriodKey,
} from "../shared/cockpit";
import { createFileSpotHistoryStore, normalizeSpotMovement, spotAccountRef, type SpotHistoryStore } from "./bybitSpotHistory";

/**
 * Private, owner-only account performance: a daily UTC-close equity series for
 * the whole Unified account, with external transfers separated from trading
 * results so a deposit or withdrawal never reads as profit or loss.
 *
 * Holdings are walked back from the live wallet through every logged balance
 * change (sums commute, so same-millisecond ordering cannot matter), and every
 * logged cashBalance is used as a continuity check. Open USDT/USDC perpetual
 * P&L is rebuilt by replaying linear fills, and must reconcile to the live
 * positions. Anything that cannot be established is reported, never invented.
 */

const D = Decimal.clone({ precision: 60, toExpNeg: -1000, toExpPos: 1000 });
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const DEFAULT_DIRECTORY = "/var/lib/crypto-dashboard-private/bybit-performance";
const STABLE = new Set(["USDT", "USDC"]);
// Money moving into or out of the Unified account is external to it (the funding
// wallet and Earn products are out of scope by agreement). Trades, fees, funding,
// conversions and settlements are results, not flows.
const isFlow = (type: string) => /(?:^|_)TRANSFER_(?:IN|OUT)$|_SUBSCRIPTION$|_REDEMPTION$|^DEPOSIT$|^WITHDRAW/.test(type);
const HOUR = 3_600_000;
// Per-step reconciliation tolerance in coin units: above venue rounding, far below any real row.
const TOLERANCE = new D("0.00001");
const PERIOD_DAYS: Record<Exclude<PeriodKey, "All">, number> = { "7D": 7, "30D": 30, "6M": 182, "12M": 365 };
const PERIOD_LABEL: Record<PeriodKey, string> = { "7D": "7 days", "30D": "30 days", "6M": "6 months", "12M": "12 months", All: "all time" };
const MAX_PAGES = 200;
const MAX_ROWS = 200_000;

export interface PerfMovement {
  id: string; timestamp: number; coin: string; change: string; balance_after: string; type: string; category: string;
}
export interface PerfFill {
  id: string; timestamp: number; symbol: string; side: "Buy" | "Sell"; qty: string; price: string; exec_type: string;
}
export interface PerfPosition { category: string; symbol: string; side: "Buy" | "Sell"; size: string; position_index: number }

export interface PerformanceInput {
  now: number;
  /** Both histories are complete and contiguous over [coverageFrom, coverageThrough]. */
  coverageFrom: number | null;
  coverageThrough: number | null;
  movements: PerfMovement[];
  fills: PerfFill[];
  wallet: Array<{ coin: string; quantity: string }>;
  /** Live derivatives positions; null when they could not be completely read. */
  positions: PerfPosition[] | null;
  liveEquityUsd: string | null;
  asOf: string | null;
  spotClose(coin: string, day: string): string | null;
  linearClose(symbol: string, day: string): string | null;
  notes?: string[];
  /** Older history is still importing; a position open before coverage is expected. */
  importing?: boolean;
}

const dayOf = (ms: number) => new Date(Math.floor(ms / DAY) * DAY).toISOString().slice(0, 10);
const dayStart = (day: string) => Date.parse(`${day}T00:00:00.000Z`);
const addDays = (day: string, n: number) => dayOf(dayStart(day) + n * DAY);
const usd = (n: Decimal) => n.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2);
const quantum = (value: string) => new D(10).pow(-((value.split(".")[1] ?? "").length));

function unavailable(asOf: string | null, notes: string[]): AccountPerformance {
  return { available: false, as_of: asOf, coverage: { start_date: null, complete: false, notes }, series: [], periods: {} };
}

/** Pure: no I/O. Deterministic for a given input. */
export function buildAccountPerformance(input: PerformanceInput): AccountPerformance {
  const notes = [...(input.notes ?? [])];
  const note = (text: string) => { if (!notes.includes(text)) notes.push(text); };
  if (input.coverageFrom === null || input.coverageThrough === null) {
    note("Account history is still being imported from Bybit.");
    return unavailable(input.asOf, notes);
  }
  const through = Math.min(input.coverageThrough, input.now);
  const wallet = new Map<string, Decimal>();
  for (const w of input.wallet) wallet.set(w.coin, (wallet.get(w.coin) ?? new D(0)).plus(w.quantity));

  // ── Balance chain: walk back group by group, re-anchoring on each logged
  // cashBalance so venue rounding (~1e-6 per interest accrual) never accumulates.
  // A missing row breaks the chain by its whole size and stops the series there.
  let validFrom = input.coverageFrom;
  let tailBroken = false;
  const byCoin = new Map<string, PerfMovement[]>();
  for (const m of input.movements) {
    if (m.timestamp < input.coverageFrom || m.timestamp > through) continue;
    (byCoin.get(m.coin) ?? byCoin.set(m.coin, []).get(m.coin)!).push(m);
  }
  // Per coin, ascending: [group time, balance after the group]; plus the opening balance.
  const chains = new Map<string, { times: number[]; after: Decimal[]; opening: Decimal }>();
  for (const [coin, rows] of Array.from(byCoin)) {
    const groups = new Map<number, PerfMovement[]>();
    for (const r of rows) (groups.get(r.timestamp) ?? groups.set(r.timestamp, []).get(r.timestamp)!).push(r);
    const times = Array.from(groups.keys()).sort((a, b) => b - a);
    let running = wallet.get(coin) ?? new D(0);
    let laterVerified: number | null = null;
    const chain = { times: [] as number[], after: [] as Decimal[], opening: running };
    for (let i = 0; i < times.length; i++) {
      const t = times[i], group = groups.get(t)!;
      const match = group.find(r => running.minus(r.balance_after).abs().lte(Decimal.max(quantum(r.balance_after).times(2), TOLERANCE)));
      if (!match) {
        if (i === 0) {
          tailBroken = true;
          note(`${coin} changed after the last imported record; the history will update on the next refresh.`);
        } else {
          note(`${coin} history has a gap before ${dayOf(laterVerified!)}; earlier days are not shown.`);
        }
        validFrom = Math.max(validFrom, laterVerified ?? through + 1);
        break;
      }
      laterVerified = t;
      const anchored = new D(match.balance_after);
      chain.times.push(t); chain.after.push(anchored);
      running = group.reduce((b, r) => b.minus(r.change), anchored);
      chain.opening = running;
    }
    chain.times.reverse(); chain.after.reverse();
    chains.set(coin, chain);
  }
  if (input.movements.some(m => /LOAN|BORROW/.test(m.type))) {
    note("Borrowed funds appear in this history and are counted as balances, not separately as debt.");
  }
  if (input.movements.some(m => m.category === "inverse" || m.category === "option")) {
    note("Inverse and options history is counted as cash only; its open P&L is not rebuilt.");
  }

  // ── Derivatives: replay one-way linear fills; they must reconcile to live ──
  if (input.positions === null) {
    note("Open derivatives positions could not be read, so account equity cannot be rebuilt.");
    return unavailable(input.asOf, notes);
  }
  if (input.positions.some(p => p.position_index !== 0)) {
    note("Hedge-mode derivatives positions are not supported by this history.");
    return unavailable(input.asOf, notes);
  }
  if (input.positions.some(p => p.category !== "linear")) {
    note("Open inverse positions are not rebuilt in this history.");
  }
  const fills = input.fills.filter(f => f.timestamp >= input.coverageFrom! && f.timestamp <= through)
    .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
  type Pos = { size: Decimal; avg: Decimal };
  const apply = (book: Map<string, Pos>, f: PerfFill) => {
    const q = new D(f.qty).times(f.side === "Buy" ? 1 : -1), p = new D(f.price);
    const cur = book.get(f.symbol) ?? { size: new D(0), avg: new D(0) };
    let next: Pos;
    if (cur.size.isZero() || cur.size.isPositive() === q.isPositive()) {
      const size = cur.size.plus(q);
      next = { size, avg: cur.size.abs().times(cur.avg).plus(q.abs().times(p)).div(size.abs()) };
    } else if (q.abs().lte(cur.size.abs())) {
      const size = cur.size.plus(q);
      next = { size, avg: size.isZero() ? new D(0) : cur.avg };
    } else next = { size: cur.size.plus(q), avg: p };
    book.set(f.symbol, next);
  };
  {
    const book = new Map<string, Pos>();
    for (const f of fills) apply(book, f);
    const live = new Map<string, Decimal>();
    for (const p of input.positions) if (p.category === "linear") live.set(p.symbol, new D(p.size).times(p.side === "Buy" ? 1 : -1));
    const symbols = new Set(Array.from(book.keys()).concat(Array.from(live.keys())));
    for (const s of Array.from(symbols)) {
      if (!(book.get(s)?.size ?? new D(0)).eq(live.get(s) ?? 0)) {
        if (input.importing) {
          note("Account history is still being imported from Bybit.");
          return unavailable(input.asOf, notes);
        }
        note(`The ${s} position history does not reconcile with the live position, so account equity cannot be rebuilt.`);
        return unavailable(input.asOf, notes);
      }
    }
  }

  // ── Daily closes ──
  const today = dayOf(input.now);
  const firstDay = dayOf(validFrom);
  const lastDay = addDays(dayOf(through + 1), -1) < today ? addDays(dayOf(through + 1), -1) : addDays(today, -1);
  const coins = Array.from(new Set<string>(Array.from(wallet.keys()).concat(Array.from(byCoin.keys()))));
  const moves = input.movements.filter(m => m.timestamp >= input.coverageFrom! && m.timestamp <= through)
    .sort((a, b) => a.timestamp - b.timestamp);
  const price = (coin: string, day: string): Decimal | null => {
    if (STABLE.has(coin)) return new D(1);
    const v = input.spotClose(coin, day);
    return v === null ? null : new D(v);
  };
  // Balance at close(day): the anchored balance after the last group before the close.
  const closes: Array<{ day: string; balances: Map<string, Decimal> }> = [];
  if (!tailBroken) {
    const pointers = new Map<string, number>();
    for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
      const close = dayStart(day) + DAY;
      const balances = new Map<string, Decimal>();
      for (const c of coins) {
        const chain = chains.get(c);
        if (!chain) { balances.set(c, wallet.get(c) ?? new D(0)); continue; }
        let i = pointers.get(c) ?? -1;
        while (i + 1 < chain.times.length && chain.times[i + 1] < close) i++;
        pointers.set(c, i);
        balances.set(c, i >= 0 ? chain.after[i] : chain.opening);
      }
      closes.push({ day, balances });
    }
  }
  const flowsByDay = new Map<string, PerfMovement[]>();
  for (const m of moves) if (isFlow(m.type)) (flowsByDay.get(dayOf(m.timestamp)) ?? flowsByDay.set(dayOf(m.timestamp), []).get(dayOf(m.timestamp))!).push(m);
  const book = new Map<string, Pos>();
  let fi = 0;
  const series: AccountPerformancePoint[] = [];
  const unpriced = new Set<string>();
  for (const { day, balances } of closes) {
    const close = dayStart(day) + DAY;
    while (fi < fills.length && fills[fi].timestamp < close) apply(book, fills[fi++]);
    let equity = new D(0), ok = true;
    for (const [c, qty] of Array.from(balances)) {
      if (qty.isZero()) continue;
      const px = price(c, day);
      if (!px) { ok = false; unpriced.add(c); continue; }
      equity = equity.plus(qty.times(px));
    }
    for (const [s, pos] of Array.from(book)) {
      if (pos.size.isZero()) continue;
      const px = input.linearClose(s, day);
      if (px === null) { ok = false; unpriced.add(s); continue; }
      equity = equity.plus(pos.size.times(new D(px).minus(pos.avg)));
    }
    let flow = new D(0);
    for (const m of flowsByDay.get(day) ?? []) {
      const px = price(m.coin, day);
      if (!px) { ok = false; unpriced.add(m.coin); continue; }
      flow = flow.plus(new D(m.change).times(px));
    }
    if (ok) series.push({ date: day, equity_usd: usd(equity), net_flow_usd: usd(flow) });
  }
  for (const c of Array.from(unpriced)) note(`No daily price was available for ${c} on some days; those days are left out.`);

  // Today's live point: the account's own total equity right now.
  if (!tailBroken && input.liveEquityUsd !== null && through >= dayStart(today) - DAY) {
    let flow = new D(0), ok = true;
    for (const m of flowsByDay.get(today) ?? []) {
      if (!STABLE.has(m.coin)) { ok = false; break; }
      flow = flow.plus(m.change);
    }
    if (ok) series.push({ date: today, equity_usd: usd(new D(input.liveEquityUsd)), net_flow_usd: usd(flow) });
  }

  // ── Periods: pnl = end - start - flows strictly after the start day ──
  const periods: AccountPerformance["periods"] = {};
  if (series.length) {
    const index = new Map(series.map((p, i) => [p.date, i]));
    const end = series[series.length - 1];
    const period = (startDate: string): AccountPerformancePeriod | null => {
      const i = index.get(startDate);
      if (i === undefined) return null;
      const days = Math.round((dayStart(end.date) - dayStart(startDate)) / DAY);
      if (series.length - 1 - i !== days) return null; // a missing day means unknown flows
      const flows = series.slice(i + 1).reduce((s, p) => s.plus(p.net_flow_usd), new D(0));
      const start = series[i];
      return { start_date: start.date, start_equity_usd: start.equity_usd, end_equity_usd: end.equity_usd,
        net_flows_usd: usd(flows), pnl_usd: usd(new D(end.equity_usd).minus(start.equity_usd).minus(flows)) };
    };
    for (const [key, days] of Object.entries(PERIOD_DAYS) as Array<[Exclude<PeriodKey, "All">, number]>) {
      periods[key] = period(addDays(end.date, -days));
      if (!periods[key] && addDays(end.date, -days) < series[0].date) {
        note(`History starts ${series[0].date}, so ${PERIOD_LABEL[key]} isn't available yet.`);
      }
    }
    periods.All = series.length > 1 ? period(series[0].date) : null;
  }
  return {
    available: series.length > 0,
    as_of: input.asOf,
    coverage: { start_date: series[0]?.date ?? null, complete: notes.length === 0, notes },
    series,
    periods,
  };
}

// ─────────────────────────────── Import ───────────────────────────────────

type Obj = Record<string, unknown>;
type Range = { from: number; through: number };
type StreamKey = "tx" | "fills";
interface Pending { from: number; through: number; cursor: string; cursors: string[]; pages: number }
interface Stream { scanFrom: number; nextEnd: number | null; pending: Pending | null; ranges: Range[] }
interface PriceSeries { closes: Record<string, string>; checkedAt: number; unavailable: boolean; from?: string }
interface Archive {
  version: 1;
  accountRef: string;
  from: number;
  target: number;
  streams: Record<StreamKey, Stream>;
  movements: PerfMovement[];
  fills: PerfFill[];
  prices: Record<string, PriceSeries>;
  syncedAt: string | null;
  /** Last fully reconciled result, served while a refresh is still running. */
  lastGood?: AccountPerformance | null;
}
function fail(): never { throw new Error("Private account performance history is unavailable."); }
function obj(v: unknown): Obj {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail();
  return v as Obj;
}
function symbol(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(v)) return fail();
  return v;
}
function positive(v: unknown): string {
  if (typeof v !== "string" || v.length > 256 || !/^\d+(?:\.\d+)?$/.test(v) || !new D(v).gt(0)) return fail();
  return new D(v).toFixed();
}
function ms(v: unknown): number {
  if (typeof v !== "string" || !/^\d{1,15}$/.test(v)) return fail();
  return Number(v);
}
const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export function normalizePerfFill(value: unknown): PerfFill | null {
  const r = obj(value);
  if (typeof r.execType !== "string" || r.execType === "Funding" || r.execType === "Settle") return null;
  if (r.side !== "Buy" && r.side !== "Sell") return fail();
  if (typeof r.execId !== "string" || !r.execId || r.execId.length > 256) return fail();
  return { id: r.execId, timestamp: ms(r.execTime), symbol: symbol(r.symbol), side: r.side,
    qty: positive(r.execQty), price: positive(r.execPrice), exec_type: r.execType };
}
function toPerfMovement(value: unknown): PerfMovement | null {
  const r = obj(value);
  // Informational rows (e.g. EXEMPTED_INTEREST) carry no balance effect at all.
  if (r.change === "" && r.cashBalance === "") return null;
  const m = normalizeSpotMovement(r);
  return { id: m.id, timestamp: Date.parse(m.timestamp), coin: m.coin, change: m.change,
    balance_after: m.balance_after, type: m.type, category: m.category };
}
function retentionStart(end: number): number {
  const date = new Date(end);
  date.setUTCFullYear(date.getUTCFullYear() - 2);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.getTime();
}
function mergeRanges(ranges: Range[]): Range[] {
  const out: Range[] = [];
  for (const r of [...ranges].sort((a, b) => a.from - b.from)) {
    const last = out[out.length - 1];
    if (last && last.through + 1 >= r.from) last.through = Math.max(last.through, r.through);
    else out.push({ ...r });
  }
  return out;
}
/** The certified range reaching the current target, if any. */
function covered(s: Stream, target: number): Range | null {
  return s.ranges.find(r => r.from <= target && r.through >= target) ?? null;
}
function streamDone(s: Stream) { return s.nextEnd === null && s.pending === null; }
function freshStream(from: number, target: number): Stream {
  return { scanFrom: from, nextEnd: target, pending: null, ranges: [] };
}
function encode(a: Archive): string {
  const body = JSON.stringify(a);
  return JSON.stringify({ checksum: hash(body), body });
}
function decode(value: string, accountRef: string): Archive {
  const wrapper = obj(JSON.parse(value));
  if (typeof wrapper.body !== "string" || hash(wrapper.body) !== wrapper.checksum) return fail();
  const a = obj(JSON.parse(wrapper.body)) as unknown as Archive;
  if (a.version !== 1 || a.accountRef !== accountRef || !Array.isArray(a.movements) || !Array.isArray(a.fills)
    || !a.streams || !a.streams.tx || !a.streams.fills || !a.prices || typeof a.prices !== "object") return fail();
  return a;
}

export interface PerformanceContext {
  origin: string;
  key: Obj;
  request(path: string, params?: Record<string, string>): Promise<Obj>;
  assertCurrent(): void;
  snapshot(): Promise<BybitAccountSnapshot>;
  maxSyncMs?: number;
}
export interface PerformanceRun { performance: AccountPerformance; syncing: boolean }

export function createAccountPerformanceReader(options: { directory?: string; store?: SpotHistoryStore; now?: () => number } = {}) {
  const store = options.store ?? createFileSpotHistoryStore(options.directory ?? DEFAULT_DIRECTORY);
  const now = options.now ?? Date.now;
  return async (context: PerformanceContext): Promise<PerformanceRun> => {
    const accountRef = spotAccountRef(context.origin, context.key);
    const requested = context.maxSyncMs ?? 4_000;
    const budget = Number.isFinite(requested) ? Math.min(90_000, Math.max(1, requested)) : 4_000;
    const started = now(), deadline = started + budget;
    return store.withLock(accountRef, async io => {
      context.assertCurrent();
      const raw = await io.read();
      const from = retentionStart(started);
      let a: Archive = raw === null ? {
        version: 1, accountRef, from, target: started,
        streams: { tx: freshStream(from, started), fills: freshStream(from, started) },
        movements: [], fills: [], prices: {}, syncedAt: null,
      } : decode(raw, accountRef);
      const save = async (next: Archive) => {
        context.assertCurrent();
        await io.write(encode(next), context.assertCurrent);
        a = next;
      };
      if (raw === null) await save(a);
      // A finished import refreshes with a one-week overlap; late rows are merged by id.
      if (streamDone(a.streams.tx) && streamDone(a.streams.fills) && started > a.target) {
        // One day of overlap catches late-posted rows; merges are idempotent by id.
        const refresh = (s: Stream): Stream => ({ ...s, scanFrom: Math.max(a.from, a.target - DAY + 1), nextEnd: started, pending: null });
        await save({ ...a, target: started, streams: { tx: refresh(a.streams.tx), fills: refresh(a.streams.fills) } });
      }
      const notes: string[] = [];
      // Page data accumulates in one working copy. Only completed windows (and the
      // resumable cursor on exit) are persisted; a lost partial window is re-read.
      let work: Archive = structuredClone(a);
      let dirty = false;
      try {
        let rows = 0;
        while (now() < deadline) {
          // Advance whichever stream is further behind so their coverage moves together.
          const open = (["tx", "fills"] as StreamKey[]).filter(k => !streamDone(work.streams[k]));
          if (!open.length) break;
          const key = open.sort((x, y) => (work.streams[y].pending?.through ?? work.streams[y].nextEnd ?? 0)
            - (work.streams[x].pending?.through ?? work.streams[x].nextEnd ?? 0))[0];
          const s = work.streams[key];
          const p: Pending = s.pending ?? { from: Math.max(s.scanFrom, s.nextEnd! - WEEK + 1), through: s.nextEnd!, cursor: "", cursors: [], pages: 0 };
          if (p.pages >= MAX_PAGES || rows >= MAX_ROWS) return fail();
          const params: Record<string, string> = key === "tx"
            ? { accountType: "UNIFIED", limit: "50" } : { category: "linear", limit: "100" };
          params.startTime = String(p.from); params.endTime = String(p.through);
          if (p.cursor) params.cursor = p.cursor;
          const result = obj((await context.request(key === "tx" ? "/v5/account/transaction-log" : "/v5/execution/list", params)).result);
          if (!Array.isArray(result.list) || result.list.length > (key === "tx" ? 50 : 100)) return fail();
          const cursor = result.nextPageCursor === null && result.list.length === 0 ? "" : result.nextPageCursor ?? "";
          if (typeof cursor !== "string" || cursor.length > 4096 || (cursor && p.cursors.includes(cursor))) return fail();
          const next = work;
          if (key === "tx") {
            const incoming = result.list.map(toPerfMovement).filter((m): m is PerfMovement => m !== null);
            if (incoming.some(m => m.timestamp < p.from || m.timestamp > p.through)) return fail();
            const seen = new Map(next.movements.map(m => [`${m.coin}:${m.id}`, m]));
            for (const m of incoming) {
              const prev = seen.get(`${m.coin}:${m.id}`);
              if (prev && JSON.stringify(prev) !== JSON.stringify(m)) return fail();
              seen.set(`${m.coin}:${m.id}`, m);
            }
            next.movements = Array.from(seen.values());
          } else {
            const incoming = result.list.map(normalizePerfFill).filter((f): f is PerfFill => f !== null);
            if (incoming.some(f => f.timestamp < p.from || f.timestamp > p.through)) return fail();
            const seen = new Map(next.fills.map(f => [f.id, f]));
            for (const f of incoming) {
              const prev = seen.get(f.id);
              if (prev && JSON.stringify(prev) !== JSON.stringify(f)) return fail();
              seen.set(f.id, f);
            }
            next.fills = Array.from(seen.values());
          }
          rows += result.list.length;
          const ns = next.streams[key];
          if (cursor) ns.pending = { ...p, cursor, cursors: [...p.cursors, cursor], pages: p.pages + 1 };
          else {
            ns.pending = null;
            ns.ranges = mergeRanges([...ns.ranges, { from: p.from, through: p.through }]);
            ns.nextEnd = p.from > ns.scanFrom ? p.from - 1 : null;
          }
          dirty = true;
          if (!ns.pending) { await save(next); work = structuredClone(a); dirty = false; }
        }
        if (dirty) { await save(work); dirty = false; }
      } catch {
        context.assertCurrent();
        notes.push("Bybit history could not be fully refreshed just now; saved history is shown.");
      }
      const refreshing = a.syncedAt !== null;
      const syncing = !streamDone(a.streams.tx) || !streamDone(a.streams.fills);
      if (!syncing && a.syncedAt === null) await save({ ...a, syncedAt: new Date(now()).toISOString() });
      if (syncing) notes.push("Older account history is still being imported from Bybit.");

      const snapshot = await context.snapshot();
      const tx = covered(a.streams.tx, a.target), fl = covered(a.streams.fills, a.target);
      const coverageFrom = tx && fl ? Math.max(tx.from, fl.from) : null;
      const coverageThrough = tx && fl ? Math.min(tx.through, fl.through) : null;

      // Daily closes (public market data) for every coin and contract that was held.
      const today = dayOf(now());
      const firstDay = coverageFrom === null ? today : dayOf(coverageFrom);
      const wanted = new Map<string, { category: "spot" | "linear"; symbol: string }>();
      const held = snapshot.balances.filter(b => b.wallet_balance !== null && /[1-9]/.test(b.wallet_balance)).map(b => b.coin);
      for (const c of Array.from(new Set(a.movements.map(m => m.coin).concat(held)))) {
        if (!STABLE.has(c)) wanted.set(`spot:${c}USDT`, { category: "spot", symbol: `${c}USDT` });
      }
      for (const s of Array.from(new Set(a.fills.map(f => f.symbol)))) wanted.set(`linear:${s}`, { category: "linear", symbol: s });
      const yesterday = addDays(today, -1);
      if (coverageFrom !== null) {
        for (const [key, w] of Array.from(wanted)) {
          const have = a.prices[key];
          // Completed daily closes never change. Ask again when coverage reaches further
          // back than already requested, or hourly for a missing latest close (daily if unlisted).
          const stale = !have || (have.unavailable ? now() - have.checkedAt > DAY
            : (have.from ?? yesterday) > firstDay || (!own(have.closes, yesterday) && now() - have.checkedAt > HOUR));
          if (!stale || now() >= deadline + 15_000) continue;
          try {
            const closes: Record<string, string> = { ...(have?.closes ?? {}) };
            let end = dayStart(today) - 1;
            for (let i = 0; i < 3 && end >= dayStart(firstDay); i++) {
              const result = obj((await context.request("/v5/market/kline", {
                category: w.category, symbol: w.symbol, interval: "D",
                start: String(dayStart(firstDay)), end: String(end), limit: "1000",
              })).result);
              if (!Array.isArray(result.list)) return fail();
              let earliest = Infinity;
              for (const row of result.list) {
                if (!Array.isArray(row) || row.length < 5) return fail();
                const t = ms(row[0]);
                if (t % DAY !== 0 || t >= dayStart(today)) continue;
                closes[dayOf(t)] = positive(row[4]);
                earliest = Math.min(earliest, t);
              }
              if (result.list.length < 1000 || !Number.isFinite(earliest)) break;
              end = earliest - 1;
            }
            a = { ...a, prices: { ...a.prices, [key]: { closes, checkedAt: now(), unavailable: false, from: firstDay } } };
          } catch (e) {
            context.assertCurrent();
            if ((e as { code?: string })?.code?.startsWith("BYBIT_")) {
              a = { ...a, prices: { ...a.prices, [key]: { closes: have?.closes ?? {}, checkedAt: now(), unavailable: true, from: firstDay } } };
            }
          }
        }
        await save(a);
      }
      const close = (key: string, day: string) => {
        const p = a.prices[key];
        return p && own(p.closes, day) ? p.closes[day] : null;
      };
      if (snapshot.status !== "connected") notes.push("Some live account data could not be read; account equity may be incomplete.");
      const derivativesKnown = snapshot.coverage.linear_usdt && snapshot.coverage.linear_usdc && snapshot.coverage.inverse;
      const performance = buildAccountPerformance({
        now: now(), coverageFrom, coverageThrough,
        movements: a.movements, fills: a.fills,
        wallet: snapshot.balances.filter(b => b.wallet_balance !== null).map(b => ({ coin: b.coin, quantity: b.wallet_balance! })),
        positions: derivativesKnown ? snapshot.positions.map(p => ({ category: p.category, symbol: p.symbol,
          side: p.side, size: p.size, position_index: p.position_index })) : null,
        liveEquityUsd: snapshot.totals.equity_usd, asOf: snapshot.retrieved_at,
        spotClose: (c, d) => close(`spot:${c}USDT`, d), linearClose: (s, d) => close(`linear:${s}`, d),
        notes, importing: syncing,
      });
      context.assertCurrent();
      if (performance.available && !syncing) {
        if (JSON.stringify(a.lastGood ?? null) !== JSON.stringify(performance)) await save({ ...a, lastGood: performance });
      } else if (syncing && refreshing && a.lastGood) {
        // A routine refresh is still catching up: the last reconciled result stays accurate to its as_of.
        return { performance: { ...structuredClone(a.lastGood), refreshing: true }, syncing };
      }
      return { performance, syncing };
    });
  };
}
