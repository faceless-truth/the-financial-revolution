/**
 * Bull Rotation Cockpit views. Presentation only: every value comes from the
 * public payload (/api/bull-rotation) or the owner-only /api/bybit/performance
 * route, through the pure helpers in lib/cockpit.ts.
 */
import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LearningTest, PeriodKey } from "@shared/cockpit";
import { PERIOD_KEYS } from "@shared/cockpit";
import {
  PERIOD_LABEL, actionLabel, changesSinceStart, dollarsBelowPeak, exitHeadline, exitName,
  formatPct, formatPrice, formatSignedUsd, formatUsd, longDate, monthYear, periodPoints,
  rotationNote, shortDate, toneOf,
  type CockpitForecast, type CockpitParams, type CockpitStatus, type ExitModel, type ExitRule, type PerfModel,
} from "@/lib/cockpit";

const MONO = "IBM Plex Mono, ui-monospace, monospace";
const SANS = "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif";

// ── Overview ─────────────────────────────────────────────────────────────────
export function StatusStrip({ status, params, accountEquity }: {
  status: CockpitStatus; params: CockpitParams; accountEquity: string | null;
}) {
  const pos = status.position ?? "CASH";
  const minHold = params.min_hold_days ?? 7;
  const held = status.hold_days ?? 0;
  const cells: [string, ReactNode][] = [
    ["Status", <span className="chip hold" key="s">{pos === "CASH" ? "In cash" : `Holding ${pos}`}</span>],
    pos === "CASH"
      ? ["BTC 30-day trend", <span className="v" key="t">{formatPct(status.assets?.BTC?.mom_30)}</span>]
      : ["Minimum hold", <span className="v" key="h">{held >= minHold ? `Met · day ${held}` : `Day ${held} of ${minHold}`}</span>],
    ["Strategy value", <span className="v" key="v">{formatUsd(status.total_wealth_usd ?? status.portfolio_value_usd)}</span>],
    ["Last decision", <span className="v" key="a">{actionLabel(status.action)}</span>],
  ];
  if (accountEquity) cells.push(["Your account", <span className="v" key="e">{formatUsd(accountEquity)}</span>]);
  return (
    <div className="strip">
      {cells.map(([l, v]) => <div key={l}><span className="lbl">{l}</span>{v}</div>)}
    </div>
  );
}

export function PositionCard({ status, exits }: { status: CockpitStatus; exits: ExitModel | null }) {
  const pos = status.position;
  if (!pos || pos === "CASH" || !exits) return null;
  const row = status.assets?.[pos] ?? {};
  const moved = exits.entry && exits.lastClose ? (exits.lastClose / exits.entry - 1) * 100 : null;
  const stop = exits.rules.find(r => r.kind === "stop")?.level ?? null;
  const moms: [string, number | undefined][] = [["30 days", row.mom_30], ["14 days", row.mom_14], ["7 days", row.mom_7]];
  const maxMom = Math.max(10, ...moms.map(([, v]) => Math.abs(v ?? 0)));
  return (
    <div className="panel">
      <div className="pos-grid">
        <div>
          <div className="pos-top">
            <div className="pos-asset">
              <div className="coin">{pos}</div>
              <div><h3>{pos}</h3><p>Entered {status.entry_date ? longDate(status.entry_date) : "—"} · day {status.hold_days ?? 0}</p></div>
            </div>
            <div className="pos-val">
              <div className="lbl">Strategy value</div>
              <div className="big">{formatUsd(status.portfolio_value_usd)}</div>
              <div className={`mono ${toneOf(moved)}`} style={{ fontSize: 13 }}>{formatPct(moved)} price since entry</div>
            </div>
          </div>
          <div className="kv">
            <div><span className="lbl">Entry</span><span className="v">{formatPrice(exits.entry)}</span></div>
            <div><span className="lbl">Last close</span><span className="v">{formatPrice(exits.lastClose)}</span></div>
            <div><span className="lbl">Stop</span><span className="v">{formatPrice(stop)}</span></div>
            <div><span className="lbl">Score</span><span className="v">{row.score != null ? row.score.toFixed(1) : "—"}</span></div>
          </div>
          {status.reason && <p className="why"><b>Last decision:</b> {status.reason}</p>}
        </div>
        <div>
          <p className="spark-cap">{pos} momentum behind the score</p>
          <div className="wx-rail" style={{ borderLeft: 0, paddingLeft: 0 }}>
            {moms.map(([label, v]) => (
              <div className="row" key={label} style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="k">{label}</span><span className={`v ${toneOf(v)}`}>{formatPct(v)}</span>
                </div>
                <div className="meter"><i style={{ width: `${Math.max(2, (Math.abs(v ?? 0) / maxMom) * 100)}%`, background: (v ?? 0) >= 0 ? "var(--gain)" : "var(--loss)" }} /></div>
              </div>
            ))}
            <p className="note" style={{ marginTop: 8 }}>Score = 0.5 × 30-day + 0.3 × 14-day + 0.2 × 7-day momentum.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function niceStep(span: number, n: number) {
  const s0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(s0)));
  const f = s0 / mag;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
}

