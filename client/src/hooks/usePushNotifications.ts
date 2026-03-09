/**
 * usePushNotifications — manages PWA push notification subscription
 * 
 * Flow:
 * 1. Register service worker
 * 2. Request notification permission
 * 3. Subscribe to push via VAPID key from backend
 * 4. Save subscription to backend
 * 5. When signal changes, call notifySignalChange
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

export type NotifStatus = "unsupported" | "default" | "granted" | "denied" | "loading";

export function usePushNotifications() {
  const [status, setStatus] = useState<NotifStatus>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const subscriptionRef = useRef<PushSubscription | null>(null);

  const { data: vapidData } = trpc.push.getVapidKey.useQuery();
  const subscribeMutation = trpc.push.subscribe.useMutation();
  const unsubscribeMutation = trpc.push.unsubscribe.useMutation();
  const notifyMutation = trpc.push.notifySignalChange.useMutation();
  const { data: storedSignal } = trpc.push.getSignalState.useQuery(undefined, {
    refetchInterval: 60_000, // Check every minute
  });

  // Register service worker on mount
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        setSwRegistration(reg);
        // Check if already subscribed
        return reg.pushManager.getSubscription();
      })
      .then((sub) => {
        if (sub) {
          subscriptionRef.current = sub;
          setIsSubscribed(true);
          setStatus("granted");
        } else {
          setStatus(Notification.permission as NotifStatus);
        }
      })
      .catch((err) => {
        console.error("[SW] Registration failed:", err);
        setStatus("unsupported");
      });
  }, []);

  // Subscribe to push notifications
  const subscribe = useCallback(async () => {
    if (!swRegistration || !vapidData?.publicKey) return;

    setStatus("loading");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }

      const sub = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey),
      });

      subscriptionRef.current = sub;
      const subJson = sub.toJSON();

      await subscribeMutation.mutateAsync({
        endpoint: sub.endpoint,
        p256dh: subJson.keys?.p256dh ?? "",
        auth: subJson.keys?.auth ?? "",
      });

      setIsSubscribed(true);
      setStatus("granted");
    } catch (err) {
      console.error("[Push] Subscribe failed:", err);
      setStatus("denied");
    }
  }, [swRegistration, vapidData, subscribeMutation]);

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async () => {
    if (!subscriptionRef.current) return;

    try {
      await unsubscribeMutation.mutateAsync({ endpoint: subscriptionRef.current.endpoint });
      await subscriptionRef.current.unsubscribe();
      subscriptionRef.current = null;
      setIsSubscribed(false);
      setStatus("default");
    } catch (err) {
      console.error("[Push] Unsubscribe failed:", err);
    }
  }, [unsubscribeMutation]);

  // Notify backend of signal change (backend handles dedup + fan-out)
  const reportSignalChange = useCallback(
    async (action: string, ruleTriggered: string | null, reason?: string) => {
      if (!isSubscribed) return;
      try {
        await notifyMutation.mutateAsync({ action, ruleTriggered, reason });
      } catch (err) {
        console.error("[Push] Notify failed:", err);
      }
    },
    [isSubscribed, notifyMutation]
  );

  return {
    status,
    isSubscribed,
    storedSignal,
    subscribe,
    unsubscribe,
    reportSignalChange,
  };
}

// Helper: convert VAPID public key from base64url to Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
