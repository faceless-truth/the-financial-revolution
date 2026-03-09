import webpush from "web-push";
import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import {
  deletePushSubscription,
  getAllPushSubscriptions,
  getSignalState,
  savePushSubscription,
  upsertSignalState,
} from "./db";

// VAPID keys — generated once, stored as env vars in production
const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ||
  "BIU5_OKzpJ93Up6ZrOJaC30eFpgKC3N2WhvPvcbmkw9uFcPyL-vAHm99MdVIkx1VE1kBz8zI8sb6XzieR5F7-jw";
const VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY || "6PK5yXQs7Y8DJgl8nrizdtrBNsJ36wYAVnHug5POAQ8";
const VAPID_SUBJECT = "mailto:admin@thefinancialrevolution.com.au";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

export const pushRouter = router({
  // Return the VAPID public key so the frontend can subscribe
  getVapidKey: publicProcedure.query(() => {
    return { publicKey: VAPID_PUBLIC_KEY };
  }),

  // Save a new push subscription from the browser
  subscribe: publicProcedure
    .input(
      z.object({
        endpoint: z.string(),
        p256dh: z.string(),
        auth: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      await savePushSubscription(input);
      return { success: true };
    }),

  // Remove a push subscription (user opted out)
  unsubscribe: publicProcedure
    .input(z.object({ endpoint: z.string() }))
    .mutation(async ({ input }) => {
      await deletePushSubscription(input.endpoint);
      return { success: true };
    }),

  // Called by the frontend when it detects a signal change
  // Sends push notifications to all subscribed devices
  notifySignalChange: publicProcedure
    .input(
      z.object({
        action: z.string(),
        ruleTriggered: z.string().nullable(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { action, ruleTriggered, reason } = input;

      // Check if the signal actually changed
      const prevState = await getSignalState();
      const signalChanged = !prevState || prevState.action !== action;

      if (!signalChanged) {
        return { sent: 0, changed: false };
      }

      // Update stored signal state
      await upsertSignalState(action, ruleTriggered ?? null);

      // Build notification payload
      const actionLabel = action.replace("_", " ");
      const prevLabel = prevState ? prevState.action.replace("_", " ") : "UNKNOWN";

      const notifPayload = JSON.stringify({
        title: `TFR Signal: ${actionLabel}`,
        body: prevState
          ? `Signal changed from ${prevLabel} → ${actionLabel}. ${reason || ""}`
          : `Strategy signal: ${actionLabel}. ${reason || ""}`,
        url: "/",
      });

      // Send to all subscribers
      const subs = await getAllPushSubscriptions();
      let sent = 0;
      const failedEndpoints: string[] = [];

      await Promise.allSettled(
        subs.map(async (sub) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
              },
              notifPayload
            );
            sent++;
          } catch (err: unknown) {
            const statusCode = (err as { statusCode?: number }).statusCode;
            // 410 Gone = subscription expired, clean it up
            if (statusCode === 410 || statusCode === 404) {
              failedEndpoints.push(sub.endpoint);
            }
            console.error("[Push] Failed to send notification:", err);
          }
        })
      );

      // Clean up expired subscriptions
      for (const endpoint of failedEndpoints) {
        await deletePushSubscription(endpoint);
      }

      return { sent, changed: true };
    }),

  // Get current stored signal state (for frontend to compare)
  getSignalState: publicProcedure.query(async () => {
    const state = await getSignalState();
    return state ? { action: state.action, ruleTriggered: state.ruleTriggered } : null;
  }),
});
