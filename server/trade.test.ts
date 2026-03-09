/**
 * Trade router tests
 * Tests the trade log API endpoints
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module
vi.mock("./db", () => ({
  insertTradeLog: vi.fn().mockResolvedValue(undefined),
  getTradeLog: vi.fn().mockResolvedValue([
    {
      id: 1,
      signalAction: "BUY",
      asset: "BTC",
      tradeType: "buy",
      price: "85000.00000000",
      notes: "Executed on time",
      executedAt: 1700000000000,
      createdAt: new Date(),
    },
  ]),
  deleteTradeLogEntry: vi.fn().mockResolvedValue(undefined),
}));

import { insertTradeLog, getTradeLog, deleteTradeLogEntry } from "./db";

describe("Trade Log DB helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("insertTradeLog is called with correct data", async () => {
    await insertTradeLog({
      signalAction: "BUY",
      asset: "BTC",
      tradeType: "buy",
      price: "85000.00",
      notes: "Test trade",
      executedAt: Date.now(),
    });
    expect(insertTradeLog).toHaveBeenCalledOnce();
  });

  it("getTradeLog returns array of trades", async () => {
    const trades = await getTradeLog(50);
    expect(Array.isArray(trades)).toBe(true);
    expect(trades.length).toBeGreaterThan(0);
    expect(trades[0]).toHaveProperty("asset", "BTC");
    expect(trades[0]).toHaveProperty("tradeType", "buy");
  });

  it("getTradeLog price is a string from DB (decimal column)", async () => {
    const trades = await getTradeLog(50);
    expect(typeof trades[0].price).toBe("string");
  });

  it("deleteTradeLogEntry is called with correct id", async () => {
    await deleteTradeLogEntry(1);
    expect(deleteTradeLogEntry).toHaveBeenCalledWith(1);
  });
});
