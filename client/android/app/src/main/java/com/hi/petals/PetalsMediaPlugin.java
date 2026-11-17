package com.hi.petals;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Size;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONException;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

// PetalsMedia: the native side of the custom media picker
// (utils/mediaPicker.ts + components/MediaPickerSheet.tsx).
//
// The picker is a custom in-app sheet, not the system file chooser:
// it lists the device's recent photos and videos as a grid with real
// thumbnails, so sending feels like Instagram, not like a file dialog.
// Two calls:
//   getRecentMedia({ limit }) -> { items: [{ id, mediaType, mimeType,
//     name, dateAdded, width, height, durationSeconds, thumbPath }] }
//     thumbPath is an absolute cache file path; the JS side loads it
//     with Capacitor.convertFileSrc. Thumbnails are 400px JPEGs in the
//     app cache, regenerated on demand, never in Gallery.
//   getMediaFile({ id, mediaType }) -> { path, name, mimeType, size }
//     copies the full original into the app cache so the JS side can
//     read it as a Blob and hand it to the normal upload flow
//     (compressor for photos, validation for videos).
//
// Permissions: READ_MEDIA_IMAGES / READ_MEDIA_VIDEO on Android 13+,
// READ_EXTERNAL_STORAGE below that (both already in the manifest).
// If the permission is missing, getRecentMedia rejects with
// "permission-denied" and the sheet shows an Allow access button
// that calls requestMediaPermission, which re-runs the query on grant.
// On web, or if this plugin is missing, the JS side falls back to the
// system file input, never to a dead picker.
@CapacitorPlugin(
    name = "PetalsMedia",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO }, alias = "media33"),
        @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = "mediaLegacy")
    }
)
public class PetalsMediaPlugin extends Plugin {

    private static class MediaItem {
        long id;
        String mediaType;
        String mimeType;
        String name;
        long dateAdded;
        int width;
        int height;
        int durationSeconds;
        Uri uri;
    }

