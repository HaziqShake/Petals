// Petals signer Worker (test-release, 2026-11-17).
//
// Mints short-lived presigned B2 (S3-compatible) URLs for the Petals app.
// The B2 application key NEVER goes in the app: it lives here as Worker
// secrets (B2_KEY_ID / B2_APPLICATION_KEY) and only this Worker signs.
//
// Free Cloudflare Workers plan, no card. Zero runtime dependencies:
// SigV4 signing and the Firebase service-account JWT flow are hand-rolled
// on WebCrypto (crypto.subtle), so there is nothing to npm install.
//
// Endpoints (all POST except /health, all require a Firebase ID token
// in `Authorization: Bearer <token>` unless noted):
//   GET  /health                       no auth, liveness only
//   POST /sign-upload   { roomId, key, contentType, contentLength }
//                       -> { url, key, expiresIn }  (PUT, 15 min)
//   POST /sign-download { key, method?: 'GET' | 'HEAD' }
//                       -> { url, key, expiresIn }  (GET 1h, HEAD 15 min)
//   POST /delete        { key } -> { ok: true }
//   POST /list          { prefix } -> { keys, nextPageToken? }  (admin only)
//
// Auth checks, in order, on every endpoint:
//   1. Verify the Firebase ID token via the Identity Toolkit REST
//      accounts:lookup call (option (b) in docs/FREE_STORAGE_ALTERNATIVE.md).
//      A bad/expired token gets 401 and nothing else runs.
//   2. Room membership: the caller must be in rooms/{roomId}.members, or
//      be the admin email. Membership is read from Firestore:
//      - with a service-account access token when the
//        FIREBASE_SERVICE_ACCOUNT_JSON secret is set (preferred), or
//      - with the caller's own ID token against the Firestore REST API
//        when it is not set. The Firestore rules only let room members
//        (or the admin) read a room doc, so a non-member read fails and
//        the request is denied. Either way a non-member gets 403.
//   3. Key validation: the key must start with rooms/{roomId}/ and match
//      one of the Petals object layouts, with an extension matching the
//      declared content type, and the declared size under the caps
//      (full photo 2 MB, thumbnail 512 KB, video 50 MB).
// If any check fails the Worker returns 403 and mints nothing. The bucket
// stays private, so a Worker outage fails closed (no downloads) rather
// than open.
//
// Secrets (wrangler secret put <name>): B2_KEY_ID, B2_APPLICATION_KEY,
// FIREBASE_SERVICE_ACCOUNT_JSON (optional, whole JSON, one line).
// Vars (wrangler.toml): B2_BUCKET, B2_ENDPOINT, FIREBASE_PROJECT_ID,
// FIREBASE_API_KEY, ADMIN_EMAIL.
//
// Deploy: `npx wrangler deploy` from this folder. The public Worker URL
// goes in the app as VITE_SIGNER_URL (client/.env.example). No B2 key,
// key ID, or bucket secret ever goes in the app or in this repo.

const ADMIN_FALLBACK_EMAIL = 'shaikhhaziq73@gmail.com';

// Size caps enforced on /sign-upload. The compressor targets 700 KB for
// a full photo, so 2 MB leaves headroom for an overshoot; thumbnails are
// 400px WebP (~60-80 KB); clips are capped at 50 MB by the app.
const MAX_FULL_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_THUMB_BYTES = 512 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

const ALLOWED_ORIGINS = [
  // Capacitor native shell.
  'capacitor://localhost',
  // Local dev / preview.
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  // Firebase Hosting default domains, in case the web build is hosted there.
  /^https:\/\/[a-z0-9-]+\.web\.app$/,
  /^https:\/\/[a-z0-9-]+\.firebaseapp\.com$/,
];

