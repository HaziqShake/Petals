# Video research for Petals (test-release)

## Verdict
Short clips are feasible. Long HD video is not, on Firebase free and on a low end phone.

## Numbers
- 30 seconds at 720p from a phone: about 10 to 20MB.
- 60 seconds at 720p: about 20 to 50MB. This is the test cap: 60 seconds, 720p max, 50MB max, 1 clip per note, 1 clip per chat message batch is capped at a few.
- 5GB free Storage: about 340 clips at 15MB average, or about 100 clips at 50MB.
- 1GB a day free download: about 65 full 15MB clips a day.
- Firebase Storage download URLs support range requests, so `<video preload="metadata">` does not download the whole file to show a poster.

## What is in the test build
- Pick a video with the same photo button in the editor, or the + button in Chat.
- Validation before upload, using `VIDEO_MAX_SECONDS = 60`, `VIDEO_MAX_MB = 50`, `VIDEO_MAX_WIDTH = 1280`, `VIDEO_MAX_HEIGHT = 720` in `client/src/utils/imageCompressor.ts`. Over the limit is rejected with a friendly message, never silently downscaled.
- Poster frame from the first frame via canvas (`makeVideoPoster`), stored as a WebP thumbnail.
- Upload is resumable with progress (`uploadStoredMediaResumable`), WiFi-only option in the editor and in Chat.
- Storage path `rooms/{roomId}/notes/{noteId}/photos/{id}.mp4` and chat media under `rooms/{roomId}/__chat__/{id}.mp4`, metadata in the same photos subcollection / messages collection with `mediaType: 'video'` and `durationSeconds`.
- Playback is `<video controls preload="metadata">`, no autoplay.
- Local cache: short clips up to 50MB are cached in IndexedDB when opened in the Lightbox (`fetchVideoCached`), total media cache 500MB, LRU by last viewed, pinned media kept. Clips over 50MB keep only a thumbnail. See `client/src/utils/localStore.ts`.

## What is not in the test build
- No transcoding in the app. `ffmpeg.wasm` is about 30MB to download, slow and hot on a low end phone, and it would blow up the bundle. Do not add it.
- No server transcode yet. The later step is a Cloud Function with ffmpeg: on Storage upload, transcode to 720p H.264/AAC, write a `-720p.mp4` next to the original, and update the doc to point at it. That needs the Blaze plan and Cloud Functions, and it is documented in `TEST_RELEASE_NOTES.md` under push setup.
- No video in the Photos grid. Videos show in the note and in Chat, not in the Photos tab, which stays image only in this build.

## Costs if clips grow
- Storage after the free 5GB: $0.026 per GB per month.
- Download after the free 1GB a day: $0.12 per GB.
- At 100 clips a month at 15MB, storage grows about 1.5GB a month, so the free allowance lasts about 3 months of that pace, then a few cents a month.
