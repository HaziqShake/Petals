const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Initialize Firebase Admin
let db;
try {
  const admin = require('firebase-admin');
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  db = admin.firestore();
  console.log('Firebase Admin initialized');
} catch (e) {
  console.warn('Firebase Admin not configured — room API disabled:', e.message);
}

/** POST /room/create — atomically create a room */
app.post('/room/create', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Server not configured' });
  const { uid } = req.body;
  if (!uid) return res.status(400).json({ error: 'uid required' });

  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

  await db.collection('rooms').doc(code).set({
    id: code,
    members: [uid],
    createdAt: Date.now(),
  });

  res.json({ code });
});

/** POST /room/join — atomically join (enforces 2-user cap) */
app.post('/room/join', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Server not configured' });
  const { uid, code } = req.body;
  if (!uid || !code) return res.status(400).json({ error: 'uid and code required' });

  const ref = db.collection('rooms').doc(code.toUpperCase());
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('Room not found');
      const data = snap.data();
      if (data.members.length >= 2 && !data.members.includes(uid)) throw new Error('Room is full');
      if (!data.members.includes(uid)) tx.update(ref, { members: [...data.members, uid] });
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Petals server running on :${PORT}`));
