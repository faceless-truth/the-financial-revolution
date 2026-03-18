from pathlib import Path
import sys

root = Path('/home/ubuntu/the-financial-revolution-work')
live_path = root / 'server/livePortfolio.ts'
home_path = root / 'client/src/pages/Home.tsx'
portfolio_path = root / 'client/src/pages/Portfolio.tsx'

live = live_path.read_text()
home = home_path.read_text()
portfolio = portfolio_path.read_text()

if 'function computePlanningState(' not in live:
    marker = 'export async function getLivePortfolioData() {'
    idx = live.find(marker)
    if idx == -1:
        print('livePortfolio marker not found', file=sys.stderr)
        sys.exit(1)
    helper = '''function toDate(value: any) {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}
function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
function formatDateUtc(date: Date) {
  return date.toISOString().slice(0, 10);
}
function humanDateUtc(date: Date) {
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
function inferCandidateAsset(strategy: any, topCandidates: any[]) {
  const direct = asString(strategy?.topAsset ?? strategy?.targetAsset ?? strategy?.candidateAsset ?? "", "");
  if (direct) return direct;
  if (Array.isArray(topCandidates) && topCandidates.length) {
    return asString(topCandidates[0]?.asset ?? topCandidates[0]?.symbol ?? "", "");
  }
  return "";
}
function inferLatestThirtyDayHighDate(state: any, strategy: any, history: any[]) {
  const candidates = [
    state?.latest_30d_high_date,
    state?.latest30dHighDate,
    state?.btc_latest_30d_high_date,
    state?.btcLatest30dHighDate,
    strategy?.latest30dHighDate,
    strategy?.latest_30d_high_date,
    strategy?.btcLatest30dHighDate,
    strategy?.btc_latest_30d_high_date,
    strategy?.rallyBlock?.latest30dHighDate,
    strategy?.rally_block?.latest_30d_high_date,
  ];
  for (const value of candidates) {
    const d = toDate(value);
    if (d) return d;
  }
  if (Array.isArray(history)) {
    for (const row of [...history].reverse()) {
      const reason = String(row?.reason ?? row?.ruleReason ?? row?.notes ?? "");
      if (/new\s+30d\s+high|30d\s+high/i.test(reason)) {
        const d = toDate(row?.timestamp ?? row?.date);
        if (d) return d;
      }
    }
  }
  return null;
}
function inferRule4Readiness(strategy: any, scenarios: any) {
  const values = [
    strategy?.rule4Pass,
    strategy?.rule4Passed,
    strategy?.rule4?.passed,
    strategy?.breakoutConfirmationPassed,
    strategy?.breakout_confirmation_passed,
    strategy?.preparation?.rule4Passed,
    strategy?.preparation?.breakoutReady,
    scenarios?.rule4Pass,
    scenarios?.rule4Passed,
  ];
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  const textCandidates = [
    asString(strategy?.preparation?.note ?? "", ""),
    asString(strategy?.reason ?? "", ""),
    asString(scenarios?.summary ?? "", ""),
  ].join(" ");
  if (/rule\s*4/i.test(textCandidates) && /pass|passed|ready/i.test(textCandidates)) return true;
  if (/rule\s*4/i.test(textCandidates) && /fail|failed|block/i.test(textCandidates)) return false;
  return null;
}
function computePlanningState(state: any, strategy: any, history: any[], scenarios: any, topCandidates: any[]) {
  const currentAsset = asString(state?.current_asset ?? state?.currentAsset ?? state?.current_position ?? "CASH", "CASH");
  const holdDays = toNumber(state?.hold_days ?? state?.holdDays ?? 0, 0);
  const candidateAsset = inferCandidateAsset(strategy, topCandidates);
  const latestHighDate = inferLatestThirtyDayHighDate(state, strategy, history);
  const latestHighDateIso = latestHighDate ? formatDateUtc(latestHighDate) : "";
  const currentRuleReason = asString(state?.reason ?? state?.rule_reason ?? strategy?.reason ?? "", "");
  const rule3Active = /rule\s*3|30d\s+high|new\s+30d\s+high/i.test(currentRuleReason);
  const rule2Active = /rule\s*2|minimum\s+hold|hold\s*days|7-day\s+minimum/i.test(currentRuleReason);
  const rule4Ready = inferRule4Readiness(strategy, scenarios);
  const earliestEligibleRunUtc = latestHighDate ? addDays(latestHighDate, 4) : null;
  const blockExpiresAfterCloseUtc = latestHighDate ? addDays(latestHighDate, 3) : null;
  let currentBlocker = "Monitoring for next eligible rotation window";
  if (rule2Active) currentBlocker = "Rule 2: 7-day minimum hold still active";
  else if (rule3Active) currentBlocker = "Rule 3: BTC new 30d high still inside 3-candle window";
  else if (rule4Ready === false) currentBlocker = "Rule 4: target asset breakout confirmation not yet satisfied";
  let nextActionSummary = currentBlocker;
  if (rule3Active && earliestEligibleRunUtc && candidateAsset) {
    nextActionSummary = `Earliest possible rotation into ${candidateAsset} is ${humanDateUtc(earliestEligibleRunUtc)} UTC, provided BTC does not print another 30d high before then and Rule 4 passes.`;
  } else if (rule2Active && candidateAsset) {
    nextActionSummary = `Hold discipline remains active; ${candidateAsset} cannot rotate in until the minimum hold window clears.`;
  } else if (rule4Ready === false && candidateAsset) {
    nextActionSummary = `${candidateAsset} is the leading candidate, but Rule 4 breakout confirmation still needs to pass.`;
  } else if (candidateAsset) {
    nextActionSummary = `${candidateAsset} is currently the leading candidate if all rotation gates remain clear.`;
  }
  return {
    currentBlocker,
    rule2Active,
    rule3Active,
    rule4Ready,
    latestThirtyDayHighDateUtc: latestHighDateIso,
    blockExpiresAfterCloseUtc: blockExpiresAfterCloseUtc ? blockExpiresAfterCloseUtc.toISOString() : "",
    earliestEligibleRunUtc: earliestEligibleRunUtc ? earliestEligibleRunUtc.toISOString() : "",
    earliestEligibleRunLabel: earliestEligibleRunUtc ? humanDateUtc(earliestEligibleRunUtc) : "Watching next close",
    candidateAsset,
    currentAsset,
    holdDays,
    nextActionSummary,
  };
}

'''
    live = live[:idx] + helper + live[idx:]

