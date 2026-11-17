package dev.paperlab.assistant;

import android.content.Intent;
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

/**
 * In-app update: download one mirror into app-private cache/updates/ (UpdateDownload checks size then sha256
 * and deletes on mismatch), and open the system installer ONLY when JS calls install() after the
 * user tapped confirm. Never installs silently. Not yet run on a real phone.
 */
@CapacitorPlugin(name = "UpdateInstaller")
public class UpdateInstallerPlugin extends Plugin {

    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url", "");
        // Not call.getLong: Capacitor only returns a Long there, and a JS size like 9445408 arrives as Integer,
        // which made every update read size -1 and fail as size_mismatch (1.4.111 → 1.4.112).
        final long size = UpdateDownload.sizeOf(call.getData().opt("size"));
        final String sha = call.getString("sha256", "");
        final long minRate = Math.max(0, UpdateDownload.sizeOf(call.getData().opt("minRate")));
        new Thread(() -> {
            File out = new File(new File(getContext().getCacheDir(), "updates"), "update.apk");
            String code = UpdateDownload.run(url, size, sha, out, (loaded, total) -> {
                JSObject p = new JSObject();
                p.put("loaded", loaded);
                p.put("total", total);
                notifyListeners("downloadProgress", p);
            }, minRate);
            JSObject ret = new JSObject();
            ret.put("ok", code == null);
            if (code == null) ret.put("path", out.getAbsolutePath());
            else ret.put("code", code);
            call.resolve(ret);
        }).start();
    }

    @PluginMethod
    public void install(PluginCall call) {
        JSObject ret = new JSObject();
        File f = new File(call.getString("path", ""));
        File dir = new File(getContext().getCacheDir(), "updates");
        try {
            if (!f.exists() || !f.getCanonicalPath().startsWith(dir.getCanonicalPath())) {
                ret.put("started", false); call.resolve(ret); return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && !getContext().getPackageManager().canRequestPackageInstalls()) {
                Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(s);
                ret.put("started", false); call.resolve(ret); return;
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            ret.put("started", true);
            call.resolve(ret);
        } catch (Exception e) {
            ret.put("started", false);
            call.resolve(ret);
        }
    }
}
