/**
 * TFR Push Notifications — VAPID Web Push server module
 *
 * Handles:
 *  - Storing push subscriptions in a JSON file on disk
 *  - Sending push notifications to all subscribers
 *  - Scheduled notification payloads: daily rotation + 8-hourly squeeze top-3
 */

import webpush from "web-push";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── VAPID configuration ───────────────────────────────────────────────────────
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT     ?? "mailto:admin@thefinancialrevolution.com.au";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// ── Subscription storage ──────────────────────────────────────────────────────
// Subscriptions are stored in a JSON file alongside the dashboard data files.
// Each entry is a standard PushSubscription object serialised to JSON.
const DASHBOARD_ROOT   = process.env.CRYPTO_DASHBOARD_ROOT ?? "/root/crypto_dashboard";
const SUBS_FILE        = path.join(DASHBOARD_ROOT, "push_subscriptions.json");

export type StoredSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  addedAt: string;
};

function loadSubscriptions(): StoredSubscription[] {
  try {
    if (!fs.existsSync(SUBS_FILE)) return [];
    const raw = fs.readFileSync(SUBS_FILE, "utf-8");
    return JSON.parse(raw) as StoredSubscription[];
  } catch {
    return [];
  }
}

function saveSubscriptions(subs: StoredSubscription[]): void {
  try {
    fs.mkdirSync(path.dirname(SUBS_FILE), { recursive: true });
    fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2), "utf-8");
  } catch (err) {
    console.error("[Push] Failed to save subscriptions:", err);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Add a new push subscription (or update if endpoint already exists). */
export function addSubscription(sub: StoredSubscription): void {
  const subs = loadSubscriptions();
  const idx  = subs.findIndex((s) => s.endpoint === sub.endpoint);
  if (idx >= 0) {
    subs[idx] = sub; // update keys in case they rotated
  } else {
    subs.push(sub);
  }
  saveSubscriptions(subs);
  console.log(`[Push] Subscription saved. Total subscribers: ${subs.length}`);
}

/** Remove a push subscription by endpoint URL. */
export function removeSubscription(endpoint: string): void {
  const subs = loadSubscriptions().filter((s) => s.endpoint !== endpoint);
  saveSubscriptions(subs);
  console.log(`[Push] Subscription removed. Total subscribers: ${subs.length}`);
}

/** Return the VAPID public key (sent to the frontend for subscription setup). */
export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

/** Return subscriber count (for health checks). */
export function getSubscriberCount(): number {
  return loadSubscriptions().length;
}

// ── Core send function ────────────────────────────────────────────────────────

type PushPayload = Record<string, unknown>;

/**
 * Send a push notification to all subscribers.
 * Automatically removes expired/invalid subscriptions (410 Gone).
 */
export async function sendPushToAll(payload: PushPayload): Promise<{ sent: number; failed: number }> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn("[Push] VAPID keys not configured — skipping push send.");
    return { sent: 0, failed: 0 };
  }

  const subs    = loadSubscriptions();
  const expired: string[] = [];
  let sent   = 0;
  let failed = 0;

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload),
          { TTL: 86400 } // 24h TTL — deliver even if device is offline
        );
        sent++;
      } catch (err: any) {
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          // Subscription expired — mark for removal
          expired.push(sub.endpoint);
        } else {
          console.error(`[Push] Send failed for ${sub.endpoint.slice(0, 40)}...:`, err?.message);
        }
        failed++;
      }
    })
  );

  // Clean up expired subscriptions
  if (expired.length > 0) {
    const cleaned = loadSubscriptions().filter((s) => !expired.includes(s.endpoint));
    saveSubscriptions(cleaned);
    console.log(`[Push] Removed ${expired.length} expired subscription(s).`);
  }

  console.log(`[Push] Sent: ${sent}, Failed: ${failed}, Total subs: ${subs.length}`);
  return { sent, failed };
}

// ── Scheduled notification payloads ──────────────────────────────────────────

/**
 * Send the daily rotation signal notification.
 * Called once per day after the bull_rotate.py cron runs.
 */
export async function sendRotationNotification(params: {
  action: string;
  currentAsset: string;
  reason: string;
  portfolioValueUsd: number;
  totalReturnPct: number;
}): Promise<void> {
  const { action, currentAsset, reason, portfolioValueUsd, totalReturnPct } = params;

  const actionLabel = action.replace(/_/g, " ");
  const pctSign     = totalReturnPct >= 0 ? "+" : "";
  const valueStr    = portfolioValueUsd > 0
    ? ` · Portfolio $${portfolioValueUsd.toLocaleString("en-AU", { maximumFractionDigits: 0 })}`
    : "";
  const retStr      = `${pctSign}${totalReturnPct.toFixed(2)}% total return`;

  const payload: PushPayload = {
    type:           "rotation",
    asset:          currentAsset,
    action:         action,
    reason:         reason.slice(0, 120),
    portfolioValue: portfolioValueUsd,
    totalReturn:    totalReturnPct,
    url:            "/portfolio",
  };

  await sendPushToAll(payload);
}

/**
 * Send the 8-hourly squeeze scanner notification.
 * Called at 00:00, 08:00, 16:00 UTC after squeeze_scanner.py runs.
 */
export async function sendSqueezeNotification(params: {
  candidates: Array<{ symbol: string; score: number; streak_quality?: string }>;
  symbolsScanned: number;
}): Promise<void> {
  const { candidates, symbolsScanned } = params;

  if (candidates.length === 0) {
    // No candidates — send a quiet "all clear" notification
    const payload: PushPayload = {
      type:  "squeeze",
      title: "TFR Squeeze Scan — No Candidates",
      body:  `Scanned ${symbolsScanned} symbols. No squeeze setups detected right now.`,
      url:   "/portfolio",
      candidates: [],
    };
    await sendPushToAll(payload);
    return;
  }

  const top3 = candidates.slice(0, 3);
  const topSymbol = top3[0].symbol;

  const payload: PushPayload = {
    type:       "squeeze",
    title:      `TFR Squeeze: ${topSymbol} leads ${candidates.length} candidate${candidates.length > 1 ? "s" : ""}`,
    body:       "", // overridden by service worker using candidates array
    url:        "/portfolio",
    candidates: top3,
  };

  await sendPushToAll(payload);
}
