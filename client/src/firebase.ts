import { initializeApp } from 'firebase/app';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  indexedDBLocalPersistence,
} from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';

// Firebase web config is a PUBLIC client config (not a secret -
// Google's own docs say the apiKey here only identifies the project).
// It is embedded as the default so CI builds work without a .env file:
// the CI build had no .env, so all VITE_FIREBASE_* were undefined,
// initializeApp threw, and the app showed a white screen on Android.
// Env vars still override these defaults when present.
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyCY9X3iIpoEAmj3QE0hPu5Rsj3iRfQDf3A',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'petals-app-hi.firebaseapp.com',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'petals-app-hi',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '486180695746',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID ?? '1:486180695746:web:54af8295c1a598cdce555b',
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