function corsHeaders(origin) {
  const allowed = typeof origin === 'string' && ALLOWED_ORIGINS.some((o) =>
    typeof o === 'string' ? o === origin : o.test(origin));
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

// ---------------------------------------------------------------------------
// Small WebCrypto helpers (hex, HMAC-SHA256, SHA-256).
// ---------------------------------------------------------------------------

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(key, data) {
  const k = typeof key === 'string'
    ? await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    : key;
  return crypto.subtle.sign('HMAC', k, typeof data === 'string' ? new TextEncoder().encode(data) : data);
}

async function sha256Hex(data) {
  const buf = await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data);
  return hex(buf);
}

function b64url(bytes) {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Firebase ID token verification (Identity Toolkit accounts:lookup).
// Returns { uid, email } or null when the token is bad/expired.
// ---------------------------------------------------------------------------

async function verifyIdToken(env, idToken) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const user = Array.isArray(data.users) ? data.users[0] : null;
  if (!user || !user.localId) return null;
  return { uid: user.localId, email: user.email ?? '' };
}

// ---------------------------------------------------------------------------
// Firestore room read. Prefers a service-account access token; falls back
// to the caller's own ID token (Firestore rules enforce membership there).
// Returns the room doc fields object, or null when unreadable.
// ---------------------------------------------------------------------------

function pemToDer(pem) {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

let cachedServiceToken = null; // { token, expiresAt }

async function getServiceAccountToken(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) return null;
  if (cachedServiceToken && cachedServiceToken.expiresAt > Date.now() + 60_000) {
    return cachedServiceToken.token;
  }
  let sa;
  try {
    sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${b64url(sig)}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.access_token) return null;
  cachedServiceToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

async function readRoomDoc(env, roomId, callerToken) {
  const path = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/rooms/${encodeURIComponent(roomId)}`;
  const url = `https://firestore.googleapis.com/v1/${path}`;
  const saToken = await getServiceAccountToken(env);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${saToken ?? callerToken}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.fields ?? {};
}

function roomMembers(fields) {
  const arr = fields?.members?.arrayValue?.values ?? [];
  return arr.map((v) => v.stringValue).filter(Boolean);
}

async function isRoomMember(env, roomId, caller, callerToken) {
  if (caller.email && caller.email === (env.ADMIN_EMAIL || ADMIN_FALLBACK_EMAIL)) return true;
  const fields = await readRoomDoc(env, roomId, callerToken);
  if (!fields) return false;
  return roomMembers(fields).includes(caller.uid);
}

// ---------------------------------------------------------------------------
// Key validation. Petals object layouts (B2 keys, same as the old
// Firebase Storage paths):
//   rooms/{roomId}/notes/{noteId}/photos/{photoId}.webp
//   rooms/{roomId}/notes/{noteId}/photos/{photoId}-thumb.webp
//   rooms/{roomId}/notes/{noteId}/photos/{photoId}.mp4
//   rooms/{roomId}/__chat__/{messageId}.webp | .mp4
//   rooms/{roomId}/archived/{mediaId}.webp | .mp4
// ---------------------------------------------------------------------------

const KEY_PATTERNS = [
  /^rooms\/([^/]+)\/notes\/([^/]+)\/photos\/([^/]+?)(-thumb)?\.(webp|mp4)$/,
  /^rooms\/([^/]+)\/__chat__\/([^/]+)\.(webp|mp4)$/,
  /^rooms\/([^/]+)\/archived\/([^/]+)\.(webp|mp4)$/,
];

function parseKey(key) {
  if (typeof key !== 'string' || !key || key.includes('..') || key.includes('\\')) return null;
  for (const re of KEY_PATTERNS) {
    const m = key.match(re);
    if (!m) continue;
    const roomId = m[1];
    const isThumb = key.includes('/photos/') && key.endsWith('-thumb.webp');
    const ext = key.endsWith('.webp') ? 'webp' : 'mp4';
    return { roomId, isThumb, ext };
  }
  return null;
}

function sizeCap(parsed) {
  if (parsed.ext === 'mp4') return MAX_VIDEO_BYTES;
  if (parsed.isThumb) return MAX_THUMB_BYTES;
  return MAX_FULL_PHOTO_BYTES;
}

function contentTypeMatches(contentType, parsed) {
  if (parsed.ext === 'webp') return contentType === 'image/webp';
  if (parsed.ext === 'mp4') return contentType === 'video/mp4';
  return false;
}

// ---------------------------------------------------------------------------
// S3 SigV4: presigned URLs and signed requests against the B2 S3 endpoint.
// Region is parsed from the endpoint host, e.g.
// s3.us-west-004.backblazeb2.com -> us-west-004.
// ---------------------------------------------------------------------------

function b2Region(env) {
  if (env.B2_REGION) return env.B2_REGION;
  const m = String(env.B2_ENDPOINT ?? '').match(/s3\.([^.]+)\.backblazeb2\.com/);
  return m ? m[1] : 'us-west-004';
}

async function signingKey(env, dateStamp, region) {
  const kDate = await hmac(`AWS4${env.B2_APPLICATION_KEY}`, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

function amzDates() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return { amzDate: stamp, dateStamp: stamp.slice(0, 8) };
}

// Presigned URL for one method (PUT/GET/HEAD/DELETE) on one key.
async function presignUrl(env, method, key, expiresSeconds) {
  const region = b2Region(env);
  const { amzDate, dateStamp } = amzDates();
  const host = new URL(env.B2_ENDPOINT).host;
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const params = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${env.B2_KEY_ID}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  });
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const canonicalRequest = [
    method,
    `/${env.B2_BUCKET}/${encodedKey}`,
    params.toString(),
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');
  const key2 = await signingKey(env, dateStamp, region);
  const signature = hex(await hmac(key2, stringToSign));
  params.set('X-Amz-Signature', signature);
  return `${env.B2_ENDPOINT}/${env.B2_BUCKET}/${encodedKey}?${params.toString()}`;
}

// Signed (header-auth) request to B2, used for DELETE and ListObjectsV2.
async function signedB2Request(env, method, pathAndQuery, body = '') {
  const region = b2Region(env);
  const { amzDate, dateStamp } = amzDates();
  const host = new URL(env.B2_ENDPOINT).host;
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const url = new URL(`${env.B2_ENDPOINT}/${env.B2_BUCKET}${pathAndQuery}`);
  const payloadHash = await sha256Hex(body);
  const canonicalRequest = [
    method,
    `/${env.B2_BUCKET}${new URL(url).pathname.slice(`/${env.B2_BUCKET}`.length) || '/'}`,
    url.searchParams.toString(),
    `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`,
    'host;x-amz-content-sha256;x-amz-date',
    payloadHash,
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');
  const key = await signingKey(env, dateStamp, region);
  const signature = hex(await hmac(key, stringToSign));
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${env.B2_KEY_ID}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  });
  return res;
}

