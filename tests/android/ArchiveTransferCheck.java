package com.guanyun.weather;
import java.io.*;
import java.nio.file.Files;
import java.util.Base64;
import java.util.zip.*;

public final class ArchiveTransferCheck {
    static void check(boolean v) { if (!v) throw new AssertionError("Archive transfer regression"); }
    static byte[] archive(String path, int size) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(out)) { zip.putNextEntry(new ZipEntry(path)); byte[] bytes = new byte[size]; new java.util.Random(42).nextBytes(bytes); zip.write(bytes); zip.closeEntry(); }
        return out.toByteArray();
    }
    static String begin(ArchiveTransfer t, byte[] bytes) { String result = t.begin("Shantu-route-123.zip", bytes.length); check(result.startsWith("ok:")); return result.substring(3); }
    static void send(ArchiveTransfer t,String id,byte[] bytes) { for(int i=0;i<bytes.length;i+=196608)check(t.append(id,i,Base64.getEncoder().encodeToString(java.util.Arrays.copyOfRange(bytes,i,Math.min(bytes.length,i+196608)))).equals("ok")); }
    public static void main(String[] args) throws Exception {
        File dir=Files.createTempDirectory("shantu-archive-check-").toFile();
        ArchiveTransfer t=new ArchiveTransfer(dir);
        check(!t.begin("../other.zip",99).startsWith("ok:"));check(!t.begin("Shantu-route-123.zip",ArchiveTransfer.LIMIT+1).startsWith("ok:"));
        byte[] data=archive("照片/中文.jpg",9*1024*1024);String id=begin(t,data);send(t,id,data);File complete=t.finish(id);check(complete.length()==data.length);
        try(ZipFile zip=new ZipFile(complete)){check(zip.getEntry("照片/中文.jpg").getSize()==9*1024*1024);}complete.delete();
        id=begin(t,data);check(!t.append(id,1,"UEs=").equals("ok"));check(dir.list().length==0);
        id=begin(t,data);try{t.finish(id);throw new AssertionError();}catch(IOException e){throw e;}catch(Exception expected){}check(dir.list().length==0);
        byte[] bad=archive("../escape.txt",10);id=begin(t,bad);send(t,id,bad);try{t.finish(id);throw new AssertionError();}catch(Exception expected){}check(dir.list().length==0);
        id=begin(t,data);t.cancel("wrong");check(t.name(id)!=null);t.cancel(id);check(dir.list().length==0);
        dir.delete();System.out.println("PASS: native archive 9 MB, UTF-8, order, size, traversal, incomplete and cancellation checks");
    }
}
