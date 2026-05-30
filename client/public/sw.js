/* TFR Service Worker v3.0 — VAPID Web Push + offline caching */
const CACHE_NAME = "TFR_CACHE_V5";
const TFR_ICON   = "https://d2xsxph8kpxj0f.cloudfront.net/310519663335455300/f7qptPGnBE9WgCNPQkiCv7/tfr-icon_467cb428.png";

// ── Install: skip waiting immediately ────────────────────────────────────────
self.addEventListener("install", () => { self.skipWaiting(); });

// ── Activate: clean old caches and claim clients ─────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for API, cache-first for assets
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (!event.request.url.startsWith("http")) return;

  if (event.request.url.includes("binance.com") || event.request.url.includes("/api/")) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// ── Push notification handler ─────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  // Parse payload — try JSON first, fall back to text, then use defaults
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      // If JSON parse fails, treat raw text as the body
      const raw = event.data.text();
      data = {
        type:  "signal",
        title: "TFR Signal Update",
        body:  raw || "Open the dashboard to view the latest signal.",
      };
    }
  }

  // ── Build notification content based on type ──────────────────────────────
  const type = data.type || "signal";
  let title  = "";
  let body   = "";

  if (type === "rotation") {
    const asset  = data.asset  || "Portfolio";
    const action = (data.action || "UPDATE").replace(/_/g, " ");
    title = `TFR: ${asset} — ${action}`;
    body  = data.reason
      ? `${data.reason.slice(0, 120)}`
      : "Daily rotation signal updated. Open the dashboard for details.";
    if (data.portfolioValue && data.totalReturn != null) {
      body += `\nPortfolio: $${Math.round(data.portfolioValue).toLocaleString()} · ${data.totalReturn >= 0 ? "+" : ""}${data.totalReturn.toFixed(2)}%`;
    }
  } else if (type === "squeeze") {
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    if (candidates.length === 0) {
      title = "TFR Squeeze Scan";
      body  = `Scanned ${data.symbolsScanned || 0} symbols — no squeeze setups detected.`;
    } else {
      const top = candidates[0];
      title = `TFR Squeeze: ${top.symbol} leads ${candidates.length} candidate${candidates.length > 1 ? "s" : ""}`;
      const lines = candidates
        .slice(0, 3)
        .map((c, i) => `${i + 1}. ${c.symbol} — Score ${c.score}${c.streak_quality ? ` (${c.streak_quality})` : ""}`)
        .join("\n");
      body = `Top squeeze candidates:\n${lines}`;
    }
  } else {
    // Generic fallback
    title = data.title || "The Financial Revolution";
    body  = data.body  || "Open the dashboard to view the latest signal.";
  }

  const options = {
    body,
    icon:     TFR_ICON,
    badge:    TFR_ICON,
    tag:      type === "squeeze" ? "tfr-squeeze" : "tfr-signal",
    renotify: true,
    silent:   false,
    vibrate:  [200, 100, 200],
    data:     { url: "/portfolio" },
    actions: [
      { action: "open",    title: "View Dashboard" },
      { action: "dismiss", title: "Dismiss"         },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click handler ────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const urlToOpen = (event.notification.data && event.notification.data.url) || "/portfolio";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(urlToOpen);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
