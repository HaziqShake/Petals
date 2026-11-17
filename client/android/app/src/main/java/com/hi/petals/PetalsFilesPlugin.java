package com.hi.petals;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

// PetalsFiles: the native side of utils/mediaStore.ts.
//
// saveToGallery reads a file from the hidden app-specific folder
// (Android/data/com.hi.petals/files/Petals/, never indexed by Gallery)
// and writes it to MediaStore, Pictures/Petals or Movies/Petals, so it
// appears in Gallery. The hidden copy is left alone by this plugin;
// the JS side deletes it only when the user chose Move in Settings.
// openFolder opens that hidden folder in the system Files app.
//
// This plugin is registered in MainActivity. If it is missing, the JS
// side falls back to a Documents write or a path copy, never silently.
@CapacitorPlugin(name = "PetalsFiles")
public class PetalsFilesPlugin extends Plugin {

    @PluginMethod
    public void saveToGallery(PluginCall call) {
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "image/webp");
        boolean isVideo = call.getBoolean("isVideo", false);
        if (fileName == null || fileName.isEmpty()) {
            call.reject("fileName is required");
            return;
        }
        try {
            File hiddenDir = new File(getContext().getExternalFilesDir(null), "Petals");
            File source = new File(hiddenDir, fileName);
            if (!source.exists()) {
                call.reject("Hidden file not found: " + fileName);
                return;
            }
            Uri galleryUri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = getContext().getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
                values.put(
                        MediaStore.MediaColumns.RELATIVE_PATH,
                        isVideo ? Environment.DIRECTORY_MOVIES + "/Petals" : Environment.DIRECTORY_PICTURES + "/Petals");
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri collection = isVideo
                        ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                        : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
                Uri itemUri = resolver.insert(collection, values);
                if (itemUri == null) {
                    call.reject("MediaStore insert failed");
                    return;
                }
                try (OutputStream out = resolver.openOutputStream(itemUri);
                     InputStream in = new FileInputStream(source)) {
                    if (out == null) {
                        call.reject("Could not open MediaStore output");
                        return;
                    }
                    copy(in, out);
                }
                values.clear();
                values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(itemUri, values, null, null);
                galleryUri = itemUri;
            } else {
                File picturesDir = new File(
                        Environment.getExternalStoragePublicDirectory(
                                isVideo ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES),
                        "Petals");
                if (!picturesDir.exists() && !picturesDir.mkdirs()) {
                    call.reject("Could not create gallery folder");
                    return;
                }
                File dest = new File(picturesDir, fileName);
                try (InputStream in = new FileInputStream(source);
                     OutputStream out = new FileOutputStream(dest)) {
                    copy(in, out);
                }
                MediaScannerConnection.scanFile(
                        getContext(), new String[]{dest.getAbsolutePath()}, new String[]{mimeType}, null);
                galleryUri = Uri.fromFile(dest);
            }
            JSObject result = new JSObject();
            result.put("uri", galleryUri.toString());
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Save to Gallery failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openFolder(PluginCall call) {
        try {
            // Open Android/data/com.hi.petals/files/Petals in the Files app.
            Uri uri = Uri.parse(
                    "content://com.android.externalstorage.documents/document/primary%3AAndroid%2Fdata%2Fcom.hi.petals%2Ffiles%2FPetals");
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "vnd.android.document/directory");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            try {
                Intent files = getContext().getPackageManager()
                        .getLaunchIntentForPackage("com.google.android.apps.nbu.files");
                if (files != null) {
                    getContext().startActivity(files);
                    call.resolve();
                    return;
                }
                Intent documentsUi = getContext().getPackageManager()
                        .getLaunchIntentForPackage("com.android.documentsui");
                if (documentsUi != null) {
                    getContext().startActivity(documentsUi);
                    call.resolve();
                    return;
                }
            } catch (Exception ignored) {
                // Fall through to reject; JS copies the path instead.
            }
            call.reject("Could not open Files app: " + e.getMessage());
        }
    }

    private static void copy(InputStream in, OutputStream out) throws java.io.IOException {
        byte[] buffer = new byte[8192];
        int n;
        while ((n = in.read(buffer)) != -1) {
            out.write(buffer, 0, n);
        }
    }
}
