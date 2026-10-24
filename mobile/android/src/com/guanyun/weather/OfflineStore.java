package com.guanyun.weather;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;

/** Durable private tile store. New downloads are limited to explicitly imported HTTPS/HTTP tiles. */
final class OfflineStore {
    static final long MAX_BYTES=8L*1024*1024*1024;
    static final long MAX_MANIFEST_BYTES=128L*1024*1024;
    static final int MAX_URLS=250000;
    private static final char[] HEX="0123456789abcdef".toCharArray();
    private static String hex(byte[] bytes){char[] out=new char[bytes.length*2];for(int i=0;i<bytes.length;i++){int v=bytes[i]&255;out[i*2]=HEX[v>>>4];out[i*2+1]=HEX[v&15];}return new String(out);}
    static File root(Context c) { File f=new File(c.getFilesDir(),"offline-maps"); f.mkdirs(); return f; }
    static String hash(String text) throws Exception { return hex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
    static boolean allowed(String value) {
        try { String source=source(value);Uri u=Uri.parse(source); if(!"https".equals(u.getScheme()) && !"http".equals(u.getScheme()))return false;
            if(u.getUserInfo()!=null || u.getHost()==null || u.getFragment()!=null)return false;
            String h=u.getHost().toLowerCase(Locale.ROOT),p=u.getPath();
            // Block bulk-download public infrastructure and the registered Tianditu family.
            if(isRestrictedHost(h))return false;
            if(p==null||p.contains(".."))return false;
            MapTileProxy.validateOffline(source);return true;
        } catch(Exception e){return false;}
    }
    static boolean isRestrictedHost(String host){String h=host.toLowerCase(Locale.ROOT);return h.equals("tianditu.gov.cn")||h.endsWith(".tianditu.gov.cn")||h.equals("tianditu.com")||h.endsWith(".tianditu.com")||h.equals("openstreetmap.org")||h.endsWith(".openstreetmap.org")||h.equals("openstreetmap.fr")||h.endsWith(".openstreetmap.fr");}
    static String source(String value) {
        Uri u=Uri.parse(value);
        if(LocalGateway.HOST.equals(u.getHost())&&"https".equals(u.getScheme())&&"/api/map-tile".equals(u.getPath())) {String inner=u.getQueryParameter("url");if(inner!=null)return inner;}
        return value;
    }
    static String identity(String value) {
        try{String src=source(value);Uri u=Uri.parse(src);if(u.getHost()!=null&&u.getHost().matches("t[0-7]\\.tianditu\\.gov\\.cn")){Map<String,String> p=new HashMap<>();for(String k:u.getQueryParameterNames())p.put(k.toLowerCase(Locale.ROOT),u.getQueryParameter(k));return "tdt:"+p.get("layer")+":"+p.get("tilematrix")+":"+p.get("tilecol")+":"+p.get("tilerow");}}catch(Exception ignored){}return value;
    }
    static File tile(Context c,String url) throws Exception { return new File(root(c),hash(identity(url))+".tile"); }
    static File job(Context c,String id) throws Exception { return new File(root(c),hash(id)+".json"); }
    static File urlsFile(Context c,String id) throws Exception{return new File(root(c),hash(id)+".urls");}
    static File stage(Context c,String id) throws Exception{return new File(root(c),hash(id)+".stage");}
    static File stageUrls(Context c,String id) throws Exception{return new File(root(c),hash(id)+".stage-urls");}
    static JSONObject read(File f) throws Exception { try(InputStream in=new android.util.AtomicFile(f).openRead()){return new JSONObject(new String(DataTransport.readLimited(in,12*1024*1024),StandardCharsets.UTF_8));} }
    static void write(File f,byte[] bytes) throws Exception { android.util.AtomicFile a=new android.util.AtomicFile(f);FileOutputStream out=null;try{out=a.startWrite();out.write(bytes);a.finishWrite(out);}catch(Exception e){if(out!=null)a.failWrite(out);throw e;} }
    static synchronized void save(Context c,JSONObject state) throws Exception {
        JSONObject lean=new JSONObject();for(String key:new String[]{"id","name","provider","total","done","bytes","state","error"})if(state.has(key))lean.put(key,state.get(key));
        write(new File(root(c),hash(state.getString("id"))+".progress"),lean.toString().getBytes(StandardCharsets.UTF_8));
    }
    static synchronized String begin(Context c,String id,String name,int total){
        try{if(id==null||id.isEmpty()||id.length()>160||total<1||total>MAX_URLS)return "离线任务范围无效";File jf=job(c,id);boolean resume=jf.exists();if(resume){JSONObject old=read(jf);if(!"imported".equals(old.optString("provider"))||old.optInt("total")!=total)return "该路线缓存任务已存在，范围不匹配";}
            JSONObject meta=new JSONObject().put("id",id).put("name",name==null?"路线缓存":name).put("provider","imported").put("total",total).put("next",0).put("length",0).put("digest","").put("resume",resume);
            write(stageUrls(c,id),new byte[0]);write(stage(c,id),meta.toString().getBytes(StandardCharsets.UTF_8));return "ok";
        }catch(Exception e){return "无法创建缓存清单，请检查存储空间";}
    }
    static synchronized String append(Context c,String id,int offset,String rawUrls){
        try{File mf=stage(c,id),uf=stageUrls(c,id);if(!mf.isFile()||!uf.isFile()){
                return "缓存清单不存在";
            }JSONObject m=read(mf);if(offset!=m.optInt("next")||offset<0)return "缓存清单偏移无效";
            if(rawUrls==null||rawUrls.length()>12*1024*1024)return "缓存清单分块过大";JSONArray urls=new JSONArray(rawUrls);int total=m.getInt("total");if(urls.length()==0||urls.length()>1000||offset+urls.length()>total)return "缓存清单分块无效";
            long expected=m.optLong("length"),chunkBytes=0;List<byte[]> encoded=new ArrayList<>();String digest=m.optString("digest","");for(int i=0;i<urls.length();i++){String url=urls.getString(i);if(!allowed(url)||url.indexOf('\n')>=0||url.indexOf('\r')>=0)return "图源暂不支持后台缓存";byte[] line=(url+"\n").getBytes(StandardCharsets.UTF_8);encoded.add(line);chunkBytes+=line.length;digest=chainDigest(digest,line);}if(expected+chunkBytes>MAX_MANIFEST_BYTES)return "缓存清单超过128 MiB限制";
            try(RandomAccessFile file=new RandomAccessFile(uf,"rw")){file.setLength(expected);file.seek(expected);for(byte[] line:encoded)file.write(line);m.put("next",offset+urls.length()).put("length",file.length()).put("digest",digest);}
            write(mf,m.toString().getBytes(StandardCharsets.UTF_8));return "ok";
        }catch(Exception e){return "缓存清单写入失败，请重试";}
    }
    static synchronized String commit(Context c,String id){
        try{File mf=stage(c,id),uf=stageUrls(c,id),jf=job(c,id),dest=urlsFile(c,id);
            if(!mf.isFile())return "缓存清单状态无效";JSONObject m=read(mf);File manifest=uf.isFile()?uf:dest;
            if(m.optInt("next")!=m.optInt("total")||!manifest.isFile()||manifest.length()!=m.optLong("length")||manifest.length()>MAX_MANIFEST_BYTES||!verifyManifest(manifest,m.getInt("total"),m.optString("digest")))return "缓存清单校验失败";
            if(jf.isFile()){JSONObject committed=read(jf);if(!"imported".equals(committed.optString("provider"))||!m.optString("digest").equals(committed.optString("manifestDigest")))return "路线缓存清单与已保存任务不一致";if(!OfflineDownloadService.reserve(id))return "已有地图正在下载，请先暂停";save(c,committed);write(new File(root(c),"active"),id.getBytes(StandardCharsets.UTF_8));discard(c,id);return "ok";}
            JSONObject task=new JSONObject().put("id",id).put("name",m.optString("name")).put("provider","imported").put("total",m.getInt("total")).put("state","queued").put("error","").put("done",0).put("bytes",0).put("manifestDigest",m.optString("digest"));
            if(!OfflineDownloadService.reserve(id))return "已有地图正在下载，请先暂停";
            if(manifest.equals(uf)&&!uf.renameTo(dest)){OfflineDownloadService.releaseReservation(id);return "缓存清单提交失败";}write(jf,task.toString().getBytes(StandardCharsets.UTF_8));save(c,task);write(new File(root(c),"active"),id.getBytes(StandardCharsets.UTF_8));new android.util.AtomicFile(mf).delete();return "ok";
        }catch(Exception e){OfflineDownloadService.releaseReservation(id);return "缓存清单提交失败，请检查存储空间";}
    }
    private static String chainDigest(String previous,byte[] line)throws Exception{MessageDigest d=MessageDigest.getInstance("SHA-256");d.update(previous.getBytes(StandardCharsets.US_ASCII));d.update(line);return hex(d.digest());}
    private static boolean verifyManifest(File file,int total,String expected)throws Exception{int count=0;String digest="";try(BufferedReader r=new BufferedReader(new InputStreamReader(new FileInputStream(file),StandardCharsets.UTF_8))){String line;while((line=r.readLine())!=null){if(count>=MAX_URLS)return false;digest=chainDigest(digest,(line+"\n").getBytes(StandardCharsets.UTF_8));count++;}}return count==total&&digest.equals(expected);}
    static synchronized void discard(Context c,String id){try{new android.util.AtomicFile(stage(c,id)).delete();new android.util.AtomicFile(stageUrls(c,id)).delete();}catch(Exception ignored){}}
    static JSONObject readTask(Context c,String id)throws Exception{JSONObject task=read(job(c,id));if(task.has("urls")){JSONArray old=task.getJSONArray("urls");if(old.length()>MAX_URLS||task.optInt("total",old.length())!=old.length())throw new IOException("Invalid legacy manifest");return task;}File manifest=urlsFile(c,id);if(manifest.length()>MAX_MANIFEST_BYTES)throw new IOException("Offline manifest too large");JSONArray urls=new JSONArray();try(BufferedReader r=new BufferedReader(new InputStreamReader(new FileInputStream(manifest),StandardCharsets.UTF_8))){String line;while((line=r.readLine())!=null){if(urls.length()>=MAX_URLS)throw new IOException("Too many tiles");urls.put(line);}}if(task.optInt("total",urls.length())!=urls.length())throw new IOException("Incomplete offline manifest");task.put("urls",urls);return task;}
    static synchronized String prepare(Context c,String raw) {
        try {
            if(raw==null || raw.length()>12*1024*1024)return "离线任务过大";
            JSONObject task=new JSONObject(raw);String id=task.getString("id"),provider=task.optString("provider");JSONArray urls=task.getJSONArray("urls");
            if(!"imported".equals(provider)||id.isEmpty()||id.length()>160||urls.length()==0||urls.length()>MAX_URLS)return "离线任务范围无效";
            for(int i=0;i<urls.length();i++)if(!allowed(urls.getString(i)))return "图源暂不支持后台缓存";
            File jf=job(c,id); if(jf.isFile())return "该路线缓存任务已存在，请删除后重试";
            if(!OfflineDownloadService.reserve(id))return "已有地图正在下载，请先暂停";
            int done=0;long bytes=0;for(int i=0;i<urls.length();i++){File f=tile(c,urls.getString(i));if(f.isFile()&&f.length()>0){done++;bytes+=f.length();}}
            task.put("name",task.optString("name","路线缓存")).put("state","queued").put("error","").put("done",done).put("bytes",bytes).put("total",urls.length());
            write(jf,task.toString().getBytes(StandardCharsets.UTF_8));save(c,task);write(new File(root(c),"active"),id.getBytes(StandardCharsets.UTF_8));return "ok";
        }catch(Exception e){try{OfflineDownloadService.releaseReservation(new JSONObject(raw).optString("id"));}catch(Exception ignored){}return "下载任务保存失败，请检查存储空间";}
    }
    static String activeId(Context c) throws Exception {try(InputStream in=new FileInputStream(new File(root(c),"active"))){return new String(DataTransport.readLimited(in,1024),StandardCharsets.UTF_8);} }
    static synchronized String snapshot(Context c) {
        try {JSONObject state=read(new File(root(c),hash(activeId(c))+".progress"));state.remove("urls");if(!OfflineDownloadService.running && Arrays.asList("running","waiting","queued").contains(state.optString("state")))state.put("state","paused");return state.toString();}catch(Exception e){return "{}";}
    }
    static synchronized void status(Context c,String id,String status,String error) {try{if(id==null||!id.equals(activeId(c)))return;JSONObject task=read(new File(root(c),hash(id)+".progress"));task.put("state",status).put("error",error);save(c,task);}catch(Exception ignored){} }
    static WebResourceResponse hit(Context c,String url) {
        try {File f=tile(c,url);if(!f.isFile()||f.length()==0)return null;
            String mime="application/octet-stream";try(InputStream in=new FileInputStream(f)){int a=in.read(),b=in.read();if(a==137&&b==80)mime="image/png";else if(a==255&&b==216)mime="image/jpeg";}
            Map<String,String> headers=new HashMap<>();headers.put("Access-Control-Allow-Origin","https://"+LocalGateway.HOST);headers.put("Cache-Control","public, max-age=86400");
            return new WebResourceResponse(mime,null,200,"OK",headers,new FileInputStream(f));
        }catch(Exception e){return null;}
    }
    static byte[] download(Context c,String url,String requestId) throws Exception {
        if(!allowed(url))throw new IOException("不支持的图源");
        MapTileProxy.Tile tile=MapTileProxy.fetchOffline(source(url),requestId);
        if(tile.bytes.length==0)throw new IOException("空瓦片");return tile.bytes;
    }
    static synchronized boolean commit(Context c,String url,byte[] data,java.util.concurrent.atomic.AtomicLong bytes,java.util.function.BooleanSupplier canCommit) throws Exception {
        if(!canCommit.getAsBoolean())throw new InterruptedIOException("下载已暂停");
        File f=tile(c,url); if(f.isFile()&&f.length()>0)return false;
        if(bytes.get()+data.length>MAX_BYTES)throw new IOException("离线包达到8 GB上限");
        if(!canCommit.getAsBoolean())throw new InterruptedIOException("下载已暂停");write(f,data);bytes.addAndGet(data.length);return true;
    }
    static synchronized String verify(Context c,String id) {
        try{JSONObject task=readTask(c,id);JSONArray urls=task.getJSONArray("urls");int done=0;long bytes=0;for(int i=0;i<urls.length();i++){File f=tile(c,urls.getString(i));if(f.isFile()&&f.length()>0){done++;bytes+=f.length();}}task.put("done",done).put("bytes",bytes).put("total",urls.length());save(c,task);task.remove("urls");return task.toString();}catch(Exception e){return "{}";}
    }
    static synchronized boolean has(Context c,String url) {try{File f=tile(c,url);return f.isFile()&&f.length()>0;}catch(Exception e){return false;} }
    static synchronized boolean remove(Context c,String id) {
        try {
            File target=job(c,id); if(OfflineDownloadService.isBusy(id))return false;
            String active="";try{active=activeId(c);}catch(Exception ignored){}
            if(target.isFile()) {
                Set<String> keep=new HashSet<>();File[] all=root(c).listFiles((d,n)->n.endsWith(".json"));
                if(all!=null)for(File f:all)if(!f.equals(target)){JSONArray urls=readTask(c,read(f).getString("id")).optJSONArray("urls");if(urls!=null)for(int i=0;i<urls.length();i++)keep.add(identity(urls.getString(i)));}
                JSONArray urls=readTask(c,id).optJSONArray("urls");if(urls!=null)for(int i=0;i<urls.length();i++){String url=urls.getString(i);File f=tile(c,url);if(!keep.contains(identity(url))&&f.exists()&&!f.delete())return false;}
                new android.util.AtomicFile(target).delete();if(target.exists())return false;
            }
            new android.util.AtomicFile(urlsFile(c,id)).delete();discard(c,id);
            new android.util.AtomicFile(new File(root(c),hash(id)+".progress")).delete();if(id.equals(active))new android.util.AtomicFile(new File(root(c),"active")).delete();return true;
        }catch(Exception e){return false;}
    }
}
