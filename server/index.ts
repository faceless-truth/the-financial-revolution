import "dotenv/config";
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { getLivePortfolioData, getLiveDashboardData, getMsbSignals, getSqueezeData } from "./livePortfolio";
import { getBullRotationDashboard } from "./bullRotation";
import {
  addSubscription,
  removeSubscription,
  getVapidPublicKey,
  getSubscriberCount,
  sendRotationNotification,
  sendSqueezeNotification,
  type StoredSubscription,
} from "./pushNotifications";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

async function startServer() {
  const app    = express();
  const server = createServer(app);

  // Parse JSON request bodies
  app.use(express.json());

  // ── Portfolio data endpoints ────────────────────────────────────────────────

  app.get("/api/live-portfolio", async (_req, res) => {
    try {
      const data = await getLivePortfolioData();
      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: "Unable to load live portfolio snapshot",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/msb-signals", async (_req, res) => {
    try {
      const data = await getMsbSignals();
      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: "Unable to load MSB signals",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/live-dashboard", async (_req, res) => {
    try {
      const data = await getLiveDashboardData();
      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: "Unable to load live dashboard snapshot",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/bull-rotation", async (_req, res) => {
    try {
      const data = await getBullRotationDashboard();
      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: "Unable to load Bull Rotation dashboard payload",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/squeeze-data", async (_req, res) => {
    try {
      const data = await getSqueezeData();
      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: "Unable to load squeeze scanner data",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ── Push notification endpoints ─────────────────────────────────────────────

  /** Return the VAPID public key so the frontend can create a PushSubscription. */
  app.get("/api/push/vapid-public-key", (_req, res) => {
    const key = getVapidPublicKey();
    if (!key) {
      return res.status(503).json({ error: "Push notifications not configured on this server." });
    }
    res.json({ publicKey: key });
  });

  /** Save a new push subscription from the browser. */
  app.post("/api/push/subscribe", (req, res) => {
    try {
      const sub = req.body as StoredSubscription;
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
        return res.status(400).json({ error: "Invalid subscription object." });
      }
      sub.addedAt = new Date().toISOString();
      addSubscription(sub);
      res.json({ ok: true, subscribers: getSubscriberCount() });
    } catch (error) {
      res.status(500).json({ error: "Failed to save subscription.", details: String(error) });
    }
  });

  /** Remove a push subscription (unsubscribe). */
  app.post("/api/push/unsubscribe", (req, res) => {
    try {
      const { endpoint } = req.body as { endpoint: string };
      if (!endpoint) return res.status(400).json({ error: "Missing endpoint." });
      removeSubscription(endpoint);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to remove subscription.", details: String(error) });
    }
  });

  /**
   * Trigger endpoint — called by the Python cron scripts after they finish.
   * The cron passes a `type` field: "rotation" or "squeeze".
   * A shared secret (NOTIFY_SECRET) prevents unauthorised triggers.
   */
  app.post("/api/push/trigger", async (req, res) => {
    try {
      const secret = process.env.NOTIFY_SECRET ?? "";
      const { type, secret: reqSecret, ...payload } = req.body as Record<string, any>;

      // Validate secret if one is configured
      if (secret && reqSecret !== secret) {
        return res.status(401).json({ error: "Unauthorised." });
      }

      if (type === "rotation") {
        await sendRotationNotification({
          action:            payload.action            ?? "HOLD",
          currentAsset:      payload.currentAsset      ?? "UNKNOWN",
          reason:            payload.reason            ?? "",
          portfolioValueUsd: Number(payload.portfolioValueUsd ?? 0),
          totalReturnPct:    Number(payload.totalReturnPct    ?? 0),
        });
        return res.json({ ok: true, type: "rotation" });
      }

      if (type === "squeeze") {
        await sendSqueezeNotification({
          candidates:     payload.candidates     ?? [],
          symbolsScanned: payload.symbolsScanned ?? 0,
        });
        return res.json({ ok: true, type: "squeeze" });
      }

      return res.status(400).json({ error: "Unknown notification type. Use 'rotation' or 'squeeze'." });
    } catch (error) {
      res.status(500).json({ error: "Failed to send notification.", details: String(error) });
    }
  });

  /** Health check — returns subscriber count and VAPID status. */
  app.get("/api/push/status", (_req, res) => {
    res.json({
      vapidConfigured: !!getVapidPublicKey(),
      subscribers:     getSubscriberCount(),
    });
  });

  // ── Static frontend ─────────────────────────────────────────────────────────

  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
