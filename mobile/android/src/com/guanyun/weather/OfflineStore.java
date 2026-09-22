package com.guanyun.weather;

import android.content.Context;
import android.net.Uri;
import android.util.AtomicFile;
import android.webkit.WebResourceResponse;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;

/** Private, durable tile storage. Only the app's known map providers are accepted. */
final class OfflineStore {
    static File root(Context c) { File f=new File(c.getFilesDir(),"offline-maps"); f.mkdirs(); return f; }
    static String hash(String text) throws Exception { byte[] b=MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));StringBuilder s=new StringBuilder();for(byte v:b)s.append(String.format("%02x",v&255));return s.toString(); }
    static boolean allowed(String value) {
        try { Uri u=Uri.parse(value);String h=u.getHost(),p=u.getPath();return "https".equals(u.getScheme()) && u.getUserInfo()==null && u.getPort()==-1 && p!=null && !p.contains("..") && (
            (h!=null && h.matches("t[0-7]\\.tianditu\\.gov\\.cn") && p.matches("/(vec|img|ter|cva|cia|cta|ibo)_w/wmts")) ||
            "tiles.openfreemap.org".equals(h) ||
            (LocalGateway.HOST.equals(h) && p.matches("/api/terrain/[0-9]+/[0-9]+/[0-9]+\\.png")) ||
            ("elevation-tiles-prod.s3.amazonaws.com".equals(h) && p.startsWith("/terrarium/")));
        } catch(Exception e){return false;}
    }
    static String identity(String value) {
        Uri u=Uri.parse(value);
        if(u.getHost()!=null && u.getHost().matches("t[0-7]\\.tianditu\\.gov\\.cn")) {
            Map<String,String> params=new HashMap<>();for(String k:u.getQueryParameterNames())params.put(k.toLowerCase(Locale.ROOT),u.getQueryParameter(k));
            return "tdt:"+params.get("layer")+":"+params.get("tilematrix")+":"+params.get("tilecol")+":"+params.get("tilerow");
        }
        return value;
    }
    static File tile(Context c,String url) throws Exception { return new File(root(c),hash(identity(url))+".tile"); }
    static File job(Context c,String id) throws Exception { return new File(root(c),hash(id)+".json"); }
    static JSONObject read(File f) throws Exception { try(InputStream in=new AtomicFile(f).openRead()){return new JSONObject(new String(DataTransport.readLimited(in,12*1024*1024),StandardCharsets.UTF_8));} }
    static void write(File f,byte[] bytes) throws Exception { AtomicFile a=new AtomicFile(f);FileOutputStream out=null;try{out=a.startWrite();out.write(bytes);a.finishWrite(out);}catch(Exception e){if(out!=null)a.failWrite(out);throw e;} }
    static synchronized void save(Context c,JSONObject state) throws Exception { JSONObject lean=new JSONObject(state.toString());lean.remove("urls");write(new File(root(c),hash(state.getString("id"))+".progress"),lean.toString().getBytes(StandardCharsets.UTF_8)); }
    static synchronized String prepare(Context c,String raw) {
        try {
            if(OfflineDownloadService.running) return "已有地图正在下载，请先暂停";
            if(raw==null || raw.length()>12*1024*1024)return "离线任务过大";
            JSONObject task=new JSONObject(raw);String id=task.getString("id");JSONArray urls=task.getJSONArray("urls");
            if(id.length()>160 || urls.length()==0 || urls.length()>20000)return "离线任务范围无效";
            for(int i=0;i<urls.length();i++)if(!allowed(urls.getString(i)))return "图源暂不支持后台缓存";
            int done=0;long bytes=0;for(int i=0;i<urls.length();i++){File f=tile(c,urls.getString(i));if(f.isFile()&&f.length()>0){done++;bytes+=f.length();}}task.put("state","queued").put("error","").put("done",done).put("bytes",bytes).put("total",urls.length());write(job(c,id),task.toString().getBytes(StandardCharsets.UTF_8));save(c,task);
            write(new File(root(c),"active"),id.getBytes(StandardCharsets.UTF_8));return "ok";
        }catch(Exception e){return "下载任务保存失败，请检查存储空间";}
    }
    static String activeId(Context c) throws Exception {try(InputStream in=new FileInputStream(new File(root(c),"active"))){return new String(DataTransport.readLimited(in,1024),StandardCharsets.UTF_8);} }
    static synchronized String snapshot(Context c) {
        try {JSONObject state=read(new File(root(c),hash(activeId(c))+".progress"));state.remove("urls");if(!OfflineDownloadService.running && Arrays.asList("running","waiting","queued").contains(state.optString("state")))state.put("state","paused");return state.toString();}catch(Exception e){return "{}";}
    }
    static synchronized void status(Context c,String status,String error) {try{JSONObject task=read(new File(root(c),hash(activeId(c))+".progress"));task.put("state",status).put("error",error);save(c,task);}catch(Exception ignored){} }
    static WebResourceResponse hit(Context c,String url) {
        try {if(!allowed(url))return null;File f=tile(c,url);if(!f.isFile() || f.length()==0)return null;
            String mime="application/octet-stream";try(InputStream in=new FileInputStream(f)){int a=in.read(),b=in.read();if(a==137&&b==80)mime="image/png";else if(a==255&&b==216)mime="image/jpeg";else if(a=='{'||a=='[')mime="application/json";}
            Map<String,String> headers=new HashMap<>();headers.put("Access-Control-Allow-Origin","https://"+LocalGateway.HOST);headers.put("Cache-Control","public, max-age=86400");
            return new WebResourceResponse(mime,null,200,"OK",headers,new FileInputStream(f));
        }catch(Exception e){return null;}
    }
    static byte[] download(Context c,String value) throws Exception {
        if(!allowed(value))throw new IOException("不支持的图源");
        Uri u=Uri.parse(value);
        if(LocalGateway.HOST.equals(u.getHost())) {
            WebResourceResponse r=new LocalGateway(c).intercept(u,"GET");if(r.getStatusCode()!=200)throw new IOException("地形暂不可用");try(InputStream in=r.getData()){return DataTransport.readLimited(in,8*1024*1024);}
        }
        HttpURLConnection connection=(HttpURLConnection)new URL(value).openConnection();
        connection.setConnectTimeout(15000);connection.setReadTimeout(15000);connection.setInstanceFollowRedirects(false);connection.setRequestProperty("Referer","https://"+LocalGateway.HOST+"/");
        try {int status=connection.getResponseCode();if(status!=200)throw new IOException("HTTP "+status);
            try(InputStream in=connection.getInputStream()) {byte[] bytes=DataTransport.readLimited(in,8*1024*1024);
                if(bytes.length==0)throw new IOException("空瓦片");
                if(u.getHost().endsWith(".tianditu.gov.cn") && !(bytes.length>3 && (((bytes[0]&255)==137 && bytes[1]==80) || ((bytes[0]&255)==255 && (bytes[1]&255)==216))))throw new IOException("授权或配额限制：未返回有效瓦片");
                return bytes;}
        }finally{connection.disconnect();}
    }
    static synchronized String verify(Context c,String id) {
        try{JSONObject task=read(job(c,id));JSONArray urls=task.getJSONArray("urls");int done=0;long bytes=0;for(int i=0;i<urls.length();i++){File f=tile(c,urls.getString(i));if(f.isFile()&&f.length()>0){done++;bytes+=f.length();}}task.put("done",done).put("bytes",bytes).put("total",urls.length());save(c,task);task.remove("urls");return task.toString();}catch(Exception e){return "{}";}
    }
    static synchronized boolean remove(Context c,String id) {
        if(OfflineDownloadService.running)return false;
        try{File target=job(c,id);JSONObject old=read(target);Set<String> keep=new HashSet<>();File[] all=root(c).listFiles((d,n)->n.endsWith(".json"));if(all!=null)for(File f:all)if(!f.equals(target)){JSONArray urls=read(f).getJSONArray("urls");for(int i=0;i<urls.length();i++)keep.add(identity(urls.getString(i)));}
            if(!target.delete())return false;new File(root(c),hash(id)+".progress").delete();JSONArray urls=old.getJSONArray("urls");for(int i=0;i<urls.length();i++){String url=urls.getString(i);if(!keep.contains(identity(url)))tile(c,url).delete();}return true;
        }catch(Exception e){return false;}
    }
}
