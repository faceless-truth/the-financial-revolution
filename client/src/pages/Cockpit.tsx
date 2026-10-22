/**
 * Bull Rotation Cockpit, the public strategy dashboard at /bull-rotation.
 * ─────────────────────────────────────────────────────────────────────────────
 * Views switched by #hash: Overview · Performance · Trades · Learning · God List.
 * God List: live coins' momentum from the latest decision (status.assets) plus
 * the watchlist and selection profile from the payload's god_list block.
 * Scarton SMSF has its own page at /smsf; the old #smsf link redirects there.
 *
 * Public data: /api/bull-rotation (the Python-emitted dashboard payload).
 * Private data: /api/bybit/performance, requested only when the server-side
 * owner session (/api/bybit/session) is authenticated. Visitors see the
 * public "$10,000 following the strategy" curve instead.
 *
 * Display-only. Nothing here feeds back into a trade decision.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AccountPerformance, LearningTest, StrategyCurve } from "@shared/cockpit";
import {
  accountModel, choosePerformanceSource, deriveExits, isStale, longDate, overviewTitle, readTheme, strategyModel, THEME_KEY,
  type CockpitForecast, type CockpitParams, type CockpitStatus, type SessionState,
} from "@/lib/cockpit";
import {
  ChangeTiles, GodListView, LearningView, PerformanceView, PositionCard, RotationWatch, StatusStrip, TradesView,
  WaitingForEntry, WhatEndsThisTrade, type GodListPayload, type TradesPayload,
} from "@/components/cockpit/CockpitViews";
import "./cockpit.css";
import { useOwner } from "@/components/OwnerGate";

interface Payload {
  available: boolean;
  generated_at: string | null;
  as_of_date: string | null;
  strategy_version: string;
  status: CockpitStatus;
  params: CockpitParams;
  forecast: CockpitForecast;
  trades: TradesPayload;
  strategy_curve?: StrategyCurve | null;
  learning_tests?: LearningTest[] | null;
  god_list?: GodListPayload | null;
}

type View = "overview" | "performance" | "trades" | "learning" | "god-list";
const VIEWS: View[] = ["overview", "performance", "trades", "learning", "god-list"];
const POLL_MS = 5 * 60 * 1000;
const PRIVATE_REQUEST = { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } } as const;

const viewFromHash = (): View => {
  const h = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  return (VIEWS as string[]).includes(h) ? (h as View) : "overview";
};

const NAV: { v: View; label: string; icon: ReactNode }[] = [
  { v: "overview", label: "Overview", icon: <svg viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg> },
  { v: "performance", label: "Performance", icon: <svg viewBox="0 0 16 16"><path d="M2 13l4-5 3 3 5-7" /></svg> },
  { v: "trades", label: "Trades", icon: <svg viewBox="0 0 16 16"><path d="M2 4h12M2 8h12M2 12h12" /></svg> },
  { v: "learning", label: "Learning", icon: <svg viewBox="0 0 16 16"><path d="M5 2v5L2 13a1 1 0 001 1h10a1 1 0 001-1l-3-6V2M4 2h8" /></svg> },
];

const SMSF_ICON = <svg viewBox="0 0 16 16"><path d="M2 7l6-4 6 4M3 7v6h10V7M6 13V9h4v4" /></svg>;
const GOD_LIST_ICON = <svg viewBox="0 0 16 16"><path d="M8 2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.2 4.4 13.1l.7-4-2.9-2.8 4-.6z" /></svg>;

export default function Cockpit() {
  const { signOut } = useOwner();
  const [data, setData] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionState>(null);
  const [account, setAccount] = useState<AccountPerformance | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [view, setView] = useState<View>(viewFromHash);
  const [theme, setTheme] = useState<"light" | "dark" | null>(readTheme);

  useEffect(() => { document.title = "Bull Rotation Cockpit"; }, []);

  // The SMSF view moved to its own page; keep old #smsf links working.
  useEffect(() => {
    if (window.location.hash === "#smsf") window.location.replace("/smsf");
  }, []);

  useEffect(() => {
    const onHash = () => { setView(viewFromHash()); window.scrollTo({ top: 0 }); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Public payload, polled like the previous page.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/bull-rotation", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as Payload;
        if (!cancelled) { setData(json); setLoadError(false); }
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  // Owner session, then private account performance only when authenticated.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/bybit/session", { ...PRIVATE_REQUEST, signal: controller.signal });
        if (!res.ok) { setSession({ authenticated: false }); return; }
        const s = (await res.json()) as { authenticated?: boolean; login_configured?: boolean };
        setSession({ authenticated: s.authenticated === true, login_configured: s.login_configured });
        if (s.authenticated !== true) return;
        // A stale-but-complete result arrives with `refreshing` while the server
        // catches up in the background; re-request until the newer one lands.
        for (let attempt = 0; attempt < 24; attempt++) {
          if (attempt > 0) await new Promise(r => window.setTimeout(r, 5_000));
          if (controller.signal.aborted) return;
          const pr = await fetch("/api/bybit/performance", { ...PRIVATE_REQUEST, signal: controller.signal });
          if (!pr.ok) {
            setAccountError(pr.status === 404 ? "Account history isn't available on this server yet." : `The account history request failed (${pr.status}).`);
            return;
          }
          const perf = (await pr.json()) as AccountPerformance;
          setAccount(perf);
          if (!perf.refreshing) return;
        }
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") {
          setSession(s => s ?? { authenticated: false });
          setAccountError(a => a ?? "The account history request failed.");
        }
      }
    })();
    return () => controller.abort();
  }, []);

  const status = data?.status ?? {};
  const params = data?.params ?? {};
  const forecast = data?.forecast ?? {};
  const exits = useMemo(() => (data ? deriveExits(status, params, forecast) : null), [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const source = choosePerformanceSource(session, account, data?.strategy_curve);
  const perfModel = useMemo(() => {
    if (source === "account" && account) return accountModel(account);
    if (source === "strategy" && data?.strategy_curve) return strategyModel(data.strategy_curve);
    return null;
  }, [source, account, data?.strategy_curve]);
  const accountEquity = source === "account" && account?.series.length ? account.series[account.series.length - 1].equity_usd : null;

  const perfNotice: ReactNode = source === "account" ? null : session?.authenticated ? (
    <div className="callout warn">
      {accountError ?? "Your account history isn't available right now."} Showing the strategy's own dollar curve instead.
    </div>
  ) : (
    <p className="note">This is the strategy on $10,000, not a real account. <a href="/portfolio">Sign in on the Portfolio page</a> to see your own Bybit account here.</p>
  );

  const toggleTheme = () => {
    const current = theme ?? (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const next = current === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* per-viewer convenience only */ }
  };

  const stale = data?.available ? isStale(data.as_of_date) : false;
  const asOf = data?.as_of_date ? longDate(data.as_of_date) : null;

  return (
    <div className="cockpit" data-theme={theme ?? undefined}>
      <div className="app">
        <aside className="side">
          <div className="brand"><b>Bull Rotation</b><span>{data?.strategy_version ?? "—"} · live strategy</span></div>
          <nav className="nav" aria-label="Sections">
            {NAV.map(n => (
              <a key={n.v} href={`#${n.v}`} aria-current={view === n.v ? "page" : undefined}>{n.icon}{n.label}</a>
            ))}
            <a href="/smsf">{SMSF_ICON}Scarton SMSF</a>
            <a href="#god-list" aria-current={view === "god-list" ? "page" : undefined}>{GOD_LIST_ICON}God List</a>
          </nav>
          <div className="side-foot">
            <span><i className="dot" style={stale ? { background: "var(--warn)" } : undefined} />Daily run 00:05 UTC</span>
            <span className="mono">Decision {data?.as_of_date ?? "—"}</span>
            <button className="theme-btn" type="button" onClick={toggleTheme}>Switch theme</button>
            <button className="theme-btn" type="button" onClick={() => void signOut()}>Sign out</button>
          </div>
        </aside>

        <main className="main">
          {loading && !data ? (
            <div className="state"><b>Loading the latest decision…</b>Reading today's strategy snapshot.</div>
          ) : !data?.available ? (
            <div className="state">
              <b>Strategy data is unavailable</b>
              {loadError ? "The dashboard couldn't reach the server. It retries every five minutes." : "The daily payload hasn't been published yet. It is written after the 00:05 UTC run."}
            </div>
          ) : (
            <>
              {stale && (
                <div className="callout warn">
                  <span className="stale">Data may be out of date.</span> The latest decision is dated {asOf}; a newer one should exist by now.
                </div>
              )}
              {view === "overview" && (
                <section className="view on" aria-label="Overview">
                  <div className="topbar">
                    <div><h1>{overviewTitle(status)}</h1><p>Updated after the {asOf} daily decision · prices are the last daily close</p></div>
                  </div>
                  <StatusStrip status={status} params={params} accountEquity={accountEquity} />
                  {exits ? (
                    <>
                      <PositionCard status={status} exits={exits} />
                      <WhatEndsThisTrade exits={exits} status={status} />
                    </>
                  ) : (
                    <WaitingForEntry forecast={forecast} />
                  )}
                  <RotationWatch status={status} params={params} />
                  {perfModel && <ChangeTiles model={perfModel} />}
                </section>
              )}
              {view === "performance" && <PerformanceView model={perfModel} notice={perfNotice} />}
              {view === "trades" && <TradesView trades={data.trades} />}
              {view === "learning" && <LearningView tests={data.learning_tests} />}
              {view === "god-list" && <GodListView status={status} params={params} asOf={asOf} godList={data.god_list} />}
            </>
          )}
          <div className="mobile-foot">
            <button className="theme-btn" type="button" onClick={toggleTheme}>Switch theme</button>
            <button className="theme-btn" type="button" onClick={() => void signOut()}>Sign out</button>
          </div>
        </main>
      </div>
    </div>
  );
}
