package com.shantu.qa149;

import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.lang.reflect.Method;
import java.net.URLEncoder;
import java.util.UUID;

/** Small real-bridge download/read/cleanup checks using unique public Bing sample requests. */
public final class Native170OfflineDownloadRegression {
    private Native170OfflineDownloadRegression() { }

    public static JSONObject run(Native149Instrumentation parent) {
        Runner runner=new Runner(parent);
        return runner.run();
    }

    private static final class Runner {
        private static final String PREFIX="qa170-";
        private static final long DOWNLOAD_TIMEOUT_MS=90_000L;
        private final Native149Instrumentation parent;
        private final JSONObject report=new JSONObject();
        private final JSONArray levels=new JSONArray();
        private final String runId=UUID.randomUUID().toString().replace("-","");
        private boolean preflightPassed;
        private Runner(Native149Instrumentation parent){this.parent=parent;}

        JSONObject run(){
            put("mode","native170-offline-download-regression");
            put("runId",runId);
            put("source","public Bing Aerial sample; no credentials");
            put("urlDisclosure",false);
            try {
                boolean existingTargetReused;
                try { callParent("readState"); existingTargetReused=true; }
                catch (Exception unattached) { callParent("attachTarget"); existingTargetReused=false; }
                put("existingInteractiveTargetReused",existingTargetReused);
                callParent("awaitWebViewDraw");
                JSONObject capability=parseObject(evalJs("(()=>{const b=window.GuanyunNative;if(!b)return JSON.stringify({present:false});let c={};try{c=JSON.parse(b.offlineCapabilities?.()||'{}')}catch{}return JSON.stringify({present:true,version:c.version||0,imported:c.imported===true,chunked:c.chunked===true,begin:typeof b.offlineBegin==='function',append:typeof b.offlineAppend==='function',commit:typeof b.offlineCommit==='function',state:typeof b.offlineState==='function',has:typeof b.offlineHas==='function',verify:typeof b.offlineVerify==='function',remove:typeof b.offlineRemove==='function',pause:typeof b.offlinePause==='function',discard:typeof b.offlineDiscard==='function'})})()"));
                boolean supported=capability.optBoolean("present")&&capability.optInt("version")>=2&&capability.optBoolean("imported")&&capability.optBoolean("chunked")&&capability.optBoolean("begin")&&capability.optBoolean("append")&&capability.optBoolean("commit")&&capability.optBoolean("state")&&capability.optBoolean("has")&&capability.optBoolean("verify")&&capability.optBoolean("remove")&&capability.optBoolean("pause")&&capability.optBoolean("discard");
                put("bridge",capability);
                if(!supported)throw new StageFailure("bridge-preflight", "native-offline-bridge-unavailable");
                JSONObject current=offlineState();
                String currentState=current.optString("state","");
                if(isActive(currentState))throw new StageFailure("active-task-preflight","another-offline-task-is-active");
                if(!current.optString("id","").isEmpty())throw new StageFailure("active-task-preflight","existing-offline-selection-must-be-preserved");
                preflightPassed=true;
                for(int zoom:new int[]{14,19})levels.put(runLevel(zoom));
            } catch(Throwable error) {
                put("testState","ERROR");put("failedStage",error instanceof StageFailure?((StageFailure)error).stage:"setup");put("errorCode",error instanceof StageFailure?((StageFailure)error).code:"qa-exception");
            } finally {
                put("cleanup",preflightPassed?"each-qa-task-cleaned-or-its-own-cleanup-failed":"not-started");
            }
            if(!report.has("testState")){
                boolean passed=levels.length()==2;
                for(int i=0;i<levels.length();i++)passed&=levels.optJSONObject(i)!=null&&"PASS".equals(levels.optJSONObject(i).optString("testState"));
                put("testState",passed?"PASS":"FAIL");
            }
            put("levels",levels);
            return report;
        }

