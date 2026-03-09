import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { deleteTradeLogEntry, getTradeLog, insertTradeLog } from "./db";

export const tradeRouter = router({
  // Log a manual trade entry
  logTrade: publicProcedure
    .input(
      z.object({
        signalAction: z.string(),      // e.g. "BUY", "SELL_ALL", "ROTATE"
        asset: z.string(),             // e.g. "BTC", "ETH", "CASH"
        tradeType: z.enum(["buy", "sell"]),
        price: z.number().positive(),  // actual execution price in USD
        notes: z.string().optional(),
        executedAt: z.number(),        // UTC ms timestamp
      })
    )
    .mutation(async ({ input }) => {
      await insertTradeLog({
        signalAction: input.signalAction,
        asset: input.asset,
        tradeType: input.tradeType,
        price: input.price.toString(),
        notes: input.notes ?? null,
        executedAt: input.executedAt,
      });
      return { success: true };
    }),

  // Get the trade log (most recent first)
  getTrades: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
    .query(async ({ input }) => {
      const trades = await getTradeLog(input?.limit ?? 50);
      return trades.map(t => ({
        ...t,
        price: parseFloat(t.price),  // convert decimal string back to number
      }));
    }),

  // Delete a trade entry
  deleteTrade: publicProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      await deleteTradeLogEntry(input.id);
      return { success: true };
    }),
});