live = live.replace(
    '  const topCandidates = Array.isArray(strategy?.topCandidates)\n    ? strategy.topCandidates\n    : Array.isArray(strategy?.momentumRanked)\n      ? strategy.momentumRanked\n      : [];\n  return {',
    '  const topCandidates = Array.isArray(strategy?.topCandidates)\n    ? strategy.topCandidates\n    : Array.isArray(strategy?.momentumRanked)\n      ? strategy.momentumRanked\n      : [];\n  const planning = computePlanningState(state, strategy, history, scenarios, topCandidates);\n  return {'
)
live = live.replace(
    '    preparation: {\n      readiness: asString(strategy?.readiness ?? strategy?.preparation?.readiness ?? "WATCH", "WATCH"),\n      label: asString(strategy?.preparation?.label ?? strategy?.readiness ?? "Watch", "Watch"),\n      note: asString(strategy?.preparation?.note ?? strategy?.reason ?? ruleReason, ruleReason),\n      targetAsset: asString(strategy?.topAsset ?? strategy?.targetAsset ?? "", ""),\n      topCandidates,\n      scenario: scenarios ?? {},\n    },\n    tradeHistory:',
    '    preparation: {\n      readiness: asString(strategy?.readiness ?? strategy?.preparation?.readiness ?? "WATCH", "WATCH"),\n      label: asString(strategy?.preparation?.label ?? strategy?.readiness ?? "Watch", "Watch"),\n      note: asString(strategy?.preparation?.note ?? strategy?.reason ?? ruleReason, ruleReason),\n      targetAsset: asString(strategy?.topAsset ?? strategy?.targetAsset ?? "", ""),\n      topCandidates,\n      scenario: scenarios ?? {},\n    },\n    planning,\n    tradeHistory:'
)
live = live.replace(
    '    preparation: snapshot.preparation,\n    tradeHistory: snapshot.tradeHistory,\n    source: snapshot.source,\n  };',
    '    preparation: snapshot.preparation,\n    planning: snapshot.planning,\n    tradeHistory: snapshot.tradeHistory,\n    source: snapshot.source,\n  };'
)

