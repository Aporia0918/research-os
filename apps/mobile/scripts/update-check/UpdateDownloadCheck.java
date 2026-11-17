package dev.paperlab.assistant;

import java.io.File;
import java.nio.file.Files;

/**
 * Runs the app's own update download code on a desktop JVM against a published build:
 *   java UpdateDownloadCheck <apk url> <size> <sha256>
 * Checks the Integer size that broke 1.4.111, the real download, and that bad size or sha is caught and deleted.
 */
public final class UpdateDownloadCheck {
    public static void main(String[] a) throws Exception {
        String url = a[0], sha = a[2];
        long size = Long.parseLong(a[1]);
        check(UpdateDownload.sizeOf(Integer.valueOf((int) size)) == size, "Integer size is read");
        check(UpdateDownload.sizeOf(Long.valueOf(size)) == size, "Long size is read");
        check(UpdateDownload.sizeOf("9") == -1L && UpdateDownload.run(url, -1, sha, tmp(), null).equals("bad_manifest"),
                "missing size stops before downloading");

        File out = tmp();
        long[] last = {0};
        String code = UpdateDownload.run(url, size, sha, out, (n, t) -> last[0] = n);
        check(code == null, "published APK downloads and matches size and sha256 (got " + code + ")");
        check(out.length() == size && last[0] == size, "file and progress reach the full size");
        Files.delete(out.toPath());

        File bad = tmp();
        check("size_mismatch".equals(UpdateDownload.run(url, size - 1, sha, bad, null)) && !bad.exists(),
                "wrong size is caught and the file deleted");
        String other = sha.charAt(0) == '0' ? "1" + sha.substring(1) : "0" + sha.substring(1);
        check("sha_mismatch".equals(UpdateDownload.run(url, size, other, bad, null)) && !bad.exists(),
                "wrong sha256 is caught and the file deleted");
        System.out.println("update download check passed");
    }

    private static File tmp() throws Exception {
        File f = File.createTempFile("update", ".apk");
        Files.delete(f.toPath());
        return f;
    }

    private static void check(boolean ok, String what) {
        System.out.println((ok ? "ok   " : "FAIL ") + what);
        if (!ok) System.exit(1);
    }
}
