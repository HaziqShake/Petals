// Cached image URL hook. Returns a local object URL when the thumbnail
// or photo is already in IndexedDB, otherwise the remote URL, and
// fetches + caches it in the background so the next open is instant,
// unless auto-download is off or the user is on mobile data with the
// WiFi-only setting on (Settings, mediaStore.shouldAutoDownload).
// Callers never revoke the returned URL; localStore owns it.
import { useState, useEffect } from 'react';
import { getCachedBlobUrl, fetchBlobCached } from '../utils/localStore';
import { shouldAutoDownload } from '../utils/mediaStore';

// storagePath is the durable B2 key. When the stored presigned URL has
// expired (403), the cache helpers mint a fresh one from it and retry.
export function useCachedUrl(url: string | undefined, storagePath?: string): string | undefined {
  const [src, setSrc] = useState<string | undefined>(url);
  useEffect(() => {
    if (!url || url.startsWith('data:')) { setSrc(url); return; }
    let alive = true;
    setSrc(url);
    void getCachedBlobUrl(url).then((cached) => {
      if (!alive || !cached) return;
      setSrc(cached);
      return;
    });
    // Background fetch so the next open hits the cache, even if this
    // open used the remote URL. Skipped when auto-download is off or
    // the user is on mobile data with WiFi-only on.
    if (shouldAutoDownload()) {
      void fetchBlobCached(url, { storagePath }).then((fresh) => { if (alive) setSrc(fresh); }).catch(() => undefined);
    }
    return () => { alive = false; };
  }, [url, storagePath]);
  return src;
}
