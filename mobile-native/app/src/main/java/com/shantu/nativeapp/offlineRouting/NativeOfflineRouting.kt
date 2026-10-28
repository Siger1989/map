package com.shantu.nativeapp.offlineRouting

import android.content.Context
import android.os.CancellationSignal
import android.os.OperationCanceledException
import android.util.AtomicFile
import com.shantu.nativeapp.navigation.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.*
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.PriorityQueue
import java.util.UUID
import kotlin.math.*

data class NativeRoutingManifest(val id:String,val name:String,val bounds:List<Double>,val createdAt:Long,val nodes:Int,val edges:Int,val bytes:Int,val digest:String,val attribution:String)
data class NativeRoutingNode(val id:Long,val point:NativeCoordinate)
data class NativeRoutingEdge(val from:Long,val to:Long,val metres:Double,val name:String)
data class NativeOfflineGraph(val id:String,val name:String,val bounds:List<Double>,val createdAt:Long,val nodes:List<NativeRoutingNode>,val edges:List<NativeRoutingEdge>,val attribution:String="© OpenStreetMap contributors · ODbL 1.0") {
    fun json()=JSONObject().put("format","shantu-offline-routing").put("version",1).put("profile","pedestrian").put("id",id).put("name",name).put("bounds",JSONArray(bounds)).put("createdAt",createdAt).put("attribution",attribution).put("nodes",JSONArray().also{a->nodes.forEach{a.put(JSONObject().put("id",it.id).put("point",it.point.toJson()))}}).put("edges",JSONArray().also{a->edges.forEach{a.put(JSONObject().put("from",it.from).put("to",it.to).put("metres",it.metres).put("name",it.name))}})
}