// ---------------------------------------------------------------------------
// Request handling.
// ---------------------------------------------------------------------------

async function requireAuth(request, env, origin) {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return { error: json({ error: 'Missing Authorization Bearer token' }, 401, origin) };
  const caller = await verifyIdToken(env, token);
  if (!caller) return { error: json({ error: 'Invalid or expired Firebase ID token' }, 401, origin) };
  return { caller, token };
}

async function handleSignUpload(env, caller, token, body, origin) {
  const { roomId, key, contentType, contentLength } = body ?? {};
  const parsed = parseKey(key);
  if (!parsed || parsed.roomId !== roomId) {
    return json({ error: 'Key does not match an allowed Petals object layout for this room' }, 403, origin);
  }
  if (!contentTypeMatches(contentType, parsed)) {
    return json({ error: 'Content type does not match the key extension' }, 403, origin);
  }
  if (typeof contentLength !== 'number' || contentLength <= 0 || contentLength > sizeCap(parsed)) {
    return json({ error: `Content length exceeds the cap for this file type (${sizeCap(parsed)} bytes)` }, 403, origin);
  }
  if (!(await isRoomMember(env, roomId, caller, token))) {
    return json({ error: 'Caller is not a member of this room' }, 403, origin);
  }
  // Only the host header is signed, so the app may send Content-Type
  // freely on the PUT; the type was already validated above.
  const url = await presignUrl(env, 'PUT', key, 15 * 60);
  return json({ url, key, expiresIn: 15 * 60 }, 200, origin);
}