function PriceRuler({ exits }: { exits: ExitModel }) {
  const stop = exits.rules.find(r => r.kind === "stop")?.level ?? null;
  const struct = exits.rules.find(r => r.kind === "structure");
  const marks = [
    struct?.level != null && { v: struct.level, cls: "struct below", t: "Structure break", s: `${formatPrice(struct.level)}${struct.live ? "" : ` · arms ${shortDate(struct.armsOn!)}`}` },
    stop != null && { v: stop, cls: "stop above", t: "Stop-loss", s: formatPrice(stop) },
    exits.entry != null && { v: exits.entry, cls: "entry below", t: "Your entry", s: formatPrice(exits.entry) },
    exits.lastClose != null && { v: exits.lastClose, cls: "now above", t: "Last close", s: formatPrice(exits.lastClose) },
  ].filter(Boolean) as { v: number; cls: string; t: string; s: string }[];
  if (!marks.length) return null;
  const values = marks.map(m => m.v);
  const rawLo = Math.min(...values), rawHi = Math.max(...values);
  const step = niceStep((rawHi - rawLo) || rawHi * 0.2, 4);
  const lo = Math.max(0, Math.floor((rawLo - step * 0.4) / step) * step);
  const hi = Math.ceil((rawHi + step * 0.4) / step) * step;
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 1e6; t += step) ticks.push(t);
  const labelShift = (pct: number) => (pct < 14 ? "translateX(-12%)" : pct > 86 ? "translateX(-88%)" : "translateX(-50%)");
  // Two labels on the same side that sit close together (e.g. stop and last
  // close on a phone) are pushed apart: the left one hangs left of its mark,
  // the right one hangs right, so the prices never run into each other.
  const shifts = new Map<string, string>(marks.map(m => [m.t, labelShift(x(m.v))]));
  for (const side of ["above", "below"]) {
    const row = marks.filter(m => m.cls.endsWith(side)).sort((a, b) => a.v - b.v);
    for (let i = 1; i < row.length; i++) {
      if (x(row[i].v) - x(row[i - 1].v) < 24) {
        shifts.set(row[i - 1].t, "translateX(calc(-100% + 6px))");
        shifts.set(row[i].t, "translateX(-6px)");
      }
    }
  }
  const tickDp = step < 0.01 ? 4 : step < 1 ? 2 : 0;
  return (
    <div className="wx-ruler-panel">
      <div className="wx-ruler-head"><span>{exits.asset} price, with the levels that trigger an exit</span><span className="mono">USDT</span></div>
      <div className="wx-ruler">
        <div className="wx-track" />
        {stop != null && <div className="wx-zone-loss" style={{ left: 0, width: `${x(stop)}%` }} />}
        {stop != null && exits.lastClose != null && exits.lastClose > stop &&
          <div className="wx-zone-room" style={{ left: `${x(stop)}%`, width: `${x(exits.lastClose) - x(stop)}%` }} />}
        {marks.map(m => (
          <div key={m.t} className={`wx-mk ${m.cls}`} style={{ left: `${x(m.v)}%` }}>
            <div className="line" />
            {m.cls.startsWith("now") && <div className="dot" />}
            <div className="mlab" style={{ transform: shifts.get(m.t) }}>{m.t}<b>{m.s}</b></div>
          </div>
        ))}
      </div>
      <div className="wx-axis">
        {ticks.map(t => <span key={t} style={{ left: `${x(t)}%` }}>${t.toFixed(tickDp)}</span>)}
      </div>
    </div>
  );
}

function ExitCard({ rule, asset }: { rule: ExitRule; asset: string }) {
  const chip = rule.live
    ? <span className="chip good">Live now</span>
    : <span className="chip warn">Arms {rule.armsOn ? shortDate(rule.armsOn) : "later"}</span>;
  const to = rule.destination === "BTC" ? "moves to BTC" : "moves to cash";
  let trigger = "";
  let distance: ReactNode = null;
  let gauge: ReactNode = null;
  if (rule.kind === "stop") {
    trigger = `${asset} closes below ${formatPrice(rule.level)}. Sells ${asset} and ${to}.`;
    if (rule.level && rule.now) distance = <>{asset} can fall <b className="num">{((1 - rule.level / rule.now) * 100).toFixed(1)}%</b> from the last close before this fires.</>;
  } else if (rule.kind === "structure") {
    trigger = `${asset} closes below its structure level of ${formatPrice(rule.level)}. Sells ${asset} and ${to}.`;
    if (rule.level && rule.now) distance = <>{asset} is <b className="num">{((rule.now / rule.level - 1) * 100).toFixed(0)}%</b> above this level.</>;
  } else {
    const isRegime = rule.kind === "regime";
    trigger = isRegime
      ? `BTC's 30-day momentum drops below ${rule.level}%. Sells ${asset} and ${to}.`
      : `BTC falls ${Math.abs(rule.level ?? 25)}% from its 30-day high. Hard exit that ${to}.`;
    if (rule.level != null && rule.now != null) {
      const [glo, ghi] = isRegime ? [Math.min(-15, rule.now - 5), Math.max(15, rule.now + 5)] : [Math.min(-30, rule.now - 5), 0];
      const gx = (v: number) => Math.min(100, Math.max(0, ((v - glo) / (ghi - glo)) * 100));
      gauge = (
        <>
          <div className="wx-gauge" aria-hidden="true">
            <div className="bar" />
            <div className="bad" style={{ left: 0, width: `${gx(rule.level)}%` }} />
            <div className="th" style={{ left: `${gx(rule.level)}%` }} />
            <div className="now" style={{ left: `${gx(rule.now)}%` }} />
          </div>
          <div className="wx-gauge-legend">
            <span>Exit at {rule.level}%</span>
            <span>Now <b className="num" style={{ color: "var(--ink)" }}>{formatPct(rule.now)}</b></span>
          </div>
        </>
      );
      distance = isRegime
        ? <>BTC's 30-day momentum has <b className="num">{(rule.now - rule.level).toFixed(1)} points</b> of room.</>
        : <>BTC is {Math.abs(rule.now).toFixed(1)}% off its 30-day high. The backstop is {Math.abs(rule.level)}%.</>;
    }
  }
  return (
    <div className="wx-card">
      <div className="top"><span className="name">{rule.name}</span>{chip}</div>
      <div className="desc">{trigger}</div>
      {gauge}
      {distance && <div className="desc">{distance}</div>}
    </div>
  );
}