        private JSONObject runLevel(int zoom)throws Exception{
            String id=PREFIX+runId+"-z"+zoom;
            String url=sampleUrl(zoom,runId);
            JSONObject result=new JSONObject();
            boolean began=false,committed=false,clean=false;
            String stage="begin";
            try {
                put(result,"zoom",zoom);put(result,"tripIdPrefix",PREFIX);put(result,"resourceCount",1);
                callParent("awaitWebViewDraw");
                JSONObject begin=bridgeCall("offlineBegin",new JSONArray().put(id).put("QA170 Bing "+zoom+" "+runId).put(1));
                if(!"ok".equals(begin.optString("value")))throw new StageFailure("begin","offline-begin-rejected");
                began=true;
                stage="append";
                JSONArray urls=new JSONArray().put(url);
                JSONObject append=bridgeCall("offlineAppend",new JSONArray().put(id).put(0).put(urls.toString()));
                if(!"ok".equals(append.optString("value")))throw new StageFailure("append","offline-append-rejected");
                stage="commit";
                JSONObject commit=bridgeCall("offlineCommit",new JSONArray().put(id));
                if(!"ok".equals(commit.optString("value")))throw new StageFailure("commit","offline-commit-rejected");
                committed=true;
                stage="download";
                JSONObject terminal=awaitTerminal(id,DOWNLOAD_TIMEOUT_MS);
                put(result,"terminalState",terminal.optString("state"));
                put(result,"done",terminal.optInt("done"));put(result,"total",terminal.optInt("total"));put(result,"bytes",terminal.optLong("bytes"));
                put(result,"missing",terminal.optInt("missing"));
                put(result,"error",safeText(terminal.optString("error","")));
                if(!"complete".equals(terminal.optString("state"))||terminal.optInt("done")!=1||terminal.optInt("total")!=1||terminal.optLong("bytes")<=0)
                    throw new StageFailure("download","public-tile-download-incomplete");
                stage="verify";
                JSONObject verify=bridgeJson("offlineVerify",id);
                boolean has=bridgeBoolean("offlineHas",url);
                put(result,"verifiedDone",verify.optInt("done"));put(result,"verifiedTotal",verify.optInt("total"));put(result,"tilePresent",has);
                if(verify.optInt("done")!=1||verify.optInt("total")!=1||!has)
                    throw new StageFailure("verify","saved-tile-not-found");
                stage="read";
                JSONObject read=readStoredTile(url);
                put(result,"readStatus",read.optInt("status"));put(result,"readContentType",read.optString("contentType"));put(result,"readBytes",read.optInt("bytes"));
                if(read.optInt("status")!=200||read.optInt("bytes")<=0||!read.optString("contentType").toLowerCase(java.util.Locale.ROOT).startsWith("image/"))
                    throw new StageFailure("read","saved-tile-read-failed");
                put(result,"testState","PASS");
            } catch(Throwable error) {
                put(result,"testState","FAIL");put(result,"failedStage",error instanceof StageFailure?((StageFailure)error).stage:stage);
                put(result,"errorCode",error instanceof StageFailure?((StageFailure)error).code:"qa-exception");
            } finally {
                try {
                    if(committed){
                        JSONObject state=offlineState();
                        if(id.equals(state.optString("id"))&&isActive(state.optString("state"))){bridgeCall("offlinePause",new JSONArray());awaitInactive(id,20_000L);}
                        boolean removed=bridgeBoolean("offlineRemove",id);
                        clean=removed;
                    } else if(began){
                        bridgeCall("offlineDiscard",new JSONArray().put(id));
                        clean=true;
                    }
                } catch(Throwable ignored) { clean=false; }
                put(result,"cleanup",clean?"PASS":"FAIL");
                if(!clean){if("PASS".equals(result.optString("testState")))put(result,"testState","FAIL");if(!result.has("failedStage"))put(result,"failedStage","cleanup");}
            }
            return result;
        }

        private JSONObject awaitTerminal(String id,long timeoutMs)throws Exception{
            long end=SystemClock.elapsedRealtime()+timeoutMs;
            while(SystemClock.elapsedRealtime()<end){
                JSONObject state=offlineState();
                if(id.equals(state.optString("id"))){
                    String value=state.optString("state","");
                    if("complete".equals(value)||"paused".equals(value)||"cancelled".equals(value)||"error".equals(value))return state;
                }
                SystemClock.sleep(350L);
            }
            throw new StageFailure("download","offline-service-timeout");
        }

        private void awaitInactive(String id,long timeoutMs)throws Exception{
            long end=SystemClock.elapsedRealtime()+timeoutMs;
            while(SystemClock.elapsedRealtime()<end){
                JSONObject state=offlineState();
                if(!id.equals(state.optString("id"))||!isActive(state.optString("state")))return;
                SystemClock.sleep(250L);
            }
        }

        private JSONObject offlineState()throws Exception{return parseObject(evalJs("(()=>{const b=window.GuanyunNative;return b?b.offlineState():'{}'})()"));}

        private JSONObject bridgeCall(String method,JSONArray args)throws Exception{
            StringBuilder values=new StringBuilder();
            for(int i=0;i<args.length();i++){if(i>0)values.append(',');Object value=args.get(i);values.append(value instanceof String?JSONObject.quote((String)value):String.valueOf(value));}
            String expression="(()=>{const b=window.GuanyunNative;if(!b||typeof b["+JSONObject.quote(method)+"]!=='function')return JSON.stringify({value:'bridge-missing'});const v=b["+JSONObject.quote(method)+"]("+values+");return JSON.stringify({value:v===undefined?null:v})})()";
            return parseObject(evalJs(expression));
        }

        private JSONObject bridgeJson(String method,String id)throws Exception{
            JSONObject wrapped=bridgeCall(method,new JSONArray().put(id));
            Object value=wrapped.opt("value");
            if(!(value instanceof String))throw new StageFailure("verify","bridge-result-invalid");
            return parseObject((String)value);
        }

