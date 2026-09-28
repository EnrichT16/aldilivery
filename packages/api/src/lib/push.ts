/**
 * Sending a notification to a Shopper's phone or computer, through Web Push.
 *
 * Web Push is the browser's own notification service: Google's for Chrome and Android, Mozilla's
 * for Firefox, Apple's for Safari. No account with anybody is needed, only a key pair of our own
 * (VAPID), and the message is encrypted so that the push service cannot read it.
 *
 * The browser hands us the address to send to. Because the server then sends a request to that
 * address, it is only ever accepted if it belongs to one of the known push services: otherwise
 * anybody signed in could make the server call any address they liked.
 */

import webpush from 'web-push';

export interface PushMessage {
  title: string;
  body: string;
  /** Where the notification opens, on our own site. */
  url: string;
  /** A second notification with the same tag replaces the first rather than piling up. */
  tag: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** `gone` means the browser has thrown the subscription away and it should be forgotten. */
export type SendPush = (target: PushTarget, message: PushMessage) => Promise<'sent' | 'gone'>;

export interface VapidSettings {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const PUSH_SERVICE_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
];

/** Whether an address is one of the browsers' push services, over https. */
export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.port === '' &&
    url.username === '' &&
    PUSH_SERVICE_HOSTS.some((host) => host.test(url.hostname))
  );
}

export function webPushSender(settings: VapidSettings): SendPush {
  const vapidDetails = {
    subject: settings.subject,
    publicKey: settings.publicKey,
    privateKey: settings.privateKey,
  };

  return async (target, message) => {
    if (!isPushServiceEndpoint(target.endpoint)) return 'gone';
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(message),
        // A question is no use after it has been settled, so the push service need not keep
        // trying for longer than the Shopper has to answer.
        { vapidDetails, TTL: 300, urgency: 'high', timeout: 10_000 },
      );
      return 'sent';
    } catch (failure) {
      const status = (failure as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      throw failure;
    }
  };
}
