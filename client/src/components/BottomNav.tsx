import React from 'react';
import { NoteIcon, CameraIcon, HeartIcon } from './Icons';

type Tab = 'notes' | 'favourites' | 'photos' | 'settings';

interface Props {
  active: Tab;
  onChange: (t: Tab) => void;
}

export default function BottomNav({ active, onChange }: Props) {
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'notes',
      label: 'Notes',
      icon: <NoteIcon size={22} />,
    },
    {
      id: 'favourites',
      label: 'Favs',
      icon: <HeartIcon size={22} />,
    },
    {
      id: 'photos',
      label: 'Photos',
      icon: <CameraIcon size={22} />,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      ),
    },
  ];

  return (
    <nav className="bottom-nav">
      {tabs.map((t) => (
        <button
          key={t.id}
          className={`nav-tab ${active === t.id ? 'active' : ''}`}
          onClick={() => onChange(t.id)}
          aria-label={t.label}
        >
          {t.icon}
          <span style={{ fontSize: '9px', marginTop: '2px' }}>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
