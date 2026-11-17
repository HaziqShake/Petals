// In-app update flow (test-release).
//
// Full flow inside the app, no browser:
// 1. Check: GET the releases list for HaziqShake/Petals from inside
//    the app and compare the newest non-draft release tag to the
//    version baked in at build time (__APP_VERSION__ from
//    vite.config.ts, which now reads client/package.json, so the web
//    version and the native versionName in android/app/build.gradle
//    both come from package.json). On Android the native versionName
//    from the PetalsUpdate plugin is preferred when available.
// 2. Download: the APK asset is downloaded inside the app with
//    progress. On Android the native PetalsUpdate plugin downloads
//    it to the app cache dir; on web it is a plain file download.
// 3. Install: on Android the plugin fires the install intent for
//    the downloaded APK through the FileProvider already in
//    AndroidManifest.xml. Android 8+ needs the "install unknown
//    apps" permission for Petals first; the flow opens that settings
//    screen when it is missing instead of failing silently.
//
// The releases LIST endpoint is used on purpose, not
// /releases/latest: /latest only returns full releases, and test
// tags like v0.1.0-test.1 are prereleases, so /latest would 404
// even when a test release exists. The list returns newest first
// including prereleases; drafts are skipped.
//
// Live fact, 2026-11-17: the repo has NO releases at all yet
// (GET /releases returns []), so the check reports 'no-release'
// until a tag is pushed. That is a real state, not a silent null.
declare const __APP_VERSION__: string;
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { kvGet, kvSet } from './localStore';

const REPO = 'HaziqShake/Petals';
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases?per_page=10`;
const UPDATE_CACHE_KEY = 'update-check';
const UPDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  tagName: string;
  downloadUrl: string | null;
  assetSize: number | null;
  releaseUrl: string;
  releaseNotes: string;
}

export type CheckStatus = 'available' | 'up-to-date' | 'no-release' | 'error';

export interface CheckResult {
  status: CheckStatus;
  info: UpdateInfo | null;
  message: string | null;
}

// Native side: PetalsUpdatePlugin.java, registered in MainActivity.
// On web, or if the plugin is missing, every call rejects and the
// callers fall back (web version string, file download, no install
// intent), never to a silent failure.
interface PetalsUpdatePlugin {
  getAppVersion(): Promise<{ versionName: string; versionCode: number }>;
  canInstallUnknownApps(): Promise<{ canInstall: boolean }>;
  openInstallSettings(): Promise<void>;
  downloadApk(options: { url: string }): Promise<{ path: string; size: number }>;
  installApk(options: { path: string }): Promise<void>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (data: { progress: number }) => void,
  ): Promise<PluginListenerHandle>;
}
const PetalsUpdate = registerPlugin<PetalsUpdatePlugin>('PetalsUpdate');

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

// Current version. Native versionName first on Android (it is the
// version the installer sees), __APP_VERSION__ otherwise.
export async function currentVersion(): Promise<string> {
  if (isNative()) {
    try {
      const v = await PetalsUpdate.getAppVersion();
      if (v?.versionName) return v.versionName;
    } catch { /* fall through to the baked-in version */ }
  }
  try {
    return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function normalise(v: string): string {
  return v.trim().replace(/^v/i, '');
}

interface ParsedVersion {
  nums: number[];
  pre: string[];
}

function parseSemver(v: string): ParsedVersion {
  const clean = normalise(v).split('+')[0];
  const [core, ...preParts] = clean.split('-');
  const nums = core.split('.').map((n) => {
    const m = parseInt(n, 10);
    return Number.isNaN(m) ? 0 : m;
  });
  while (nums.length < 3) nums.push(0);
  return { nums: nums.slice(0, 3), pre: preParts.join('-').split('.').filter(Boolean) };
}

// Real semver comparison: -1 if a < b, 0 if equal, 1 if a > b.
// A plain string compare is wrong here: '0.1.0' is NEWER than
// '0.1.0-test.1' (a release beats its prerelease), and '0.1.0-test.10'
// is newer than '0.1.0-test.2' (numeric, not lexicographic).
export function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1;
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;
  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn) return -1;
    if (yn) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function resultFromCached(cached: UpdateInfo, current: string): CheckResult {
  const available = compareVersions(cached.latestVersion, current) > 0;
  return {
    status: available ? 'available' : 'up-to-date',
    info: { ...cached, currentVersion: current, available },
    message: null,
  };
}

export async function checkForUpdate(opts: { force?: boolean } = {}): Promise<CheckResult> {
  const current = await currentVersion();
  // Cache the GitHub result for a day: the release does not change
  // hourly, and this saves a network call on every app open. A
  // manual check (force) always goes to the network.
  if (!opts.force) {
    const cached = await kvGet<UpdateInfo>(UPDATE_CACHE_KEY);
    if (cached && cached.currentVersion === current) return resultFromCached(cached, current);
  }
  let res: Response;
  try {
    res = await fetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' } });
  } catch {
    return { status: 'error', info: null, message: 'You appear to be offline. Check your connection and try again.' };
  }
  if (!res.ok) {
    if (res.status === 403) {
      return { status: 'error', info: null, message: 'GitHub rate limit reached. Try again in a little while.' };
    }
    return { status: 'error', info: null, message: `Could not check for updates (GitHub returned ${res.status}). Try again later.` };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { status: 'error', info: null, message: 'GitHub sent a reply the app could not read. Try again later.' };
  }
  const releases = (Array.isArray(data) ? data : []) as {
    tag_name?: string;
    draft?: boolean;
    html_url?: string;
    body?: string;
    assets?: { name: string; browser_download_url: string; size?: number }[];
  }[];
  const release = releases.find((r) => !r.draft && r.tag_name);
  if (!release || !release.tag_name) {
    return { status: 'no-release', info: null, message: 'No releases published yet.' };
  }
  const latest = normalise(release.tag_name);
  const apk = release.assets?.find((a) => a.name.toLowerCase().endsWith('.apk'));
  const info: UpdateInfo = {
    available: compareVersions(latest, current) > 0,
    currentVersion: current,
    latestVersion: latest,
    tagName: release.tag_name,
    downloadUrl: apk ? apk.browser_download_url : null,
    assetSize: apk?.size ?? null,
    releaseUrl: release.html_url ?? `https://github.com/${REPO}/releases`,
    releaseNotes: release.body ?? '',
  };
  await kvSet(UPDATE_CACHE_KEY, info, UPDATE_CACHE_TTL_MS);
  return { status: info.available ? 'available' : 'up-to-date', info, message: null };
}

