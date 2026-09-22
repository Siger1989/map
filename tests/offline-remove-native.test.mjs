import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {execFileSync} from 'node:child_process';import path from 'node:path';
test('native removal permits another active package, preserves shared tiles, retries missing job',()=>{
 const source=readFileSync('mobile/android/src/com/guanyun/weather/OfflineStore.java','utf8');const method=source.slice(source.indexOf('    static synchronized boolean remove('),source.lastIndexOf('\n}'));
 const dir=path.resolve('.openai/offline-remove-java');mkdirSync(dir,{recursive:true});
 writeFileSync(path.join(dir,'RemoveCheck.java'),`
import java.io.*;import java.util.*;import java.nio.file.*;
public class RemoveCheck {
 ${method}
 static class Context {File dir;String active="";Context()throws Exception{dir=Files.createTempDirectory("shantu-remove-check").toFile();}}
 static class OfflineDownloadService {static boolean running;}
 static class AtomicFile {File f;AtomicFile(File f){this.f=f;}void delete(){f.delete();}}
 static class JSONArray {String[] v;JSONArray(String...v){this.v=v;}int length(){return v.length;}String getString(int i){return v[i];}}
 static class JSONObject {JSONArray urls;JSONObject(String...v){urls=new JSONArray(v);}JSONArray getJSONArray(String s){return urls;}}
 static Map<String,JSONObject> jobs=new HashMap<>();
 static String activeId(Context c){return c.active;}static File root(Context c){return c.dir;}static String hash(String s){return s;}
 static File job(Context c,String id){return new File(c.dir,id+".json");}static File tile(Context c,String url){return new File(c.dir,url+".tile");}
 static String identity(String s){return s;}static JSONObject read(File f)throws Exception{JSONObject j=jobs.get(f.getPath());if(j==null)throw new IOException();return j;}
 static void add(Context c,String id,String...urls)throws Exception{File f=job(c,id);f.createNewFile();jobs.put(f.getPath(),new JSONObject(urls));new File(c.dir,id+".progress").createNewFile();for(String url:urls)tile(c,url).createNewFile();}
 static void require(boolean ok){if(!ok)throw new AssertionError();}
 public static void main(String[] args)throws Exception{
 Context c=new Context();add(c,"a","shared","only-a");add(c,"b","shared","only-b");c.active="b";new File(c.dir,"active").createNewFile();OfflineDownloadService.running=true;
 require(remove(c,"a"));require(tile(c,"shared").exists());require(!tile(c,"only-a").exists());require(job(c,"b").exists());require(new File(c.dir,"active").exists());
 require(remove(c,"a"));require(!remove(c,"b"));OfflineDownloadService.running=false;require(remove(c,"b"));require(!new File(c.dir,"active").exists());require(!new File(c.dir,"b.progress").exists());require(!tile(c,"shared").exists());require(remove(c,"b"));
 System.out.println("native remove boundaries passed");
 }
}`);
 const jdk=process.env.JAVA_HOME||'D:/GodotAndroid/jdk-17-portable/jdk-17.0.19+10';const bin=n=>path.join(jdk,'bin',n+(process.platform==='win32'?'.exe':''));execFileSync(bin('javac'),['-encoding','UTF-8','-d',dir,path.join(dir,'RemoveCheck.java')]);assert.match(execFileSync(bin('java'),['-cp',dir,'RemoveCheck'],{encoding:'utf8'}),/boundaries passed/);
});
