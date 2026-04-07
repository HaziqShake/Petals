// ─── Shared TypeScript Interfaces ───────────────────────────────────────────

export interface UserProfile {
  uid: string;
  displayName: string;
  theme: 'pink' | 'blue';
  isDarkMode: boolean;
  lastSeen: number; // epoch ms
}


export interface Room {
  id: string;          // 6-char invite code
  members: string[];   // [uid1, uid2?] max 2
  createdAt: number;
  activeNotes?: Record<string, string | null>; // Maps UID to noteId they are viewing
}

export interface StickerPlacement {
  id: string;
  stickerId: string;   // built-in key OR 'custom_<uid>'
  x: number;           // % of canvas width
  y: number;           // % of canvas height
  scale: number;       // 0.5 – 2.0
  rotation: number;    // degrees
  isPx?: boolean;      // flag for pixel coordinate lock
}

export interface Photo {
  id: string;
  url: string;          // base64 data URL (compressed JPEG)
  width: number;
  height: number;
  scale: number;        // 0.5 – 2.0
  rotation?: number;    // custom override tilt
  x: number;
  y: number;
  isPx?: boolean;       // flag for pixel coordinate lock
  takenAt?: number;     // original capture timestamp from file.lastModified
}


export interface Note {
  id: string;
  roomId: string;
  title: string;
  body: string;        // plain-text snapshot for preview
  bodyHtml: string;    // contenteditable innerHTML
  photos: Photo[];
  stickers: StickerPlacement[];
  createdAt: number;
  updatedAt: number;
  editingBy: string | null; // uid of user currently typing
  isFavourite?: boolean;
}

export interface CustomSticker {
  id: string;
  ownerUid: string;
  dataUrl: string;     // base64 PNG with white-outline
  storageUrl?: string; // Firebase Storage URL if > 150KB
}
