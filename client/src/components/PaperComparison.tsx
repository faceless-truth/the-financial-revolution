import React, { useEffect, useState, type ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PaperAccount, PaperComparisonPayload } from "@shared/paperComparison";

const COLORS: Record<string, string> = {
  BTC: "#f7931a", ETH: "#8a92b2", SOL: "#14f195",
  DOGE: "#c2a633", SUI: "#4da2ff", CASH: "#22c55e",
};
const CONTROL_COLOR = "#4da2ff";
const CANDIDATE_COLOR = "#f7931a";
const valid = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);
const usd = (value: number | null | undefined, price = false) => !valid(value) ? "—" :
  new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: price && Math.abs(value) < 1 ? 8 : price && Math.abs(value) < 100 ? 4 : 2,
  }).format(value);
const percent = (value: number | null | undefined, unit = "%") =>
  !valid(value) ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}${unit}`;
const count = (value: number | null | undefined) => valid(value) ? String(value) : "—";
const utc = (value: string | null | undefined) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return `${new Date(value).toISOString().slice(0, 19).replace("T", " ")} UTC`;
};

/** Timestamp-only presentation: never changes or infers recorded financial results. */
export function getPaperFreshness(
  data: PaperComparisonPayload | null | undefined,
  now = Date.now(),
): "unavailable" | "error" | "overdue" | "awaiting" | "current" | "unknown" {
  const failedAt = Date.parse(data?.last_run?.completed_at ?? "");
  const updatedAt = Date.parse(data?.last_updated_at ?? "");
  const latestRunFailed = data?.last_run?.status === "error" && Number.isFinite(failedAt) &&
    (!Number.isFinite(updatedAt) || failedAt > updatedAt);
  if (data?.health === "error" || latestRunFailed) return "error";
  if (!data?.available) return "unavailable";
  const deadline = data.stale_after ? Date.parse(data.stale_after) : NaN;
  if (data.health === "stale" || (Number.isFinite(deadline) && now > deadline)) return "overdue";
  if (data.phase === "initialized" || data.sample_days === 0) return "awaiting";
  return Number.isFinite(deadline) ? "current" : "unknown";
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-border bg-card/60 p-4 md:p-5 ${className}`}>{children}</section>;
}
function Metric({ label, value }: { label: string; value: ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium tabular-nums">{value}</dd></div>;
}
function AccountCard({ account, candidate }: { account?: PaperAccount; candidate: boolean }) {
  const invested = !!account?.position && account.position !== "CASH";
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide" style={{ color: candidate ? CANDIDATE_COLOR : CONTROL_COLOR }}>
        {candidate ? "Candidate · virtual account" : "Control · virtual account"}
      </div>
      <h3 className="mt-1 text-base font-semibold">{account?.label ?? "—"}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{account?.description ?? "Account snapshot unavailable."}</p>
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xl font-semibold" style={{ color: COLORS[account?.position ?? ""] }}>{account?.position ?? "—"}</span>
        <div className="text-right"><div className="text-xs text-muted-foreground">Total wealth</div><div className="text-2xl font-semibold tabular-nums">{usd(account?.total_wealth_usd)}</div></div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <Metric label="Portfolio value" value={usd(account?.portfolio_value_usd)} />
        <Metric label="Reserve" value={usd(account?.reserve_usd)} />
        <Metric label="Total return" value={percent(account?.return_pct)} />
        <Metric label="P&L" value={usd(account?.pnl_usd)} />
        <Metric label="Max drawdown" value={percent(account?.max_drawdown_pct)} />
        <Metric label="Transitions" value={count(account?.transition_count)} />
        <Metric label="Fees" value={usd(account?.fees_usd)} />
        <Metric label="Days held" value={invested ? count(account?.hold_days) : "—"} />
        <Metric label="Entry price" value={invested ? usd(account?.entry_price, true) : "—"} />
        <Metric label="Entry date" value={invested ? account?.entry_date ?? "—" : "—"} />
      </dl>
      <div className="mt-4 rounded-lg bg-muted/40 p-3 text-sm">
        <div className="text-xs text-muted-foreground">Last action</div>
        <div className="mt-1 break-words font-medium">{account?.last_action ?? "—"}</div>
        {account?.last_reason && <p className="mt-1 text-muted-foreground">{account.last_reason}</p>}
      </div>
      {candidate && invested && (
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
          <Metric label="Profit trail" value={account?.trail?.armed == null ? "—" : account.trail.armed ? "Armed" : "Not armed"} />
          <Metric label="Activation / distance" value={`${percent(account?.trail?.activation_pct)} / ${percent(account?.trail?.distance_pct)}`} />
          <Metric label="Peak price" value={usd(account?.trail?.peak_price, true)} />
          <Metric label="Trigger price" value={usd(account?.trail?.trigger_price, true)} />
        </dl>
      )}
    </Card>
  );
}

/** How the paper control lines up against the live script — rules, position and
 *  growth over the control's own window. Balances are deliberately absent: the
 *  control is seeded separately, so its dollar value can never equal live's. */
