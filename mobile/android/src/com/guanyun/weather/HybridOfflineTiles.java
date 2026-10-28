package com.guanyun.weather;

import android.content.Context;
import java.io.File;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.util.Arrays;
import org.json.JSONObject;
import org.json.JSONArray;

/** Read-only adapter for the original cache used by React's unchanged cache UI. */
public final class HybridOfflineTiles {
    private static String membershipStamp;
    // Four longs per SHA-256 identity: at most 8 MiB for the supported 250000 URLs.
    private static long[] membership = new long[0];
    private HybridOfflineTiles() { }
    public static synchronized boolean containsPackageUrl(Context context, String packageId, String url) {
        try {
            if (packageId == null || packageId.isEmpty() || packageId.length() > 160 || !readPermitted(url)) return false;
            File job = OfflineStore.job(context, packageId), urls = OfflineStore.urlsFile(context, packageId);
            if (!job.isFile() || job.length() > 12L * 1024 * 1024) return false;
            JSONObject task = OfflineStore.read(job);
            if (!packageId.equals(task.optString("id"))) return false;
            int total = task.optInt("total", -1);
            if (total < 1 || total > OfflineStore.MAX_URLS) return false;
            String stamp = job.getCanonicalPath() + ":" + job.lastModified() + ":" + job.length() + ":" + urls.lastModified() + ":" + urls.length() + ":" + task.optString("manifestDigest");
            if (!stamp.equals(membershipStamp)) {
                long[] values = new long[total * 4]; int count = 0;
                JSONArray legacy = task.optJSONArray("urls");
                if (legacy != null) {
                    if (legacy.length() != total) return false;
                    for (int i = 0; i < total; i++) appendIdentity(values, count++, legacy.getString(i));
                } else {
                    if (!urls.isFile() || urls.length() > OfflineStore.MAX_MANIFEST_BYTES) return false;
                    String digest = "";
                    try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(urls), StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = reader.readLine()) != null) {
                            if (count >= total || line.length() > 32768) return false;
                            appendIdentity(values, count++, line);
                            MessageDigest chain = MessageDigest.getInstance("SHA-256");
                            chain.update(digest.getBytes(StandardCharsets.US_ASCII)); chain.update((line + "\n").getBytes(StandardCharsets.UTF_8));
                            digest = hex(chain.digest());
                        }
                    }
                    if (count != total || !task.optString("manifestDigest").equals(digest)) return false;
                }
                sort(values, 0, count - 1); membership = values; membershipStamp = stamp;
            }
            long[] target = identity(url);
            int lo = 0, hi = membership.length / 4 - 1;
            while (lo <= hi) {
                int mid = (lo + hi) >>> 1, comparison = compare(membership, mid, target);
                if (comparison == 0) return true;
                if (comparison < 0) lo = mid + 1; else hi = mid - 1;
            }
        } catch (Exception ignored) { }
        return false;
    }

    private static void appendIdentity(long[] values, int index, String url) throws Exception {
        if (!readPermitted(url)) throw new IllegalArgumentException("Invalid cached tile");
        System.arraycopy(identity(url), 0, values, index * 4, 4);
    }
    private static long[] identity(String url) throws Exception {
        ByteBuffer bytes = ByteBuffer.wrap(MessageDigest.getInstance("SHA-256").digest(OfflineStore.identity(url).getBytes(StandardCharsets.UTF_8)));
        return new long[]{bytes.getLong(), bytes.getLong(), bytes.getLong(), bytes.getLong()};
    }
    private static String hex(byte[] bytes) {
        char[] digits = "0123456789abcdef".toCharArray(), text = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) { int b = bytes[i] & 255; text[i * 2] = digits[b >>> 4]; text[i * 2 + 1] = digits[b & 15]; }
        return new String(text);
    }
    private static int compare(long[] values, int index, long[] target) {
        for (int i = 0; i < 4; i++) { int comparison = Long.compareUnsigned(values[index * 4 + i], target[i]); if (comparison != 0) return comparison; }
        return 0;
    }
    private static void sort(long[] values, int lo, int hi) {
        if (lo >= hi) return;
        int left = lo, right = hi;
        long[] pivot = Arrays.copyOfRange(values, ((lo + hi) >>> 1) * 4, ((lo + hi) >>> 1) * 4 + 4);
        while (left <= right) {
            while (compare(values, left, pivot) < 0) left++;
            while (compare(values, right, pivot) > 0) right--;
            if (left <= right) {
                for (int i = 0; i < 4; i++) { long old = values[left * 4 + i]; values[left * 4 + i] = values[right * 4 + i]; values[right * 4 + i] = old; }
                left++; right--;
            }
        }
        if (lo < right) sort(values, lo, right); if (left < hi) sort(values, left, hi);
    }
    public static byte[] lookup(Context context, String url) {
        try {
            if (!readPermitted(url)) return null;
            File file = OfflineStore.tile(context, url);
            if (!file.isFile() || file.length() < 1 || file.length() > 4 * 1024 * 1024) return null;
            try (FileInputStream input = new FileInputStream(file); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192]; int count, total = 0;
                while ((count = input.read(buffer)) >= 0) {
                    total += count;
                    if (total > 4 * 1024 * 1024) return null;
                    out.write(buffer, 0, count);
                }
                return out.toByteArray();
            }
        } catch (Exception ignored) { return null; }
    }
    private static boolean readPermitted(String url) {
        try { MapTileProxy.validate(OfflineStore.source(url)); return true; }
        catch (Exception ignored) { return false; }
    }
}
