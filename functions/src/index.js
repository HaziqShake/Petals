// TEST ONLY prototype: push notifications for Petals.
// Deploy: firebase deploy --only functions (requires the Blaze plan).
// Triggers: on new message in rooms/{roomId}/messages, and on new note
// in rooms/{roomId}/notes. Looks up the other member's fcmTokens in
// users/{uid} and sends one FCM data+notification message. No tokens,
// no send. No service account key is committed; the Functions runtime
// uses Application Default Credentials.
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

async function notifyPartner(roomId, title, body, data) {
  const db = getFirestore();
  const roomSnap = await db.collection('rooms').doc(roomId).get();
  if (!roomSnap.exists) return;
  const members = roomSnap.data().members || [];
  const tokens = [];
  for (const uid of members) {
    const u = await db.collection('users').doc(uid).get();
    if (u.exists) tokens.push(...(u.data().fcmTokens || []));
  }
  const unique = [...new Set(tokens.filter(Boolean))];
  if (unique.length === 0) return;
  await getMessaging().sendEachForMulticast({
    tokens: unique,
    notification: { title, body },
    data: { roomId, ...(data || {}) },
  });
}

exports.onNewMessage = onDocumentCreated('rooms/{roomId}/messages/{messageId}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const m = snap.data();
  const text = m.type === 'text' ? (m.text || 'New message') : m.type === 'video' ? 'Sent a short clip' : 'Sent a photo';
  await notifyPartner(event.params.roomId, 'Petals', text, { type: 'message' });
});

exports.onNewNote = onDocumentCreated('rooms/{roomId}/notes/{noteId}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const n = snap.data();
  await notifyPartner(event.params.roomId, 'Petals', `New note: ${n.title || 'Untitled'}`, { type: 'note', noteId: event.params.noteId });
});