function LiveReference({ reference, startDate }: {
  reference?: PaperComparisonPayload["live_reference"];
  startDate?: string | null;
}) {
  if (!reference) return null;
  const matches = reference.control_matches_live;
  const verdict = matches == null ? "Unknown" : matches ? "Tracking live" : "Diverged from live";
  const verdictColor = matches == null ? "text-muted-foreground" : matches ? "text-emerald-400" : "text-amber-400";
  const gap = reference.return_gap_pp;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Control vs the live script</h3>
        <span className={`text-xs font-medium ${verdictColor}`}>{verdict}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
        <Metric label="Live position" value={reference.live_position ?? "—"} />
        <Metric label="Control position" value={reference.control_position ?? "—"} />
        <Metric label="Same rules version"
                value={reference.strategy_version_matches == null ? "—" : reference.strategy_version_matches ? "Yes" : "No"} />
        <Metric label={`Live return since ${startDate ?? "start"}`} value={percent(reference.live_return_pct)} />
        <Metric label="Control return, same window" value={percent(reference.control_return_pct)} />
        <Metric label="Control minus live"
                value={<span className={!valid(gap) ? "" : gap >= 0 ? "text-emerald-400" : "text-rose-400"}>{percent(gap, " pp")}</span>} />
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        Returns only. The control starts from its own virtual capital on {startDate ?? "its start date"}, so its
        balance is never the live account balance — a dollar comparison between the two would be meaningless.
        {reference.live_return_pct == null && " The live return is unavailable for this window, so no gap is shown."}
      </p>
    </Card>
  );
}

