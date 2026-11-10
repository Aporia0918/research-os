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
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * In-app update: download one mirror into app-private cache/updates/, check size then sha256
 * (delete on mismatch), and open the system installer ONLY when JS calls install() after the
 * user tapped confirm. Never installs silently. Not yet run on a real phone.
 */
@CapacitorPlugin(name = "UpdateInstaller")
public class UpdateInstallerPlugin extends Plugin {

    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url", "");
        final long size = call.getLong("size", -1L);
        final String sha = call.getString("sha256", "");
        new Thread(() -> {
            JSObject ret = new JSObject();
            File dir = new File(getContext().getCacheDir(), "updates");
            File out = new File(dir, "update.apk");
            HttpURLConnection c = null;
            try {
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("mkdir");
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                if (c.getResponseCode() / 100 != 2) { fail(call, ret, "http", out); return; }
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                long n = 0;
                int lastPct = -1;
                try (InputStream in = c.getInputStream(); FileOutputStream fo = new FileOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024];
                    int r;
                    while ((r = in.read(buf)) != -1) {
                        n += r;
                        if (n > size) break;
                        md.update(buf, 0, r);
                        fo.write(buf, 0, r);
                        int pct = size > 0 ? (int) (n * 100 / size) : 0;
                        if (pct != lastPct) {
                            lastPct = pct;
                            JSObject p = new JSObject();
                            p.put("loaded", n);
                            p.put("total", size);
                            notifyListeners("downloadProgress", p);
                        }
                    }
                }
                if (n != size) { fail(call, ret, "size_mismatch", out); return; }
                StringBuilder hex = new StringBuilder();
                for (byte b : md.digest()) hex.append(String.format("%02x", b));
                if (!hex.toString().equals(sha)) { fail(call, ret, "sha_mismatch", out); return; }
                ret.put("ok", true);
                ret.put("path", out.getAbsolutePath());
                call.resolve(ret);
            } catch (Exception e) {
                fail(call, ret, "offline", out);
            } finally {
                if (c != null) c.disconnect();
            }
        }).start();
    }

    private void fail(PluginCall call, JSObject ret, String code, File out) {
        if (out.exists()) out.delete();
        ret.put("ok", false);
        ret.put("code", code);
        call.resolve(ret);
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
