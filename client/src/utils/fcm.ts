// FCM push prototype (test-release). Client side only.
// - requestPermission: asks for notification permission (web only;
//   on Capacitor Android, use the native push plugin in production and
//   keep this file as the token-storage shape).
// - registerToken: gets an FCM token with the web VAPID key from
//   VITE_FIREBASE_VAPID_KEY (public key, safe to ship; the private key
//   stays in the Firebase console) and stores it in
//   users/{uid}/fcmTokens (arrayUnion, deduped by Firestore).
// - onForegroundMessage: shows an in-app toast via a callback; background
//   messages are handled by public/firebase-messaging-sw.js.
// If messaging is not supported in this browser, all functions no-op
// and return null/false. Push will not work until the Firebase console
// steps in TEST_RELEASE_NOTES.md are done (Blaze plan, Cloud Messaging
// enabled, VAPID key set, functions deployed).
import { getMessaging, getToken, onMessage, isSupported, type Messaging } from 'firebase/messaging';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../firebase';

let messaging: Messaging | null = null;
let supported: boolean | null = null;

async function getMessagingSafe(): Promise<Messaging | null> {
  if (supported === false) return null;
  try {
    if (supported === null) supported = await isSupported();
    if (!supported) return null;
    if (!messaging) messaging = getMessaging();
    return messaging;
  } catch {
    return null;
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission().catch(() => 'denied' as NotificationPermission);
  return result === 'granted';
}

export async function registerFcmToken(uid: string): Promise<string | null> {
  if (!uid) return null;
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
  if (!vapidKey) return null;
  const msg = await getMessagingSafe();
  if (!msg) return null;
  const ok = await requestNotificationPermission();
  if (!ok) return null;
  try {
    const token = await getToken(msg, { vapidKey });
    if (!token) return null;
    await updateDoc(doc(db, 'users', uid), { fcmTokens: arrayUnion(token) }).catch(() => undefined);
    return token;
  } catch (e) {
    console.warn('FCM token registration failed (prototype):', e);
    return null;
  }
}

export async function onForegroundMessage(cb: (title: string, body: string) => void): Promise<() => void> {
  const msg = await getMessagingSafe();
  if (!msg) return () => undefined;
  return onMessage(msg, (payload) => {
    const title = payload.notification?.title ?? 'Petals';
    const body = payload.notification?.body ?? '';
    cb(title, body);
  });
}
