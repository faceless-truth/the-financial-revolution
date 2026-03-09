/**
 * TradeLogPanel — shows the user's manual trade history with actual vs estimated prices.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Trash2, TrendingUp, TrendingDown, BookOpen, Plus } from "lucide-react";
import { TradeEntryModal } from "./TradeEntryModal";

function formatPrice(p: number) {
  if (p >= 1000) return `$${p.toLocaleString("en-AU", { maximumFractionDigits: 0 })}`;
  if (p >= 1) return `$${p.toFixed(4)}`;
  return `$${p.toFixed(6)}`;
}

function formatDate(ms: number) {
  return new Date(ms).toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

const ASSET_COLORS: Record<string, string> = {
  BTC: "oklch(0.78 0.18 75)",
  ETH: "oklch(0.70 0.15 290)",
  SOL: "oklch(0.72 0.18 155)",
  SUI: "oklch(0.65 0.20 220)",
  DOGE: "oklch(0.78 0.18 75)",
  CASH: "oklch(0.60 0.22 255)",
};

export function TradeLogPanel() {
  const [addOpen, setAddOpen] = useState(false);
  const utils = trpc.useUtils();

  const { data: trades, isLoading } = trpc.trade.getTrades.useQuery({ limit: 50 });

  const deleteTrade = trpc.trade.deleteTrade.useMutation({
    onSuccess: () => utils.trade.getTrades.invalidate(),
  });

  return (
    <div
      className="panel p-5 flex flex-col gap-4"
      style={{ borderColor: "oklch(0.60 0.22 255 / 20%)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen size={14} className="text-primary opacity-70" />
          <div>
            <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>
              My Trade Log
            </h2>
            <p className="text-xs text-muted-foreground/50 mt-0.5">Actual execution prices vs strategy signal</p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="text-xs gap-1.5 h-7 px-2.5"
          onClick={() => setAddOpen(true)}
        >
          <Plus size={11} />
          Log Trade
        </Button>
      </div>

      {/* Trade list */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-14 rounded-lg shimmer" />
          ))}
        </div>
      ) : !trades || trades.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground/40">
          <BookOpen size={28} />
          <p className="text-xs">No trades logged yet</p>
          <p className="text-xs">Tap "Log Trade" when a signal fires to record your actual price</p>
        </div>
      ) : (
        <div className="space-y-2">
          {trades.map(trade => {
            const assetColor = ASSET_COLORS[trade.asset] ?? "oklch(0.55 0.010 260)";
            const isBuy = trade.tradeType === "buy";
            return (
              <div
                key={trade.id}
                className="flex items-center gap-3 p-3 rounded-lg border group"
                style={{ borderColor: "oklch(1 0 0 / 8%)", background: "oklch(1 0 0 / 3%)" }}
              >
                {/* Trade type icon */}
                <div
                  className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{
                    background: isBuy ? "oklch(0.72 0.18 155 / 15%)" : "oklch(0.62 0.22 25 / 15%)",
                  }}
                >
                  {isBuy
                    ? <TrendingUp size={14} style={{ color: "oklch(0.72 0.18 155)" }} />
                    : <TrendingDown size={14} style={{ color: "oklch(0.62 0.22 25)" }} />
                  }
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-bold" style={{ color: assetColor, fontFamily: "Syne, sans-serif" }}>
                      {trade.asset}
                    </span>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded border font-semibold uppercase"
                      style={{
                        color: isBuy ? "oklch(0.72 0.18 155)" : "oklch(0.62 0.22 25)",
                        borderColor: isBuy ? "oklch(0.72 0.18 155 / 30%)" : "oklch(0.62 0.22 25 / 30%)",
                        background: isBuy ? "oklch(0.72 0.18 155 / 10%)" : "oklch(0.62 0.22 25 / 10%)",
                        fontSize: "10px",
                      }}
                    >
                      {trade.signalAction.replace("_", " ")}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold mono-data text-foreground">
                      {formatPrice(trade.price)}
                    </span>
                    <span className="text-xs text-muted-foreground/50 mono-data">
                      {formatDate(trade.executedAt)}
                    </span>
                  </div>
                  {trade.notes && (
                    <p className="text-xs text-muted-foreground/60 mt-0.5 truncate">{trade.notes}</p>
                  )}
                </div>

                {/* Delete */}
                <button
                  onClick={() => deleteTrade.mutate({ id: trade.id })}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/40 hover:text-red-400 p-1"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Quick-add modal (manual entry without a signal) */}
      <TradeEntryModal
        isOpen={addOpen}
        onClose={() => { setAddOpen(false); utils.trade.getTrades.invalidate(); }}
        signalAction="BUY"
        targetAsset="BTC"
      />
    </div>
  );
}