    private String permissionAlias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? "media33" : "mediaLegacy";
    }

    @PluginMethod
    public void requestMediaPermission(PluginCall call) {
        if (hasPermission(permissionAlias())) {
            call.resolve();
            return;
        }
        requestPermissions(call);
    }

    @PermissionCallback
    private void mediaPermissionCallback(PluginCall call) {
        if (hasPermission(permissionAlias())) {
            call.resolve();
        } else {
            call.reject("permission-denied");
        }
    }

    @PluginMethod
    public void getRecentMedia(PluginCall call) {
        if (!hasPermission(permissionAlias())) {
            call.reject("permission-denied");
            return;
        }
        int limit = call.getInt("limit", 60);
        if (limit <= 0 || limit > 200) limit = 60;
        try {
            List<MediaItem> items = new ArrayList<>();
            items.addAll(queryMedia(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "image", limit));
            items.addAll(queryMedia(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, "video", limit));
            Collections.sort(items, (a, b) -> Long.compare(b.dateAdded, a.dateAdded));
            if (items.size() > limit) items = items.subList(0, limit);

            File thumbDir = new File(getContext().getCacheDir(), "petals-picker-thumbs");
            if (!thumbDir.exists()) thumbDir.mkdirs();

            JSArray out = new JSArray();
            for (MediaItem item : items) {
                JSObject obj = new JSObject();
                obj.put("id", item.mediaType + ":" + item.id);
                obj.put("mediaType", item.mediaType);
                obj.put("mimeType", item.mimeType);
                obj.put("name", item.name);
                obj.put("dateAdded", item.dateAdded);
                obj.put("width", item.width);
                obj.put("height", item.height);
                obj.put("durationSeconds", item.durationSeconds);
                String thumbPath = writeThumbnail(item, thumbDir);
                if (thumbPath != null) obj.put("thumbPath", thumbPath);
                out.put(obj);
            }
            JSObject result = new JSObject();
            result.put("items", out);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Could not read media: " + e.getMessage());
        }
    }

    private List<MediaItem> queryMedia(Uri collection, String mediaType, int limit) {
        List<MediaItem> items = new ArrayList<>();
        String[] projection = {
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.DATE_ADDED,
            MediaStore.MediaColumns.WIDTH,
            MediaStore.MediaColumns.HEIGHT,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.DURATION
        };
        String sort = MediaStore.MediaColumns.DATE_ADDED + " DESC LIMIT " + limit;
        ContentResolver resolver = getContext().getContentResolver();
        try (Cursor cursor = resolver.query(collection, projection, null, null, sort)) {
            if (cursor == null) return items;
            int idCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID);
            int nameCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME);
            int mimeCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE);
            int dateCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_ADDED);
            int widthCol = cursor.getColumnIndex(MediaStore.MediaColumns.WIDTH);
            int heightCol = cursor.getColumnIndex(MediaStore.MediaColumns.HEIGHT);
            int durationCol = cursor.getColumnIndex(MediaStore.MediaColumns.DURATION);
            while (cursor.moveToNext()) {
                MediaItem item = new MediaItem();
                item.id = cursor.getLong(idCol);
                item.mediaType = mediaType;
                item.name = cursor.getString(nameCol);
                item.mimeType = cursor.getString(mimeCol);
                item.dateAdded = cursor.getLong(dateCol);
                item.width = widthCol >= 0 ? cursor.getInt(widthCol) : 0;
                item.height = heightCol >= 0 ? cursor.getInt(heightCol) : 0;
                item.durationSeconds = durationCol >= 0 ? (int) (cursor.getLong(durationCol) / 1000) : 0;
                item.uri = ContentUris.withAppendedId(collection, item.id);
                items.add(item);
            }
        } catch (Exception ignored) {
            // One collection failing must not kill the other.
        }
        return items;
    }

    // 400px JPEG thumbnail in the app cache. loadThumbnail needs API 29;
    // below that there is no thumbnail and the sheet shows a placeholder.
    private String writeThumbnail(MediaItem item, File thumbDir) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null;
        try {
            Bitmap thumb = getContext().getContentResolver().loadThumbnail(item.uri, new Size(400, 400), null);
            File out = new File(thumbDir, item.mediaType + "_" + item.id + ".jpg");
            try (OutputStream os = new FileOutputStream(out)) {
                thumb.compress(Bitmap.CompressFormat.JPEG, 80, os);
            }
            return out.getAbsolutePath();
        } catch (Exception ignored) {
            return null;
        }
    }

    @PluginMethod
    public void getMediaFile(PluginCall call) {
        if (!hasPermission(permissionAlias())) {
            call.reject("permission-denied");
            return;
        }
        String id = call.getString("id");
        String mediaType = call.getString("mediaType", "image");
        if (id == null || id.isEmpty()) {
            call.reject("id is required");
            return;
        }
        try {
            long numericId = Long.parseLong(id.contains(":") ? id.substring(id.indexOf(':') + 1) : id);
            Uri collection = "video".equals(mediaType)
                    ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                    : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            Uri uri = ContentUris.withAppendedId(collection, numericId);
            ContentResolver resolver = getContext().getContentResolver();
            String mimeType = null;
            String name = null;
            String[] projection = { MediaStore.MediaColumns.MIME_TYPE, MediaStore.MediaColumns.DISPLAY_NAME };
            try (Cursor cursor = resolver.query(uri, projection, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    mimeType = cursor.getString(0);
                    name = cursor.getString(1);
                }
            }
            if (mimeType == null) mimeType = "video".equals(mediaType) ? "video/mp4" : "image/jpeg";
            if (name == null) name = "petals-" + numericId;
            String ext = mimeType.contains("/") ? mimeType.substring(mimeType.indexOf('/') + 1) : "bin";
            File pickDir = new File(getContext().getCacheDir(), "petals-pick");
            if (!pickDir.exists()) pickDir.mkdirs();
            File out = new File(pickDir, mediaType + "_" + numericId + "." + ext);
            long size = 0;
            try (InputStream in = resolver.openInputStream(uri);
                 OutputStream os = new FileOutputStream(out)) {
                if (in == null) {
                    call.reject("Could not open media");
                    return;
                }
                byte[] buf = new byte[8192];
                int read;
                while ((read = in.read(buf)) != -1) {
                    os.write(buf, 0, read);
                    size += read;
                }
            }
            JSObject result = new JSObject();
            result.put("path", out.getAbsolutePath());
            result.put("name", name);
            result.put("mimeType", mimeType);
            result.put("size", size);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Could not read media file: " + e.getMessage());
        }
    }
}
