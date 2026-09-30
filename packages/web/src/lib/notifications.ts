/**
 * Allowing notifications on this device, so a Runner's question reaches the Shopper when the
 * Your order page is closed. The browser asks the person first; nothing happens without a yes.
 */

import { removePushSubscription, savePushSubscription } from './api';

export type NotificationState =
  /** This browser cannot do it at all. */
  | 'unsupported'
  /** An iPhone or iPad, where it only works once the app is on the Home Screen. */
  | 'needs-home-screen'
  /** The person, or their browser settings, said no. Only they can change it. */
  | 'blocked'
  | 'off'
  | 'on';

function isAppleMobile(): boolean {
  const platform = navigator.platform ?? '';
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function supported(): boolean {
  return (
    'serviceWorker' in navigator &&
    typeof window.PushManager !== 'undefined' &&
    'Notification' in window
  );
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  // `ready` never settles where no service worker is registered (in development, say).
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 4000)),
  ]);
}

export async function notificationState(): Promise<NotificationState> {
  if (!supported()) return isAppleMobile() && !isStandalone() ? 'needs-home-screen' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const ready = await registration();
  if (!ready) return 'unsupported';
  const existing = await ready.pushManager.getSubscription();
  return existing && Notification.permission === 'granted' ? 'on' : 'off';
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const text = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(text.length));
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}

/** Asks the browser, then tells the server. Returns what the page should now say. */
export async function turnOn(publicKey: string): Promise<NotificationState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const ready = await registration();
  if (!ready) return 'unsupported';
  const subscription =
    (await ready.pushManager.getSubscription()) ??
    (await ready.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  const json = subscription.toJSON() as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };
  await savePushSubscription({ endpoint: json.endpoint, keys: json.keys });
  return 'on';
}

export async function turnOff(): Promise<NotificationState> {
  const ready = await registration();
  const subscription = await ready?.pushManager.getSubscription();
  if (subscription) {
    await removePushSubscription(subscription.endpoint);
    await subscription.unsubscribe();
  }
  return 'off';
}
