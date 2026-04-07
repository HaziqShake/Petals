import { useState, useEffect } from 'react';
import {
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  signInWithCredential,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
// import from Capacitor instead

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setLoading(false);

      // Upsert user profile doc on every login
      if (u) {
        const ref = doc(db, 'users', u.uid);
        await setDoc(ref, {
          uid: u.uid,
          displayName: u.displayName || u.email?.split('@')[0] || 'Petal',
          lastSeen: serverTimestamp(),
        }, { merge: true });
      }
    });
    return unsub;
  }, []);

  const signInWithGoogle = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        const result = await FirebaseAuthentication.signInWithGoogle();
        const idToken = result.credential?.idToken;
        if (!idToken) throw new Error("No ID Token received from Google");
        
        const credential = GoogleAuthProvider.credential(idToken, result.credential?.accessToken);
        await signInWithCredential(auth, credential);
      } else {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
      }
    } catch (error: any) {
      console.error("Login Error:", error);
      alert("Login Error: " + (error.message || JSON.stringify(error)));
    }
  };

  const signOut = () => firebaseSignOut(auth);

  return { user, loading, signInWithGoogle, signOut };
}