        private boolean bridgeBoolean(String method,String value)throws Exception{
            JSONObject wrapped=bridgeCall(method,new JSONArray().put(value));
            return wrapped.optBoolean("value",false);
        }

        private JSONObject readStoredTile(String url)throws Exception{
            String expression="(async()=>{const u="+JSONObject.quote(url)+";const r=await fetch('/api/offline-tile?url='+encodeURIComponent(u));const b=await r.arrayBuffer();return JSON.stringify({status:r.status,contentType:r.headers.get('content-type')||'',bytes:b.byteLength})})()";
            return parseObject(evalAsync(expression,15_000L));
        }

        private String evalAsync(String expression,long timeoutMs)throws Exception{
            String token="qa170"+UUID.randomUUID().toString().replace("-","");String key=JSONObject.quote(token);
            String start="(()=>{window.__qa170Async=window.__qa170Async||{};window.__qa170Async["+key+"]=null;Promise.resolve().then(()=>"+expression+").then(v=>window.__qa170Async["+key+"]=JSON.stringify({ok:true,value:v}),e=>window.__qa170Async["+key+"]=JSON.stringify({ok:false}));return 'started'})()";
            evalJs(start);long end=SystemClock.elapsedRealtime()+timeoutMs;
            while(SystemClock.elapsedRealtime()<end){
                String raw=evalJs("(()=>window.__qa170Async&&window.__qa170Async["+key+"]||'')()");
                if(raw!=null&&!raw.isEmpty()){
                    JSONObject result=parseObject(raw);evalJs("(()=>{delete window.__qa170Async["+key+"];return 'done'})()");
                    if(!result.optBoolean("ok"))throw new StageFailure("read","offline-tile-fetch-failed");
                    Object value=result.opt("value");return value instanceof String?(String)value:String.valueOf(value);
                }
                SystemClock.sleep(100L);
            }
            evalJs("(()=>{if(window.__qa170Async)delete window.__qa170Async["+key+"];return 'timeout'})()");
            throw new StageFailure("read","offline-tile-read-timeout");
        }

        private String evalJs(String script)throws Exception{return String.valueOf(callParent("evalJs",script));}
        private Object callParent(String name,Object... args)throws Exception{
            Method found=null;
            for(Class<?> type=parent.getClass();type!=null&&found==null;type=type.getSuperclass())for(Method method:type.getDeclaredMethods())
                if(method.getName().equals(name)&&method.getParameterTypes().length==args.length&&!method.getName().endsWith("$default")){found=method;break;}
            if(found==null)throw new NoSuchMethodException("Native149Instrumentation."+name+"/"+args.length);
            found.setAccessible(true);
            try{return found.invoke(parent,args);}catch(java.lang.reflect.InvocationTargetException error){Throwable cause=error.getCause();if(cause instanceof Exception)throw(Exception)cause;if(cause instanceof Error)throw(Error)cause;throw error;}
        }

        private JSONObject parseObject(String value)throws JSONException{
            Object parsed=new JSONTokener(value).nextValue();if(parsed instanceof JSONObject)return(JSONObject)parsed;throw new JSONException("expected-object-result");
        }

        private String sampleUrl(int zoom,String unique)throws Exception{
            double longitude=-0.1278,latitude=51.5074;
            double n=Math.scalb(1.0,zoom);
            int x=(int)Math.floor((longitude+180.0)/360.0*n);
            double radians=Math.toRadians(latitude);
            int y=(int)Math.floor((1.0-Math.log(Math.tan(radians)+1.0/Math.cos(radians))/Math.PI)/2.0*n);
            StringBuilder quadkey=new StringBuilder(zoom);
            for(int level=zoom;level>0;level--){int mask=1<<(level-1),digit=0;if((x&mask)!=0)digit++;if((y&mask)!=0)digit+=2;quadkey.append(digit);}
            return "https://ecn.t3.tiles.virtualearth.net/tiles/a"+quadkey+".jpeg?g=1&qa170="+URLEncoder.encode(unique+"-z"+zoom,"UTF-8");
        }

        private boolean isActive(String value){return "running".equals(value)||"waiting".equals(value)||"queued".equals(value)||"downloading".equals(value);}
        private String safeText(String value){if(value==null)return "";String safe=value.replaceAll("https?://[^\\s]+","<url>").replaceAll("(?i)(tk|key|token|sig|api_key)=([^&\\s]+)","$1=<redacted>");return safe.substring(0,Math.min(240,safe.length()));}
        private void put(String key,Object value){try{report.put(key,value);}catch(JSONException ignored){}}
        private void put(JSONObject target,String key,Object value){try{target.put(key,value);}catch(JSONException ignored){}}
    }

    private static final class StageFailure extends Exception {
        final String stage,code;
        StageFailure(String stage,String code){super(code);this.stage=stage;this.code=code;}
    }
}
