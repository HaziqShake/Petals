# Free storage alternative to Firebase Storage for Petals

Status: IMPLEMENTED IN CODE, 2026-11-17. The Worker (`worker/`) and the
client swap (`client/src/utils/b2Storage.ts`, callers switched, old
`storagePhotos.ts` and `storage.rules` deleted) are done and type-check
plus build clean (`npx tsc -b`, `npm run build`). NOT deployed: no B2 or
Cloudflare accounts were created, no card was used, nothing was pushed.
Live deployment still needs Haziq to create the free B2 account +
private bucket + bucket-scoped application key and the free Cloudflare
account holding those as Worker secrets, then deploy the Worker and set
`VITE_SIGNER_URL` (see `worker/README.md`). End-to-end proof (real
upload/download/relay delete/archive against B2) is still outstanding
until then. The Firestore rules deploy running separately in the browser
is untouched by this.

## The problem

Firebase project `petals-app-hi` is on the Spark (no-cost) plan. Cloud
Storage was removed from Spark on 2026-02-03, so Firebase Storage cannot be
enabled without upgrading to Blaze, which needs a card. Petals therefore has
no server-side place to put photos and videos today, even though the code
already calls Firebase Storage everywhere (`client/src/utils/storagePhotos.ts`).

## Pick: Backblaze B2

**Backblaze B2, private bucket, S3-compatible API, signed from a small
Cloudflare Worker.**

### Why B2 and not the others

| Option | Free storage | Free egress | Card to start? | Verdict |
| --- | --- | --- | --- | --- |
| Cloudflare R2 | 10 GB/month | Unlimited, $0 | **Yes, card or PayPal on file to activate** | Rejected. It is the best tier on paper, but it fails the one constraint Haziq set: free with no card. Same blocker as Firebase Blaze. |
| **Backblaze B2** | **10 GB** | **Free up to 3x average stored data per month, then $0.01/GB** | **No** | **Pick.** Same 10 GB as R2, no card, S3-compatible, cheapest paid storage after the free tier ($0.00695/GB-month). |
| Supabase Storage | 1 GB | 5 GB/month | No | Too small. 1 GB is about 1,400 compressed photos, and free Supabase projects pause after about a week idle. |
| Tigris | 5 GB | Unlimited | No | Runner-up. Half the free storage of B2, and a smaller ecosystem. Use it only if B2 signup ever asks for a card. |

Free-tier numbers were checked against current (Nov 2026) pricing pages and
comparisons; re-check B2's pricing page at signup, free tiers change.

### Cost at Petals scale

Two people, compressed photos ~700 KB, thumbnails ~60-80 KB, clips up to
50 MB (720p, 60 s max).

- 1,000 photos a year: ~0.7 GB full + ~0.08 GB thumbs. 20 clips at ~25 MB
  average: ~0.5 GB. Total stored ~1.3 GB, well under 10 GB.
- Egress: each full file is downloaded once per partner device (the hidden
  nomedia cache is the primary copy after that), so ~2.6 GB/month worst
  case, against a free allowance of 3x stored (~3.9 GB). Inside the free
  tier.
- The 10 GB cap is hit at roughly 14,000 photos (or ~200 full 50 MB
  clips). Past that: $0.00695/GB-month storage, $0.01/GB egress over the
  3x allowance, so about $0.07/month per extra GB stored. No cliff.
- B2 API calls (Class B/C reads, lists) are free within generous daily
  caps; uploads are not charged per request the way R2 Class A ops are.

## How Storage is used today (what must be replaced)

All of this lives in `client/src/utils/storagePhotos.ts`, called from:

- `client/src/pages/NoteEditorPage.tsx` — `uploadStoredMediaResumable`
  for note photos (videos were removed from notes, photos only).
- `client/src/pages/ChatPage.tsx` — same, with noteId `'__chat__'` for
  chat photos and videos.
- `client/src/hooks/usePhotos.ts`, `useMessages.ts` — `deleteStoredMedia`,
  `deleteRelayFullFile`.
- `client/src/utils/mediaArchive.ts` — `uploadArchiveMedia` for the
  30-day archive.
- `client/src/pages/AdminPage.tsx` — direct `firebase/storage`
  `listAll` / `deleteObject` calls (must be reworked, see below).
- `client/src/firebase.ts` — `getStorage()`; `storageBucket` in
  `.env.example`.

