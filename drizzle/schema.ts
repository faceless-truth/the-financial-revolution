import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Push notification subscriptions
export const pushSubscriptions = mysqlTable("push_subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = typeof pushSubscriptions.$inferInsert;

// Last known signal state (for change detection)
export const signalState = mysqlTable("signal_state", {
  id: int("id").autoincrement().primaryKey(),
  action: varchar("action", { length: 32 }).notNull(),
  ruleTriggered: varchar("ruleTriggered", { length: 64 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type SignalState = typeof signalState.$inferSelect;

// Manual trade log — user records their actual buy/sell prices
import { decimal, bigint } from "drizzle-orm/mysql-core";
export const tradeLog = mysqlTable("trade_log", {
  id: int("id").autoincrement().primaryKey(),
  signalAction: varchar("signalAction", { length: 32 }).notNull(),  // BUY / SELL_ALL / ROTATE etc
  asset: varchar("asset", { length: 16 }).notNull(),                // BTC / ETH / CASH etc
  tradeType: mysqlEnum("tradeType", ["buy", "sell"]).notNull(),
  price: decimal("price", { precision: 20, scale: 8 }).notNull(),   // actual execution price
  notes: text("notes"),
  executedAt: bigint("executedAt", { mode: "number" }).notNull(),   // UTC ms timestamp
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type TradeLog = typeof tradeLog.$inferSelect;
export type InsertTradeLog = typeof tradeLog.$inferInsert;
