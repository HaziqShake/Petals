import { initializeApp } from 'firebase/app';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  indexedDBLocalPersistence,
} from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Session persistence: stay signed in across app restarts. On native
// (Capacitor) prefer IndexedDB persistence, on web use local persistence.
// This is set once at startup, before any sign-in call. If setting it
// fails, Firebase falls back to its default persistence.
setPersistence(
  auth,
  Capacitor.isNativePlatform() ? indexedDBLocalPersistence : browserLocalPersistence,
).catch((e) => console.warn('Auth persistence could not be set, using default:', e));

// Firestore with persistent local cache, so notes stay readable offline
// and edits queue until the device is back online. Multi-tab safe.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// No Firebase Storage: file storage is Backblaze B2 via the Cloudflare
// Worker signer, see client/src/utils/b2Storage.ts. Firebase Storage
// cannot be enabled on the Spark no-cost plan without a Blaze upgrade.