if 'type PlanningState = {' not in home:
    home = home.replace('type DashboardSnapshot = {\n', 'type PlanningState = {\n  currentBlocker?: string;\n  rule2Active?: boolean;\n  rule3Active?: boolean;\n  rule4Ready?: boolean | null;\n  latestThirtyDayHighDateUtc?: string;\n  blockExpiresAfterCloseUtc?: string;\n  earliestEligibleRunUtc?: string;\n  earliestEligibleRunLabel?: string;\n  candidateAsset?: string;\n  currentAsset?: string;\n  holdDays?: number;\n  nextActionSummary?: string;\n};\n\ntype DashboardSnapshot = {\n')
    home = home.replace('  preparation?: {\n    readiness?: string;\n    targetAsset?: string;\n    note?: string;\n  };\n', '  preparation?: {\n    readiness?: string;\n    targetAsset?: string;\n    note?: string;\n  };\n  planning?: PlanningState;\n')
if 'const planning = data?.planning ?? {};' not in home:
    home = home.replace('  const ranking = useMemo(() => Array.isArray(data?.ranking) ? data!.ranking! : [], [data]);\n  const history = useMemo(() => Array.isArray(data?.tradeHistory) ? data!.tradeHistory! : [], [data]);\n', '  const ranking = useMemo(() => Array.isArray(data?.ranking) ? data!.ranking! : [], [data]);\n  const history = useMemo(() => Array.isArray(data?.tradeHistory) ? data!.tradeHistory! : [], [data]);\n  const planning = data?.planning ?? {};\n')
home = home.replace(
    '<h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: \'Geist, sans-serif\' }}>What to Expect</h2>\n                </div>\n                <p className="text-sm text-muted-foreground">The dashboard now reflects the live droplet script state, including current position, hold-day progression, and most recent rule reasoning.</p>\n',
    '<h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: \'Geist, sans-serif\' }}>Rotation Readiness</h2>\n                </div>\n                <div className="space-y-3 text-sm text-muted-foreground">\n                  <p><span className="text-foreground font-semibold">Current blocker:</span> {planning.currentBlocker ?? "Monitoring live conditions"}</p>\n                  <p><span className="text-foreground font-semibold">Candidate:</span> {planning.candidateAsset ?? data.preparation?.targetAsset ?? "Watching leaders"}</p>\n                  <p><span className="text-foreground font-semibold">Earliest eligible run:</span> {planning.earliestEligibleRunLabel ?? "Watching next close"}</p>\n                  <p><span className="text-foreground font-semibold">Rule 4:</span> {planning.rule4Ready === true ? "Ready" : planning.rule4Ready === false ? "Pending confirmation" : "Monitoring"}</p>\n                  <p>{planning.nextActionSummary ?? "The dashboard now reflects the live droplet script state, including current blockers and earliest eligible rotation timing."}</p>\n                </div>\n'
)

