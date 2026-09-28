/**
 * Making the key pair for notifications, once, from the DigitalOcean console.
 *
 * Prints two lines to paste into the api component's settings as VAPID_PUBLIC_KEY and
 * VAPID_PRIVATE_KEY. Nothing is saved anywhere by this: the keys exist only on the screen until
 * they are pasted. Make them once. Making new ones later means every Shopper who allowed
 * notifications has to allow them again.
 *
 * Usage, from the repository root:
 *
 *   node packages/api/scripts/push-keys.mjs
 */

import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();

console.log('');
console.log('Paste each of these into the api component, under Environment Variables.');
console.log('The private key is a secret: tick Encrypt for it, and cover it in any screenshot.');
console.log('');
console.log(`VAPID_PUBLIC_KEY  ${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY ${keys.privateKey}`);
console.log('');