Current paths, which stay the same as B2 object keys:

- `rooms/{roomId}/notes/{noteId}/photos/{photoId}.webp`
- `rooms/{roomId}/notes/{noteId}/photos/{photoId}-thumb.webp`
- `rooms/{roomId}/notes/{noteId}/photos/{photoId}.mp4` (chat videos)
- Chat media uses noteId `__chat__`: `rooms/{roomId}/__chat__/{messageId}.webp|.mp4`
- Archive: `rooms/{roomId}/archived/{mediaId}.webp|.mp4`

Current semantics that must be preserved:

- Upload full + thumb, return a URL and the storage path; thumbnail
  stays on the server permanently; the full file is a transient relay
  that is deleted (`deleteRelayFullFile`) only after both members have
  it cached locally (`cachedBy`).
- Resumable upload with progress (0-100) for the full file, pause /
  resume / cancel from the UI.
- Archive upload is verified (download URL + stored size match) before
  the local copy is deleted. Never delete locally on failure.
- `isOnCellular()` gates uploads on mobile data (WiFi only by default).

## Design: private bucket + presigned URLs from a Worker

### The one rule

**The B2 application key never goes in the app.** It is extractable from
any APK, and anyone with it could read or delete every photo. All signing
happens server-side.

### Components

1. **B2 bucket `petals-media`, private, Standard class, one bucket.**
   No public access, no public `r2.dev`-style URL. CORS on the bucket
   allows `PUT`/`GET`/`HEAD` from `capacitor://localhost`,
   `http://localhost:*`, and the web origin, so the app can PUT/GET
   directly to B2 with a presigned URL.
2. **Cloudflare Worker `petals-signer` (Workers free plan, 100,000
   requests/day, no card required).** This is the only server piece.
   It holds the B2 key ID + application key as Worker secrets, and the
   bucket name + endpoint as vars. It exposes three endpoints, all
   POST, all requiring a Firebase ID token in the `Authorization:
   Bearer <token>` header:
   - `POST /sign-upload` `{ roomId, key, contentType, contentLength }`
     → presigned PUT URL (15 min expiry). The Worker verifies the
     token with Firebase (see below), checks the caller is a member
     of that room in Firestore (or checks the room doc via the
     Firebase Admin / REST API), checks the key matches one of the
     allowed patterns above, and enforces the size caps (photo
     700 KB target, video 50 MB max).
   - `POST /sign-download` `{ key }` → presigned GET URL (1 hour
     expiry, enough to download and cache locally).
   - `POST /delete` `{ key }` → deletes the object after the same
     membership check. Used for relay cleanup, message/note delete,
     and admin delete.
   - `POST /list` `{ prefix }` → admin only (73 email), lists keys
     under a room prefix. Replaces AdminPage's `listAll`.
   The Worker signs with the S3 SigV4 presigned-URL flow
   (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, or
   `aws4fetch`). B2's S3-compatible endpoint is region-specific,
   e.g. `https://s3.us-west-004.backblazeb2.com`.
3. **Firestore stays the source of truth for metadata.** The Firestore
   docs keep exactly the fields they have today (`storageUrl`,
   `thumbUrl`, `storagePath`, `thumbPath`, `archivedUrl`,
   `archivedPath`, `serverStored`, `localExpired`, `cachedBy`,
   `relayDeleted`). One change in meaning: `storageUrl` is no longer
   a permanent download URL. It is the presigned GET URL minted at
   upload time, and it expires. The durable identifier is
   `storagePath` (the B2 key). Whenever the app needs to download a
   file whose URL has expired, it calls `/sign-download` with the
   stored key and gets a fresh one. This is why every download path
   must go through the cache helpers in `localStore.ts`
   (`fetchBlobCached` / `fetchVideoCached`), never a raw `<img
   src={storageUrl}>` from a stale doc.

### Auth check in the Worker

The existing Express server (`server/index.js`) has the same job in
theory, but it is not deployed anywhere, it trusts `uid` from the
request body, and it allows CORS `*`. Do not reuse it as-is for
signing. The Worker must:

1. Verify the Firebase ID token. Options, in order of preference:
   (a) `firebase-admin` is not available in Workers; use the
   `jose` library to verify the JWT against Google's public keys
   and check `aud` = `petals-app-hi`, `iss`, and expiry.
   (b) Or call the Firebase Auth REST `getAccountInfo` endpoint
   with the token.
