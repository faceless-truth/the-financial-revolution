/**
 * TradeLogPanel — shows the user's manual trade history with actual vs estimated prices.
 * Price is the hero element on each row.
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

const ASSET_ICONS: Record<string, string> = {
  BTC: "₿", ETH: "Ξ", SOL: "◎", SUI: "🌊", DOGE: "Ð", CASH: "$",
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
            <h2
              className="text-xs font-semibold tracking-widest uppercase text-muted-foreground"
              style={{ fontFamily: "Geist, sans-serif" }}
            >
              My Trade Log
            </h2>
            <p className="text-xs text-muted-foreground/50 mt-0.5">
              Your actual execution prices vs strategy signal
            </p>
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
            <div key={i} className="h-16 rounded-lg shimmer" />
          ))}
        </div>
      ) : !trades || trades.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground/40">
          <BookOpen size={28} />
          <p className="text-sm font-semibold">No trades logged yet</p>
          <p className="text-xs">Tap "Log Trade" to record your actual buy or sell price</p>
        </div>
      ) : (
        <div className="space-y-2">
          {trades.map(trade => {
            const assetColor = ASSET_COLORS[trade.asset] ?? "oklch(0.55 0.010 260)";
            const isBuy = trade.tradeType === "buy";
            const buyColor = "oklch(0.72 0.18 155)";
            const sellColor = "oklch(0.62 0.22 25)";
            const actionColor = isBuy ? buyColor : sellColor;

            return (
              <div
                key={trade.id}
                className="flex items-center gap-4 p-4 rounded-xl border group transition-all"
                style={{
                  borderColor: `${actionColor}25`,
                  background: `${actionColor}08`,
                }}
              >
                {/* Left: trade type icon + asset */}
                <div className="flex flex-col items-center gap-1 shrink-0 w-10">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-base"
                    style={{
                      background: `${actionColor}18`,
                      border: `1px solid ${actionColor}30`,
                    }}
                  >
                    {isBuy
                      ? <TrendingUp size={16} style={{ color: actionColor }} />
                      : <TrendingDown size={16} style={{ color: actionColor }} />
                    }
                  </div>
                  <span className="text-xs font-bold" style={{ color: assetColor }}>
                    {ASSET_ICONS[trade.asset] ?? trade.asset}
                  </span>
                </div>

                {/* Centre: signal label + asset name + notes */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded border uppercase tracking-wide"
                      style={{
                        color: actionColor,
                        borderColor: `${actionColor}35`,
                        background: `${actionColor}12`,
                        fontSize: "10px",
                      }}
                    >
                      {trade.signalAction.replace("_", " ")}
                    </span>
                    <span
                      className="text-sm font-bold"
                      style={{ color: assetColor, fontFamily: "Syne, sans-serif" }}
                    >
                      {trade.asset}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground/50 mono-data">
                    {formatDate(trade.executedAt)}
                  </p>
                  {trade.notes && (
                    <p className="text-xs text-muted-foreground/60 mt-0.5 truncate italic">
                      "{trade.notes}"
                    </p>
                  )}
                </div>

                {/* Right: BIG price — the hero */}
                <div className="shrink-0 text-right">
                  <p className="text-xs font-semibold uppercase tracking-wider mb-0.5"
                    style={{ color: actionColor, fontSize: "9px" }}>
                    {isBuy ? "BUY PRICE" : "SELL PRICE"}
                  </p>
                  <p
                    className="text-xl font-bold mono-data leading-none"
                    style={{ color: actionColor, fontFamily: "Syne, sans-serif" }}
                  >
                    {formatPrice(trade.price)}
                  </p>
                </div>

                {/* Delete (hover) */}
                <button
                  onClick={() => deleteTrade.mutate({ id: trade.id })}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/30 hover:text-red-400 p-1 shrink-0"
                  title="Delete trade"
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