/** Strict, bounded validator and atomic JSON-package store. */
class NativeOfflineRouting(context:Context) {
    private val dir=File(context.applicationContext.filesDir,"offline-routing").apply{mkdirs()}
    @Synchronized fun list():List<NativeRoutingManifest> = dir.listFiles{f->f.extension=="json"}?.mapNotNull{f->runCatching{val bytes=f.readBytes();val digest=File(dir,"${f.nameWithoutExtension}.sha256").readText().trim();require(sha(bytes)==digest);val g=validate(JSONObject(String(bytes,Charsets.UTF_8)));manifest(g,bytes)}.getOrNull()}?.sortedByDescending{it.createdAt}?: emptyList()
    @Synchronized fun load(id:String):NativeOfflineGraph { require(id.matches(Regex("[A-Za-z0-9_-]{1,100}"))); val file=File(dir,"$id.json");val bytes=file.readBytes();require(sha(bytes)==File(dir,"$id.sha256").readText().trim()){"路网完整性检查失败"};return validate(JSONObject(String(bytes,Charsets.UTF_8))) }
    @Synchronized fun save(graph:NativeOfflineGraph):NativeRoutingManifest { val value=validate(graph.json()); val bytes=value.json().toString().toByteArray(Charsets.UTF_8); require(bytes.size<=MAX_BYTES){"单个离线路网不能超过24MiB"}; val files=dir.listFiles{f->f.extension=="json"}?: emptyArray(); require(files.any{it.nameWithoutExtension==value.id}||files.size<8){"最多8个离线路网，请先删除旧包"}; writeAtomic(File(dir,"${value.id}.json"),bytes);writeAtomic(File(dir,"${value.id}.sha256"),sha(bytes).toByteArray(Charsets.US_ASCII));return manifest(value,bytes) }
    private fun writeAtomic(file:File,bytes:ByteArray){val atomic=AtomicFile(file);var stream:FileOutputStream?=null;try{val output=atomic.startWrite();stream=output;output.write(bytes);atomic.finishWrite(output)}catch(e:Exception){stream?.let{atomic.failWrite(it)};throw IOException("路网包保存失败",e)}}
    @Synchronized fun delete(id:String){require(id.matches(Regex("[A-Za-z0-9_-]{1,100}")));File(dir,"$id.json").delete();File(dir,"$id.sha256").delete()}
    fun export(id:String):ByteArray { val bytes=File(dir,"$id.json").readBytes(); require(bytes.size<=MAX_BYTES); return bytes }
    @Synchronized fun import(bytes:ByteArray):NativeRoutingManifest { require(bytes.size<=MAX_BYTES){"路网文件不能超过24MiB"}; return save(validate(JSONObject(String(bytes,Charsets.UTF_8)))) }
    fun verify(manifest:NativeRoutingManifest):NativeOfflineGraph { val bytes=export(manifest.id); require(sha(bytes)==manifest.digest&&bytes.size==manifest.bytes){"路网完整性检查失败"}; return validate(JSONObject(String(bytes,Charsets.UTF_8))) }
    private fun manifest(g:NativeOfflineGraph,b:ByteArray)=NativeRoutingManifest(g.id,g.name,g.bounds,g.createdAt,g.nodes.size,g.edges.size,b.size,sha(b),g.attribution)
    private fun sha(b:ByteArray)=MessageDigest.getInstance("SHA-256").digest(b).joinToString(""){"%02x".format(it)}
    fun validate(o:JSONObject):NativeOfflineGraph {
        require(o.optString("format")=="shantu-offline-routing"&&o.optInt("version")==1&&o.optString("profile")=="pedestrian") {"离线路网格式无效"}
        val id=o.getString("id");require(id.matches(Regex("[A-Za-z0-9_-]{1,100}"))); val name=o.getString("name");require(name.length<=60)
        val b=o.getJSONArray("bounds");require(b.length()==4);val bounds=(0..3).map{b.getDouble(it)};require(bounds.all{it.isFinite()}&&bounds[0]>=-180&&bounds[2]<=180&&bounds[1]>=-85&&bounds[3]<=85&&bounds[0]<bounds[2]&&bounds[1]<bounds[3])
        val ns=o.getJSONArray("nodes");require(ns.length() in 2..60000);val nodes=(0 until ns.length()).map{i->val n=ns.getJSONObject(i);val p=n.getJSONArray("point");NativeRoutingNode(n.getLong("id"),coord(p))};require(nodes.map{it.id}.toSet().size==nodes.size)
        val nm=nodes.associateBy{it.id};val es=o.getJSONArray("edges");require(es.length() in 1..150000);val edges=(0 until es.length()).map{i->val e=es.getJSONObject(i);val from=e.getLong("from");val to=e.getLong("to");val metres=e.getDouble("metres");require(from in nm&&to in nm&&from!=to&&metres.isFinite()&&metres>0&&metres+0.01>=distance(nm.getValue(from).point,nm.getValue(to).point));val edgeName=e.getString("name");require(edgeName.length<=100);NativeRoutingEdge(from,to,metres,edgeName)}
        val attribution=o.getString("attribution");require(attribution.length<=500); val g=NativeOfflineGraph(id,name,bounds,o.getLong("createdAt"),nodes,edges,attribution);require(g.json().toString().toByteArray().size<=MAX_BYTES){"单个离线路网不能超过24MiB"};return g
    }
    companion object { const val MAX_BYTES=24*1024*1024; const val MAX_AREA_KM2=100.0
        private fun coord(a:JSONArray):NativeCoordinate {require(a.length()==2);val x=a.getDouble(0);val y=a.getDouble(1);require(x.isFinite()&&y.isFinite()&&x in -180.0..180.0&&y in -85.0..85.0);return NativeCoordinate(x,y)}
        private fun inside(p:NativeCoordinate,b:List<Double>)=p.longitude in b[0]..b[2]&&p.latitude in b[1]..b[3]
        fun distance(a:NativeCoordinate,b:NativeCoordinate):Double {val r=6371008.8;val p1=Math.toRadians(a.latitude);val p2=Math.toRadians(b.latitude);val dp=p2-p1;val dl=Math.toRadians(b.longitude-a.longitude);val h=sin(dp/2).pow(2)+cos(p1)*cos(p2)*sin(dl/2).pow(2);return 2*r*asin(sqrt(h.coerceIn(0.0,1.0)))}
    }
}

