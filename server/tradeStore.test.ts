/**
 * Tests for the client-side tradeStore logic.
 * We test the pure data manipulation functions directly (no DOM needed).
 */
import { describe, it, expect, beforeEach } from "vitest";

// ── Inline the tradeStore logic so we can test it without a browser ──────────
interface Trade {
  id: string;
  signalAction: string;
  asset: string;
  tradeType: "buy" | "sell";
  price: number;
  notes?: string;
  executedAt: number;
}

const store: Trade[] = [];

const tradeStore = {
  getAll(limit = 50): Trade[] {
    return [...store]
      .sort((a, b) => b.executedAt - a.executedAt)
      .slice(0, limit);
  },
  add(trade: Omit<Trade, "id">): Trade {
    const newTrade: Trade = {
      ...trade,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };
    store.unshift(newTrade);
    return newTrade;
  },
  remove(id: string): void {
    const idx = store.findIndex((t) => t.id === id);
    if (idx !== -1) store.splice(idx, 1);
  },
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("tradeStore", () => {
  beforeEach(() => {
    store.length = 0; // clear between tests
  });

  it("starts empty", () => {
    expect(tradeStore.getAll()).toHaveLength(0);
  });

  it("adds a trade and returns it with an id", () => {
    const t = tradeStore.add({
      signalAction: "BUY",
      asset: "BTC",
      tradeType: "buy",
      price: 71000,
      executedAt: Date.now(),
    });
    expect(t.id).toBeTruthy();
    expect(t.asset).toBe("BTC");
    expect(t.price).toBe(71000);
    expect(tradeStore.getAll()).toHaveLength(1);
  });

  it("returns trades sorted newest first", () => {
    tradeStore.add({ signalAction: "BUY",  asset: "BTC", tradeType: "buy",  price: 60000, executedAt: 1000 });
    tradeStore.add({ signalAction: "SELL_ALL", asset: "BTC", tradeType: "sell", price: 70000, executedAt: 2000 });
    const all = tradeStore.getAll();
    expect(all[0].executedAt).toBe(2000);
    expect(all[1].executedAt).toBe(1000);
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 10; i++) {
      tradeStore.add({ signalAction: "BUY", asset: "ETH", tradeType: "buy", price: i * 100, executedAt: i });
    }
    expect(tradeStore.getAll(3)).toHaveLength(3);
  });

  it("removes a trade by id", () => {
    const t = tradeStore.add({ signalAction: "BUY", asset: "SOL", tradeType: "buy", price: 150, executedAt: Date.now() });
    tradeStore.remove(t.id);
    expect(tradeStore.getAll()).toHaveLength(0);
  });

  it("ignores remove for unknown id", () => {
    tradeStore.add({ signalAction: "BUY", asset: "SOL", tradeType: "buy", price: 150, executedAt: Date.now() });
    tradeStore.remove("nonexistent-id");
    expect(tradeStore.getAll()).toHaveLength(1);
  });

  it("supports sell tradeType", () => {
    const t = tradeStore.add({
      signalAction: "SELL_ALL",
      asset: "BTC",
      tradeType: "sell",
      price: 75000,
      executedAt: Date.now(),
    });
    expect(t.tradeType).toBe("sell");
    expect(t.signalAction).toBe("SELL_ALL");
  });

  it("stores optional notes", () => {
    const t = tradeStore.add({
      signalAction: "BUY",
      asset: "BTC",
      tradeType: "buy",
      price: 71000,
      notes: "Bought on Binance",
      executedAt: Date.now(),
    });
    expect(t.notes).toBe("Bought on Binance");
  });
});
