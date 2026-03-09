/**
 * TradeEntryModal — appears when a strategy signal fires.
 * Lets the user log the actual price they executed at (vs the estimated signal price).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { CheckCircle, X, DollarSign, FileText, Clock } from "lucide-react";

interface TradeEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  signalAction: string;       // e.g. "BUY", "SELL_ALL", "ROTATE"
  targetAsset: string;        // e.g. "BTC", "ETH", "CASH"
  estimatedPrice?: number;    // the live price at signal time
}

const ACTION_LABELS: Record<string, { label: string; tradeType: "buy" | "sell"; color: string }> = {
  BUY:      { label: "Buy",       tradeType: "buy",  color: "oklch(0.72 0.18 155)" },
  ROTATE:   { label: "Rotate",    tradeType: "buy",  color: "oklch(0.78 0.18 75)" },
  REBALANCE:{ label: "Rebalance", tradeType: "buy",  color: "oklch(0.60 0.22 255)" },
  SELL_ALL: { label: "Sell All",  tradeType: "sell", color: "oklch(0.62 0.22 25)" },
  HOLD:     { label: "Hold",      tradeType: "buy",  color: "oklch(0.55 0.010 260)" },
};

export function TradeEntryModal({ isOpen, onClose, signalAction, targetAsset, estimatedPrice }: TradeEntryModalProps) {
  const [price, setPrice] = useState(estimatedPrice ? estimatedPrice.toFixed(2) : "");
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const logTrade = trpc.trade.logTrade.useMutation({
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        onClose();
      }, 1500);
    },
  });

  const meta = ACTION_LABELS[signalAction] ?? ACTION_LABELS["BUY"];
  const isHighPrice = parseFloat(price) > 100;

  const handleSubmit = () => {
    const parsedPrice = parseFloat(price);
    if (!parsedPrice || parsedPrice <= 0) return;
    logTrade.mutate({
      signalAction,
      asset: targetAsset,
      tradeType: meta.tradeType,
      price: parsedPrice,
      notes: notes.trim() || undefined,
      executedAt: Date.now(),
    });
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "oklch(0 0 0 / 70%)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border p-6 flex flex-col gap-5"
        style={{
          background: "oklch(0.11 0.015 255)",
          borderColor: "oklch(1 0 0 / 12%)",
          boxShadow: "0 24px 64px oklch(0 0 0 / 60%)",
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-xs font-bold px-2.5 py-1 rounded-md border uppercase tracking-wider"
                style={{ color: meta.color, borderColor: `${meta.color}40`, background: `${meta.color}15` }}
              >
                {meta.label}
              </span>
              <span className="text-sm font-bold text-foreground" style={{ fontFamily: "Syne, sans-serif" }}>
                {targetAsset}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Log your actual execution price</p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground/50 hover:text-foreground transition-colors p-1"
          >
            <X size={16} />
          </button>
        </div>

        {/* Estimated price reference */}
        {estimatedPrice && (
          <div
            className="flex items-center justify-between px-3 py-2 rounded-lg border"
            style={{ borderColor: "oklch(1 0 0 / 8%)", background: "oklch(1 0 0 / 4%)" }}
          >
            <span className="text-xs text-muted-foreground">Dashboard price at signal</span>
            <span className="text-xs font-semibold mono-data text-foreground/70">
              ${estimatedPrice.toLocaleString("en-AU", { minimumFractionDigits: isHighPrice ? 0 : 4, maximumFractionDigits: isHighPrice ? 0 : 6 })}
            </span>
          </div>
        )}

        {/* Price input */}
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground flex items-center gap-1.5">
            <DollarSign size={11} />
            Your execution price (USD)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
            <input
              type="number"
              step="any"
              min="0"
              value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder={estimatedPrice ? estimatedPrice.toFixed(2) : "0.00"}
              className="w-full pl-7 pr-3 py-2.5 rounded-lg border text-sm font-semibold mono-data text-foreground bg-transparent focus:outline-none focus:ring-1"
              style={{
                borderColor: "oklch(1 0 0 / 15%)",
                background: "oklch(1 0 0 / 5%)",
              }}
              autoFocus
            />
          </div>
          {estimatedPrice && price && parseFloat(price) > 0 && (
            <p className="text-xs mono-data" style={{
              color: parseFloat(price) > estimatedPrice
                ? "oklch(0.62 0.22 25)"
                : "oklch(0.72 0.18 155)"
            }}>
              {parseFloat(price) > estimatedPrice ? "▲" : "▼"}{" "}
              {Math.abs(((parseFloat(price) - estimatedPrice) / estimatedPrice) * 100).toFixed(2)}%{" "}
              {parseFloat(price) > estimatedPrice ? "above" : "below"} dashboard price
            </p>
          )}
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground flex items-center gap-1.5">
            <FileText size={11} />
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. Executed 2h late due to travel, slippage on Binance..."
            rows={2}
            className="w-full px-3 py-2 rounded-lg border text-xs text-foreground bg-transparent focus:outline-none focus:ring-1 resize-none"
            style={{
              borderColor: "oklch(1 0 0 / 15%)",
              background: "oklch(1 0 0 / 5%)",
            }}
          />
        </div>

        {/* Timestamp note */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
          <Clock size={10} />
          <span>Will be logged at {new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney", hour12: true })}</span>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1 text-xs"
            onClick={onClose}
            disabled={logTrade.isPending || saved}
          >
            Skip
          </Button>
          <Button
            className="flex-1 text-xs font-bold"
            onClick={handleSubmit}
            disabled={!price || parseFloat(price) <= 0 || logTrade.isPending || saved}
            style={{ background: saved ? "oklch(0.72 0.18 155)" : meta.color }}
          >
            {saved ? (
              <span className="flex items-center gap-1.5"><CheckCircle size={13} /> Saved!</span>
            ) : logTrade.isPending ? (
              "Saving..."
            ) : (
              "Log Trade"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
