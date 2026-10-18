/** Operator-only initial/read-only spot-history import. Never prints trades or credentials. */
import { createBybitClient, BybitReadOnlyError } from "../server/bybitReadOnly";

async function main() {
  const client = createBybitClient();
  let previous = "";
  let unchanged = 0;
  for (let pass = 1; pass <= 20; pass++) {
    const result = await client.getPortfolio({ maxSyncMs: 90_000 });
    const h = result.history;
    const progress = {
      pass, status: result.status, executions: h.execution_count,
      execution_windows_checked: h.windows_checked, execution_windows_total: h.windows_total,
      executions_complete: h.executions_complete,
      inventory_scopes: Object.keys(h.inventory_complete).length,
      inventory_scopes_complete: Object.values(h.inventory_complete).filter(Boolean).length,
      history_syncing: h.syncing, has_error: Boolean(h.error),
      holding_rows: result.holdings.length,
      known_basis_holdings: result.holdings.filter(row => row.basis_status === "known").length,
      sales: result.sales.length,
      sales_with_realized_pnl: result.sales.filter(row => row.realized_pnl !== null).length,
      warnings: Array.from(new Set(result.warnings.map(w => w.code))),
    };
    console.log(JSON.stringify(progress));
    if (h.error) throw new Error("History import needs review");
    if (!h.syncing && h.executions_complete && Object.values(h.inventory_complete).every(Boolean)) {
      console.log("Private spot-history import complete. No trades or credentials printed.");
      return;
    }
    const signature = JSON.stringify([h.execution_count, h.windows_checked, h.inventory_complete, h.last_synced_at]);
    unchanged = signature === previous ? unchanged + 1 : 0;
    if (unchanged >= 2) throw new Error("History import made no further progress");
    previous = signature;
  }
  throw new Error("History import remains incomplete after the bounded pass limit");
}
main().catch(error => {
  console.error(error instanceof BybitReadOnlyError
    ? `Read-only spot import blocked: ${error.code}. ${error.message}`
    : "Private spot-history import remains incomplete or unavailable; details suppressed.");
  process.exitCode = 1;
});
