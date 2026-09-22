import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

test('native start queues WebView access, reports service failure, preserves permission-independent downloads', () => {
  // Run the actual production method with thread-checking Android boundary fakes.
  // UI cannot run until the synchronous JS bridge invocation has returned.
  const source=readFileSync('mobile/android/src/com/guanyun/weather/NativeBridge.java','utf8');
  const method=source.slice(source.indexOf('    @JavascriptInterface public String offlineStart'),source.indexOf('    @JavascriptInterface public String offlineState')).replace('@JavascriptInterface ','');
  const dir=path.resolve('.openai/offline-start-java');mkdirSync(dir,{recursive:true});
  writeFileSync(path.join(dir,'StartCheck.java'),`
import java.util.*;
public class StartCheck {
  final Activity activity=new Activity();
  ${method}
  static class Activity {
    final Thread ui=Thread.currentThread(); final Queue<Runnable> queue=new ArrayDeque<>();
    boolean trusted=true, failService, failPermission; int starts;
    void check(){if(Thread.currentThread()!=ui)throw new IllegalStateException("WebView wrong thread");}
    boolean trustedForeground(){check();return trusted;}
    void runOnUiThread(Runnable r){queue.add(r);}
    void startForegroundService(Intent i){check();if(failService)throw new IllegalStateException("denied");starts++;}
    int checkSelfPermission(String p){check();return -1;}
    void requestPermissions(String[] p,int id){check();if(failPermission)throw new IllegalStateException("notification denied");}
    void drain(){check();while(!queue.isEmpty())queue.remove().run();}
  }
  static class Intent {Intent(Activity a,Class<?> c){} Intent setAction(String a){return this;}}
  static class Build {static class VERSION {static int SDK_INT=35;}}
  static class Manifest {static class permission {static String POST_NOTIFICATIONS="notification";}}
  static class PackageManager {static int PERMISSION_GRANTED=0;}
  static class OfflineDownloadService {static boolean running;}
  static class OfflineStore {
    static String result="ok",state="",error="";
    static String prepare(Activity a,String raw){if("ok".equals(result))state="queued";return result;}
    static void status(Activity a,String s,String e){state=s;error=e;}
  }
  static class android {static class util {static class Log {static void e(String a,String b,Exception e){} static void w(String a,String b,Exception e){}}}}
  static void require(boolean ok){if(!ok)throw new AssertionError();}
  static String call(StartCheck bridge)throws Exception {
    final String[] result={null}; final Throwable[] error={null};
    Thread t=new Thread(()->{try{result[0]=bridge.offlineStart("task");}catch(Throwable e){error[0]=e;}});
    t.start();t.join(2000);require(!t.isAlive());if(error[0]!=null)throw new AssertionError(error[0]);return result[0];
  }
  public static void main(String[] args)throws Exception {
    StartCheck a=new StartCheck();require("ok".equals(call(a)));require(a.activity.starts==0);require(OfflineDownloadService.running);a.activity.drain();require(a.activity.starts==1);
    StartCheck b=new StartCheck();b.activity.failService=true;require("ok".equals(call(b)));b.activity.drain();require(!OfflineDownloadService.running);require("paused".equals(OfflineStore.state));
    StartCheck c=new StartCheck();c.activity.trusted=false;require("ok".equals(call(c)));c.activity.drain();require(c.activity.starts==0);require(!OfflineDownloadService.running);
    StartCheck d=new StartCheck();d.activity.failPermission=true;require("ok".equals(call(d)));d.activity.drain();require(d.activity.starts==1);require(OfflineDownloadService.running);
    OfflineStore.result="range rejected";StartCheck e=new StartCheck();require("range rejected".equals(call(e)));require(e.activity.queue.isEmpty());
    System.out.println("5 native startup scenarios passed");
  }
}
`);
  const jdk=process.env.JAVA_HOME || 'D:/GodotAndroid/jdk-17-portable/jdk-17.0.19+10';
  const bin=name=>path.join(jdk,'bin',name+(process.platform==='win32'?'.exe':''));
  execFileSync(bin('javac'),['-encoding','UTF-8','-d',dir,path.join(dir,'StartCheck.java')]);
  assert.match(execFileSync(bin('java'),['-cp',dir,'StartCheck'],{encoding:'utf8'}),/5 native startup scenarios passed/);
});

test('failed native invocation keeps the package and enables retry; retry reaches completion', async (t) => {
  const oldKey=process.env.NEXT_PUBLIC_TIANDITU_KEY;
  process.env.NEXT_PUBLIC_TIANDITU_KEY='offlineTestPlaceholder';
  t.after(()=>{if(oldKey===undefined)delete process.env.NEXT_PUBLIC_TIANDITU_KEY;else process.env.NEXT_PUBLIC_TIANDITU_KEY=oldKey;});
  const {window}=parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true});
  const data=new Map();globalThis.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
  let state={},fail=true,starts=0;
  window.GuanyunNative={offlineStart(raw){starts++;if(fail)throw Error('Error invoking offlineStart: Java exception');const task=JSON.parse(raw);state={id:task.id,state:'complete',done:task.urls.length,bytes:512};return 'ok';},offlineState:()=>JSON.stringify(state),offlinePause(){}};
  await build({entryPoints:['modules/outdoor/useOffline.ts','modules/outdoor/OfflineDownload.tsx'],outdir:'.openai/offline-start-ui',bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic'});
  const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
  const {useOffline}=await import('../.openai/offline-start-ui/useOffline.js');
  const {OfflineDownload}=await import('../.openai/offline-start-ui/OfflineDownload.js');
  let offline;const target={name:'测试路线',provider:'tianditu',area:{kind:'route',segments:[[[103,30],[103.001,30.001]]],bufferKm:5},settings:{baseMap:'tianditu-img',labels:false,terrain:false}};
  // Use repository defaults so the same real download plan is exercised.
  const {DEFAULT_LAYERS}=await import('../modules/map/types.ts');
  target.settings={...DEFAULT_LAYERS,tiandituBase:'img',labels:false,terrain:false};
  function Probe(){offline=useOffline();return React.createElement(OfflineDownload,{offline,target,onClose(){},onManage(){}});}
  const root=createRoot(document.getElementById('root'));t.after(async()=>{await act(async()=>root.unmount());});await act(async()=>root.render(React.createElement(Probe)));
  const button=t=>[...document.querySelectorAll('button')].find(b=>b.textContent===t);
  await act(async()=>button('下载地图').click());
  assert.equal(starts,1);assert.equal(offline.busy,false);assert.ok(offline.current);assert.equal(offline.packages.length,1);
  assert.match(document.body.textContent,/后台下载启动失败/);assert.doesNotMatch(document.body.textContent,/Java exception/);
  assert.equal(button('继续下载').disabled,false);const id=offline.current.id;
  fail=false;await act(async()=>button('继续下载').click());
  assert.equal(starts,2);assert.equal(offline.current.id,id);assert.equal(offline.current.complete,true);assert.equal(offline.packages.length,1);
  assert.equal(button('继续下载').disabled,true);
});