// Download the APK asset inside the app, with progress 0-100.
// Native: the plugin downloads to the app cache dir and reports
// progress events; the returned path is the file to hand to
// installUpdate(). Web: a plain file download, no install step.
export async function downloadUpdate(
  info: UpdateInfo,
  onProgress: (pct: number) => void,
): Promise<{ path: string; size: number }> {
  if (!info.downloadUrl) throw new Error('This release has no APK file attached yet.');
  if (isNative()) {
    let handle: PluginListenerHandle | undefined;
    try {
      handle = await PetalsUpdate.addListener('downloadProgress', (d) => onProgress(d.progress));
      const out = await PetalsUpdate.downloadApk({ url: info.downloadUrl });
      onProgress(100);
      return { path: out.path, size: out.size };
    } finally {
      await handle?.remove().catch(() => undefined);
    }
  }
  const res = await fetch(info.downloadUrl);
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length') ?? info.assetSize ?? 0);
  const reader = res.body?.getReader();
  if (!reader) {
    const blob = await res.blob();
    saveBlob(blob, `petals-${info.latestVersion}.apk`);
    onProgress(100);
    return { path: '', size: blob.size };
  }
  const chunks: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      if (total > 0) onProgress(Math.min(100, Math.round((received / total) * 100)));
    }
  }
  const blob = new Blob(chunks, { type: 'application/vnd.android.package-archive' });
  saveBlob(blob, `petals-${info.latestVersion}.apk`);
  onProgress(100);
  return { path: '', size: blob.size };
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}

// Fire the Android install intent for a downloaded APK.
// Returns needsPermission when Petals is not allowed to install
// unknown apps yet; the caller should show the "Open settings"
// step and let the user tap Install again after allowing it.
export async function installUpdate(
  downloadedPath: string,
): Promise<{ started: boolean; needsPermission: boolean }> {
  if (!isNative()) throw new Error('APK install only works in the Android app.');
  if (!downloadedPath) throw new Error('No downloaded APK to install. Download it first.');
  let canInstall = true;
  try {
    canInstall = (await PetalsUpdate.canInstallUnknownApps()).canInstall;
  } catch { /* if the check fails, try the intent and let Android say no */ }
  if (!canInstall) return { started: false, needsPermission: true };
  await PetalsUpdate.installApk({ path: downloadedPath });
  return { started: true, needsPermission: false };
}

export async function openInstallSettings(): Promise<void> {
  if (!isNative()) return;
  await PetalsUpdate.openInstallSettings().catch(() => undefined);
}

export async function canInstallUnknownApps(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    return (await PetalsUpdate.canInstallUnknownApps()).canInstall;
  } catch {
    return false;
  }
}
