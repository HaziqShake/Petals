// Firebase Cloud Messaging service worker (web push prototype).
// TEST ONLY / prototype: fill in your Firebase web config from the
// Firebase console (Project settings, Your apps, Web app) before use.
// The values below are placeholders on purpose; no private keys live here.
// This file must sit in client/public/ so it is served at the site root.
importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'YOUR_VITE_FIREBASE_API_KEY',
  authDomain: 'YOUR_VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'YOUR_VITE_FIREBASE_PROJECT_ID',
  storageBucket: 'YOUR_VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'YOUR_VITE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'YOUR_VITE_FIREBASE_APP_ID',
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage(function (payload) {
  const title = (payload.notification && payload.notification.title) || 'Petals';
  const options = {
    body: (payload.notification && payload.notification.body) || '',
    icon: '/favicon.svg',
  };
  self.registration.showNotification(title, options);
});