if 'planning?: {' not in portfolio:
    portfolio = portfolio.replace('  preparation?: {\n    readiness?: string;\n    label?: string;\n    note?: string;\n    targetAsset?: string;\n    topCandidates?: Array<{ asset?: string; symbol?: string; score?: number }>;\n    scenario?: Record<string, unknown>;\n  };\n', '  preparation?: {\n    readiness?: string;\n    label?: string;\n    note?: string;\n    targetAsset?: string;\n    topCandidates?: Array<{ asset?: string; symbol?: string; score?: number }>;\n    scenario?: Record<string, unknown>;\n  };\n  planning?: {\n    currentBlocker?: string;\n    rule2Active?: boolean;\n    rule3Active?: boolean;\n    rule4Ready?: boolean | null;\n    latestThirtyDayHighDateUtc?: string;\n    blockExpiresAfterCloseUtc?: string;\n    earliestEligibleRunUtc?: string;\n    earliestEligibleRunLabel?: string;\n    candidateAsset?: string;\n    currentAsset?: string;\n    holdDays?: number;\n    nextActionSummary?: string;\n  };\n')
if 'const planning = data?.planning;' not in portfolio:
    portfolio = portfolio.replace('  const performance = data?.performance;\n  const preparation = data?.preparation;\n', '  const performance = data?.performance;\n  const preparation = data?.preparation;\n  const planning = data?.planning;\n')
if 'Rotation Readiness' not in portfolio:
    portfolio = portfolio.replace(
        '<h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>Source of Truth</h2>',
        '<h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>Rotation Readiness</h2>'
    )
    portfolio = portfolio.replace(
        '<div className="space-y-3 text-sm text-muted-foreground">\n                    <p>Source of truth: live droplet JSON data · Fixed displayed capital 71,000 USD</p>\n                    <p className="mono-data break-all">{data.source?.root ?? "/var/lib/crypto_dashboard"}</p>\n                    <p>Public dashboard now reflects the live script state rather than local browser-only calculations.</p>\n                  </div>',
        '<div className="space-y-3 text-sm text-muted-foreground">\n                    <p><span className="text-foreground font-semibold">Current blocker:</span> {planning?.currentBlocker ?? "Monitoring live conditions"}</p>\n                    <p><span className="text-foreground font-semibold">Candidate:</span> {planning?.candidateAsset ?? preparation?.targetAsset ?? "Watching leaders"}</p>\n                    <p><span className="text-foreground font-semibold">Earliest eligible run:</span> {planning?.earliestEligibleRunLabel ?? "Watching next close"}</p>\n                    <p><span className="text-foreground font-semibold">Rule 4:</span> {planning?.rule4Ready === true ? "Ready" : planning?.rule4Ready === false ? "Pending confirmation" : "Monitoring"}</p>\n                    <p>{planning?.nextActionSummary ?? "Live planning state will update as daily closes change."}</p>\n                  </div>'
    )
    portfolio = portfolio.replace(
        '<BellRing size={14} style={{ color: prep.color, opacity: 0.8 }} />',
        '<Shield size={14} style={{ color: prep.color, opacity: 0.8 }} />',
        1
    )
    source_panel = '''                <div className="panel p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <BellRing size={14} style={{ color: prep.color, opacity: 0.8 }} />
                    <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>Source of Truth</h2>
                  </div>
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <p>Source of truth: live droplet JSON data · Fixed displayed capital 71,000 USD</p>
                    <p className="mono-data break-all">{data.source?.root ?? "/var/lib/crypto_dashboard"}</p>
                    <p>Public dashboard now reflects the live script state rather than local browser-only calculations.</p>
                  </div>
                </div>'''
    portfolio = portfolio.replace('              </div>\n            </div>\n            <div className="grid lg:grid-cols-3 gap-4">', f'              </div>\n{source_panel}\n            </div>\n            <div className="grid lg:grid-cols-3 gap-4">')

live_path.write_text(live)
home_path.write_text(home)
portfolio_path.write_text(portfolio)
print('Planning-state patch written.')