/** Downloads public pedestrian topology from Overpass; rejects partial replies and unsafe access. */
class NativeOverpassDownloader(private val endpoint:String="https://overpass-api.de/api/interpreter") {
 fun download(name:String,bounds:List<Double>,cancel:CancellationSignal?):NativeOfflineGraph {
    require(bounds.size==4&&bounds.all{it.isFinite()}&&bounds[0]>=-180&&bounds[2]<=180&&bounds[1]>=-85&&bounds[3]<=85&&bounds[0]<bounds[2]&&bounds[1]<bounds[3]);val width=NativeOfflineRouting.distance(NativeCoordinate(bounds[0],bounds[1]),NativeCoordinate(bounds[2],bounds[1]));val height=NativeOfflineRouting.distance(NativeCoordinate(bounds[0],bounds[1]),NativeCoordinate(bounds[0],bounds[3]));require(width*height/1e6<=NativeOfflineRouting.MAX_AREA_KM2){"离线步行路网单区最多100km²"}
    cancel?.throwIfCanceled();val bbox="${bounds[1]},${bounds[0]},${bounds[3]},${bounds[2]}";val query="[out:json][timeout:40][maxsize:32000000];way[highway]($bbox)->.roads;( .roads; node(w.roads); rel(bw.roads)[type~\"^restriction\"];);out body;";val url=URL(endpoint+"?data="+java.net.URLEncoder.encode(query,"UTF-8"));val c=url.openConnection() as HttpURLConnection;c.connectTimeout=10000;c.readTimeout=60000;c.setRequestProperty("Accept","application/json");cancel?.setOnCancelListener{c.disconnect()};try{val status=c.responseCode;if(status==429||status==504)throw IllegalStateException("路网服务繁忙，请稍后重试");require(status in 200..299){"道路下载失败，请检查网络"};val out=ByteArrayOutputStream();c.inputStream.use{input->val buf=ByteArray(16384);while(true){cancel?.throwIfCanceled();val n=input.read(buf);if(n<0)break;require(out.size()+n<=NativeOfflineRouting.MAX_BYTES){"道路数据过大，请缩小区域"};out.write(buf,0,n)}};cancel?.throwIfCanceled();return compile(JSONObject(String(out.toByteArray(),Charsets.UTF_8)),name,bounds)}catch(e:IOException){if(cancel?.isCanceled==true)throw OperationCanceledException();throw IllegalStateException("道路下载失败或连接超时") }finally{cancel?.setOnCancelListener(null);c.disconnect()}
 }
 private fun compile(raw:JSONObject,name:String,bounds:List<Double>):NativeOfflineGraph {val els=raw.optJSONArray("elements")?:error("道路数据无效");require(els.length()<=180000&&!raw.has("remark")){"道路数据不完整或过大"};data class ONode(val id:Long,val p:NativeCoordinate,val tags:JSONObject);val nodes=mutableMapOf<Long,ONode>();val ways=mutableListOf<JSONObject>();val blocked=mutableSetOf<Long>();val seenNodes=mutableSetOf<Long>();for(i in 0 until els.length()){val e=els.getJSONObject(i);when(e.optString("type")){"node"->{val nodeId=e.getLong("id");require(seenNodes.add(nodeId)){"道路数据包含重复节点"};val tags=e.optJSONObject("tags")?:JSONObject();val barrier=tags.optString("barrier");val access=tags.optString("foot",tags.optString("access","yes"));if(barrier.isEmpty()||barrier in setOf("bollard","cycle_barrier","kerb","entrance")||access in setOf("yes","designated","permissive","official")){runCatching{val p=NativeCoordinate(e.getDouble("lon"),e.getDouble("lat"));if(p.longitude.isFinite()&&p.latitude.isFinite()&&p.longitude in -180.0..180.0&&p.latitude in -85.0..85.0)nodes[nodeId]=ONode(nodeId,p,tags)}}};"way"->ways.add(e);"relation"->{val tags=e.optJSONObject("tags")?:JSONObject();if(tags.optString("type").startsWith("restriction")&&(tags.has("restriction:foot")||tags.optString("type")=="restriction:foot"||tags.has("restriction:conditional"))){val ms=e.optJSONArray("members")?:JSONArray();for(j in 0 until ms.length()){val m=ms.getJSONObject(j);if(m.optString("type")=="way")blocked.add(m.getLong("ref"))}}}}
    };val used=linkedSetOf<Long>();val edges=mutableListOf<NativeRoutingEdge>();val allowed=setOf("yes","designated","permissive","official");val roads=setOf("footway","path","pedestrian","steps","track","residential","living_street","service","unclassified","tertiary","tertiary_link","secondary","secondary_link");for(w in ways){val tags=w.optJSONObject("tags")?:JSONObject();val h=tags.optString("highway");val access=tags.optString("access");val foot=tags.optString("foot");if(w.getLong("id") in blocked||tags.optString("area")=="yes"||tags.has("construction")||tags.has("proposed")||tags.optString("sac_scale") in setOf("alpine_hiking","demanding_alpine_hiking","difficult_alpine_hiking")||tags.keys().asSequence().any{it.matches(Regex("^(access|foot).*:conditional$"))}||tags.optString("locked")=="yes"||tags.optString("ford")=="yes"||h=="ford"||(foot.isNotEmpty()&&foot !in allowed)||(foot.isEmpty()&&access.isNotEmpty()&&access !in allowed)||(h !in roads&&!(foot in allowed||access in allowed)))continue;val arr=w.optJSONArray("nodes")?:continue;val nm=tags.optString("name",tags.optString("name:zh",h.ifBlank{"步行路段"})).take(100);val fw=tags.optString("oneway:foot")!="-1"&&tags.optString("foot:forward")!="no";val bw=tags.optString("oneway:foot") !in setOf("yes","1","true")&&tags.optString("foot:backward")!="no";for(i in 1 until arr.length()){val a=nodes[arr.getLong(i-1)]?:continue;val b=nodes[arr.getLong(i)]?:continue;if(a.id==b.id)continue;val d=NativeOfflineRouting.distance(a.p,b.p);if(d<=0||d>20000)continue;used.add(a.id);used.add(b.id);if(fw)edges.add(NativeRoutingEdge(a.id,b.id,d,nm));if(bw)edges.add(NativeRoutingEdge(b.id,a.id,d,nm));require(edges.size<=150000&&used.size<=60000){"道路图过大，请分成更小区域"}}};require(edges.size>=2){"区域内没有可用的公开步行道路"};return NativeOfflineGraph(UUID.randomUUID().toString(),name.take(60),bounds,System.currentTimeMillis(),used.map{NativeRoutingNode(it,nodes.getValue(it).p)},edges)}
}