2. Check room membership: read the room doc from Firestore
   (Firestore REST API with a service-account token, or a small
   Firestore read via the REST API using the caller's own token is
   not sufficient for a cross-user check, so use a service account
   stored as a Worker secret). The caller must be in
   `rooms/{roomId}.members`, or be the admin email
   `shaikhhaziq73@gmail.com` (test only, same as the Firestore
   rules).
3. Validate the key: it must start with `rooms/{roomId}/` and match
   one of the patterns in the layout above, and the extension must
   match the declared content type (`image/webp` or `video/mp4`).

If any check fails, the Worker returns 403 and no URL is minted.
That replaces Firebase Storage rules entirely; there is no B2-side
per-user rule, the Worker is the rule.

### Why a Worker and not the existing Express server

- The Express server is not deployed anywhere, so signing through it
  means also picking and paying for hosting. The Worker is free,
  no card, no sleeping, no server to keep up, and 100k requests/day
  is far above 2-person use (a photo upload is 2-3 signer calls).
- If Haziq later deploys the Express server for real (room
  create/join, push), the signer can move there instead with the same
  endpoints and the same checks; the app code does not care which
  host signs, it only calls the three endpoints. Keep the signer
  interface stable for that reason.

## What changes in code

New file, same API surface as today so callers barely change:

- **`client/src/utils/b2Storage.ts`** (replaces
  `client/src/utils/storagePhotos.ts` as the storage backend; keep
  `storagePhotos.ts` until the swap is proven, then delete it):
  - `photoStoragePaths(roomId, noteId, photoId, isVideo)` — unchanged,
    returns the same keys.
  - `uploadStoredMedia(...)` — GET a presigned PUT from the Worker,
    PUT the blob with `fetch`, then PUT the thumb, then GET a
    presigned download URL for each and return
    `{ storageUrl, thumbUrl, storagePath, thumbPath }`.
  - `uploadStoredMediaResumable(..., onProgress)` — same signature
    (callers in NoteEditorPage and ChatPage keep `task.pause() /
    resume() / cancel()`). Implement the PUT with `XMLHttpRequest`
    so `upload.onprogress` gives a real 0-100. Honest limit: true
    S3 multipart resume is not in scope; pause/cancel aborts the
    XHR (the file is at most 50 MB, and photos are ~700 KB, so a
    restart is cheap). Document that in the function, do not fake
    a resume.
  - `deleteStoredMedia(storagePath, thumbPath)` — POST `/delete`
    for each key, failures swallowed (same as today).
  - `deleteRelayFullFile(storagePath)` — same, one `/delete`.
  - `uploadArchiveMedia(roomId, mediaId, blob, isVideo)` — PUT to
    the `archived/` key via a presigned URL, then verify by HEAD
    (or a presigned GET + `Content-Length` check) that the stored
    size equals `blob.size` before returning. Same contract as
    today, only the verification call changes from Firebase
    `getMetadata` to an HTTP HEAD.
  - `getDownloadUrl(storagePath)` — POST `/sign-download`, used
    by the cache helpers when a stored URL has expired.
  - `isOnCellular()` — unchanged, it does not depend on Firebase.
- **`client/src/utils/mediaArchive.ts`**:
  - `parseStoragePathFromUrl` currently only parses
    `firebasestorage.googleapis.com` URLs and returns `null` for
    anything else. That is fine as a fallback, but the archive job
    must rely on `BlobMeta.storagePath` (record it at upload time
    if it is not already recorded) instead of parsing a URL back.
    Update `resolveArchiveTarget` to try `meta.storagePath` first
    (it already does) and to accept B2 keys, which have the same
    `rooms/...` shape, so the regexes need no change.
  - The Firestore update after archiving is unchanged
    (`serverStored`, `archivedAt`, `archivedUrl`, `archivedPath`,
    `localExpired`, `mediaUrl`/`storageUrl`/`storagePath` pointed
    at the archived copy).
- **`client/src/utils/localStore.ts`** (`fetchBlobCached` /
  `fetchVideoCached`): when a fetch of a stored URL fails with 403
  (expired presigned URL), call `getDownloadUrl(storagePath)` and
  retry once. The `storagePath` must be passed through the callers
  that already have it.
