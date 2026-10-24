import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

test('native removal allows a different active package, preserves shared tiles and retries failed deletion', () => {
  const source = readFileSync('mobile/android/src/com/guanyun/weather/OfflineStore.java', 'utf8');
  const method = source.slice(source.indexOf('    static synchronized boolean remove('), source.lastIndexOf('\n}'));
  const dir = path.resolve('.openai/offline-remove-java');
  mkdirSync(path.join(dir, 'android', 'util'), { recursive: true });
  writeFileSync(path.join(dir, 'RemoveCheck.java'), `
import java.io.*;import java.util.*;import java.nio.file.*;
public class RemoveCheck {
 ${method}
 static class Context {File dir;String active="";Context()throws Exception{dir=Files.createTempDirectory("shantu-remove-check").toFile();}}
 static class OfflineDownloadService {static final Set<String> busy=new HashSet<>();static boolean isBusy(String id){return busy.contains(id);}}
 static class JSONArray {String[] v;JSONArray(String...v){this.v=v;}int length(){return v.length;}String getString(int i){return v[i];}}
 static class JSONObject {String id;JSONArray urls;JSONObject(String id,String...v){this.id=id;this.urls=new JSONArray(v);}JSONArray optJSONArray(String s){return "urls".equals(s)?urls:null;}JSONArray getJSONArray(String s){return optJSONArray(s);}String getString(String s){if("id".equals(s))return id;throw new IllegalArgumentException(s);}}
 static Map<String,JSONObject> jobs=new HashMap<>();
 static String activeId(Context c){return c.active;}static File root(Context c){return c.dir;}static String hash(String s){return s;}
 static File job(Context c,String id){return new File(c.dir,id+".json");}static File urlsFile(Context c,String id){return new File(c.dir,id+".urls");}
 static File tile(Context c,String url){return new File(c.dir,url+".tile");}static String identity(String s){return s;}
 static JSONObject read(File f)throws Exception{JSONObject j=jobs.get(f.getPath());if(j==null)throw new IOException("missing task");return j;}
 static JSONObject readTask(Context c,String id)throws Exception{return read(job(c,id));}
 static void discard(Context c,String id){new android.util.AtomicFile(new File(root(c),id+".stage")).delete();new android.util.AtomicFile(new File(root(c),id+".stage.urls")).delete();}
 static void add(Context c,String id,String...urls)throws Exception{File f=job(c,id);f.createNewFile();jobs.put(f.getPath(),new JSONObject(id,urls));new File(c.dir,id+".progress").createNewFile();for(String url:urls)tile(c,url).createNewFile();}
 static void require(boolean ok){if(!ok)throw new AssertionError();}
 public static void main(String[] args)throws Exception{
  Context c=new Context();add(c,"a","shared","only-a");add(c,"b","shared","only-b");c.active="b";new File(c.dir,"active").createNewFile();OfflineDownloadService.busy.add("b");
  require(remove(c,"a"));require(tile(c,"shared").exists());require(!tile(c,"only-a").exists());require(job(c,"b").exists());require(new File(c.dir,"active").exists());require(!remove(c,"b"));
  OfflineDownloadService.busy.clear();android.util.AtomicFile.failDeletes.add(job(c,"b"));require(!remove(c,"b"));require(job(c,"b").exists());
  android.util.AtomicFile.failDeletes.clear();OfflineDownloadService.busy.clear();require(remove(c,"b"));require(!new File(c.dir,"active").exists());require(!new File(c.dir,"b.progress").exists());require(!tile(c,"shared").exists());require(!tile(c,"only-b").exists());require(remove(c,"b"));
  System.out.println("native remove boundaries passed");
 }
}`);
  writeFileSync(path.join(dir, 'android', 'util', 'AtomicFile.java'), `
package android.util;
import java.io.File;import java.util.HashSet;import java.util.Set;
public class AtomicFile {private final File file;public static final Set<File> failDeletes=new HashSet<>();public AtomicFile(File file){this.file=file;}public void delete(){if(!failDeletes.contains(file))file.delete();}}
`);
  const jdk = process.env.JAVA_HOME || 'D:/GodotAndroid/jdk-17-portable/jdk-17.0.19+10';
  const bin = name => path.join(jdk, 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
  execFileSync(bin('javac'), ['-encoding', 'UTF-8', '-d', dir, path.join(dir, 'RemoveCheck.java'), path.join(dir, 'android', 'util', 'AtomicFile.java')]);
  assert.match(execFileSync(bin('java'), ['-cp', dir, 'RemoveCheck'], { encoding: 'utf8' }), /boundaries passed/);
});
