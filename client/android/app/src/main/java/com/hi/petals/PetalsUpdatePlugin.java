package com.hi.petals;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// PetalsUpdate: the native side of utils/updateCheck.ts.
//
// The update flow stays inside the app, no browser:
//   downloadApk  downloads the release APK asset to the app cache
//                dir (getCacheDir()/petals-update.apk) on a background
//                thread, reporting progress 0-100 through the
//                "downloadProgress" listener, and resolves with the
//                file path and size. The file is under cache-path in
//                res/xml/file_paths.xml, so FileProvider can serve it.
//   installApk   fires the install intent for that file through
//                FileProvider (${applicationId}.fileprovider).
//   canInstallUnknownApps / openInstallSettings handle the Android 8+
//                "install unknown apps" permission: if it is off, the
//                installer would just refuse, so the JS side opens
//                the settings screen first instead of failing.
//   getAppVersion returns the native versionName/versionCode, the
//                version the installer actually sees.
//
// This plugin is registered in MainActivity. If it is missing, the
// JS side falls back to the baked-in __APP_VERSION__ and a plain
// file download, never to a silent failure. The Java here was not
// compiled on this machine (Gradle cannot run in this sandbox);
// it needs a device or CI Gradle build to prove it.
@CapacitorPlugin(name = "PetalsUpdate")
public class PetalsUpdatePlugin extends Plugin {

    private static final String APK_FILE_NAME = "petals-update.apk";

    @PluginMethod
    public void getAppVersion(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager()
                    .getPackageInfo(getContext().getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("versionName", info.versionName != null ? info.versionName : "");
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? info.getLongVersionCode() : info.versionCode;
            result.put("versionCode", code);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Could not read app version: " + e.getMessage());
        }
    }

    @PluginMethod
    public void canInstallUnknownApps(PluginCall call) {
        boolean canInstall = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            canInstall = getContext().getPackageManager().canRequestPackageInstalls();
        }
        JSObject result = new JSObject();
        result.put("canInstall", canInstall);
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName()));
            } else {
                intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open install settings: " + e.getMessage());
        }
    }

    @PluginMethod
    public void downloadApk(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        // Network on a background thread: plugin methods run on the
        // main thread, and Android forbids network there.
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(30_000);
                conn.setReadTimeout(60_000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("Accept", "application/vnd.android.package-archive");
                int status = conn.getResponseCode();
                if (status < 200 || status >= 300) {
                    call.reject("Download failed (HTTP " + status + ")");
                    return;
                }
                long total = conn.getContentLengthLong();
                File dest = new File(getContext().getCacheDir(), APK_FILE_NAME);
                long received = 0;
                int lastPct = -1;
                try (InputStream in = conn.getInputStream();
                     OutputStream out = new FileOutputStream(dest)) {
                    byte[] buffer = new byte[8192];
                    int n;
                    while ((n = in.read(buffer)) != -1) {
                        out.write(buffer, 0, n);
                        received += n;
                        if (total > 0) {
                            int pct = (int) Math.min(100, (received * 100) / total);
                            if (pct != lastPct) {
                                lastPct = pct;
                                JSObject progress = new JSObject();
                                progress.put("progress", pct);
                                notifyListeners("downloadProgress", progress);
                            }
                        }
                    }
                }
                if (total > 0 && dest.length() != total) {
                    dest.delete();
                    call.reject("Download incomplete: got " + dest.length() + " of " + total + " bytes");
                    return;
                }
                JSObject result = new JSObject();
                result.put("path", dest.getAbsolutePath());
                result.put("size", dest.length());
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Download failed: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }
        try {
            File apk = new File(path);
            File cacheDir = getContext().getCacheDir();
            if (!apk.getCanonicalPath().startsWith(cacheDir.getCanonicalPath())) {
                call.reject("APK must be the downloaded file in the app cache dir");
                return;
            }
            if (!apk.exists()) {
                call.reject("Downloaded APK not found, download it again");
                return;
            }
            Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open installer: " + e.getMessage());
        }
    }
}
