import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserProfile } from '../../../shared/types';

interface AppContextValue {
  user: User | null;
  profile: UserProfile | null;
  theme: 'pink' | 'blue';
  setTheme: (t: 'pink' | 'blue') => void;
  isDarkMode: boolean;
  setDarkMode: (d: boolean) => void;
  roomId: string | null;
  setRoomId: (id: string | null) => void;
  updateProfile: (data: Partial<UserProfile>) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ user, children }: { user: User | null; children: ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [theme, setThemeState] = useState<'pink' | 'blue'>(() =>
    (localStorage.getItem('petals_theme') as 'pink' | 'blue') || 'pink'
  );
  const [isDarkMode, setDarkModeState] = useState<boolean>(() =>
    localStorage.getItem('petals_dark') === 'true'
  );
  const [roomId, setRoomId] = useState<string | null>(() => localStorage.getItem('petals_room_id'));

  // Apply theme & dark mode to body
  useEffect(() => {
    document.body.classList.remove('theme-pink', 'theme-blue', 'dark-theme', 'platform-android');
    document.body.classList.add(`theme-${theme}`);
    if (isDarkMode) document.body.classList.add('dark-theme');
    
    // Platform detection for specific CSS tuning
    const isAndroid = /android/i.test(navigator.userAgent);
    if (isAndroid) {
      document.body.classList.add('platform-android');
    }
    
    localStorage.setItem('petals_theme', theme);
    localStorage.setItem('petals_dark', isDarkMode.toString());
  }, [theme, isDarkMode]);


  // Subscribe to user profile & sync settings
  useEffect(() => {
    if (!user) { setProfile(null); return; }
    const ref = doc(db, 'users', user.uid);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as UserProfile;
        setProfile(data);
        if (data.theme) setThemeState(data.theme);
        if (data.isDarkMode !== undefined) setDarkModeState(data.isDarkMode);
      }
    });
    return unsub;
  }, [user]);

  const setTheme = async (t: 'pink' | 'blue') => {
    setThemeState(t);
    if (user) {
      await setDoc(doc(db, 'users', user.uid), { theme: t }, { merge: true });
    }
  };

  const setDarkMode = async (d: boolean) => {
    setDarkModeState(d);
    if (user) {
      await setDoc(doc(db, 'users', user.uid), { isDarkMode: d }, { merge: true });
    }
  };

  const updateProfile = async (data: Partial<UserProfile>) => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), data, { merge: true });
  };

  return (
    <AppContext.Provider value={{ 
      user, profile, theme, setTheme, isDarkMode, setDarkMode, 
      roomId, setRoomId, updateProfile 
    }}>
      {children}
    </AppContext.Provider>
  );
}


export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}
