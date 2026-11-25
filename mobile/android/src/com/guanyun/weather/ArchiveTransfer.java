package com.guanyun.weather;

import java.io.File;
import java.io.FileOutputStream;
import java.io.DataInputStream;
import java.io.FileInputStream;
import java.util.Base64;
import java.util.HashSet;
import java.util.UUID;
import java.util.zip.ZipFile;

/** No caller-supplied paths. One bounded, ordered transfer into private cache. */
final class ArchiveTransfer {
    private static final int VIDEO_LIMIT = 64 * 1024 * 1024;
    static final int LIMIT = 256 * 1024 * 1024;
    private final File directory;
    private String token, name;
    private File file;
    private FileOutputStream stream;
    private int expected, written;
    private long touched;
    ArchiveTransfer(File directory) { this.directory = directory; }
    synchronized String begin(String name, int size) {
        if (token != null && System.currentTimeMillis() - touched > 600000L) close();
        if (token != null) return "已有压缩包正在输出";
        boolean zip = name != null && name.matches("Shantu-(route|collection)-[0-9]{1,16}\\.zip");
        boolean text = name != null && name.matches("(Shantu-workspace\\.json|Shantu-(route-coordinates-[0-9]{1,16}|coordinates-[0-9]{4}-[0-9]{2}-[0-9]{2})\\.(json|csv))");
        boolean video = isSkyVideo(name);
        boolean stl = isTerrainStl(name);
        if ((!zip && !text && !video && !stl) || size < (zip ? 22 : video ? 12 : stl ? 134 : 2)
                || size > (zip ? LIMIT : video ? VIDEO_LIMIT : stl ? 32 * 1024 * 1024 : 100 * 1024 * 1024)) return "文件名称或大小无效";
        try {
            if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception();
            File[] old = directory.listFiles(f -> f.getName().matches("[a-f0-9-]{36}\\.(zip|json|csv|webm|mp4|stl)") && System.currentTimeMillis() - f.lastModified() > 86400000L);
            if (old != null) for (File f : old) f.delete();
            token = UUID.randomUUID().toString(); this.name = name; expected = size; written = 0;
            file = new File(directory, token + name.substring(name.lastIndexOf('.'))); stream = new FileOutputStream(file); touched = System.currentTimeMillis();
            return "ok:" + token;
        } catch (Exception e) { close(); return "无法创建压缩包，请检查存储空间"; }
    }
    synchronized String append(String id, int offset, String encoded) {
        if (token == null || !token.equals(id)) return "压缩包会话已失效";
        try {
            if (offset != written || encoded == null || encoded.length() > 256 * 1024) throw new Exception();
            byte[] bytes = Base64.getDecoder().decode(encoded);
            if (bytes.length == 0 || written + bytes.length > expected) throw new Exception();
            stream.write(bytes); written += bytes.length; touched = System.currentTimeMillis(); return "ok";
        } catch (Exception e) { close(); return "压缩包传输中断，请重新导出"; }
    }
    synchronized String name(String id) { return token != null && token.equals(id) ? name : null; }
    synchronized File finish(String id) throws Exception {
        if (token == null || !token.equals(id)) throw new Exception("压缩包会话已失效");
        try {
            if (written != expected) throw new Exception("压缩包尚未传输完整");
            stream.close(); stream = null;
            if (isSkyVideo(name)) validateVideo(file, name);
            if (isTerrainStl(name)) validateTerrainStl(file);
            if (name.endsWith(".zip")) try (ZipFile zip = new ZipFile(file)) {
                if (zip.size() == 0 || zip.size() > 4000) throw new Exception("压缩包条目数量无效");
                java.util.Enumeration<? extends java.util.zip.ZipEntry> entries = zip.entries();
                HashSet<String> names = new HashSet<>(); long total = 0;
                while (entries.hasMoreElements()) {
                    java.util.zip.ZipEntry entry = entries.nextElement(); String path = entry.getName();
                    if (path.startsWith("/") || path.contains("\\") || path.indexOf(':') >= 0 || path.indexOf('\0') >= 0 || !names.add(path)) throw new Exception("压缩包文件名无效");
                    for (String part : path.split("/", -1)) if (part.isEmpty() || part.equals(".") || part.equals("..")) throw new Exception("压缩包路径无效");
                    if (entry.getSize() < 0 || (total += entry.getSize()) > LIMIT) throw new Exception("压缩包内容超过限制");
                }
            }
            File complete = file; file = null; token = null; name = null; return complete;
        } catch (Exception e) { close(); throw e; }
    }
    static boolean isSkyVideo(String name) {
        return name != null && name.matches("Shantu-sky-journey-[0-9]{1,16}\\.(mp4|webm)");
    }
    static boolean isTerrainStl(String name) {
        return name != null && name.matches("Shantu-terrain-(rectangle|circle)-[0-9]{1,16}\\.stl");
    }
    private static void validateTerrainStl(File file) throws Exception {
        try (DataInputStream input = new DataInputStream(new FileInputStream(file))) {
            input.readFully(new byte[80]);
            long triangles = Integer.toUnsignedLong(Integer.reverseBytes(input.readInt()));
            if (triangles > 0 && file.length() == 84L + triangles * 50L) return;
        }
        throw new Exception("STL 模型格式无效");
    }
    private static void validateVideo(File file, String name) throws Exception {
        try (DataInputStream input = new DataInputStream(new FileInputStream(file))) {
            int signature = input.readInt();
            if (name.endsWith(".webm") ? signature == 0x1a45dfa3
                    : signature >= 8 && input.readInt() == 0x66747970) return;
        }
        throw new Exception("录像格式无效");
    }
    synchronized void cancel(String id) { if (token != null && token.equals(id)) close(); }
    synchronized void close() {
        try { if (stream != null) stream.close(); } catch (Exception ignored) { }
        if (file != null) file.delete(); stream = null; file = null; token = null; name = null;
    }
}
