import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, InsertPushSubscription, InsertTradeLog, appSettings, pushSubscriptions, signalState, tradeLog, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Push notification helpers
export async function savePushSubscription(sub: InsertPushSubscription): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Upsert by endpoint
  await db.insert(pushSubscriptions)
    .values(sub)
    .onDuplicateKeyUpdate({ set: { p256dh: sub.p256dh, auth: sub.auth } });
}

export async function getAllPushSubscriptions() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pushSubscriptions);
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function getSignalState() {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(signalState).limit(1);
  return rows.length > 0 ? rows[0] : null;
}

export async function upsertSignalState(action: string, ruleTriggered: string | null): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await getSignalState();
  if (existing) {
    await db.update(signalState)
      .set({ action, ruleTriggered: ruleTriggered ?? null })
      .where(eq(signalState.id, existing.id));
  } else {
    await db.insert(signalState).values({ action, ruleTriggered: ruleTriggered ?? null });
  }
}

// Trade log helpers
export async function insertTradeLog(entry: InsertTradeLog): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(tradeLog).values(entry);
}

export async function getTradeLog(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tradeLog).orderBy(desc(tradeLog.executedAt)).limit(limit);
}

export async function deleteTradeLogEntry(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(tradeLog).where(eq(tradeLog.id, id));
}

// App settings helpers
export async function getAppSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return rows.length > 0 ? rows[0].value : null;
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(appSettings)
    .values({ key, value })
    .onDuplicateKeyUpdate({ set: { value } });
}
