import React from "react";
import type { CandidateWatchPayload } from "@shared/candidateWatch";

const valid = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);
const pct = (v: number | null | undefined, unit = "%") =>
  !valid(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}${unit}`;

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** The forward paper candidate under watch, judged against live on the window
 *  they actually share. Balances are never shown side by side: the book starts
 *  on its own virtual capital, so only returns are comparable. */
export default function CandidateWatch({ data }: { data?: CandidateWatchPayload | null }) {
  if (!data) return null;
  const gap = data.gap_pp;
  const target = data.divergence_target ?? 10;
  const done = data.divergent_days ?? 0;
  const progress = Math.min(100, target > 0 ? (done / target) * 100 : 0);
  const b = data.backtest;

  return (
    <section className="rounded-xl border border-primary/40 bg-primary/5 p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-primary">Candidate under test</div>
          <h2 className="mt-1 text-lg font-semibold">{data.label}</h2>
        </div>
        <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-400">
          Paper only · not live
        </span>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">{data.plain_summary}</p>

      {!data.available ? (
        <p role="status" className="mt-4 rounded-lg border border-amber-500/30 p-3 text-sm text-amber-400">
          {data.message || "No result published yet."}
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Candidate" value={data.candidate_position ?? "—"}
                  sub={`${pct(data.candidate_return_pct)} since ${data.start_date ?? "start"}`} />
            <Stat label="Your live script" value={data.live_position ?? "—"}
                  sub={`${pct(data.live_return_pct)} same window`} />
            <Stat label="Candidate vs live"
                  value={<span className={!valid(gap) ? "" : gap >= 0 ? "text-emerald-400" : "text-rose-400"}>{pct(gap, " pp")}</span>}
                  sub="Returns only — see note" />
            <Stat label="Days running" value={data.days_running ?? "—"}
                  sub={data.as_of_date ? `as of ${data.as_of_date}` : undefined} />
          </div>

          <div className="mt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">Evidence collected</span>
              <span className="tabular-nums text-muted-foreground">
                {done} of {target} days where it disagreed with live
                {valid(data.rotations) && ` · ${data.rotations} of ${data.rotation_target ?? 1} rotations`}
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Only days it disagrees with live carry information. Matching days prove nothing either way.
            </p>
          </div>

          <div className="mt-4 rounded-lg border border-primary/30 bg-background/40 p-3">
            <div className="text-xs uppercase tracking-wide text-primary">Possible go-live</div>
            <p className="mt-1 text-sm font-medium">
              {data.gate_met ? "Enough evidence collected — ready for review." : data.decision_window ?? "—"}
              <span className="font-normal text-muted-foreground"> · pending performance</span>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{data.note}</p>
          </div>

          {b && (
            <details className="mt-4 rounded-lg border border-border/60 bg-background/30 p-3">
              <summary className="cursor-pointer text-sm font-medium">Why it is being tested (historical, not live)</summary>
              <p className="mt-2 text-sm text-muted-foreground">{b.summary}</p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <Stat label="Return, 3yr history" value={pct(b.candidate_return_pct)} sub={`live ${pct(b.live_return_pct)}`} />
                <Stat label="Worst loss" value={pct(b.candidate_maxdd_pct)} sub={`live ${pct(b.live_maxdd_pct)}`} />
                <Stat label="Test periods won" value={`${b.windows_won ?? "—"} of ${b.windows ?? "—"}`} />
                <Stat label="Confidence score" value={valid(b.dsr) ? b.dsr.toFixed(3) : "—"}
                      sub={`needs ${valid(b.dsr_bar) ? b.dsr_bar.toFixed(2) : "0.95"} to promote`} />
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                Past results on historical data. The confidence score is below the bar you set, which is
                exactly why this is on paper rather than live.
              </p>
            </details>
          )}
        </>
      )}
    </section>
  );
}