/** Offline-only A* provider. It never synthesizes a straight line when no road path exists. */
class NativeOfflineRouteProvider(private val storage:NativeOfflineRouting) {
 fun searchPlaces(query:String):List<NativePlace>{if(query.isBlank())return emptyList();val results=linkedMapOf<String,NativePlace>();for(manifest in storage.list()){val graph=storage.load(manifest.id);val nodes=graph.nodes.associateBy{it.id};for(edge in graph.edges){if(edge.name.contains(query,ignoreCase=true)&&!results.containsKey(edge.name)){val p=nodes[edge.from]?.point?:continue;results[edge.name]=NativePlace(edge.name,p.longitude,p.latitude,"离线路网 · ${manifest.name}")};if(results.size>=20)return results.values.toList()}};return results.values.toList()}
 fun route(stops:List<NativePlace>,cancel:CancellationSignal?):NativePlannedRoute? {require(stops.size in 2..10);cancel?.throwIfCanceled();val candidates=storage.list().filter{m->stops.all{it.longitude in m.bounds[0]..m.bounds[2]&&it.latitude in m.bounds[1]..m.bounds[3]}};if(candidates.isEmpty())return null;var last:Exception?=null;for(m in candidates){cancel?.throwIfCanceled();try{return route(storage.load(m.id),stops,cancel)}catch(e:OperationCanceledException){throw e}catch(e:Exception){last=e}};throw IllegalStateException(last?.message?:"下载区域内道路不连通；请扩大路网范围或更换选点") }
 private fun route(g:NativeOfflineGraph,stops:List<NativePlace>,cancel:CancellationSignal?):NativePlannedRoute {
    val nodes=g.nodes.associateBy{it.id}.toMutableMap()
    data class Cut(val id:Long,val t:Double)
    data class PairRoad(val a:Long,val b:Long,val cuts:MutableList<Cut>)
    val pairs=linkedMapOf<String,PairRoad>()
    for(e in g.edges){val a=minOf(e.from,e.to);val b=maxOf(e.from,e.to);pairs.putIfAbsent("$a/$b",PairRoad(a,b,mutableListOf()))}
    var nextId=minOf(-1L,(nodes.keys.minOrNull()?:0L)-1L)
    val snapped=stops.map{stop->
        val c=NativeCoordinate(stop.longitude,stop.latitude);var best:Triple<PairRoad,Double,Double>?=null
        for(pair in pairs.values){val a=nodes.getValue(pair.a).point;val b=nodes.getValue(pair.b).point;val cos=cos(Math.toRadians(c.latitude));val dx=(((b.longitude-a.longitude+540)%360)-180)*cos;val dy=b.latitude-a.latitude;val px=(((c.longitude-a.longitude+540)%360)-180)*cos;val py=c.latitude-a.latitude;val t=((px*dx+py*dy)/(dx*dx+dy*dy).coerceAtLeast(1e-15)).coerceIn(0.0,1.0);val point=NativeCoordinate((((a.longitude+(if(cos==0.0)0.0 else dx/cos)*t+540)%360)-180),a.latitude+dy*t);val d=NativeOfflineRouting.distance(c,point);if(best==null||d<best!!.third)best=Triple(pair,t,d)}
        val candidate=best?:error("离线路网没有道路连接")
        require(candidate.third<=120){"地点距已下载道路超过120米"}
        val pair=candidate.first
        val id=when {
            candidate.second<1e-9->pair.a
            candidate.second>1-1e-9->pair.b
            else->{
                val old=pair.cuts.firstOrNull{NativeOfflineRouting.distance(nodes.getValue(it.id).point,c)<.1}
                if(old!=null)old.id else {
                    val newId=nextId;nextId--
                    val a=nodes.getValue(pair.a).point;val b=nodes.getValue(pair.b).point;val cos=cos(Math.toRadians(stop.latitude));val dx=(((b.longitude-a.longitude+540)%360)-180)*cos;val dy=b.latitude-a.latitude
                    val point=NativeCoordinate((((a.longitude+(if(cos==0.0)0.0 else dx/cos)*candidate.second+540)%360)-180),a.latitude+dy*candidate.second)
                    nodes[newId]=NativeRoutingNode(newId,point);pair.cuts.add(Cut(newId,candidate.second));newId
                }
            }
        }
        nodes.getValue(id)
    }
    val augmented=mutableListOf<NativeRoutingEdge>()
    for(edge in g.edges){val pair=pairs.getValue("${minOf(edge.from,edge.to)}/${maxOf(edge.from,edge.to)}");if(pair.cuts.isEmpty()){augmented.add(edge);continue};var cuts=(listOf(Cut(pair.a,0.0))+pair.cuts+Cut(pair.b,1.0)).sortedBy{it.t};if(edge.from==pair.b)cuts=cuts.reversed();for(i in 1 until cuts.size){val left=cuts[i-1];val right=cuts[i];if(left.id!=right.id)augmented.add(edge.copy(from=left.id,to=right.id,metres=edge.metres*abs(right.t-left.t)))}}
    val adj=augmented.groupBy{it.from};val legs=mutableListOf<List<NativeCoordinate>>();val steps=mutableListOf<NativeRouteStep>();var total=0.0;var elapsed=0.0
    for(li in 1 until snapped.size){cancel?.throwIfCanceled();val start=snapped[li-1].id;val goal=snapped[li].id;data class Q(val id:Long,val cost:Double);val q=PriorityQueue<Q>(compareBy{it.cost});val costs=mutableMapOf(start to 0.0);val prev=mutableMapOf<Long,NativeRoutingEdge>();q.add(Q(start,0.0));var visits=0;while(q.isNotEmpty()){if(visits++%512==0)cancel?.throwIfCanceled();val u=q.remove().id;if(u==goal)break;for(e in adj[u].orEmpty()){val c=costs.getValue(u)+e.metres;if(c<(costs[e.to]?:Double.POSITIVE_INFINITY)){costs[e.to]=c;prev[e.to]=e;q.add(Q(e.to,c+NativeOfflineRouting.distance(nodes.getValue(e.to).point,nodes.getValue(goal).point)))}}};require(start==goal||goal in prev){"下载区域内道路不连通；请扩大路网范围或更换选点"};val path=mutableListOf<NativeRoutingEdge>();var cur=goal;while(cur!=start){val e=prev[cur]?:error("离线路径无效");path.add(e);cur=e.from};path.reverse();val line=if(path.isEmpty())listOf(nodes.getValue(start).point,nodes.getValue(goal).point) else listOf(nodes.getValue(start).point)+path.map{nodes.getValue(it.to).point};legs.add(line);for(e in path){total+=e.metres;val seconds=e.metres/1.111111;elapsed+=seconds;val prevStep=steps.lastOrNull();if(prevStep!=null&&prevStep.legIndex==li-1&&prevStep.instruction=="沿 ${e.name} 行进"){steps[steps.lastIndex]=prevStep.copy(distance=prevStep.distance+e.metres,duration=prevStep.duration+seconds,elapsedSeconds=elapsed,coordinates=prevStep.coordinates+nodes.getValue(e.to).point)}else steps.add(NativeRouteStep("road",li-1,"沿 ${e.name} 行进",e.metres,seconds,elapsed,listOf(nodes.getValue(e.from).point,nodes.getValue(e.to).point)))}}
     val segments=mutableListOf<NativeRouteSegment>();val fullSteps=mutableListOf<NativeRouteStep>();var accessDistance=0.0;var accessDuration=0.0;var fullElapsed=0.0
     fun addAccess(a:NativeCoordinate,b:NativeCoordinate,label:String,legIndex:Int){val d=NativeOfflineRouting.distance(a,b);if(d<.01)return;val t=d/1.2;segments.add(NativeRouteSegment("access",listOf(a,b)));fullSteps.add(NativeRouteStep("access",legIndex,label,d,t,fullElapsed,listOf(a,b)));fullElapsed+=t;accessDistance+=d;accessDuration+=t}
     legs.forEachIndexed{index,line->addAccess(NativeCoordinate(stops[index].longitude,stops[index].latitude),line.first(),"沿虚线前往道路接入点 · 直线示意",index);segments.add(NativeRouteSegment("road",line));steps.filter{it.legIndex==index}.forEach{s->fullSteps.add(s.copy(elapsedSeconds=fullElapsed));fullElapsed+=s.duration};addAccess(line.last(),NativeCoordinate(stops[index+1].longitude,stops[index+1].latitude),if(index==legs.lastIndex)"离开道路前往终点 · 虚线直连示意" else "离开道路前往途经点 ${index+1} · 虚线直连示意",index)}
    val all=segments.flatMap{it.coordinates};val coords=all.filterIndexed{index,p->index==0||p!=all[index-1]};return NativePlannedRoute("pedestrian",coords,total,total/1.111111,fullSteps,legs,segments,accessDistance,accessDuration,snapped.map{it.point},stops,System.currentTimeMillis())
 }
}
