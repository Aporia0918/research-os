package dev.paperlab.assistant;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.security.MessageDigest;

/**
 * Downloads one update APK and checks it: byte count first, then sha256. Any mismatch deletes the file.
 * No Android classes here, so UpdateDownloadCheck can run it on a desktop JVM against a published build.
 */
final class UpdateDownload {
    interface Progress { void on(long loaded, long total); }

    private UpdateDownload() {}

    /** Size from the JS call, which arrives as Integer or Long depending on how big it is. */
    static long sizeOf(Object v) {
        return v instanceof Number ? ((Number) v).longValue() : -1L;
    }

    /** How long a mirror is watched before its speed is judged. */
    static final long JUDGE_AFTER_MS = 8000;

    static String run(String url, long size, String sha256, File out, Progress progress) {
        return run(url, size, sha256, out, progress, 0);
    }

    /**
     * Returns null when the file at {@code out} is the expected APK, otherwise an UpdateCode for JS. With
     * {@code minBytesPerSec} above 0, a mirror still under that speed after JUDGE_AFTER_MS is given up as
     * "slow:<bytes per second>", so the next mirror gets its turn instead of a trickle holding the whole update.
     */
    static String run(String url, long size, String sha256, File out, Progress progress, long minBytesPerSec) {
        if (size <= 0 || sha256 == null || !sha256.matches("[0-9a-f]{64}")) return "bad_manifest";
        File dir = out.getParentFile();
        HttpURLConnection c = null;
        try {
            if (dir != null && !dir.exists() && !dir.mkdirs()) return fail("download_failed", out);
            c = (HttpURLConnection) URI.create(url).toURL().openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("Accept-Encoding", "identity");  // count the APK's own bytes, never a gzip body
            if (c.getResponseCode() / 100 != 2) return fail("http", out);
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            long n = 0;
            int lastPct = -1;
            final long start = System.currentTimeMillis();
            try (InputStream in = c.getInputStream(); FileOutputStream fo = new FileOutputStream(out)) {
                byte[] buf = new byte[64 * 1024];
                int r;
                while ((r = in.read(buf)) != -1) {
                    n += r;
                    if (n > size) break;
                    md.update(buf, 0, r);
                    fo.write(buf, 0, r);
                    long ms = System.currentTimeMillis() - start;
                    if (minBytesPerSec > 0 && ms >= JUDGE_AFTER_MS && n < size && n * 1000 / ms < minBytesPerSec) {
                        fo.close();
                        return fail("slow:" + (n * 1000 / ms), out);
                    }
                    int pct = (int) (n * 100 / size);
                    if (pct != lastPct && progress != null) {
                        lastPct = pct;
                        progress.on(n, size);
                    }
                }
            }
            if (n != size) return fail("size_mismatch", out);
            StringBuilder hex = new StringBuilder();
            for (byte b : md.digest()) hex.append(String.format("%02x", b));
            return hex.toString().equals(sha256) ? null : fail("sha_mismatch", out);
        } catch (Exception e) {
            return fail("offline", out);
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String fail(String code, File out) {
        if (out.exists() && !out.delete()) out.deleteOnExit();
        return code;
    }
}
