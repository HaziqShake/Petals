import { useState, useEffect } from 'react';
import {
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  signInWithCredential,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';

/** Friendly, user-facing message for common Firebase Auth errors. */
export function friendlyAuthError(e: unknown): string {
  const code = (e as { code?: string } | null)?.code ?? '';
  const message = (e as { message?: string } | null)?.message ?? '';
  switch (code) {
    case 'auth/email-already-in-use':
      return 'That email already has an account. Try signing in instead.';
    case 'auth/invalid-email':
      return 'That email address does not look right. Check it and try again.';
    case 'auth/weak-password':
      return 'Password needs at least 6 characters.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Email or password is wrong. Check them and try again.';
    case 'auth/too-many-requests':
      return 'Too many tries. Wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'No connection. Check your internet and try again.';
    case 'auth/popup-closed-by-user':
      return 'Sign-in was closed before it finished. Try again.';
    default:
      return message || 'Something went wrong signing in. Try again.';
  }
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setLoading(false);

      if (u) {
        const ref = doc(db, 'users', u.uid);
        try {
          const snap = await getDoc(ref);
          if (!snap.exists()) {
            // First creation only: set the display name once.
            await setDoc(ref, {
              uid: u.uid,
              displayName: u.displayName || u.email?.split('@')[0] || 'Petal',
              lastSeen: serverTimestamp(),
            });
          } else {
            // Returning user: never overwrite a custom display name set
            // in Settings. Only refresh lastSeen.
            await setDoc(ref, { lastSeen: serverTimestamp() }, { merge: true });
          }
        } catch (e) {
          console.warn('Profile upsert failed:', e);
        }
      }
    });
    return unsub;
  }, []);

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      if (Capacitor.isNativePlatform()) {
        const result = await FirebaseAuthentication.signInWithGoogle();
        const idToken = result.credential?.idToken;
        if (!idToken) throw new Error('No ID Token received from Google');

        const credential = GoogleAuthProvider.credential(idToken, result.credential?.accessToken);
        await signInWithCredential(auth, credential);
      } else {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
      }
    } catch (error: unknown) {
      console.error('Login Error:', error);
      setAuthError(friendlyAuthError(error));
      throw error;
    }
  };

  const signUpWithEmail = async (email: string, password: string) => {
    setAuthError(null);
    try {
      await createUserWithEmailAndPassword(auth, email.trim(), password);
    } catch (error: unknown) {
      const msg = friendlyAuthError(error);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error: unknown) {
      const msg = friendlyAuthError(error);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const resetPassword = async (email: string) => {
    setAuthError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (error: unknown) {
      const msg = friendlyAuthError(error);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const signOut = () => firebaseSignOut(auth);

  return { user, loading, authError, signInWithGoogle, signUpWithEmail, signInWithEmail, resetPassword, signOut };
}