async function handleSignDownload(env, caller, token, body, origin) {
  const { key, method } = body ?? {};
  const verb = method === 'HEAD' ? 'HEAD' : 'GET';
  const parsed = parseKey(key);
  if (!parsed) return json({ error: 'Key does not match an allowed Petals object layout' }, 403, origin);
  if (!(await isRoomMember(env, parsed.roomId, caller, token))) {
    return json({ error: 'Caller is not a member of this room' }, 403, origin);
  }
  const expiresIn = verb === 'HEAD' ? 15 * 60 : 60 * 60;
  const url = await presignUrl(env, verb, key, expiresIn);
  return json({ url, key, expiresIn }, 200, origin);
}

async function handleDelete(env, caller, token, body, origin) {
  const { key } = body ?? {};
  const parsed = parseKey(key);
  if (!parsed) return json({ error: 'Key does not match an allowed Petals object layout' }, 403, origin);
  if (!(await isRoomMember(env, parsed.roomId, caller, token))) {
    return json({ error: 'Caller is not a member of this room' }, 403, origin);
  }
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const res = await signedB2Request(env, 'DELETE', `/${encodedKey}`);
  // B2 returns 204 on delete, 404 when the object was already gone;
  // both mean the key is gone, which is the outcome the app wants.
  if (res.status !== 204 && res.status !== 404) {
    return json({ error: `B2 delete failed (HTTP ${res.status})` }, 502, origin);
  }
  return json({ ok: true, key }, 200, origin);
}

async function handleList(env, caller, _token, body, origin) {
  if (!caller.email || caller.email !== (env.ADMIN_EMAIL || ADMIN_FALLBACK_EMAIL)) {
    return json({ error: 'Admin only' }, 403, origin);
  }
  const { prefix, continuationToken } = body ?? {};
  if (typeof prefix !== 'string' || !prefix.startsWith('rooms/') || prefix.includes('..')) {
    return json({ error: 'Prefix must start with rooms/' }, 403, origin);
  }
  const params = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': '1000' });
  if (continuationToken) params.set('continuation-token', continuationToken);
  const res = await signedB2Request(env, 'GET', `/?${params.toString()}`);
  if (!res.ok) return json({ error: `B2 list failed (HTTP ${res.status})` }, 502, origin);
  const xml = await res.text();
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
  const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
  return json({ keys, nextPageToken: next ? next[1] : null }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ ok: true, service: 'petals-signer' }, 200, origin);
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, origin);
    }
    if (!env.B2_KEY_ID || !env.B2_APPLICATION_KEY || !env.B2_BUCKET || !env.B2_ENDPOINT
      || !env.FIREBASE_PROJECT_ID || !env.FIREBASE_API_KEY) {
      return json({ error: 'Signer is not configured (missing Worker secrets/vars)' }, 500, origin);
    }
    const { error, caller, token } = await requireAuth(request, env, origin);
    if (error) return error;
    let body = null;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Request body must be JSON' }, 400, origin);
    }
    try {
      if (url.pathname === '/sign-upload') return await handleSignUpload(env, caller, token, body, origin);
      if (url.pathname === '/sign-download') return await handleSignDownload(env, caller, token, body, origin);
      if (url.pathname === '/delete') return await handleDelete(env, caller, token, body, origin);
      if (url.pathname === '/list') return await handleList(env, caller, token, body, origin);
      return json({ error: 'Unknown endpoint' }, 404, origin);
    } catch (e) {
      // Log the denial/failure server-side; the client only gets a
      // generic error so internals never leak to the app.
      console.error('petals-signer error', url.pathname, e instanceof Error ? e.message : String(e));
      return json({ error: 'Signer failed' }, 500, origin);
    }
  },
};
