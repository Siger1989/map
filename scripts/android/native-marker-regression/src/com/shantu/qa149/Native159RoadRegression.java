package com.shantu.qa149;

import android.os.Environment;
import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Map;
import java.util.List;
import java.util.UUID;

/** Read real ordinary-road state and temporarily isolate its native layer. */
public final class Native159RoadRegression {
    private Native159RoadRegression() { }
    public static JSONObject run(Native149Instrumentation parent) throws Exception {
        JSONObject report = new JSONObject().put("mode", "road-style-regression").put("testState", "RUNNING");
        JSONArray stages = new JSONArray(); report.put("stages", stages);
        call(parent,"attachTarget");
        // Map allocation precedes React hydration and persisted layer selection.
        SystemClock.sleep(6000L);call(parent,"awaitWebViewDraw");
        Object entry = field(parent,"entry"), controller=field(entry,"controller"), cartography=field(controller,"cartography");
        Object roads=field(cartography,"nativeRoadLayer");
        Object rasterLabels=field(cartography,"tiandituLabelRenderLayer");
        JSONObject originalCamera=(JSONObject)call(parent,"invokeCameraJson");
        boolean originalEnabled=(Boolean)property(roads,"isEnabled","isEnabled");
        boolean originalRasterEnabled=(Boolean)property(rasterLabels,"isEnabled","isEnabled");
        JSONObject originalState=new JSONObject(((JSONObject)call(parent,"readState")).toString());
        long baseline=originalState.optLong("revision",0),qaRevision=baseline+100000L;
        boolean stateChanged=false;
        String runId=UUID.randomUUID().toString().replace("-", "");
        File dir=new File(parent.getTargetContext().getExternalFilesDir(Environment.DIRECTORY_PICTURES), "native159-roads-"+runId);
        if(!dir.mkdirs()) throw new IllegalStateException("evidence-directory-create-failed");
        set(parent,"evidenceDir",dir);set(parent,"runId",runId);
        report.put("evidenceDirectory",dir.getAbsolutePath()).put("targetVersion",call(parent,"targetVersionProof"));
        try {
            // No business settings, records, overlays, source selection, or data are changed.
            call(parent,"applyCamera",new JSONObject(originalCamera.toString()).put("zoom",14));
            call(parent,"awaitFrames",2,10000L);SystemClock.sleep(2500);
            stages.put(snapshot(parent,entry,roads,"original"));
            setEnabled(parent,roads,false); redraw(parent,controller);
            call(parent,"awaitFrames",2,10000L);SystemClock.sleep(200);
            stages.put(snapshot(parent,entry,roads,"ordinary-roads-hidden"));
            setEnabled(parent,rasterLabels,false);redraw(parent,controller);
            call(parent,"awaitFrames",2,10000L);SystemClock.sleep(200);
            stages.put(snapshot(parent,entry,roads,"raster-labels-hidden"));
            setEnabled(parent,rasterLabels,originalRasterEnabled);
            setEnabled(parent,roads,true);redraw(parent,controller);
            for(double zoom:new double[]{14,10,7}) {
                JSONObject camera=new JSONObject(originalCamera.toString()).put("zoom",zoom);
                call(parent,"applyCamera",camera);call(parent,"awaitFrames",2,10000L);SystemClock.sleep(4000);
                stages.put(snapshot(parent,entry,roads,"zoom-"+(int)zoom));
            }
            JSONObject vectorState=new JSONObject(originalState.toString());
            JSONObject vectorSettings=new JSONObject(vectorState.getJSONObject("settings").toString());
            vectorSettings.put("tiandituLabels","vector").put("roadsEnabled",true).put("labelsEnabled",true);
            vectorState.put("settings",vectorSettings).put("revision",++qaRevision);
            stateChanged=true;
            call(parent,"applyRenderStateThroughBridge","main",vectorState,"qa-road-vector-"+runId);
            for(double zoom:new double[]{14,10}) {
                call(parent,"applyCamera",new JSONObject(originalCamera.toString()).put("zoom",zoom));
                call(parent,"awaitFrames",2,10000L);SystemClock.sleep(4000);
                stages.put(snapshot(parent,entry,roads,"vector-only-zoom-"+(int)zoom));
            }
            report.put("testState","PASS");
        } catch(Throwable error) {
            report.put("testState","ERROR").put("errorDetails",call(parent,"errorDetails",error));
        } finally {
            if(stateChanged){
                JSONObject restore=new JSONObject(originalState.toString()).put("revision",++qaRevision);
                call(parent,"applyRenderStateThroughBridge","main",restore,"qa-road-restore-"+runId);
                call(parent,"restoreRevisionBaseline",originalState,baseline);
                report.put("originalRenderStateAndRevisionRestored",true);
            }
            setEnabled(parent,rasterLabels,originalRasterEnabled);setEnabled(parent,roads,originalEnabled);call(parent,"applyCamera",originalCamera);redraw(parent,controller);
            report.put("originalRoadsEnabledRestored",property(roads,"isEnabled","isEnabled").equals(originalEnabled));
            try(FileOutputStream out=new FileOutputStream(new File(dir,"road-style-regression.json"))){out.write(report.toString(2).getBytes("UTF-8"));}
        }
        return report;
    }
    private static JSONObject snapshot(Native149Instrumentation p,Object entry,Object roads,String name) throws Exception {
        JSONObject state=(JSONObject)call(p,"readState");
        JSONObject out=new JSONObject().put("stage",name).put("camera",call(p,"invokeCameraJson"))
            .put("roadsEnabled",property(roads,"isEnabled","isEnabled")).put("cssScale",call(p,"rendererCssScale"));
        JSONObject plan=new JSONObject();Object cartography=field(field(entry,"controller"),"cartography"),planValue=field(cartography,"plan");
        for(String k:new String[]{"roads","roadNames","placeLabels","tiandituLabels","effectiveBase","rasterLabelOpacity"})plan.put(k,field(planValue,k));
        out.put("cartographyPlan",plan);
        Object view=field(roads,"viewStyle");
        out.put("styleZoom",field(view,"zoom")).put("styleCssScale",field(view,"cssScale"));
        Object cut=field(roads,"renderCut"), key=field(roads,"groupKey");
        JSONArray renderables=new JSONArray();
        // The GL thread replaces the selected cut while rendering. Copy the
        // arrays instead of using a fail-fast iterator over that live list.
        Object[] tiles=cut instanceof java.util.Collection?((java.util.Collection<?>)cut).toArray():new Object[0];
        for(Object tile:tiles) if(tile instanceof java.util.Collection) for(Object r:((java.util.Collection<?>)tile).toArray()) {
            if(r==null)continue;
            JSONObject item=new JSONObject().put("class",r.getClass().getSimpleName());
            Object group;
            try{group=call(r,"getUserProperty",key);}catch(NoSuchMethodException e){Object props=field(r,"userProperties");group=props instanceof Map?((Map<?,?>)props).get(key):null;}
            item.put("group",String.valueOf(group));
            try{item.put("widthScale",property(r,"widthScale","getWidthScale"));}catch(Exception ignored){}
            try{
                Object attrs=field(r,"attributes");item.put("outlineWidth",property(attrs,"outlineWidth","getOutlineWidth"));
                item.put("color",color(field(attrs,"outlineColor")));
            }catch(Exception ignored){}
            try{
                Object fs=field(r,"features");
                if(fs instanceof List && !((List<?>)fs).isEmpty()) {
                    item.put("featureCount",((List<?>)fs).size());
                    Object attrs=field(((List<?>)fs).get(0),"attributes");
                    item.put("baseOutlineWidth",property(attrs,"outlineWidth","getOutlineWidth")).put("color",color(field(attrs,"outlineColor")));
                }
            }catch(Exception ignored){}
            renderables.put(item);
        }
        out.put("roadRenderables",renderables);
        JSONObject geometry=state.optJSONObject("renderGeometry");JSONArray overlays=new JSONArray();
        if(geometry!=null) for(String group:new String[]{"routes","tracks","guidance"}) {
            JSONObject fc=geometry.optJSONObject(group);JSONArray fs=fc==null?null:fc.optJSONArray("features");
            if(fs!=null) for(int i=0;i<fs.length();i++){
                JSONObject f=fs.optJSONObject(i),props=f==null?null:f.optJSONObject("properties");
                if(props!=null){JSONObject row=new JSONObject().put("group",group);
                    for(String k:new String[]{"role","width","color","opacity"}) if(props.has(k)) row.put(k,props.opt(k));overlays.put(row);}
            }
        }
        out.put("overlayStyleSummary",overlays).put("screenshot",call(p,"capture","roads-"+name));
        return out;
    }
    private static JSONObject color(Object value) throws Exception {
        JSONObject c=new JSONObject();for(String k:new String[]{"red","green","blue","alpha"})c.put(k,field(value,k));return c;
    }
    private static void setEnabled(Native149Instrumentation p,Object roads,boolean enabled) throws Exception {
        Field f=findField(roads.getClass(),"isEnabled");p.runOnMainSync(()->{try{f.set(roads,enabled);}catch(Exception e){throw new IllegalStateException(e);}});
    }
    private static void redraw(Native149Instrumentation p,Object controller) throws Exception {
        Object world=field(controller,"worldWindow");p.runOnMainSync(()->{try{call(world,"requestRedraw");}catch(Exception e){throw new IllegalStateException(e);}});
    }
    private static Object property(Object o,String f,String getter) throws Exception {try{return field(o,f);}catch(NoSuchFieldException e){return call(o,getter);}}
    private static Object call(Object o,String name,Object... args) throws Exception {
        Method m=method(o.getClass(),name,args.length);
        try{return m.invoke(o,args);}catch(java.lang.reflect.InvocationTargetException e){Throwable c=e.getCause();if(c instanceof Exception)throw (Exception)c;throw e;}
    }
    private static Method method(Class<?> c,String name,int n) throws NoSuchMethodException {
        for(;c!=null;c=c.getSuperclass())for(Method m:c.getDeclaredMethods())if(m.getName().equals(name)&&m.getParameterTypes().length==n){m.setAccessible(true);return m;}
        throw new NoSuchMethodException(name);
    }
    private static Object field(Object o,String name) throws Exception {return findField(o.getClass(),name).get(o);}
    private static Field findField(Class<?> type,String name) throws Exception {for(Class<?> c=type;c!=null;c=c.getSuperclass())try{Field f=c.getDeclaredField(name);f.setAccessible(true);return f;}catch(NoSuchFieldException e){}throw new NoSuchFieldException(name);}
    private static void set(Object o,String name,Object value) throws Exception {Field f=o.getClass().getDeclaredField(name);f.setAccessible(true);f.set(o,value);}
}
