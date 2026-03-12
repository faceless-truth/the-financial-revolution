/**
 * usePushNotifications — manages browser push notifications.
 *
 * Since the live site is a static deployment (no Express server), this hook
 * uses the browser Notification API directly instead of server-side web-push.
 *
 * Flow:
 * 1. Request notification permission from the browser
 * 2. When signal changes, show a browser notification directly
 * 3. Store last-seen signal in localStorage to detect changes across page loads
 *
 * This works in all browsers that support the Notification API (Chrome, Edge,
 * Firefox, Safari 16.4+). Safari Private Browsing blocks notifications by design.
 */
import { useCallback, useEffect, useState } from "react";

export type NotifStatus = "unsupported" | "default" | "granted" | "denied" | "loading";

const SIGNAL_STATE_KEY = "tfr_last_signal_v1";
const NOTIF_ENABLED_KEY = "tfr_notif_enabled_v1";

const TFR_ICON = "https://d2xsxph8kpxj0f.cloudfront.net/310519663335455300/f7qptPGnBE9WgCNPQkiCv7/tfr-icon_467cb428.png";

function getStoredSignal(): string | null {
  try { return localStorage.getItem(SIGNAL_STATE_KEY); } catch { return null; }
}

function storeSignal(action: string): void {
  try { localStorage.setItem(SIGNAL_STATE_KEY, action); } catch { /* ignore */ }
}

function getNotifEnabled(): boolean {
  try { return localStorage.getItem(NOTIF_ENABLED_KEY) === "true"; } catch { return false; }
}

function setNotifEnabled(v: boolean): void {
  try { localStorage.setItem(NOTIF_ENABLED_KEY, String(v)); } catch { /* ignore */ }
}

export function usePushNotifications() {
  const [status, setStatus] = useState<NotifStatus>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);

  // Initialise from stored permission + enabled flag
  useEffect(() => {
    if (!("Notification" in window)) {
      setStatus("unsupported");
      return;
    }
    const perm = Notification.permission as NotifStatus;
    setStatus(perm);
    if (perm === "granted" && getNotifEnabled()) {
      setIsSubscribed(true);
    }
  }, []);

  // Enable notifications — request permission then mark as subscribed
  const subscribe = useCallback(async () => {
    if (!("Notification" in window)) {
      setStatus("unsupported");
      return;
    }
    setStatus("loading");
    try {
      const permission = await Notification.requestPermission();
      setStatus(permission as NotifStatus);
      if (permission === "granted") {
        setNotifEnabled(true);
        setIsSubscribed(true);
      } else {
        setIsSubscribed(false);
      }
    } catch (err) {
      console.error("[Notif] Permission request failed:", err);
      setStatus("denied");
    }
  }, []);

  // Disable notifications
  const unsubscribe = useCallback(() => {
    setNotifEnabled(false);
    setIsSubscribed(false);
    setStatus(Notification.permission as NotifStatus);
  }, []);

  /**
   * Call this whenever the dashboard detects a new signal.
   * Shows a browser notification if the signal changed since last time.
   */
  const reportSignalChange = useCallback(
    (action: string, _ruleTriggered: string | null, reason?: string) => {
      const prev = getStoredSignal();
      const changed = prev !== action;

      // Always update stored signal so we track the latest
      storeSignal(action);

      if (!changed || !isSubscribed || Notification.permission !== "granted") return;

      const actionLabel = action.replace("_", " ");
      const prevLabel = prev ? prev.replace("_", " ") : null;

      const title = `TFR Signal: ${actionLabel}`;
      const body = prevLabel
        ? `Signal changed from ${prevLabel} → ${actionLabel}. ${reason ?? ""}`
        : `Strategy signal: ${actionLabel}. ${reason ?? ""}`;

      try {
        // Use service worker notification if available (shows even when tab is closed)
        if ("serviceWorker" in navigator) {
          navigator.serviceWorker.ready.then((reg) => {
            reg.showNotification(title, {
              body,
              icon: TFR_ICON,
              badge: TFR_ICON,
              tag: "tfr-signal",
            });
          }).catch(() => {
            // Fallback to direct Notification API
            new Notification(title, { body, icon: TFR_ICON });
          });
        } else {
          new Notification(title, { body, icon: TFR_ICON });
        }
      } catch (err) {
        console.error("[Notif] Failed to show notification:", err);
      }
    },
    [isSubscribed]
  );

  // Expose storedSignal as null (no longer fetched from server)
  const storedSignal = null;

  return {
    status,
    isSubscribed,
    storedSignal,
    subscribe,
    unsubscribe,
    reportSignalChange,
  };
}