export function WhatEndsThisTrade({ exits, status }: { exits: ExitModel; status: CockpitStatus }) {
  const stop = exits.rules.find(r => r.kind === "stop");
  const btc = status.assets?.BTC ?? {};
  const mh = exits.minHold;
  return (
    <div className="panel">
      <div className="sechead" style={{ marginBottom: 14 }}>
        <div><p className="eyebrow">What ends this trade</p><h2>{exitHeadline(exits)}</h2></div>
      </div>
      <div className="wx">
        <div className="wx-main">
          <PriceRuler exits={exits} />
          <div className="wx-cards">{exits.rules.map(r => <ExitCard key={r.kind} rule={r} asset={exits.asset} />)}</div>
        </div>
        <aside className="wx-rail">
          <h3>Minimum hold</h3>
          <div className="wx-hold">
            <div className="t">
              <span>{Math.min(mh.done, mh.required)} of {mh.required} days</span>
              <span>{mh.met ? "met" : mh.armsOn ? `arms ${shortDate(mh.armsOn)}` : ""}</span>
            </div>
            <div className="pips">{Array.from({ length: mh.required }, (_, i) => <i key={i} className={i < mh.done ? "on" : ""} />)}</div>
          </div>
          <div className="row"><span className="k">Stop level</span><span className="v down">{formatPrice(stop?.level)}</span></div>
          <div className="row"><span className="k">Room to stop</span><span className="v">{stop?.level && stop.now ? `${((1 - stop.level / stop.now) * 100).toFixed(1)}%` : "—"}</span></div>
          <div className="row"><span className="k">BTC 30d momentum</span><span className="v">{formatPct(btc.mom_30)}</span></div>
          <div className="row"><span className="k">BTC off 30d high</span><span className="v">{formatPct(btc.dd_30 != null ? btc.dd_30 * 100 : null)}</span></div>
        </aside>
      </div>
    </div>
  );
}

export function WaitingForEntry({ forecast }: { forecast: CockpitForecast }) {
  return (
    <div className="panel">
      <div className="sechead" style={{ marginBottom: 14 }}>
        <div><p className="eyebrow">What it's waiting for</p><h2>{forecast.headline ?? "Waiting for an entry signal."}</h2></div>
      </div>
      <div className="wx-cards">
        {(forecast.conditions ?? []).map(c => (
          <div className="wx-card" key={c.label}>
            <div className="top">
              <span className="name">{c.label}</span>
              {c.distance_pct != null && <span className="chip mute">{formatPct(c.distance_pct)} away</span>}
            </div>
            <div className="desc">{c.detail}</div>
          </div>
        ))}
      </div>
      {forecast.eta && <p className="note" style={{ marginTop: 10 }}>{forecast.eta}</p>}
    </div>
  );
}

function useWidth<T extends HTMLElement>(fallback: number): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function RotationWatch({ status, params }: { status: CockpitStatus; params: CockpitParams }) {
  const [ref, W] = useWidth<HTMLDivElement>(720);
  const assets = status.assets ?? {};
  const rows = Object.entries(assets)
    .filter(([, r]) => r.score != null)
    .sort((a, b) => (b[1].score ?? 0) - (a[1].score ?? 0));
  const btc = assets.BTC?.score;
  const thrPts = params.rotation_threshold ?? 30;
  if (!rows.length || btc == null) return null;
  const thr = btc + thrPts;
  const rowH = 34, pl = 48, pr = W < 480 ? 78 : 90, pt = 22, H = pt + rows.length * rowH + 8;
  const minScore = Math.min(0, ...rows.map(([, r]) => r.score ?? 0));
  const lo = Math.floor(minScore / 10) * 10;
  const max = Math.ceil(Math.max(...rows.map(([, r]) => r.score ?? 0), thr) / 10) * 10;
  const x = (v: number) => pl + ((v - lo) / (max - lo)) * (W - pl - pr);
  const ticks: number[] = [];
  for (let t = lo; t <= max; t += 10) ticks.push(t);
  return (
    <div className="panel rot">
      <div className="ph"><h2>Rotation watch</h2><span className="sub">Momentum score · 0.5×30d + 0.3×14d + 0.2×7d</span></div>
      <div ref={ref}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Momentum scores by asset with the rotation threshold">
          {ticks.map(t => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={pt - 4} y2={H - 6} stroke="var(--grid)" strokeWidth={1} />
              <text x={x(t)} y={pt - 9} fontSize={10.5} textAnchor="middle" fontFamily={MONO} fill="var(--muted)">{t}</text>
            </g>
          ))}
          {rows.map(([asset, r], i) => {
            const s = r.score ?? 0;
            const y = pt + i * rowH + 7, h = rowH - 14, held = asset === status.position;
            const col = held ? "var(--accent)" : asset === "BTC" ? "var(--ink-2)" : "var(--muted)";
            const x0 = Math.min(x(0), x(s)), w = Math.max(2, Math.abs(x(s) - x(0)));
            return (
              <g key={asset}>
                <title>{`${asset}: score ${s.toFixed(1)} (30d ${formatPct(r.mom_30)}, 14d ${formatPct(r.mom_14)}, 7d ${formatPct(r.mom_7)})`}</title>
                <text x={pl - 10} y={y + h / 2 + 4} textAnchor="end" fontSize={12.5} fontWeight={600} fontFamily={SANS} fill="var(--ink)">{asset}</text>
                <rect x={x0} y={y} width={w} height={h} rx={3} fill={col} fillOpacity={held ? 1 : 0.55} />
                <text x={Math.max(x(s), x(0)) + 6} y={y + h / 2 + 4} fontSize={12} fontFamily={MONO} fill="var(--ink-2)">{s.toFixed(1)}{held ? "  held" : ""}</text>
              </g>
            );
          })}
          <line x1={x(thr)} x2={x(thr)} y1={pt - 4} y2={H - 6} stroke="var(--warn)" strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={x(thr) + 5} y={H - 10} fontSize={10.5} fontFamily={MONO} fill="var(--warn)">BTC + {thrPts} = {thr.toFixed(1)}</text>
        </svg>
      </div>
      <p className="rot-note">{rotationNote(status, params)}</p>
    </div>
  );
}

