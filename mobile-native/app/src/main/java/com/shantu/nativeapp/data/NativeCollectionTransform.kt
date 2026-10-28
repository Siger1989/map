package com.shantu.nativeapp.data

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** One atomic map-space transform: translation is metres, rotation is counter-clockwise from east. */
data class NativeCollectionTransformSpec(
    val eastMeters: Double = 0.0,
    val northMeters: Double = 0.0,
    val upMeters: Double = 0.0,
    val rotationDegrees: Double = 0.0,
    val scale: Double = 1.0,
) {
    fun validate() {
        require(listOf(eastMeters,northMeters,upMeters,rotationDegrees,scale).all(Double::isFinite)) { "变换参数必须是有限数字" }
        require(eastMeters in -1_000_000.0..1_000_000.0 && northMeters in -1_000_000.0..1_000_000.0 && upMeters in -100_000.0..100_000.0) { "平移距离超出允许范围" }
        require(rotationDegrees in -3600.0..3600.0 && scale in .01..100.0) { "旋转或缩放超出允许范围" }
    }
}

/** Transforms selected geometry in a local tangent plane while preserving unknown fields. */
object NativeCollectionTransform {
    private const val EARTH = 6_378_137.0
    private val coordinateKeys = setOf("coordinates","boundary","footprint","segments","nodes","trackNetwork","preferredTrackPath","localNetwork","line","center","a","b","location","coordinate","startCoordinate","endCoordinate")

    fun anchor(container:String, record:JSONObject):Pair<Double,Double>? = when(container) {
        "favorites" -> record.optJSONObject("route")?.optJSONArray("coordinates")?.let(::firstCoordinate)
        "tracks" -> record.optJSONArray("segments")?.let(::firstNestedCoordinate)
        "annotations" -> coordinate(record.optJSONArray("coordinates"))
        "areas" -> record.optJSONArray("boundary")?.let(::firstCoordinate)
        "sections" -> record.optJSONObject("settings")?.optJSONObject("plane")?.optJSONArray("center")?.let(::coordinate)
        "measurements" -> record.optJSONArray("points")?.optJSONObject(0)?.optJSONArray("coordinates")?.let(::coordinate)
        else -> null
    }

    fun transformBatch(records:List<Pair<CollectionRecordRef,JSONObject>>,spec:NativeCollectionTransformSpec):Map<CollectionRecordRef,JSONObject> {
        spec.validate();require(records.isNotEmpty()) { "先选择收藏对象" }
        val anchors=records.mapNotNull{anchor(it.first.container,it.second)}
        require(anchors.isNotEmpty()) { "所选对象没有可变换的有效地理坐标" }
        val pivot=pivot(anchors)
        return records.associate { (ref,record)->ref to transform(ref.container,record,spec,pivot) }
    }

    fun transform(container:String,record:JSONObject,spec:NativeCollectionTransformSpec,pivot:Pair<Double,Double>):JSONObject {
        spec.validate();require(container in setOf("favorites","tracks","annotations","areas","sections","measurements")) { "所选对象类型不支持批量变换" }
        require(pivot.first.isFinite()&&pivot.first in -180.0..180.0&&pivot.second.isFinite()&&pivot.second in -85.0..85.0) { "变换中心无效" }
        val copy=JSONObject(record.toString());transformValue(copy,"",container,spec,pivot)
        when(container) {
            "annotations" -> if(copy.optString("kind")!="pin") {
                if(copy.has("heading"))copy.put("heading",normalizeAngle(copy.optDouble("heading")+spec.rotationDegrees))
                for(key in listOf("width","length","height","offset"))if(copy.opt(key) is Number)copy.put(key,copy.optDouble(key)*spec.scale)
            }
            "favorites" -> copy.optJSONObject("route")?.let{route->for(key in listOf("distance","distanceMeters","duration"))if(route.opt(key) is Number)route.put(key,route.optDouble(key)*spec.scale)}
            "tracks" -> {
                for (key in listOf("distance", "distanceMeters", "length")) {
                    if (copy.opt(key) is Number) copy.put(key, copy.optDouble(key) * spec.scale)
                }
                val samples = copy.optJSONArray("samples")
                if (spec.upMeters != 0.0 && samples != null) {
                    for (i in 0 until samples.length()) {
                        val row = samples.optJSONArray(i) ?: continue
                        for (j in 0 until row.length()) {
                            val sample = row.optJSONObject(j) ?: continue
                            if (sample.opt("altitude") is Number) {
                                sample.put("altitude", sample.optDouble("altitude") + spec.upMeters)
                            }
                        }
                    }
                }
            }
            "sections" -> transformSection(copy,spec)
            "measurements" -> {
                val points=copy.optJSONArray("points")?:JSONArray()
                for (i in 0 until points.length()) {
                    val point = points.optJSONObject(i) ?: continue
                    if (point.opt("altitude") is Number) point.put("altitude", point.optDouble("altitude") + spec.upMeters)
                }
                if(copy.has("updatedAt"))copy.put("updatedAt",System.currentTimeMillis())
            }
        }
        if(container=="annotations") {
            // groundElevation describes the terrain itself and stays fixed; the object moves via
            // its absolute centre or its offset from that terrain.
            if(copy.opt("centerAltitude") is Number)copy.put("centerAltitude",copy.optDouble("centerAltitude")+spec.upMeters)
            if(copy.opt("offset") is Number)copy.put("offset",copy.optDouble("offset")+spec.upMeters)
        }
        // These are distances measured along an associated saved track/profile, not opaque ids.
        if (container == "annotations") {
            for (key in listOf("trackAnchor", "sectionAnchor")) {
                copy.optJSONObject(key)?.let { anchor ->
                    if (anchor.opt("distance") is Number) anchor.put("distance", anchor.optDouble("distance") * spec.scale)
                }
            }
        }
        return copy
    }

