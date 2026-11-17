// ─── Shared TypeScript Interfaces ───────────────────────────────────────────

// TEST ONLY (test-release branch): the admin backdoor account. This must be
// removed before any public release. See TEST_RELEASE_NOTES.md.
export const ADMIN_EMAIL = 'shaikhhaziq73@gmail.com';

export interface UserProfile {
  uid: string;
  displayName: string;
  theme: 'pink' | 'blue';
  isDarkMode: boolean;
  lastSeen: number; // epoch ms
  // Optional, test-release. FCM device tokens for push (prototype).
  fcmTokens?: string[];
}

// In-app notification (test-release). Stored under users/{uid}/notifications.
// Push notifications are a separate layer, see utils/fcm.ts and functions/.
export interface AppNotification {
  id: string;
  uid: string;
  kind: 'message' | 'note' | 'view-once-viewed' | 'partner-editing';
  title: string;
  body: string;
  roomId?: string;
  noteId?: string;
  messageId?: string;
  createdAt: number;
  read: boolean;
}


export interface Room {
  id: string;          // 6-char invite code
  members: string[];   // [uid1, uid2?] max 2
  createdAt: number;
  activeNotes?: Record<string, string | null>; // Maps UID to noteId they are viewing
  lastReadAt?: Record<string, number>; // chat read receipts, epoch ms per uid
  chatTyping?: Record<string, number>; // chat typing, epoch ms per uid
}

export interface StickerPlacement {
  id: string;
  stickerId: string;   // built-in key OR 'custom_<uid>'
  // Normalised canvas coordinates (test-release, coordVersion 2):
  // x is percent of canvas width (0-100), y is logical px from the top of
  // the fixed 360 x 5600 canvas (0-5600). Legacy docs without coordVersion
  // use the old mixed px / percent form; see utils/canvasCoords.ts which
  // normalises them on read. Do not rewrite old docs.
  x: number;
  y: number;
  scale: number;       // 0.5 – 2.0
  rotation: number;    // degrees
  isPx?: boolean;      // legacy flag for pixel coordinate lock
  coordVersion?: number; // 2 = normalised form above
}

export interface Photo {
  id: string;
  url: string;          // base64 data URL (compressed JPEG) for legacy photos,
                        // or Storage download URL for stored photos
  width: number;
  height: number;
  scale: number;        // 0.5 – 2.0
  rotation?: number;    // custom override tilt
  // Normalised canvas coordinates, same convention as StickerPlacement.
  x: number;
  y: number;
  isPx?: boolean;       // legacy flag for pixel coordinate lock
  coordVersion?: number; // 2 = x is percent of width, y is logical px (0-5600)
  takenAt?: number;     // original capture timestamp from file.lastModified
  // Optional, backward compatible. Only set for photos uploaded through the
  // Storage flow (test-release). Legacy base64 photos leave these unset.
  storageUrl?: string;
  thumbUrl?: string;
  storagePath?: string;
  thumbPath?: string;
  mediaType?: 'image' | 'video';
  // View-once, for everyone including the admin (test-release rule
  // changed 2026-11-17): once the recipient has opened it, viewedBy is
  // non-empty and the app hides the image for both users and for admin.
  // The file is NOT deleted; it stays in hidden app storage, see
  // utils/mediaStore.ts. viewedAt is when it was first opened.
  isViewOnce?: boolean;
  viewedBy?: string[];  // uids that have already opened this view-once photo
  viewedAt?: number;
  // Client-side primary + transient relay (test-release): the full file
  // lives on each device first; Storage is only a relay until both room
  // members confirm they have it cached locally (cachedBy), then the
  // full file is deleted from Storage and relayDeleted is true. The
  // thumbnail stays in Storage. See TEST_RELEASE_NOTES.md.
  cachedBy?: string[];
  relayDeleted?: boolean;
  // 30-day archive to server (test-release, revised 2026-11-17): after
  // 30 days without being opened, the full file is uploaded back to
  // Storage as a long-term copy (rooms/{roomId}/archived/{id}) and only
  // then deleted from local nomedia storage. It is NOT wiped forever.
  // serverStored/archivedAt/archivedUrl/archivedPath are written to
  // Firestore by the archive job; downloadedAt/lastAccessedAt/
  // localExpired are local-only. localExpired means the local copy is
  // gone; tapping the item re-downloads it from the archived server
  // copy and resets the 30-day clock.
  downloadedAt?: number;
  lastAccessedAt?: number;
  localExpired?: boolean;
  serverStored?: boolean;
  archivedAt?: number;
  archivedUrl?: string;
  archivedPath?: string;
}

