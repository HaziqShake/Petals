# Petals signer Worker

Mints short-lived presigned Backblaze B2 URLs for the Petals app. The B2
application key lives here as a Worker secret and never goes in the app.
Free Cloudflare Workers plan (100,000 requests/day), no card. Zero runtime
dependencies: SigV4 signing and the Firebase service-account JWT flow are
hand-rolled on WebCrypto.

## What the user must create first (nothing here is deployed yet)

1. **Free Backblaze B2 account** (email signup, no card):
   - Bucket `petals-media`, private, Standard class.
   - One application key scoped to that bucket only, with
     `readFiles, writeFiles, deleteFiles, listFiles`. Note the key ID and
     the key itself once, they are shown only once.
   - The bucket's S3 endpoint, e.g.
     `https://s3.us-west-004.backblazeb2.com` (shown on the bucket page).
2. **Free Cloudflare account** (email signup, no card for Workers).

## Deploy

From this folder (`worker/`):

```sh
npm install
npx wrangler login
npx wrangler secret put B2_KEY_ID
npx wrangler secret put B2_APPLICATION_KEY
# Optional but preferred: a Firebase service-account JSON (whole file,
# one line) so the Worker checks room membership with its own
# credentials instead of the caller's token. Without it the Worker
# falls back to reading the room doc with the caller's own ID token,
# which the Firestore rules only allow for room members (or the admin).
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
npx wrangler deploy
```

Then put the Worker URL in the app as `VITE_SIGNER_URL`
(see `client/.env.example`), e.g.
`https://petals-signer.<subdomain>.workers.dev`.

## Config

- `wrangler.toml` `[vars]`: `B2_BUCKET`, `B2_ENDPOINT`,
  `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY` (the public web API key,
  same one already in the app config), `ADMIN_EMAIL`.
- Secrets (never in this repo): `B2_KEY_ID`, `B2_APPLICATION_KEY`,
  `FIREBASE_SERVICE_ACCOUNT_JSON` (optional).

## Endpoints

All POST, all require `Authorization: Bearer <Firebase ID token>`,
except `GET /health`.

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /sign-upload` | `{ roomId, key, contentType, contentLength }` | `{ url, key, expiresIn }` PUT, 15 min |
| `POST /sign-download` | `{ key, method?: 'GET' \| 'HEAD' }` | `{ url, key, expiresIn }` GET 1h, HEAD 15 min |
| `POST /delete` | `{ key }` | `{ ok: true, key }` |
| `POST /list` | `{ prefix, continuationToken? }` | `{ keys, nextPageToken }` admin only |

Every endpoint verifies the ID token, checks the caller is a member of
the room in the key (or the admin email), and validates the key against
the Petals object layouts (`rooms/{roomId}/notes/...`,
`rooms/{roomId}/__chat__/...`, `rooms/{roomId}/archived/...`) with size
caps (full photo 2 MB, thumbnail 512 KB, video 50 MB). Failures return
401/403 and mint nothing. The bucket stays private, so a Worker outage
fails closed rather than open.

## CORS

Allowed origins: `capacitor://localhost`, `http://localhost:*` /
`https://localhost:*`, `127.0.0.1`, and `*.web.app` /
`*.firebaseapp.com`. Add a custom domain to `ALLOWED_ORIGINS` in
`src/index.js` if the web build is ever hosted on one.
