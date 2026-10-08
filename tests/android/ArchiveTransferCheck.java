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
    static String begin(ArchiveTransfer t, String name, byte[] bytes) { String result = t.begin(name, bytes.length); check(result.startsWith("ok:")); return result.substring(3); }
    static String begin(ArchiveTransfer t, byte[] bytes) { return begin(t, "Shantu-route-123.zip", bytes); }
    static void send(ArchiveTransfer t,String id,byte[] bytes) { for(int i=0;i<bytes.length;i+=192*1024)check(t.append(id,i,Base64.getEncoder().encodeToString(java.util.Arrays.copyOfRange(bytes,i,Math.min(bytes.length,i+192*1024)))).equals("ok")); }
    public static void main(String[] args) throws Exception {
        File dir=Files.createTempDirectory("shantu-archive-check-").toFile();
        ArchiveTransfer t=new ArchiveTransfer(dir);
        check(!t.begin("../other.zip",99).startsWith("ok:"));
        for(String name:new String[]{"../Shantu-workspace.json","/Shantu-workspace.json","Shantu-workspace.json/../../escape","Shantu-route-coordinates-1/../x.csv","Shantu-other.csv"}) check(!t.begin(name,2).startsWith("ok:"));
        check(!t.begin("Shantu-workspace.json",100*1024*1024+1).startsWith("ok:"));
        String boundary=t.begin("Shantu-workspace.json",100*1024*1024);check(boundary.startsWith("ok:"));t.cancel(boundary.substring(3));check(dir.list().length==0);
        check(!t.begin("Shantu-route-123.zip",ArchiveTransfer.LIMIT+1).startsWith("ok:"));
        byte[] data=archive("照片/中文.jpg",9*1024*1024);String id=begin(t,data);send(t,id,data);File complete=t.finish(id);check(complete.length()==data.length);
        try(ZipFile zip=new ZipFile(complete)){check(zip.getEntry("照片/中文.jpg").getSize()==9*1024*1024);}complete.delete();
        id=begin(t,data);check(!t.append(id,1,"UEs=").equals("ok"));check(dir.list().length==0);
        id=begin(t,data);try{t.finish(id);throw new AssertionError();}catch(IOException e){throw e;}catch(Exception expected){}check(dir.list().length==0);
        byte[] bad=archive("../escape.txt",10);id=begin(t,bad);send(t,id,bad);try{t.finish(id);throw new AssertionError();}catch(Exception expected){}check(dir.list().length==0);
        for(String unsafe:new String[]{"C:/escape.txt","folder/name:stream.txt"}){bad=archive(unsafe,10);id=begin(t,bad);send(t,id,bad);try{t.finish(id);throw new AssertionError();}catch(Exception expected){}check(dir.list().length==0);}
        id=begin(t,data);t.cancel("wrong");check(t.name(id)!=null);t.cancel(id);check(dir.list().length==0);
        byte[] workspace=new byte[9*1024*1024];java.util.Arrays.fill(workspace,(byte)'a');
        byte[] prefix="{\"padding\":\"".getBytes(java.nio.charset.StandardCharsets.UTF_8),suffix="\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        System.arraycopy(prefix,0,workspace,0,prefix.length);System.arraycopy(suffix,0,workspace,workspace.length-suffix.length,suffix.length);
        id=begin(t,"Shantu-workspace.json",workspace);check(t.name(id).equals("Shantu-workspace.json"));send(t,id,workspace);complete=t.finish(id);
        check(complete.getName().endsWith(".json")&&complete.length()==workspace.length);check(java.util.Arrays.equals(workspace,Files.readAllBytes(complete.toPath())));complete.delete();
        byte[] csv="featureID,name,type,part,vertex,x,y,z\r\np-1,点,Point,0,0,1,2,3\r\n".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        for(String name:new String[]{"Shantu-coordinates-2026-10-08.csv","Shantu-route-coordinates-123.csv"}){id=begin(t,name,csv);send(t,id,csv);complete=t.finish(id);check(complete.getName().endsWith(".csv")&&java.util.Arrays.equals(csv,Files.readAllBytes(complete.toPath())));complete.delete();}
        byte[] json="{}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        for(String name:new String[]{"Shantu-coordinates-2026-10-08.json","Shantu-route-coordinates-123.json"}){id=begin(t,name,json);send(t,id,json);complete=t.finish(id);check(complete.getName().endsWith(".json")&&java.util.Arrays.equals(json,Files.readAllBytes(complete.toPath())));complete.delete();}
        id=begin(t,"Shantu-workspace.json",workspace);check(!t.append(id,1,Base64.getEncoder().encodeToString(java.util.Arrays.copyOfRange(workspace,0,192*1024))).equals("ok"));check(dir.list().length==0);
        id=begin(t,"Shantu-workspace.json",workspace);byte[] first=java.util.Arrays.copyOfRange(workspace,0,192*1024);check(t.append(id,0,Base64.getEncoder().encodeToString(first)).equals("ok"));
        try{t.finish(id);throw new AssertionError();}catch(Exception expected){}check(dir.list().length==0);
        dir.delete();System.out.println("PASS: native archive 9 MB, UTF-8, order, size, traversal, incomplete and cancellation checks");
    }
}
