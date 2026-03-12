/**
 * tradeStore — client-side trade log persisted in localStorage.
 * Replaces the server-side tRPC/DB trade router so the live static site works.
 */

export interface Trade {
  id: string;
  signalAction: string;
  asset: string;
  tradeType: "buy" | "sell";
  price: number;
  notes?: string;
  executedAt: number; // UTC ms
}

const STORAGE_KEY = "tfr_trades_v1";

function readAll(): Trade[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Trade[];
  } catch {
    return [];
  }
}

function writeAll(trades: Trade[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
  } catch {
    // localStorage unavailable (Safari Private) — silently ignore
  }
}

export const tradeStore = {
  getAll(limit = 50): Trade[] {
    return readAll()
      .sort((a, b) => b.executedAt - a.executedAt)
      .slice(0, limit);
  },

  add(trade: Omit<Trade, "id">): Trade {
    const newTrade: Trade = {
      ...trade,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };
    const all = readAll();
    writeAll([newTrade, ...all]);
    return newTrade;
  },

  remove(id: string): void {
    const all = readAll().filter((t) => t.id !== id);
    writeAll(all);
  },
};
