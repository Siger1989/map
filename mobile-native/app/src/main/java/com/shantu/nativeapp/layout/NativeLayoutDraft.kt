package com.shantu.nativeapp.layout

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

data class NativeLayoutAnchor(val reference:String,val x:String,val y:String,val gapX:Double,val gapY:Double)
data class NativeLayoutEntry(
    val selector:String,val label:String,val dx:Double=0.0,val dy:Double=0.0,
    val width:Double?=null,val height:Double?=null,val scale:Double=1.0,val fontSize:Double?=null,
    val hidden:Boolean=false,val zIndex:Int?=null,val anchor:NativeLayoutAnchor?=null,
)
data class NativeLayoutDraft(val viewportWidth:Double=390.0,val viewportHeight:Double=844.0,val entries:List<NativeLayoutEntry> = emptyList()) {
    fun toJson()=JSONObject().put("format",FORMAT).put("version",1).put("viewport",JSONObject().put("width",viewportWidth).put("height",viewportHeight)).put("entries",JSONArray().apply {
        entries.forEach { e -> put(JSONObject().put("selector",e.selector).put("label",e.label).put("dx",e.dx).put("dy",e.dy).put("width",e.width ?: JSONObject.NULL).put("height",e.height ?: JSONObject.NULL).put("scale",e.scale).put("fontSize",e.fontSize ?: JSONObject.NULL).put("hidden",e.hidden).also { o ->
            e.zIndex?.let { o.put("zIndex",it) }; e.anchor?.let { o.put("anchor",JSONObject().put("reference",it.reference).put("x",it.x).put("y",it.y).put("gapX",it.gapX).put("gapY",it.gapY)) }
        }) }
    })
    fun entry(selector:String)=entries.firstOrNull { it.selector==selector }
    fun replace(entry:NativeLayoutEntry)=copy(entries=(entries.filterNot { it.selector==entry.selector }+entry).take(256))
    fun remove(selector:String)=copy(entries=entries.filterNot { it.selector==selector })
    companion object {
        const val FORMAT="shantu-layout-draft"
        val protected=setOf("#shantu-lock","#shantu-layout-recovery")
        private val aliases=mapOf(".topbar" to "#home-topbar", ".home-topbar" to "#home-topbar", ".map-actions" to "#home-map-actions", ".home-map-actions" to "#home-map-actions", ".position-dock" to "#home-position-dock", ".home-position-dock" to "#home-position-dock", ".position-dock > .position-dock-button" to "#home-position-dock", ".dock-navigation" to "#home-bottom-nav", ".home-bottom-nav" to "#home-bottom-nav", ".route-card" to "#home-route-card", ".home-route-card" to "#home-route-card", ".recording-quick" to "#home-recording", ".recording-chip" to "#home-recording", ".camera-gizmo" to "#home-camera-joystick", ".route-display-info" to "#home-route-display-info", ".route-color-legend" to "#home-route-display-legend", ".route-elevation-stats" to "#home-route-display-stats", ".route-elevation-profile" to "#home-route-display-profile", ".position-status" to "#home-status")
        fun migrateSelector(selector:String)=aliases[selector.trim()] ?: selector.trim()
        fun known(selector:String)=migrateSelector(selector) in setOf("#home-topbar","#home-map-actions","#home-position-dock","#home-bottom-nav","#home-route-card","#home-recording","#home-scale-bar","#home-status","#home-camera-joystick","#home-route-display-info","#home-route-display-legend","#home-route-display-stats","#home-route-display-profile")
        fun parse(json:String):NativeLayoutDraft {
            val root=JSONObject(json)
            fun num(o:JSONObject,key:String):Double=(o.opt(key) as? Number)?.toDouble() ?: Double.NaN
            require(root.opt("format")==FORMAT && num(root,"version")==1.0) { "布局格式或版本无效" }
            val viewport=root.optJSONObject("viewport") ?: error("缺少画布尺寸")
            val width=num(viewport,"width"); val height=num(viewport,"height")
            require(width in 266.0..1600.0 && height in 400.0..1600.0) { "画布尺寸无效" }
            val raw=root.optJSONArray("entries") ?: error("缺少布局控件")
            require(raw.length()<=256) { "布局控件过多" }
            val seen=mutableMapOf<String,Triple<Int,Boolean,String>>(); val entries=mutableListOf<NativeLayoutEntry>()
            fun nullable(o:JSONObject,key:String,min:Double,max:Double):Double? { if(!o.has(key)||o.isNull(key)) return null; val n=num(o,key); require(n.isFinite()&&n in min..max) { "$key 超出范围" }; return n }
            for(i in 0 until raw.length()) {
                val o=raw.optJSONObject(i) ?: error("布局控件格式无效")
                val source=o.opt("selector") as? String ?: error("控件选择器必须是文本")
                val selector=migrateSelector(source); val explicit=source.trim()==selector
                require(selector.isNotBlank()&&selector.length<=600&&!selector.contains(Regex("[{};<@]"))) { "控件选择器无效" }
                val dx=num(o,"dx"); val dy=num(o,"dy"); val scale=num(o,"scale")
                require(dx.isFinite()&&dx in -3000.0..3000.0&&dy.isFinite()&&dy in -3000.0..3000.0&&scale.isFinite()&&scale in .4..2.5) { "位移或缩放无效" }
                val label=o.opt("label") as? String ?: error("控件标签必须是文本"); require(label.length<=120) { "标签过长" }
                val anchor=o.optJSONObject("anchor")?.let { a ->
                    val ref=migrateSelector(a.opt("reference") as? String ?: ""); val x=a.opt("x") as? String ?: ""; val y=a.opt("y") as? String ?: ""; val gx=num(a,"gapX"); val gy=num(a,"gapY")
                    require(ref.isNotBlank()&&ref.length<=600&&x in setOf("left","right","center")&&y in setOf("top","bottom","center")&&gx.isFinite()&&gx in -3000.0..3000.0&&gy.isFinite()&&gy in -3000.0..3000.0) { "锚点无效" }
                    NativeLayoutAnchor(ref,x,y,gx,gy)
                }
                val hidden=o.opt("hidden") as? Boolean ?: error("hidden 必须是布尔值")
                val z=if(o.has("zIndex")&&!o.isNull("zIndex")) num(o,"zIndex").also { require(it.isFinite()&&it in -1000.0..99999.0) }.roundToInt() else null
                val entry=NativeLayoutEntry(selector,label,dx,dy,nullable(o,"width",16.0,2000.0),nullable(o,"height",16.0,2000.0),scale,nullable(o,"fontSize",8.0,40.0),hidden,z,anchor)
                val prior=seen[selector]
                if(prior==null) { seen[selector]=Triple(entries.size,explicit,source); entries+=entry }
                else {
                    require(prior.third != source) { "布局控件重复: $selector" }
                    if(explicit&&!prior.second) { entries[prior.first]=entry; seen[selector]=Triple(prior.first,true,source) }
                }
            }
            return NativeLayoutDraft(width,height,entries)
        }
    }
}