- **`client/src/pages/AdminPage.tsx`**: replace `firebase/storage`
  `listAll` / `deleteObject` with Worker `/list` and `/delete`
  calls. Admin is still the 73 email only, test only.
- **`client/src/firebase.ts`**: remove `getStorage()` and the
  `storageBucket` env var once the swap is proven. Keep Auth and
  Firestore exactly as they are.
- **Config**: add `VITE_SIGNER_URL` (e.g.
  `https://petals-signer.<subdomain>.workers.dev`) to
  `client/.env.example`. No B2 key, key ID, or bucket secret ever
  goes in the app or in `.env` — only the public Worker URL.

## What stays the same

- Firestore (project `petals-app-hi`, Spark): rooms, notes, messages,
  users, notifications, and the rules being deployed now. Auth
  (email/password + Google, session persistence) is unchanged.
- The compressor (`imageCompressor.ts`): 1920px, WebP 0.86, 700 KB
  target, 400px thumb. Video caps: 60 s, 720p, 50 MB.
- Hidden nomedia local cache (`mediaStore.ts`): full files live in
  `Android/data/com.hi.petals/files/Petals/` with `.nomedia`, or
  IndexedDB on web. B2 is still only a relay + archive, exactly as
  Firebase Storage was. Auto-download, WiFi-only, Save to Gallery,
  and the Settings toggles are unchanged.
- The 30-day archive flow (`mediaArchive.ts`): after 30 days
  unopened, upload to the server (now B2 `archived/`), verify, then
  delete locally. Exemptions are unchanged: favourites/pinned,
  thumbnails, view-once media, legacy base64 photos.
- View-once: unchanged. View-once files are never archived and never
  re-downloadable from the server after viewing.
- `storage.rules` in the repo becomes dead code once the swap lands;
  delete it then, and note in `TEST_RELEASE_NOTES.md` that Storage
  rules are not used. `firestore.rules` stays live.

## Credentials and setup needed to implement this

Haziq must provide / create these. Nothing here needs a card.

1. **Backblaze B2 account** (free, email signup, no card):
   - Bucket: `petals-media`, private, Standard class.
   - Application key: one key scoped to that bucket only, with
     `readFiles, writeFiles, deleteFiles, listFiles` (create it in
     the B2 console, App Keys). Note the key ID and the key itself
     once, they are shown only once.
   - Endpoint: the S3 endpoint for the bucket's region, e.g.
     `https://s3.us-west-004.backblazeb2.com` (shown in the bucket
     page). The Worker needs the endpoint, bucket name, key ID,
     and application key.
2. **Cloudflare account** (free, email signup, no card for Workers):
   - Worker `petals-signer`, with secrets `B2_KEY_ID`,
     `B2_APPLICATION_KEY`, `B2_BUCKET`, `B2_ENDPOINT`, and a
     Firebase service-account JSON (or the public-key verification
     route, see above) as a secret.
   - The Worker URL goes in `VITE_SIGNER_URL`.
3. **No Firebase change**: no Blaze upgrade, no Storage enablement,
   no card. Firestore stays on Spark.

## Risks and honest limits

- Presigned GET URLs expire (1 hour in this design). Any code that
  stores a URL and reuses it days later will get a 403; that is why
  the download path must refresh through `/sign-download`. Grep for
  raw `storageUrl` / `mediaUrl` uses in `<img>` / `<video>` tags
  before shipping the swap.
- A single PUT (not multipart) means a 50 MB clip upload that fails
  at 99% restarts from 0. Acceptable for 2-person test use; add S3
  multipart presigned parts later only if clips actually fail.
- The Worker is a new trusted component: a bug in its room check is
  a privacy bug. Keep its key validation strict, log denials, and
  keep the bucket private so a Worker outage fails closed (no
  downloads) rather than open.
- B2's free egress is 3x stored, not unlimited. If both phones
  re-download everything every month, egress could pass the free
  allowance; in practice the nomedia cache means each file is
  downloaded once per device, so this should not happen at
  2-person scale. Watch the B2 usage page for the first month.
- Supabase's 1 GB and the free-project pause, and R2's card
  requirement, are the reasons those were not picked; if Haziq
  later adds a card, R2 is a drop-in replacement for B2 (same
  S3 presigned flow, same Worker, only the endpoint and the
  egress terms change).