export default function PaperComparison({ data, now }: {
  data?: PaperComparisonPayload | null;
  /** Optional clock for deterministic rendering tests. */
  now?: number;
}) {
  const [clock, setClock] = useState(() => Date.now());
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (now != null) return;
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [now]);
  const currentTime = now ?? clock;
  const freshness = getPaperFreshness(data, currentTime);
  const overdue = data?.health === "stale" ||
    (!!data?.stale_after && currentTime > Date.parse(data.stale_after));
  const observed = valid(data?.sample_days) && data.sample_days > 0;
  const history = [...(data?.daily_history ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const rows = showAll ? history : history.slice(0, 30);
  const series = (data?.series ?? []).map(row => ({
    ...row, label: row.is_seed ? `${row.date} · Initial balance` : row.date,
  }));

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Current script vs profit-trailing paper</h2>
          <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-400">Paper only</span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Both accounts are virtual, with the same CASH starting state and starting capital.
          The control runs unchanged v5.0 rules — it is not the actual account on Dashboard.
          The candidate is the frozen 50% activation / 20% profit-trailing variant. No automatic promotion to live trading.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">Daily observations · page checks for a new snapshot every 5 minutes.</p>
      </Card>

      {freshness === "error" && (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <div role="alert" className="text-sm text-rose-400">
            <p className="font-semibold">Paper comparison update failed</p>
            <p className="mt-1">{data?.last_run?.message || data?.message || "The latest daily update could not complete."}</p>
            {data?.available && <p className="mt-1">Showing the last recorded snapshot, not a successful new observation.</p>}
          </div>
        </Card>
      )}
      {overdue && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <p role="alert" className="text-sm text-amber-400">Daily update overdue — this snapshot is stale. Expected update: {utc(data?.next_update_due_at)}. Recorded values below have not been advanced.</p>
        </Card>
      )}
      {!data?.available ? (
        <p role="status" className="rounded-lg border border-amber-500/30 p-3 text-sm text-amber-400">
          Paper comparison unavailable. {data?.message || "No paired snapshot has been published yet."} No legacy results are substituted.
        </p>
      ) : (
        <>
          {data.live_reference?.strategy_version_matches === false && (
            <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-400">
              The control is frozen at v5.0 and no longer matches the live current version ({data.live_reference.strategy_version ?? "—"}). This remains a comparison of the original frozen pair.
            </p>
          )}
          {data.live_reference?.position_matches === false && (
            <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-400">
              The control holds {data.live_reference.control_position ?? "—"} while the live script holds {data.live_reference.live_position ?? "—"}.
              The two books entered on different dates, so their minimum-hold gates and stops arm at different times. Same rules, different state — not a rules difference.
            </p>
          )}
          <LiveReference reference={data.live_reference} startDate={data.start_date} />
          {(data.phase === "initialized" || data.sample_days === 0) && (
            <Card className="border-primary/30">
              <h3 className="font-semibold">Awaiting first daily observation</h3>
              <p className="mt-1 text-sm text-muted-foreground">Initial balances only — no performance observations or leader yet. First observation due: {utc(data.next_update_due_at)}.</p>
            </Card>
          )}
          <Card>
            <p className="mb-3 text-sm text-muted-foreground">{data.message || "—"}</p>
            <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
              <Metric label="Starting capital · each" value={usd(data.starting_capital_usd)} />
              <Metric label="Starting date" value={data.start_date ?? "—"} />
              <Metric label="Latest observation date" value={data.last_observation_date ?? "—"} />
              <Metric label="Latest quote time" value={utc(data.last_quote_at)} />
              <Metric label="Last updated" value={utc(data.last_updated_at)} />
              <Metric label="Daily schedule (UTC)" value={data.schedule_utc || "—"} />
              <Metric label="Next observation due" value={utc(data.next_update_due_at)} />
              <Metric label="Observation days" value={count(data.sample_days)} />
              <Metric label="Divergence days" value={count(data.divergence_days)} />
              <Metric label="Profit-trail exits" value={count(data.trail_exit_count)} />
              <Metric label="Snapshot published" value={utc(data.generated_at)} />
              <Metric label="Freshness" value={{ unavailable: "Unavailable", error: "Update failed", overdue: "Overdue", awaiting: "Awaiting observation", current: "Within update window", unknown: "—" }[freshness]} />
            </dl>
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            <AccountCard account={data.accounts?.control} candidate={false} />
            <AccountCard account={data.accounts?.candidate} candidate />
          </div>
          {observed && (
            <Card>
              <h3 className="text-sm font-semibold">Candidate minus control</h3>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-lg tabular-nums">
                <span>{usd(data.comparison?.lead_usd)}</span>
                <span>{percent(data.comparison?.lead_return_pp, " pp")}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Recorded wealth difference and total-return difference in percentage points (pp). Positive favours the candidate; negative favours the control. This is not a promotion verdict.</p>
            </Card>
          )}
          {observed && series.some(row => !row.is_seed) && (
            <Card>
              <h3 className="text-sm font-semibold">Recorded paper equity</h3>
              <div className="mt-2 flex flex-wrap gap-4 text-xs">
                <span style={{ color: CONTROL_COLOR }}>Control</span><span style={{ color: CANDIDATE_COLOR }}>Candidate</span>
              </div>
              <div className="mt-3 h-64 w-full" role="img" aria-label="Recorded total wealth for the two virtual accounts">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" opacity={0.25} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={35} />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={85} tickFormatter={value => usd(value)} />
                    <Tooltip formatter={(value: number) => usd(value)} contentStyle={{ background: "rgba(20,20,28,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
                    <Line type="linear" dataKey="control" name="Control" stroke={CONTROL_COLOR} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} connectNulls={false} />
                    <Line type="linear" dataKey="candidate" name="Candidate" stroke={CANDIDATE_COLOR} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-muted-foreground">The seed is labelled Initial balance, not an observation. Only recorded forward values are plotted.</p>
            </Card>
          )}
          <Card>
            <h3 className="mb-3 text-sm font-semibold">Daily paired history · newest first</h3>
            {!history.length ? <p className="text-sm text-muted-foreground">No daily observations recorded yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-sm">
                  <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-3 pr-4" scope="col">Date (UTC)</th>
                    <th className="py-3 pr-4" scope="col">Control · position / action / NAV</th>
                    <th className="py-3 pr-4" scope="col">Candidate · position / action / NAV</th>
                    <th className="py-3 text-right" scope="col">Candidate − control</th>
                  </tr></thead>
                  <tbody>{rows.map(row => (
                    <tr key={row.date} className="border-b border-border/40 align-top last:border-0">
                      <td className="py-3 pr-4"><div className="whitespace-nowrap font-medium">{row.date}</div><div className="mt-1 text-xs text-muted-foreground">Signal: {row.signal_date ?? "—"}</div>{row.quote_at && <div className="mt-1 text-xs text-muted-foreground">Quote: {utc(row.quote_at)}</div>}</td>
                      {(["control", "candidate"] as const).map(id => (
                        <td key={id} className="py-3 pr-4"><div style={{ color: COLORS[row[id]?.position] }}>{row[id]?.position ?? "—"}</div><div className="mt-1 font-medium">{row[id]?.action ?? "—"}</div><div className="mt-1 tabular-nums">{usd(row[id]?.wealth)}</div>{row[id]?.reason && <div className="mt-1 text-xs text-muted-foreground">{row[id].reason}</div>}</td>
                      ))}
                      <td className="py-3 text-right tabular-nums"><div>{usd(row.lead_usd)}</div><div className="mt-1 text-xs text-muted-foreground">{percent(row.lead_return_pp, " pp")}</div>{row.divergent && <div className="mt-1 text-xs text-amber-400">Diverged</div>}{row.trail_exit && <div className="mt-1 text-xs text-amber-400">Trail exit</div>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {history.length > 30 && <button type="button" aria-expanded={showAll} onClick={() => setShowAll(value => !value)} className="mt-3 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground">{showAll ? "Show fewer" : `Show all ${history.length} days`}</button>}
          </Card>
          {!!data.notes?.length && <Card><h3 className="mb-2 text-sm font-semibold">Comparison notes</h3><ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">{data.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></Card>}
        </>
      )}
    </div>
  );
}