// A photo/video stored in Firebase Storage, with its metadata in the
// photos subcollection: rooms/{roomId}/notes/{noteId}/photos/{photoId}.
// The legacy Note.photos array is unchanged and still renders; stored
// photos are rendered alongside it and deduped by id.
export interface StoredPhoto {
  id: string;
  roomId: string;
  noteId: string;
  url: string;          // Storage download URL (full size)
  storageUrl: string;
  thumbUrl?: string;
  storagePath: string;
  thumbPath?: string;
  width: number;
  height: number;
  scale: number;
  rotation?: number;
  // Normalised canvas coordinates: x percent of width, y logical px.
  x: number;
  y: number;
  coordVersion: 2;
  takenAt?: number;
  createdAt: number;
  mediaType?: 'image' | 'video';
  durationSeconds?: number; // video only, best effort
  // View-once for everyone including admin: once opened, viewedBy is
  // non-empty and the app hides it for both users and for admin. The
  // file stays in hidden app storage, it is not deleted. See Photo above.
  isViewOnce?: boolean;
  viewedBy?: string[];
  viewedAt?: number;
  // Transient relay: cachedBy lists room members who have the full file
  // stored locally; relayDeleted means the full file was removed from
  // Storage after both members cached it. Thumbnail stays in Storage.
  cachedBy?: string[];
  relayDeleted?: boolean;
  // 30-day archive to server: local-only, see Photo above.
  downloadedAt?: number;
  lastAccessedAt?: number;
  localExpired?: boolean;
  serverStored?: boolean;
  archivedAt?: number;
  archivedUrl?: string;
  archivedPath?: string;
}


export interface Note {
  id: string;
  roomId: string;
  title: string;
  body: string;        // plain-text snapshot for preview
  bodyHtml: string;    // contenteditable innerHTML
  photos: Photo[];     // legacy base64 photos, still rendered as before
  stickers: StickerPlacement[];
  createdAt: number;
  updatedAt: number;
  editingBy: string | null; // uid of user currently typing
  isFavourite?: boolean;
  // Optional, backward compatible. Count of stored (Storage) photos, kept
  // in sync by the client when it adds/removes stored photos. Never
  // required for reading a note.
  storedPhotoCount?: number;
}

export interface CustomSticker {
  id: string;
  ownerUid: string;
  dataUrl: string;     // base64 PNG with white-outline
  storageUrl?: string; // Firebase Storage URL if > 150KB
}

// Chat message (test-release). Lives in rooms/{roomId}/messages/{messageId}.
// Notes data is untouched; messages are a separate collection. Push
// notifications are out of scope for this test build.
export interface ChatMessage {
  id: string;
  roomId: string;
  senderUid: string;
  senderName?: string;
  text?: string;
  type: 'text' | 'photo' | 'video' | 'view-once';
  mediaUrl?: string;
  thumbUrl?: string;
  storagePath?: string;
  thumbPath?: string;
  mediaType?: 'image' | 'video';
  durationSeconds?: number;
  // View-once for everyone including admin: once the recipient opens it,
  // viewedBy is non-empty and the app hides it for both users and admin.
  // The file stays in hidden app storage, it is not deleted.
  isViewOnce?: boolean;
  viewedBy?: string[];
  viewedAt?: number;
  replyTo?: string | null;
  // Instagram-like reactions: one reaction per user, map uid -> emoji.
  // Any emoji is allowed, not just a fixed set. Counts are derived
  // client-side from this map. Optimistic: the UI updates instantly,
  // Firestore is the source of truth afterwards.
  reactions?: Record<string, string>;
  createdAt: number;
  deletedAt?: number | null;
  // Transient relay, same as StoredPhoto: cachedBy lists members who
  // have the full file locally; relayDeleted means Storage no longer
  // holds the full file, only the thumbnail.
  cachedBy?: string[];
  relayDeleted?: boolean;
  // 30-day archive to server: local-only, see Photo above.
  downloadedAt?: number;
  lastAccessedAt?: number;
  localExpired?: boolean;
  serverStored?: boolean;
  archivedAt?: number;
  archivedUrl?: string;
  archivedPath?: string;
}