    private fun transformSection(record:JSONObject,spec:NativeCollectionTransformSpec) {
        val settings=record.optJSONObject("settings")?:return
        if(settings.opt("altitude") is Number)settings.put("altitude",settings.optDouble("altitude")+spec.upMeters)
        val plane=settings.optJSONObject("plane")?:return
        plane.put("heading",normalizeAngle(plane.optDouble("heading")+spec.rotationDegrees))
        plane.put("width",plane.optDouble("width")*spec.scale)
        plane.put("height",plane.optDouble("height")*spec.scale)
        settings.optJSONObject("survey")?.let{survey->
            survey.put("halfWidth",survey.optDouble("halfWidth")*spec.scale)
            val stations=survey.optJSONArray("stations")?:JSONArray();for(i in 0 until stations.length())stations.optJSONObject(i)?.let{station->station.put("distance",station.optDouble("distance")*spec.scale)}
        }
        settings.optJSONObject("surveyTerrain")?.let{terrain->
            for(key in listOf("start","end","halfWidth"))if(terrain.opt(key) is Number)terrain.put(key,terrain.optDouble(key)*spec.scale)
            val heights=terrain.optJSONArray("heights")
            if(spec.upMeters!=0.0&&heights!=null)for(i in 0 until heights.length())if(heights.opt(i) is Number)heights.put(i,heights.optDouble(i)+spec.upMeters)
        }
    }

    private fun transformValue(value:Any?,key:String,container:String,spec:NativeCollectionTransformSpec,pivot:Pair<Double,Double>) {
        when(value) {
            is JSONObject -> { val keys=value.keys().asSequence().toList();for(child in keys)transformValue(value.opt(child),child,container,spec,pivot) }
            is JSONArray -> {
                if(key in coordinateKeys && isCoordinate(value)) transformCoordinate(value,spec,pivot)
                else for(i in 0 until value.length())transformValue(value.opt(i),key,container,spec,pivot)
            }
        }
    }

    private fun isCoordinate(value:JSONArray):Boolean = value.length()>=2&&value.opt(0) is Number&&value.opt(1) is Number&&value.optDouble(0).isFinite()&&value.optDouble(1).isFinite()&&value.optDouble(0) in -180.0..180.0&&value.optDouble(1) in -90.0..90.0
    private fun transformCoordinate(point:JSONArray,spec:NativeCollectionTransformSpec,pivot:Pair<Double,Double>) {
        val lon=point.getDouble(0);val lat=point.getDouble(1);val pivotLat=pivot.second*PI/180.0;val cosLat=cos(pivotLat).coerceAtLeast(1e-6)
        val dx=EARTH*cosLat*shortLongitudeRadians(lon-pivot.first);val dy=EARTH*(lat-pivot.second)*PI/180.0
        val angle=spec.rotationDegrees*PI/180.0;val x=(dx*cos(angle)-dy*sin(angle))*spec.scale+spec.eastMeters;val y=(dx*sin(angle)+dy*cos(angle))*spec.scale+spec.northMeters
        var outLon=pivot.first+x/(EARTH*cosLat)*180.0/PI;outLon=((outLon%360.0+540.0)%360.0)-180.0;val outLat=pivot.second+y/EARTH*180.0/PI
        require(outLat in -85.0..85.0) { "变换结果超出支持纬度范围" }
        point.put(0,outLon).put(1,outLat)
        if(point.length()>=3&&point.opt(2) is Number)point.put(2,point.optDouble(2)+spec.upMeters)
    }
    private fun shortLongitudeRadians(deltaDegrees:Double)=(((deltaDegrees+540.0)%360.0)-180.0)*PI/180.0
    private fun coordinate(a:JSONArray?):Pair<Double,Double>?=a?.takeIf(::isCoordinate)?.let{it.getDouble(0) to it.getDouble(1)}
    private fun firstCoordinate(a:JSONArray):Pair<Double,Double>? { for(i in 0 until a.length()){val value=a.opt(i);if(value is JSONArray){coordinate(value)?.let{return it};firstNestedCoordinate(value)?.let{return it}}};return null }
    private fun firstNestedCoordinate(a:JSONArray):Pair<Double,Double>? {for(i in 0 until a.length()){val value=a.opt(i);if(value is JSONArray){coordinate(value)?.let{return it};firstNestedCoordinate(value)?.let{return it}}else if(value is JSONObject){coordinate(value.optJSONArray("coordinates"))?.let{return it}}};return null}
    private fun pivot(points:List<Pair<Double,Double>>):Pair<Double,Double> {val first=points.first();val longitude=points.map{first.first+(((it.first-first.first+540)%360)-180)}.average();return (((longitude%360+540)%360)-180) to points.map{it.second}.average()}
    private fun normalizeAngle(value:Double)=((value%360.0)+360.0)%360.0
}
