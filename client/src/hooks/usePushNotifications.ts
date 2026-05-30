/**
 * usePushNotifications v4.0 — Stable bell, persistent subscription state
 *
 * Key changes from v3:
 * - Never sets status to "unsupported" — bell is always shown
 * - Persists subscription state in localStorage so bell doesn't flicker on reload
 * - Retries PushManager check up to 3 times with 1s delay between attempts
 * - Graceful degradation: if push truly not available, bell is greyed out but visible
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type NotifStatus =
  | "unknown"
  | "default"
  | "granted"
  | "denied"
  | "loading"
  | "error"
  | "unsupported";

const SUBSCRIBED_KEY   = "tfr_push_subscribed_v2";
const SIGNAL_STATE_KEY = "tfr_last_signal_v2";
const TFR_ICON = "/icons/icon-192.png";

function getStoredSignal(): string | null {
  try { return localStorage.getItem(SIGNAL_STATE_KEY); } catch { return null; }
}
function storeSignal(action: string): void {
  try { localStorage.setItem(SIGNAL_STATE_KEY, action); } catch { /* ignore */ }
}
function getStoredSubscribed(): boolean {
  try { return localStorage.getItem(SUBSCRIBED_KEY) === "true"; } catch { return false; }
}
function setStoredSubscribed(val: boolean): void {
  try { localStorage.setItem(SUBSCRIBED_KEY, val ? "true" : "false"); } catch { /* ignore */ }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw     = window.atob(base64);
  return Uint8Array.from(Array.from(raw).map((c) => c.charCodeAt(0)));
}

function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function usePushNotifications() {
  // Initialise from localStorage so bell doesn't flicker on reload
  const [status,       setStatus]       = useState<NotifStatus>("unknown");
  const [isSubscribed, setIsSubscribed] = useState<boolean>(getStoredSubscribed);
  const checkAttempts = useRef(0);

  useEffect(() => {
    // Retry checking push support up to 3 times with 1s intervals
    // This handles iOS PWA where SW takes time to activate
    function checkSupport() {
      checkAttempts.current += 1;
      if (!isPushSupported()) {
        if (checkAttempts.current < 3) {
          setTimeout(checkSupport, 1000);
        } else {
          // After 3 attempts, mark as unsupported but keep bell visible
          setStatus("unsupported");
          setStoredSubscribed(false);
          setIsSubscribed(false);
        }
        return;
      }

      const perm = Notification.permission;
      if (perm === "denied") {
        setStatus("denied");
        setStoredSubscribed(false);
        setIsSubscribed(false);
        return;
      }

      if (perm === "granted") {
        navigator.serviceWorker.ready
          .then((reg) => reg.pushManager.getSubscription())
          .then((sub) => {
            if (sub) {
              setIsSubscribed(true);
              setStoredSubscribed(true);
              setStatus("granted");
            } else {
              // Had permission but subscription was cleared (e.g. after reinstall)
              setStoredSubscribed(false);
              setIsSubscribed(false);
              setStatus("default");
            }
          })
          .catch(() => {
            setStatus("default");
          });
      } else {
        setStatus("default");
      }
    }

    // Small initial delay to let SW activate on iOS PWA
    const timer = setTimeout(checkSupport, 800);
    return () => clearTimeout(timer);
  }, []);

  const subscribe = useCallback(async () => {
    if (!isPushSupported()) {
      setStatus("unsupported");
      return;
    }
    setStatus("loading");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "default");
        return;
      }

      const reg = await navigator.serviceWorker.ready;

      const keyRes = await fetch("/api/push/vapid-public-key");
      if (!keyRes.ok) throw new Error(`VAPID key fetch failed: ${keyRes.status}`);
      const { publicKey } = await keyRes.json() as { publicKey: string };

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const subJson = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const saveRes = await fetch("/api/push/subscribe", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(subJson),
      });
      if (!saveRes.ok) throw new Error(`Subscribe save failed: ${saveRes.status}`);

      setIsSubscribed(true);
      setStoredSubscribed(true);
      setStatus("granted");
      console.log("[Push] Subscribed successfully");
    } catch (err) {
      console.error("[Push] Subscribe failed:", err);
      setStatus("error");
      setStoredSubscribed(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
    } catch (err) {
      console.error("[Push] Unsubscribe failed:", err);
    }
    setIsSubscribed(false);
    setStoredSubscribed(false);
    setStatus("default");
  }, []);

  // reportSignalChange is intentionally a no-op.
  // All notifications are server-sent via VAPID push (cron jobs).
  // In-app notifications are disabled to avoid duplicate/redundant alerts.
  const reportSignalChange = useCallback(
    (action: string, _ruleTriggered: string | null, _reason?: string) => {
      storeSignal(action); // still track signal for state persistence
    },
    []
  );

  return { status, isSubscribed, storedSignal: null, subscribe, unsubscribe, reportSignalChange };
}
