import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import type { BybitAccountSnapshot, BybitOwnerSession } from "@shared/bybitAccount";
import type { BybitSpotPortfolio } from "@shared/bybitSpot";
import { BybitAuthorizedSpotPerformance } from "./BybitSpotPerformance";

/** Presentation only: never convert financial decimal strings to JS numbers. */
export function formatBybitDecimal(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return "—";
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const [, sign, integer, fraction = ""] = match;
  const trimmed = fraction.replace(/0+$/, "");
  return `${sign}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${trimmed ? `.${trimmed}` : ""}`;
}

function Decimal({ value }: { value: string | null | undefined }) {
  return <span className="mono-data break-all" title={value ?? undefined}>{formatBybitDecimal(value)}</span>;
}

const scopeLabels: Record<keyof BybitAccountSnapshot["coverage"], string> = {
  wallet: "Unified wallet",
  linear_usdt: "USDT-settled linear positions",
  linear_usdc: "USDC-settled linear positions",
  inverse: "Inverse positions",
};

export function BybitSnapshotView({ snapshot }: { snapshot: BybitAccountSnapshot }) {
  const missingScopes = (Object.keys(scopeLabels) as Array<keyof typeof scopeLabels>)
    .filter(scope => !snapshot.coverage[scope]);
  const incomplete = snapshot.status === "partial" || missingScopes.length > 0;
  const collected = Date.parse(snapshot.retrieved_at);
  const collectedUtc = Number.isFinite(collected)
    ? `${new Date(collected).toISOString().replace("T", " ").replace("Z", " UTC")}` : "—";
  const totals = [
    ["Unified equity (USD)", snapshot.totals.equity_usd],
    ["Wallet balance (USD)", snapshot.totals.wallet_balance_usd],
    ["Perpetual unrealized P&L (USD)", snapshot.totals.perpetual_unrealised_pnl_usd],
    ["Available margin (USD)", snapshot.totals.available_balance_usd],
  ] as const;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><ShieldCheck size={14} />Read-only verified</span>
        <span>IP restrictions: {snapshot.ip_restricted ? "Verified" : "Not verified — review Bybit API-key settings"}</span>
        <span>Collected: <time dateTime={snapshot.retrieved_at}>{collectedUtc}</time></span>
        <span>Margin mode: {snapshot.margin_mode || "—"}</span>
      </div>
      {incomplete && (
        <div role="alert" className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
          <p className="font-semibold">Partial snapshot — coverage incomplete</p>
          <p>{missingScopes.length ? `Missing scopes: ${missingScopes.map(scope => scopeLabels[scope]).join(", ")}.` : "Not all requested account data could be verified."} Do not treat missing data as zero.</p>
        </div>
      )}
      {snapshot.warnings.length > 0 && (
        <ul className="space-y-1 text-xs text-amber-200" aria-label="Account coverage warnings">
          {snapshot.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.message}</li>)}
        </ul>
      )}
      <section aria-labelledby="bybit-balances-heading" className="space-y-3">
        <h3 id="bybit-balances-heading" className="text-sm font-semibold">Spot / Unified balances</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {totals.map(([label, value]) => (
            <div key={label} className="panel p-3 min-w-0">
              <p className="text-xs text-muted-foreground mb-2">{label}</p>
              <p className="text-lg font-semibold"><Decimal value={snapshot.coverage.wallet ? value : null} /></p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Vendor-reported totals, not a sum of rows. Unified equity can include options value and derivative P&L: do not add position notional, margin or P&L on top. Wallet balance is not net ownership or freely spendable cash; spot borrowing and locked balances matter. Account-wide totals may be unavailable in some margin modes.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <caption className="sr-only">Unified coin balances; coin units except USD value</caption>
            <thead className="text-muted-foreground border-b border-border/40"><tr>
              {["Coin", "Wallet balance", "Equity", "USD value", "Spot borrow", "Locked"].map(label => <th key={label} scope="col" className="p-2 font-medium">{label}</th>)}
            </tr></thead>
            <tbody>
              {snapshot.balances.map(balance => (
                <tr key={balance.coin} className="border-b border-border/20">
                  <th scope="row" className="p-2 font-semibold">{balance.coin}</th>
                  {[balance.wallet_balance, balance.equity, balance.usd_value, balance.spot_borrow, balance.locked].map((value, index) => <td key={index} className="p-2 min-w-24"><Decimal value={value} /></td>)}
                </tr>
              ))}
              {snapshot.balances.length === 0 && <tr><td colSpan={6} className="p-3 text-muted-foreground">{incomplete ? "Balances unavailable or incomplete; an empty account is not confirmed." : "No coin balances reported in the covered Unified wallet."}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="bybit-positions-heading" className="space-y-3">
        <h3 id="bybit-positions-heading" className="text-sm font-semibold">Derivatives positions</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <caption className="sr-only">Open derivatives positions, with separate hedge legs and native settlement P&L</caption>
            <thead className="text-muted-foreground border-b border-border/40"><tr>
              {["Symbol", "Category / settlement", "Side", "Hedge leg index", "Size", "Entry price", "Mark price", "Unrealized P&L (native)", "Leverage", "Liquidation price"].map(label => <th key={label} scope="col" className="p-2 font-medium">{label}</th>)}
            </tr></thead>
            <tbody>
              {snapshot.positions.map(position => (
                <tr key={`${position.category}-${position.symbol}-${position.position_index}`} className="border-b border-border/20">
                  <th scope="row" className="p-2 font-semibold">{position.symbol}</th>
                  <td className="p-2">{position.category} / {position.settle_coin || "Native settlement units"}</td>
                  <td className="p-2">{position.side}</td>
                  <td className="p-2">{position.position_index}</td>
                  <td className="p-2"><Decimal value={position.size} /></td>
                  <td className="p-2"><Decimal value={position.avg_price} /></td>
                  <td className="p-2"><Decimal value={position.mark_price} /></td>
                  <td className="p-2"><Decimal value={position.unrealised_pnl} /> <span>{position.settle_coin || "Native settlement units"}</span></td>
                  <td className="p-2"><Decimal value={position.leverage} /></td>
                  <td className="p-2"><Decimal value={position.liquidation_price} /></td>
                </tr>
              ))}
              {snapshot.positions.length === 0 && <tr><td colSpan={10} className="p-3 text-muted-foreground">{incomplete ? "Positions unavailable or incomplete; no-open-positions status is not confirmed." : "No open positions in the covered linear and inverse scopes."}</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">P&L stays in its settlement currency; mixed currencies are not summed. Prices and sizes use the venue’s contract units. These are account observations, not executed orders. Funding wallet and options positions are omitted.</p>
      </section>
    </div>
  );
}

/** Defense-in-depth display boundary; the server cookie remains the authorization authority. */
export function BybitAuthorizedSnapshot({ session, snapshot }: {
  session: BybitOwnerSession | null;
  snapshot: BybitAccountSnapshot | null;
}) {
  return session?.authenticated && session.login_configured && snapshot
    ? <BybitSnapshotView snapshot={snapshot} /> : null;
}

export function BybitAccessNotice({ loginConfigured }: { loginConfigured: boolean }) {
  return <p className="text-sm text-muted-foreground">{loginConfigured
    ? "Account locked. Use the separate private account password, not the public site password or a Bybit API secret. Venue credentials stay on the server."
    : "Secure login setup needed. The owner must configure a separate private account password using the server CLI before signing in. Do not enter a Bybit API key or secret here."}</p>;
}

// Never display arbitrary response bodies or request errors: they may contain private details.
export function bybitRequestError(status: number, action: "login" | "account" | "portfolio" | "session"): string {
  if (status === 401) return action === "login" ? "Private account password not accepted." : "Owner session expired. Sign in again.";
  if (status === 429) return "Too many requests. Wait before trying again.";
  if (status === 503 && action === "login") return "Secure login setup needed on the server.";
  return action === "portfolio" ? "Unable to retrieve actual spot performance. Retry when available."
    : action === "account" ? "Unable to retrieve the private account snapshot. Retry when available."
    : action === "login" ? "Unable to sign in. Please try again." : "Unable to verify the owner session. Please retry.";
}

const buttonClass = "inline-flex items-center justify-center gap-2 rounded-lg border border-border/50 px-3 py-2 text-xs font-semibold hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed";
const requestOptions = { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } } as const;

export default function BybitAccount() {
  const [session, setSession] = useState<BybitOwnerSession | null>(null);
  const [portfolio, setPortfolio] = useState<BybitSpotPortfolio | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"session" | "login" | "account" | "logout" | null>("session");
  const [error, setError] = useState<string | null>(null);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const authenticated = useRef(false);
  const lockedByUser = useRef(false);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const logoutPending = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    sequence.current += 1;
    pending.current?.abort();
    pending.current = null;
  }, []);

  const clearPrivateData = useCallback(() => {
    setPortfolio(null);
  }, []);

  const expireSession = useCallback(() => {
    authenticated.current = false;
    cancel();
    clearPrivateData();
    setBusy(null);
    setSession(previous => ({ authenticated: false, login_configured: previous?.login_configured ?? true }));
    setError(bybitRequestError(401, "account"));
  }, [cancel, clearPrivateData]);

  const load = useCallback(async (checkSession: boolean) => {
    if (document.visibilityState !== "visible" || logoutPending.current) return;
    if (!checkSession && (!authenticated.current || lockedByUser.current || pending.current)) return;
    cancel();
    const id = sequence.current;
    const controller = new AbortController();
    pending.current = controller;
    const current = () => mounted.current && sequence.current === id && !controller.signal.aborted && document.visibilityState === "visible";
    // Keep the mounted view (and its selected period/page size) during a normal
    // authorized refresh. Concealment, failures and auth changes still clear it.
    setBusy(checkSession ? "session" : "account");
    setError(null);
    if (checkSession) {
      authenticated.current = false;
      setSession(null);
      clearPrivateData();
    }
    let action: "session" | "portfolio" = checkSession ? "session" : "portfolio";
    try {
      if (checkSession) {
        const response = await fetch("/api/bybit/session", { ...requestOptions, signal: controller.signal });
        if (!current()) return;
        if (!response.ok) {
          setError(bybitRequestError(response.status, "session"));
          return;
        }
        const result: BybitOwnerSession = await response.json();
        if (!current()) return;
        const allowed = result.authenticated === true && result.login_configured === true && !lockedByUser.current;
        authenticated.current = allowed;
        setSession({ authenticated: allowed, login_configured: result.login_configured === true });
        if (!allowed) return;
      }
      action = "portfolio";
      setBusy("account");
      const response = await fetch("/api/bybit/portfolio", { ...requestOptions, signal: controller.signal });
      if (!current()) return;
      if (!response.ok) {
        clearPrivateData();
        if (response.status === 401) expireSession();
        setError(bybitRequestError(response.status, "portfolio"));
        return;
      }
      const result: BybitSpotPortfolio = await response.json();
      if (current() && authenticated.current && !lockedByUser.current) {
        setPortfolio(result);
      }
    } catch {
      if (current()) {
        clearPrivateData();
        setError(bybitRequestError(0, action));
      }
    } finally {
      if (current()) {
        pending.current = null;
        setBusy(null);
      }
    }
  }, [cancel, clearPrivateData, expireSession]);

  useEffect(() => {
    mounted.current = true;
    void load(true);
    const conceal = () => {
      cancel();
      clearPrivateData();
      setPassword("");
      if (!logoutPending.current) setBusy(null);
    };
    const visibility = () => document.visibilityState === "visible" ? void load(true) : conceal();
    const pageshow = () => { void load(true); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", pageshow);
    window.addEventListener("pagehide", conceal);
    const timer = window.setInterval(() => { void load(false); }, 60_000);
    return () => {
      mounted.current = false;
      cancel();
      logoutPending.current?.abort();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pageshow", pageshow);
      window.removeEventListener("pagehide", conceal);
      window.clearInterval(timer);
    };
  }, [cancel, clearPrivateData, load]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const length = Array.from(password).length;
    if (busy) return;
    if (length < 12 || length > 256) {
      setError("Use your private account password (12–256 characters), not an API credential.");
      return;
    }
    const body = JSON.stringify({ password });
    setPassword("");
    cancel();
    const id = sequence.current;
    const controller = new AbortController();
    pending.current = controller;
    const current = () => mounted.current && sequence.current === id && !controller.signal.aborted && document.visibilityState === "visible";
    setBusy("login");
    clearPrivateData();
    setError(null);
    try {
      const response = await fetch("/api/bybit/login", {
        ...requestOptions, method: "POST", headers: { ...requestOptions.headers, "Content-Type": "application/json" }, body, signal: controller.signal,
      });
      if (!current()) return;
      if (!response.ok) {
        authenticated.current = false;
        if (response.status === 503) setSession({ authenticated: false, login_configured: false });
        setError(bybitRequestError(response.status, "login"));
        return;
      }
      const result: { authenticated: boolean } = await response.json();
      if (!current()) return;
      if (result.authenticated !== true) {
        setError(bybitRequestError(0, "login"));
        return;
      }
      lockedByUser.current = false;
      setLogoutFailed(false);
      // Revalidate the HttpOnly owner session before any private account request.
      void load(true);
    } catch {
      if (current()) setError(bybitRequestError(0, "login"));
    } finally {
      if (current()) {
        pending.current = null;
        setBusy(null);
      }
    }
  }

  async function lock() {
    if (logoutPending.current) return;
    lockedByUser.current = true;
    authenticated.current = false;
    cancel();
    clearPrivateData();
    setPassword("");
    setSession(previous => ({ authenticated: false, login_configured: previous?.login_configured ?? true }));
    setError(null);
    setBusy("logout");
    const controller = new AbortController();
    logoutPending.current = controller;
    try {
      const response = await fetch("/api/bybit/logout", { ...requestOptions, method: "POST", signal: controller.signal });
      if (!response.ok) throw new Error("logout failed");
      if (mounted.current) setLogoutFailed(false);
    } catch {
      if (mounted.current) setLogoutFailed(true);
    } finally {
      logoutPending.current = null;
      if (mounted.current) setBusy(null);
    }
  }

  return (
    <section aria-labelledby="bybit-account-heading" className="panel p-4 md:p-6 space-y-4 border border-sky-400/30" data-private-account="bybit">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="bybit-account-heading" className="text-base font-bold text-sky-200">Investment portfolio — Bybit spot</h2>
          <p className="text-xs text-muted-foreground mt-1">Private owner access · Actual purchases, sales and trading PnL · Read-only</p>
        </div>
        {session?.authenticated && session.login_configured && <div className="flex gap-2">
          <button type="button" className={buttonClass} onClick={() => void load(false)} disabled={busy !== null}><RefreshCw size={14} />Refresh</button>
          <button type="button" className={buttonClass} onClick={() => void lock()}><LockKeyhole size={14} />Lock account</button>
        </div>}
      </div>
      {logoutFailed && <div role="alert" className="text-sm text-amber-200 space-y-2">
        <p>Account hidden on this page, but server logout could not be confirmed. The server session may still be active. Retry locking before leaving a shared device.</p>
        <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void lock()}>Retry server logout</button>
      </div>}
      {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
      {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" />{busy === "session" ? "Checking secure owner session…" : busy === "login" ? "Signing in…" : busy === "logout" ? "Revoking server session…" : "Retrieving actual spot performance…"}</p>}
      {!session && !busy && <button type="button" className={buttonClass} onClick={() => void load(true)}>Retry session check</button>}
      {session && !session.authenticated && <>
        <BybitAccessNotice loginConfigured={session.login_configured} />
        {session.login_configured ? <form onSubmit={login} className="flex flex-col sm:flex-row sm:items-end gap-3 max-w-xl">
          <input type="text" name="username" autoComplete="username" value="bybit-owner" readOnly hidden />
          <div className="flex-1">
            <label htmlFor="bybit-owner-password" className="block text-xs mb-2">Private account password</label>
            <input id="bybit-owner-password" name="password" type="password" autoComplete="current-password" minLength={12} maxLength={512} required value={password} onChange={event => setPassword(event.target.value)} disabled={busy !== null} className="w-full rounded-lg border border-border/50 bg-background p-2 text-sm" />
          </div>
          <button type="submit" className={buttonClass} disabled={busy !== null}>Unlock account</button>
        </form> : <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void load(true)}>Recheck secure login setup</button>}
      </>}
      <BybitAuthorizedSpotPerformance session={session} portfolio={portfolio} />

    </section>
  );
}