export interface GodListCoin {
  status: "live" | "watch";
  score: number | null; vs_btc: number | null; price: number | null;
  mom_30: number | null; mom_14: number | null; mom_7: number | null;
  likelihood_rank: number | null; clears: number; clear_days: number;
  field_rank: number; field_clears: number; field_clear_days: number;
  ret_90d_pct: number | null; ret_365d_pct: number | null; vol_90d_pct: number | null;
  max_dd_pct: number | null; off_high_pct: number | null; btc_corr_90d: number | null; btc_beta_90d: number | null;
  usd_volume_30d: number | null; first_date: string | null; history_days: number;
  bybit?: { spot: boolean; perp: boolean; turnover_24h: number | null } | null;
}

export interface GodListPayload {
  available: boolean;
  lookback_days?: number;
  window_start?: string;
  through_date?: string;
  live?: string[];
  watchlist?: string[];
  coins?: Record<string, GodListCoin>;
  btc?: Partial<GodListCoin>;
}

const compactUsd = (v: number | null | undefined) =>
  v == null ? "—" : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${(v / 1e3).toFixed(0)}K`;
const clearsText = (n: number, d: number) => n ? `${n} · ${d}d` : "0";

export function GodListView({ status, params, asOf, godList }: { status: CockpitStatus; params: CockpitParams; asOf: string | null; godList?: GodListPayload | null }) {
  const coins = godList?.available ? godList.coins ?? {} : {};
  const liveCount = Object.values(coins).filter(c => c.status === "live").length;
  const assets = status.assets ?? {};
  const thrPts = params.rotation_threshold ?? 30;
  // Live coins show the decision's own numbers; watchlist coins come from the God List.
  const merged: Record<string, { price?: number | null; score?: number | null; mom_30?: number | null; mom_14?: number | null; mom_7?: number | null }> = {};
  for (const [a, c] of Object.entries(coins)) merged[a] = c;
  for (const [a, r] of Object.entries(assets)) merged[a] = r;
  const btc = merged.BTC?.score ?? godList?.btc?.score ?? null;
  const rows = Object.entries(merged)
    .filter(([, r]) => r.score != null)
    .sort((a, b) => (b[1].score ?? 0) - (a[1].score ?? 0));
  const watch = (a: string) => coins[a]?.status === "watch";
  const standing = (asset: string, score: number) => {
    if (asset === status.position) return <span className="chip hold">Held</span>;
    if (asset === "BTC") return <span className="chip mute">Benchmark</span>;
    if (score <= 0) return <span className="chip mute">Score not positive</span>;
    if (btc == null) return null;
    const short = btc + thrPts - score;
    if (short <= 0) return watch(asset) ? <span className="chip warn">Clears · not traded</span> : <span className="chip good">Clears line</span>;
    return <span className="chip mute">{short.toFixed(1)} pts short</span>;
  };
  const profile = Object.entries(coins).sort((a, b) => a[1].field_rank - b[1].field_rank);
  const thinHistory = (c: Partial<GodListCoin>) => (c.history_days ?? 0) < (godList?.lookback_days ?? 730);
  const bybitCell = (c: Partial<GodListCoin>) => {
    const b = c.bybit;
    if (!b) return "—";
    if (!b.spot) return <span className="chip warn" title="No Bybit spot market">{b.perp ? "Perp only" : "Not listed"}</span>;
    return <span title={`Bybit spot 24h turnover${b.perp ? "; perpetual also listed" : ""}`}>{compactUsd(b.turnover_24h)}{b.perp ? "" : " · no perp"}</span>;
  };
  const riskCells = (c: Partial<GodListCoin>) => (
    <>
      <td className={`r mono ${toneOf(c.ret_365d_pct)}`}>{formatPct(c.ret_365d_pct)}</td>
      <td className="r mono">{c.vol_90d_pct == null ? "—" : `${c.vol_90d_pct.toFixed(0)}%`}</td>
      <td className="r mono">{formatPct(c.max_dd_pct, 0)}</td>
      <td className="r mono">{formatPct(c.off_high_pct, 0)}</td>
      <td className="r mono" title={c.btc_beta_90d == null ? undefined : `Beta to BTC ${c.btc_beta_90d.toFixed(2)}`}>{c.btc_corr_90d == null ? "—" : c.btc_corr_90d.toFixed(2)}</td>
      <td className="r mono">{compactUsd(c.usd_volume_30d)}</td>
      <td className="r mono">{bybitCell(c)}</td>
      <td className="r mono" title={c.first_date ? `Daily closes since ${c.first_date}` : undefined}>
        {c.first_date ? c.first_date.slice(0, 7) : "—"}{thinHistory(c) ? <span className="chip sample" style={{ marginLeft: 6 }}>short</span> : null}
      </td>
    </>
  );
  return (
    <section className="view on" aria-label="God List">
      <div className="topbar">
        <div><h1>God List</h1><p>Momentum scores after the {asOf ?? "latest"} daily decision · crypto only · ranked highest first</p></div>
      </div>
      {rows.length === 0 ? (
        <div className="state"><b>Momentum scores are unavailable</b>The latest decision didn't publish per-coin scores.</div>
      ) : (
        <div className="panel">
          <div className="ph"><h2>Momentum now</h2><span className="sub">0.5×30d + 0.3×14d + 0.2×7d · rotation needs BTC + {thrPts}</span></div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th className="r">#</th><th>Coin</th><th className="r" title="How likely the script is to pick this coin over BTC, ranked by how often it cleared the rotation line in the last two years. Watchlist coins can't be picked.">Likelihood</th><th className="r">Daily close</th><th className="r">Score</th><th className="r">vs BTC</th>
                  <th className="r">30d</th><th className="r">14d</th><th className="r">7d</th><th>Standing</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([asset, r], i) => {
                  const score = r.score ?? 0;
                  const c = coins[asset];
                  return (
                    <tr key={asset}>
                      <td className="r mono muted">{i + 1}</td>
                      <td><b>{asset}</b>{watch(asset) && <span className="chip mute" style={{ marginLeft: 6 }}>Watch</span>}</td>
                      <td className="r mono" title={c && c.status === "live" ? `Cleared the line ${c.clears} times (${c.clear_days} days) since ${godList?.window_start}` : undefined}>
                        {c?.likelihood_rank ? `${c.likelihood_rank} of ${liveCount}` : "—"}
                      </td>
                      <td className="r mono">{formatPrice(r.price)}</td>
                      <td className={`r mono ${toneOf(score)}`}><b>{score.toFixed(1)}</b></td>
                      <td className="r mono">{asset === "BTC" || btc == null ? "—" : `${score - btc >= 0 ? "+" : "−"}${Math.abs(score - btc).toFixed(1)}`}</td>
                      <td className={`r mono ${toneOf(r.mom_30)}`}>{formatPct(r.mom_30)}</td>
                      <td className={`r mono ${toneOf(r.mom_14)}`}>{formatPct(r.mom_14)}</td>
                      <td className={`r mono ${toneOf(r.mom_7)}`}>{formatPct(r.mom_7)}</td>
                      <td>{standing(asset, score)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="rot-note">{rotationNote(status, params)}</p>
          {godList?.available && (
            <p className="note" style={{ marginTop: 8 }}>Likelihood ranks the {liveCount} altcoins the script trades by how many separate times each was the rotation target (highest positive score, {thrPts}+ points above BTC) from {godList.window_start} to {godList.through_date}, then by days on target. It ignores the 7-day hold, choppiness and crash rules, so it is a guide to who usually wins, not a forecast. Watch coins are scored the same way but are never traded.</p>
          )}
        </div>
      )}
      {profile.length > 0 && (
        <div className="panel">
          <div className="ph"><h2>Selection profile</h2><span className="sub">{godList?.window_start} to {godList?.through_date} · ranked by times it led the whole field</span></div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th className="r">#</th><th>Coin</th>
                  <th className="r" title="Separate times (and days) it was the rotation target with every coin on this list competing">Led field</th>
                  <th className="r" title="Separate times (and days) it would have been the rotation target if it were the only coin added to the live universe. For live coins, the live count.">With live set</th>
                  <th className="r">1y return</th><th className="r" title="Annualised volatility of daily returns, last 90 days">Volatility</th>
                  <th className="r" title="Worst peak-to-trough fall in the window">Max drop</th><th className="r" title="Below the window's highest close">Off high</th>
                  <th className="r" title="Correlation of daily returns with BTC, last 90 days; hover for beta">BTC corr</th>
                  <th className="r" title="Average daily dollar volume on Binance, last 30 days">Volume 30d</th>
                  <th className="r" title="Bybit spot 24h turnover — where the account trades">Bybit</th><th className="r">Data from</th>
                </tr>
              </thead>
              <tbody>
                {godList?.btc && (
                  <tr className="muted">
                    <td className="r mono muted">—</td><td><b>BTC</b><span className="chip mute" style={{ marginLeft: 6 }}>Benchmark</span></td>
                    <td className="r mono">—</td><td className="r mono">—</td>
                    {riskCells({ ...godList.btc, bybit: null })}
                  </tr>
                )}
                {profile.map(([asset, c]) => (
                  <tr key={asset}>
                    <td className="r mono muted">{c.field_rank}</td>
                    <td><b>{asset}</b>{c.status === "live" ? <span className="chip good" style={{ marginLeft: 6 }}>Live</span> : <span className="chip mute" style={{ marginLeft: 6 }}>Watch</span>}</td>
                    <td className="r mono">{clearsText(c.field_clears, c.field_clear_days)}</td>
                    <td className="r mono">{clearsText(c.clears, c.clear_days)}</td>
                    {riskCells(c)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note" style={{ marginTop: 8 }}>“Led field” counts the separate runs, and total days, each coin spent as the rotation target with every coin here competing. “With live set” asks what would have happened if only that coin were added to what the script trades today. Coins marked “short” have less than {Math.round((godList?.lookback_days ?? 730) / 365)} years of data, so their counts cover a shorter window. Adding a coin to the live set changes the strategy and needs a backtest and a forward test first.</p>
        </div>
      )}
    </section>
  );
}

export function ChangeTiles({ model }: { model: PerfModel }) {
  return (
    <div className="panel">
      <div className="ph"><h2>{model.source === "account" ? "Account change" : `Strategy change · ${model.title}`}</h2><a href="#performance">See performance →</a></div>
      <div className="rets">
        {PERIOD_KEYS.map(k => {
          const p = model.periods[k];
          return (
            <div className="ret" key={k}>
              <span className="lbl">{k === "All" ? "All time" : k}</span>
              <span className={`v ${p ? toneOf(p.change) : ""}`}>{p ? formatSignedUsd(p.change) : "—"}</span>
              <span className="s">{p ? `from ${formatUsd(p.start)}` : "not enough history"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Performance ──────────────────────────────────────────────────────────────
const kFmt = (t: number, step: number) => {
  const sign = t < 0 ? "−" : "";
  const a = Math.abs(t);
  if (a >= 1000) return `${sign}$${step >= 1000 ? Math.round(a / 1000) : (a / 1000).toFixed(1)}k`;
  return `${sign}$${Math.round(a)}`;
};

export function PerformanceView({ model, notice }: { model: PerfModel | null; notice: ReactNode }) {
  const [period, setPeriod] = useState<PeriodKey | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const active: PeriodKey | null = useMemo(() => {
    if (!model) return null;
    if (period && model.periods[period]) return period;
    for (const k of ["12M", "All", "6M", "30D", "7D"] as PeriodKey[]) if (model.periods[k]) return k;
    return null;
  }, [model, period]);

  if (!model || !active) {
    return (
      <section className="view on" aria-label="Performance">
        <div className="sechead"><div><p className="eyebrow">Past performance</p><h2>Performance history isn't available yet</h2></div></div>
        {notice}
        <p className="note">The daily run publishes it. Check back after the next 00:05 UTC decision.</p>
      </section>
    );
  }
  const per = model.periods[active]!;
  const pts = periodPoints(model, per);
  const changes = changesSinceStart(model, per);
  const changeNums = pts.map(p => Number(changes[p.date]));
  const dd = dollarsBelowPeak(changeNums);
  const mdd = Math.min(0, ...dd);
  const d = per.change;
  const col = toneOf(d) === "down" ? "var(--loss)" : "var(--gain)";
  const W = 1000, H = 300, m = { l: 62, r: 12, t: 14, b: 30 };
  const values = pts.map(p => p.value);
  let lo = Math.min(...values), hi = Math.max(...values);
  const pad = (hi - lo) * 0.08 || Math.max(1, hi * 0.01);
  lo -= pad; hi += pad;
  const step = niceStep(hi - lo, 4);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 1e6; t += step) ticks.push(t);
  const n = pts.length;
  const x = (i: number) => m.l + (n > 1 ? i / (n - 1) : 0.5) * (W - m.l - m.r);
  const y = (v: number) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const area = `${line}L${x(n - 1)},${H - m.b}L${x(0)},${H - m.b}Z`;
  const nx = Math.min(5, n);
  const xl = Array.from(new Set(Array.from({ length: nx }, (_, j) => Math.round((j * (n - 1)) / Math.max(1, nx - 1)))));
  const shortRange = active === "7D" || active === "30D";
  const DH = 90, dt = 6, db = 6, dlo = Math.min(mdd * 1.1, -1);
  const dy = (v: number) => dt + ((0 - v) / (0 - dlo)) * (DH - dt - db);
  const dline = dd.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${dy(v).toFixed(1)}`).join("");
  const dstep = niceStep(-dlo, 2);
  const mid = -dstep * Math.max(1, Math.floor((-dlo * 0.75) / dstep));
  const onMove = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg || n < 2) return;
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((sx - m.l) / (W - m.l - m.r)) * (n - 1)))));
  };
  const hp = hover != null ? pts[hover] : null;
  const flowsNonZero = per.flows != null && Number(per.flows) !== 0;
  const heading = model.source === "account" ? "How the account has done" : "How the strategy has done";

  return (
    <section className="view on" aria-label="Performance">
      <div className="sechead">
        <div><p className="eyebrow">Past performance · {model.title}</p><h2>{heading}</h2></div>
      </div>
      {notice}
      {model.notes.length > 0 && (
        <div className="callout warn">
          <b>History is incomplete.</b> {model.notes.join(" ")}
        </div>
      )}
      <div className="panel">
        <div className="pf-head">
          <div>
            <div className="pf-big"><span className={toneOf(d)}>{formatSignedUsd(d)}</span><small>{PERIOD_LABEL[active].phrase}</small></div>
            <div className="pf-sub">
              {formatUsd(per.start)} → {formatUsd(per.end)} · {longDate(per.startDate)} to {longDate(per.endDate)}
              {flowsNonZero && <> · net deposits/withdrawals {formatSignedUsd(per.flows)}</>}
            </div>
            {model.source === "account" && model.asOf && (
              <div className="pf-sub">
                Updated <time dateTime={model.asOf}>{new Date(model.asOf).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
                {model.refreshing && <> · fetching newer account history…</>}
              </div>
            )}
          </div>
          <div className="seg" role="group" aria-label="Time range">
            {PERIOD_KEYS.map(k => (
              <button key={k} type="button" id={`seg-${k}`} aria-pressed={k === active} disabled={!model.periods[k]}
                onClick={() => { setPeriod(k); setHover(null); }}>{k}</button>
            ))}
          </div>
        </div>
        <div className="pf-chart">
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Balance in dollars ${PERIOD_LABEL[active].phrase}`}
            onMouseMove={e => onMove(e.clientX)} onMouseLeave={() => setHover(null)}
            onTouchMove={e => onMove(e.touches[0].clientX)} onTouchEnd={() => setHover(null)}>
            <defs>
              <linearGradient id="cockpit-pfg" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={col} stopOpacity={0.22} /><stop offset="1" stopColor={col} stopOpacity={0} />
              </linearGradient>
            </defs>
            {ticks.map(t => (
              <g key={t}>
                <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
                <text x={m.l - 8} y={y(t) + 4} textAnchor="end" fontSize={12} fill="var(--muted)" fontFamily={MONO}>{kFmt(t, step)}</text>
              </g>
            ))}
            <line x1={m.l} x2={W - m.r} y1={y(pts[0].value)} y2={y(pts[0].value)} stroke="var(--ink-2)" strokeWidth={1} strokeDasharray="2 4" />
            {xl.map(i => (
              <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={12} fill="var(--muted)" fontFamily={MONO}>
                {shortRange ? shortDate(pts[i].date) : monthYear(pts[i].date)}
              </text>
            ))}
            <path d={area} fill="url(#cockpit-pfg)" />
            <path d={line} fill="none" stroke={col} strokeWidth={2} strokeLinejoin="round" />
            <circle cx={x(n - 1)} cy={y(pts[n - 1].value)} r={4.5} fill={col} stroke="var(--panel)" strokeWidth={2} />
            {hp && hover != null && (
              <>
                <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={H - m.b} stroke="var(--ink-2)" strokeWidth={1} strokeDasharray="3 3" />
                <circle cx={x(hover)} cy={y(hp.value)} r={5} fill={col} stroke="var(--panel)" strokeWidth={2} />
              </>
            )}
            <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} fill="transparent" />
          </svg>
          {hp && hover != null && (
            <div className="pf-tip" style={{ left: `${Math.min(Math.max((x(hover) / W) * 100, 12), 88)}%`, top: `${(y(hp.value) / H) * 100}%` }}>
              <span className="d">{longDate(hp.date)}</span>
              <span className="v">{formatUsd(model.exact[hp.date] ?? hp.value)}</span>
              <span className={toneOf(changes[hp.date])}>{formatSignedUsd(changes[hp.date])} since {shortDate(per.startDate)}</span>
            </div>
          )}
        </div>
        <div className="pf-dd-lbl">
          <span>{model.source === "account" ? "Dollars below the peak (deposits and withdrawals excluded)" : "Dollars below the peak"}</span>
          <span className="mono">Largest dip {formatSignedUsd(mdd)}</span>
        </div>
        <div className="pf-chart" style={{ marginTop: 4 }}>
          <svg viewBox={`0 0 ${W} ${DH}`} role="img" aria-label={`Dollars below the peak, largest dip ${formatUsd(Math.abs(mdd))}`}>
            <line x1={m.l} x2={W - m.r} y1={dy(0)} y2={dy(0)} stroke="var(--line)" />
            <line x1={m.l} x2={W - m.r} y1={dy(mid)} y2={dy(mid)} stroke="var(--grid)" />
            <text x={m.l - 8} y={dy(0) + 4} textAnchor="end" fontSize={11} fontFamily={MONO} fill="var(--muted)">$0</text>
            <text x={m.l - 8} y={dy(mid) + 4} textAnchor="end" fontSize={11} fontFamily={MONO} fill="var(--muted)">{kFmt(mid, dstep)}</text>
            <path d={`${dline}L${x(n - 1)} ${dy(0)}L${x(0)} ${dy(0)}Z`} fill="var(--loss)" fillOpacity={0.18} />
            <path d={dline} fill="none" stroke="var(--loss)" strokeWidth={1.5} />
          </svg>
        </div>
        <dl className="pf-periods">
          {PERIOD_KEYS.map(k => {
            const p = model.periods[k];
            return (
              <div key={k}>
                <dt>{PERIOD_LABEL[k].tile}</dt>
                <dd className={p ? toneOf(p.change) : ""}>{p ? formatSignedUsd(p.change) : "—"}</dd>
                <dd className="s">{p ? `${formatUsd(p.start)} → ${formatUsd(p.end)}` : "not enough history"}</dd>
              </div>
            );
          })}
        </dl>
      </div>
      <p className="note">{model.subtitle}</p>
    </section>
  );
}

// ── Trades ───────────────────────────────────────────────────────────────────
export interface TradeRow {
  asset: string; entry_date: string; exit_date: string | null; hold_days: number;
  pnl_pct: number | null; exit_action: string | null; win?: boolean; open?: boolean;
}
export interface TradesPayload {
  closed_trades?: TradeRow[]; open_trade?: TradeRow | null;
  stats?: { n?: number; wins?: number; losses?: number; win_rate?: number; compounded_pct?: number; best?: number; worst?: number; avg_hold_days?: number };
}

type SortKey = "asset" | "entry_date" | "exit_date" | "hold_days" | "pnl_pct" | "exit_action";
const TRADE_COLS: [SortKey | "res", string, string?][] = [
  ["asset", "Asset"], ["entry_date", "Entered"], ["exit_date", "Exited"], ["hold_days", "Days", "r"],
  ["pnl_pct", "Return", "r"], ["exit_action", "Exit reason"], ["res", "Result"],
];

export function TradesView({ trades }: { trades: TradesPayload | undefined }) {
  const [sortK, setSortK] = useState<SortKey>("exit_date");
  const [dir, setDir] = useState(-1);
  const closed = trades?.closed_trades ?? [];
  const open = trades?.open_trade ?? null;
  const s = trades?.stats ?? {};
  const rows = [...closed].sort((a, b) => {
    const A = a[sortK] ?? "", B = b[sortK] ?? "";
    return (A > B ? 1 : A < B ? -1 : 0) * dir;
  });
  const sortBy = (k: SortKey) => {
    setDir(k === sortK ? -dir : k === "asset" || k === "exit_action" ? 1 : -1);
    setSortK(k);
  };
  const tiles: [string, string, string, string?][] = [
    ["Trades", String(s.n ?? closed.length), `${s.wins ?? 0} won · ${s.losses ?? 0} lost`],
    ["Win rate", s.win_rate != null ? `${s.win_rate.toFixed(0)}%` : "—", "of closed trades"],
    ["Compounded", formatPct(s.compounded_pct), "all closed trades", toneOf(s.compounded_pct)],
    ["Avg hold", s.avg_hold_days != null ? `${s.avg_hold_days.toFixed(0)} days` : "—", `best ${formatPct(s.best)} · worst ${formatPct(s.worst)}`],
  ];
  return (
    <section className="view on" aria-label="Trades">
      <div className="topbar"><div><h1>Trades</h1><p>Closed round-trips from the strategy's permanent record, most recent first</p></div></div>
      <div className="stats">
        {tiles.map(([l, v, sub, tone]) => (
          <div className="ret" key={l}><span className="lbl">{l}</span><span className={`v ${tone ?? ""}`}>{v}</span><span className="s">{sub}</span></div>
        ))}
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              {TRADE_COLS.map(([k, label, align]) => k === "res"
                ? <th key={k} className={align}>{label}</th>
                : (
                  <th key={k} className={`sortable ${align ?? ""}`} tabIndex={0}
                    aria-sort={k === sortK ? (dir > 0 ? "ascending" : "descending") : "none"}
                    onClick={() => sortBy(k)}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sortBy(k); } }}>
                    {label}{k === sortK && <span className="ar">{dir > 0 ? "↑" : "↓"}</span>}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {open && (
              <tr>
                <td><b>{open.asset}</b></td><td className="mono">{open.entry_date}</td><td className="mono muted">open</td>
                <td className="r mono">{open.hold_days}</td>
                <td className={`r mono ${toneOf(open.pnl_pct)}`}>{formatPct(open.pnl_pct, 2)}</td>
                <td className="muted">Still held</td><td><span className="chip hold">Open</span></td>
              </tr>
            )}
            {rows.map(t => (
              <tr key={`${t.asset}-${t.entry_date}`}>
                <td><b>{t.asset}</b></td><td className="mono">{t.entry_date}</td><td className="mono">{t.exit_date}</td>
                <td className="r mono">{t.hold_days}</td>
                <td className={`r mono ${toneOf(t.pnl_pct)}`}>{formatPct(t.pnl_pct, 2)}</td>
                <td>{exitName(t.exit_action)}</td>
                <td>{(t.win ?? (t.pnl_pct ?? 0) > 0) ? <span className="chip good">Win</span> : <span className="chip bad">Loss</span>}</td>
              </tr>
            ))}
            {!open && rows.length === 0 && <tr><td colSpan={7} className="muted">No trades recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="note">
        Returns are priced from daily closes (a decision dated D acts on the close of D−1) and include the 0.4% switching fee.
        {open && <> Open position: {open.asset} since {longDate(open.entry_date)}; its return is to the last close.</>}
      </p>
    </section>
  );
}

// ── Learning ─────────────────────────────────────────────────────────────────
const STATUS_CHIP: Record<string, string> = { watching: "hold", waiting: "mute", unlikely: "warn", not_promoted: "bad" };

export function LearningView({ tests }: { tests: LearningTest[] | null | undefined }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => (tests?.[0] ? { [tests[0].id]: true } : {}));
  const toggle = (id: string) => setOpen(o => ({ ...o, [id]: !o[id] }));
  return (
    <section className="view on" aria-label="Learning">
      <div className="topbar"><div><h1>Learning</h1><p>Paper tests running beside your live strategy. None of them can change it automatically.</p></div></div>
      {!tests || tests.length === 0 ? (
        <div className="state"><b>No paper test summaries yet</b>They are published with the daily run. Check back after the next 00:05 UTC decision.</div>
      ) : (
        <>
          <div className="tablewrap">
            <table>
              <thead><tr><th style={{ width: "28%" }}>Test</th><th>Live vs test</th><th>Progress to a verdict</th><th>Status</th><th>Earliest decision</th></tr></thead>
              <tbody>
                {tests.flatMap(t => {
                  const expanded = !!open[t.id];
                  const b = t.backtest;
                  return [
                    <tr key={t.id} className="lrow" tabIndex={0} aria-expanded={expanded}
                      onClick={() => toggle(t.id)}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(t.id); } }}>
                      <td><div className="nm"><span className="caret">›</span> {t.name}</div><div className="pl">{t.plain}</div></td>
                      <td>
                        <div className="vs">
                          {t.live_return_pct == null && t.test_return_pct == null
                            ? <span className="muted">Not running forward</span>
                            : <>
                                <span>Live <b className={toneOf(t.live_return_pct)}>{formatPct(t.live_return_pct, 2)}</b></span>
                                <span>Test <b className={toneOf(t.test_return_pct)}>{formatPct(t.test_return_pct, 2)}</b></span>
                                {t.days_running != null && <span className="muted" style={{ fontSize: 11 }}>{t.days_running} day{t.days_running === 1 ? "" : "s"} running</span>}
                              </>}
                        </div>
                      </td>
                      <td>
                        {t.progress ? (
                          <div className="prog">
                            <div className="meter"><i style={{ width: `${Math.max(2, Math.min(100, (t.progress.done / Math.max(1, t.progress.need)) * 100))}%`, background: "var(--accent)" }} /></div>
                            <small className="mono">{t.progress.done} of {t.progress.need} {t.progress.label}</small>
                          </div>
                        ) : <span className="muted">n/a</span>}
                      </td>
                      <td><span className={`chip ${STATUS_CHIP[t.status] ?? "mute"}`}>{t.verdict_label}</span></td>
                      <td style={{ maxWidth: "24ch", fontSize: 12.5, color: "var(--ink-2)" }}>{t.decision}</td>
                    </tr>,
                    <tr key={`${t.id}-d`} className="detail" hidden={!expanded}>
                      <td colSpan={5}>
                        {b ? (
                          <>
                            <div className="bt">
                              <div><span className="lbl">Return · test vs live</span><span className="v">{b.test_return_pct != null ? <>{formatPct(b.test_return_pct)} <span className="muted">vs</span> {formatPct(b.live_return_pct)}</> : <span className="muted">not published</span>}</span></div>
                              <div><span className="lbl">Worst loss · test vs live</span><span className="v">{b.test_maxdd_pct != null ? <><span className="down">{b.test_maxdd_pct.toFixed(1)}%</span> <span className="muted">vs</span> {b.live_maxdd_pct != null ? `${b.live_maxdd_pct.toFixed(1)}%` : "—"}</> : <span className="muted">n/a</span>}</span></div>
                              <div><span className="lbl">Test periods won</span><span className="v">{b.windows_won ?? <span className="muted">n/a</span>}</span></div>
                              <div>
                                <span className="lbl">Confidence</span>
                                <span className="v">{b.confidence != null ? <>{b.confidence.toFixed(3)} <span className="muted">/ {b.bar} needed</span></> : <span className="muted">n/a</span>}</span>
                                {b.confidence != null && <div className="conf"><i style={{ width: `${Math.min(100, b.confidence * 100)}%` }} /><b style={{ left: `${Math.min(100, b.bar * 100)}%` }} /></div>}
                              </div>
                            </div>
                            <p className="note" style={{ marginTop: 10 }}>{b.summary ?? "Historical backtest results, not a forecast."}</p>
                          </>
                        ) : <span className="muted">No backtest for this test. It needs forward evidence.</span>}
                      </td>
                    </tr>,
                  ];
                })}
              </tbody>
            </table>
          </div>
          <div className="legend"><span>Click a row to see its backtest.</span><span>Confidence bar: the tick marks the promotion bar.</span></div>
        </>
      )}
    </section>
  );
}
