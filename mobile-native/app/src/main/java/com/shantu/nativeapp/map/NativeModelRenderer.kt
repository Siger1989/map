package com.shantu.nativeapp.map

import android.graphics.Color as AndroidColor
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.text.TextUtils
import android.text.TextPaint
import earth.worldwind.geom.AltitudeMode
import earth.worldwind.geom.Angle.Companion.degrees
import earth.worldwind.geom.Offset
import earth.worldwind.geom.OffsetMode.FRACTION
import earth.worldwind.geom.Position
import earth.worldwind.render.Color
import earth.worldwind.render.Renderable
import earth.worldwind.render.image.ArgbImage
import earth.worldwind.render.image.argbImageSource
import earth.worldwind.shape.Ellipsoid
import earth.worldwind.shape.Path
import earth.worldwind.shape.Placemark
import earth.worldwind.shape.PlacemarkAttributes
import earth.worldwind.shape.ShapeAttributes
import earth.worldwind.shape.TriangleMesh
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt
import java.util.WeakHashMap

enum class NativeMarkerStatus { RENDERED, HIDDEN, NEEDS_ELEVATION, UNSUPPORTED, INVALID }

data class NativeMarkerRenderResult(
    val id: String?,
    val status: NativeMarkerStatus,
    val renderables: List<Renderable> = emptyList(),
    val reason: String? = null,
    /** DEM-conforming stencil mask to upsert/remove in [NativeTerrainCutLayer]. */
    val terrainCutMesh: NativeTerrainCutMesh? = null,
)

/** The same rotated WorldWind model mesh, exported as geodetic triangle vertices for section cuts. */
internal data class NativeModelSectionMesh(
    val id: String,
    val kind: String,
    val vertices: List<NativeModelSectionVertex>,
    val triangles: IntArray,
)

internal data class NativeModelSectionVertex(
    val latitude: Double,
    val longitude: Double,
    val altitudeMeters: Double,
)

private data class MarkerGlyphPresentation(
    val icon: String,
    val color: Int,
    val title: String,
    val mode: String,
    val density: Int,
    val attributes: PlacemarkAttributes,
)

/** Builds truthful WorldWind renderables from the complete Web annotation record. */
internal object NativeModelRenderer {
    private const val EARTH_RADIUS_METERS = 6_371_008.8
    private const val MAX_VERTICES = 65_536
    // A bounded descriptor cache prevents arbitrary names/custom colors from
    // retaining pixels indefinitely. The SDK raster factory remains lazy.
    internal const val MAX_MARKER_GLYPHS = 128
    private val markerGlyphs = object : LinkedHashMap<String, earth.worldwind.render.image.ImageSource>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, earth.worldwind.render.image.ImageSource>?) = size > MAX_MARKER_GLYPHS
    }
    private val placemarkPresentation = WeakHashMap<Placemark, MarkerGlyphPresentation>()
    internal fun cachedMarkerGlyphCount(): Int = synchronized(markerGlyphs) { markerGlyphs.size }
    internal fun markerImageSource(key: Any, factory: suspend () -> ArgbImage?) = argbImageSource(key, factory)
    private fun markerGlyph(key: String, create: () -> earth.worldwind.render.image.ImageSource) =
        synchronized(markerGlyphs) { markerGlyphs.getOrPut(key, create) }

    /** Update one placemark in place; it keeps its last ready image during async texture retrieval. */
    internal fun updateMarkerPresentation(renderables: List<Renderable>, zoom: Double, cssScale: Double, resolvedMode: String): Boolean {
        val mode = NativeMarkerPresentation.resolvedMode(zoom, resolvedMode)
        val density = NativeMarkerPresentation.densityBucket(cssScale)
        renderables.filterIsInstance<Placemark>().forEach { placemark ->
            val presentation = synchronized(placemarkPresentation) { placemarkPresentation[placemark] } ?: return@forEach
            val imageScale = NativeMarkerPresentation.imageScale(zoom, cssScale, density, mode)
            if (presentation.mode == mode && presentation.density == density) {
                val nativePlacemark = placemark as? NativeMarkerPlacemark ?: return false
                nativePlacemark.updateImageScale(zoom, cssScale, imageScale)
                return@forEach
            }
            val source = markerImage(presentation.icon, presentation.color, presentation.title, density, mode)
            val nextAttributes = PlacemarkAttributes(presentation.attributes).apply {
                imageSource = source
                this.imageScale = imageScale
                imageOffset = if (mode == "dot") Offset.center() else Offset(FRACTION, 0.5, FRACTION, 2.0 / 64.0)
            }
            val nativePlacemark = placemark as? NativeMarkerPlacemark ?: return false
            val fallbackScale = NativeMarkerPresentation.imageScale(zoom, cssScale, presentation.density, presentation.mode)
            nativePlacemark.updateImagePresentation(nextAttributes, mode, density, fallbackScale)
            synchronized(placemarkPresentation) {
                placemarkPresentation[placemark] = presentation.copy(mode = mode, density = density, attributes = nextAttributes)
            }
        }
        return true
    }

    fun render(
        marker: JSONObject,
        terrainSampler: NativeTerrainSampler? = null,
        previousMarkerPresentation: NativeMarkerFallbackPresentation? = null,
    ): NativeMarkerRenderResult {
        val id = marker.optString("id").takeIf { it.isNotBlank() && it.length <= 100 }
            ?: return result(null, NativeMarkerStatus.INVALID, "标记编号无效")
        if (!marker.optBoolean("visible", true)) return result(id, NativeMarkerStatus.HIDDEN)
        val kind = marker.optString("kind")
        if (kind !in setOf("pin", "box", "sphere", "cylinder", "prism")) {
            return result(id, NativeMarkerStatus.UNSUPPORTED, "原生地图不支持此标记类型")
        }
        return try {
            val coordinate = marker.optJSONArray("coordinates") ?: return result(id, NativeMarkerStatus.INVALID, "缺少标记坐标")
            if (coordinate.length() < 2) return result(id, NativeMarkerStatus.INVALID, "标记坐标无效")
            val lon = coordinate.optDouble(0, Double.NaN)
            val lat = coordinate.optDouble(1, Double.NaN)
            if (!lat.isFinite() || lat !in -85.0..85.0 || !lon.isFinite()) return result(id, NativeMarkerStatus.INVALID, "标记坐标超出支持范围")
            val colorValue = try { AndroidColor.parseColor(marker.optString("color")) }
            catch (_: IllegalArgumentException) { return result(id, NativeMarkerStatus.INVALID, "标记颜色无效") }
            if (kind == "pin") return renderPin(marker, id, lat, lon, colorValue, previousMarkerPresentation)

            val width = finiteBound(marker, "width", 0.1, 10_000.0) ?: return result(id, NativeMarkerStatus.INVALID, "模型宽度无效")
            val length = finiteBound(marker, "length", 0.1, 10_000.0) ?: return result(id, NativeMarkerStatus.INVALID, "模型长度无效")
            val height = finiteBound(marker, "height", 0.1, 10_000.0) ?: return result(id, NativeMarkerStatus.INVALID, "模型高度无效")
            val heading = finiteBound(marker, "heading", -360.0, 360.0) ?: return result(id, NativeMarkerStatus.INVALID, "模型朝向无效")
            val pitch = finiteBound(marker, "pitch", -360.0, 360.0) ?: return result(id, NativeMarkerStatus.INVALID, "模型俯仰无效")
            val roll = finiteBound(marker, "roll", -360.0, 360.0) ?: return result(id, NativeMarkerStatus.INVALID, "模型翻滚无效")
            val opacity = finiteBound(marker, "opacity", 0.1, 0.85) ?: return result(id, NativeMarkerStatus.INVALID, "模型透明度无效")
            val placement = marker.optString("placement", "surface")
            if (placement !in setOf("surface", "underground")) return result(id, NativeMarkerStatus.INVALID, "模型贴地方式无效")
            val offset = finiteBound(marker, "offset", 0.0, 10_000.0) ?: return result(id, NativeMarkerStatus.INVALID, "模型离地偏移无效")
            val footprint = if (kind == "prism") parseFootprint(marker.optJSONArray("footprint"))
                ?: return result(id, NativeMarkerStatus.INVALID, "轮廓模型需要有效的 footprint") else emptyList()
            val terrainCut = marker.optBoolean("terrainCut", placement == "underground")
            // The web contract enables terrain/model contact by default unless explicitly false.
            val terrainIntersection = marker.optBoolean("terrainIntersection", true)
            val needsTerrainProcessing = terrainCut || (terrainIntersection && terrainSampler != null)
            if (terrainCut && terrainSampler == null) return result(id, NativeMarkerStatus.NEEDS_ELEVATION, "地形裁切等待真实DEM采样器")
            val vertices = when (kind) {
                "box" -> boxVertices(width, length, height)
                "cylinder" -> cylinderVertices(width / 2.0, height / 2.0)
                "prism" -> prismVertices(footprint, width, length, height)
                "sphere" -> if (needsTerrainProcessing) sphereMesh(width / 2.0).first else emptyList()
                else -> emptyList()
            }
            if (vertices.size > MAX_VERTICES) return result(id, NativeMarkerStatus.UNSUPPORTED, "模型顶点数超过原生引擎上限")
            val indices = when (kind) {
                "box" -> boxIndices()
                "cylinder" -> cylinderIndices(48)
                "prism" -> prismIndices(footprint)
                "sphere" -> if (needsTerrainProcessing) sphereMesh(width / 2.0).second else intArrayOf()
                else -> intArrayOf()
            }
            if (kind == "prism" && indices.isEmpty()) return result(id, NativeMarkerStatus.INVALID, "轮廓无法安全三角剖分")
            val vertical = vertices.map { rotate(it, heading, pitch, roll).z }
            val minZ = vertical.minOrNull() ?: -width / 2.0
            val maxZ = vertical.maxOrNull() ?: width / 2.0
            val ground = if (marker.has("groundElevation") && !marker.isNull("groundElevation")) marker.optDouble("groundElevation", Double.NaN) else null
            val centerAltitude = if (marker.has("centerAltitude") && !marker.isNull("centerAltitude")) marker.optDouble("centerAltitude", Double.NaN) else null
            if ((ground != null && !ground.isFinite()) || (centerAltitude != null && !centerAltitude.isFinite())) return result(id, NativeMarkerStatus.INVALID, "模型高程无效")
            val center = modelCenterAltitude(ground, centerAltitude, placement, offset, minZ, maxZ)
                ?: return result(id, NativeMarkerStatus.NEEDS_ELEVATION, "缺少真实地面高程或绝对中心高程，模型未绘制")
            val effectiveOpacity = if (placement == "underground") min(opacity, 0.45) else opacity
            val color = colorWithOpacity(colorValue, effectiveOpacity)
            val attrs = ShapeAttributes().apply {
                isDrawInterior = true
                isDrawOutline = true
                isDepthTest = placement != "underground"
                isLightingEnabled = false
                interiorColor = color
                outlineColor = color
                outlineWidth = 1f
            }
            val worldPositions = if (kind == "sphere" && !needsTerrainProcessing) emptyList() else vertices.map { vertex ->
                val local = rotate(vertex, heading, pitch, roll)
                localPosition(lat, lon, center + local.z, local.x, local.y)
            }
            val terrainMesh = if (needsTerrainProcessing) {
                val sampled=NativeTerrainMeshProcessor.process(worldPositions,indices,terrainSampler!!,cut=false)
                if(sampled==null&&terrainCut)return result(id,NativeMarkerStatus.NEEDS_ELEVATION,"地形高程采样不完整，未生成地形裁切")
                sampled
            } else null
            val shape: Renderable = if (kind == "sphere" && !needsTerrainProcessing) {
                Ellipsoid(Position(lat.degrees, wrapLongitude(lon).degrees, center), width / 2.0, width / 2.0, width / 2.0, attrs).apply {
                    altitudeMode = AltitudeMode.ABSOLUTE
                    this.heading = heading.degrees
                    this.pitch = pitch.degrees
                    this.roll = roll.degrees
                    slices = 32
                    stacks = 20
                }
            } else if (terrainMesh != null) TriangleMesh(terrainMesh.vertices.toTypedArray(), terrainMesh.indices, attrs).apply { altitudeMode = AltitudeMode.ABSOLUTE }
            else TriangleMesh(worldPositions.toTypedArray(), indices, attrs).apply { altitudeMode = AltitudeMode.ABSOLUTE }
            val renderables = mutableListOf(shape)
            if (kind != "sphere") renderables += edgePaths(modelEdges(kind, footprint), vertices, lat, lon, center, heading, pitch, roll, color, placement!="underground")
            val label = marker.optString("name").take(120)
            val mode = NativeMarkerPresentation.resolvedMode(marker.optDouble("_mapZoom", Double.NaN), marker.optString("_markerMode"))
            if (label.isNotBlank()) {
                val cssScale = safeCssScale(marker.optDouble("_cssScale", 1.0))
                val density = NativeMarkerPresentation.densityBucket(cssScale)
                val icon = marker.optString("icon", "pin").takeIf { it in MARKER_IDS } ?: "pin"
                val attrs = PlacemarkAttributes().apply {
                    imageSource = markerImage(icon, colorValue, label, density, mode)
                    imageScale = NativeMarkerPresentation.imageScale(marker.optDouble("_mapZoom", Double.NaN), cssScale, density, mode)
                    imageOffset = if (mode == "dot") Offset.center() else Offset(FRACTION, 0.5, FRACTION, 2.0 / 64.0)
                    isDrawLabel = false
                    isDrawLeader = false
                    isDepthTest = placement != "underground"
                }
                renderables += NativeMarkerPlacemark(
                    Position(lat.degrees, wrapLongitude(lon).degrees, center + maxZ), attrs, mode, density,
                    previousMarkerPresentation,
                ).apply {
                    altitudeMode = AltitudeMode.ABSOLUTE
                    isAlwaysOnTop = placement == "underground"
                    synchronized(placemarkPresentation) {
                        placemarkPresentation[this] = MarkerGlyphPresentation(icon, colorValue, label, mode, density, attrs)
                    }
                }
            }
            if (terrainMesh != null && terrainIntersection) terrainMesh.intersections.forEach { (a,b) ->
                renderables += Path(listOf(a,b), ShapeAttributes().apply { isDrawInterior=false;isDrawOutline=true;isDepthTest=placement!="underground";outlineColor=Color(1f,.25f,.12f,1f);outlineWidth=2f }).apply { altitudeMode=AltitudeMode.ABSOLUTE }
            }
            val cutMesh = if (terrainCut) terrainCutMesh(marker, terrainSampler!!, lat, lon, kind, width, length, height, heading, pitch, roll, offset, placement, center, vertical.minOrNull()!!, vertical.maxOrNull()!!, footprint) ?: return result(id, NativeMarkerStatus.NEEDS_ELEVATION, "地形裁切网格采样不完整，未声明已裁切") else null
            val terrainNotice=if(terrainIntersection&&(terrainSampler==null||terrainMesh==null))"真实DEM采样不完整，相交线暂未显示" else null
            NativeMarkerRenderResult(id, NativeMarkerStatus.RENDERED, renderables, reason=terrainNotice, terrainCutMesh = cutMesh)
        } catch (_: RuntimeException) {
            result(id, NativeMarkerStatus.INVALID, "模型几何数据无效")
        }
    }

    /**
     * Exposes the same dimensions, rotations, placement and geodetic vertex conversion used by
     * render(). Unknown/groundless models return null; callers must not invent a zero altitude.
     */
    fun sectionMesh(marker: JSONObject): NativeModelSectionMesh? {
        val id = marker.optString("id").takeIf { it.isNotBlank() && it.length <= 100 } ?: return null
        if (!marker.optBoolean("visible", true)) return null
        val kind = marker.optString("kind")
        if (kind !in setOf("box", "sphere", "cylinder", "prism")) return null
        val coordinate = marker.optJSONArray("coordinates") ?: return null
        if (coordinate.length() < 2) return null
        val lon = coordinate.optDouble(0, Double.NaN)
        val lat = coordinate.optDouble(1, Double.NaN)
        if (!lat.isFinite() || lat !in -85.0..85.0 || !lon.isFinite()) return null
        val width = finiteBound(marker, "width", 0.1, 10_000.0) ?: return null
        val length = finiteBound(marker, "length", 0.1, 10_000.0) ?: return null
        val height = finiteBound(marker, "height", 0.1, 10_000.0) ?: return null
        val heading = finiteBound(marker, "heading", -360.0, 360.0) ?: return null
        val pitch = finiteBound(marker, "pitch", -360.0, 360.0) ?: return null
        val roll = finiteBound(marker, "roll", -360.0, 360.0) ?: return null
        try { AndroidColor.parseColor(marker.optString("color")) } catch (_: IllegalArgumentException) { return null }
        finiteBound(marker, "opacity", 0.1, 0.85) ?: return null
        val placement = marker.optString("placement", "surface")
        if (placement !in setOf("surface", "underground")) return null
        val offset = finiteBound(marker, "offset", 0.0, 10_000.0) ?: return null
        val footprint = if (kind == "prism") parseFootprint(marker.optJSONArray("footprint")) ?: return null else emptyList()
        val localVertices = when (kind) {
            "box" -> boxVertices(width, length, height)
            "cylinder" -> cylinderVertices(width / 2.0, height / 2.0)
            "prism" -> prismVertices(footprint, width, length, height)
            "sphere" -> sphereMesh(width / 2.0).first
            else -> return null
        }
        if (localVertices.size > MAX_VERTICES) return null
        val indices = when (kind) {
            "box" -> boxIndices()
            "cylinder" -> cylinderIndices(48)
            "prism" -> prismIndices(footprint)
            "sphere" -> sphereMesh(width / 2.0).second
            else -> intArrayOf()
        }
        if (indices.isEmpty() || indices.size % 3 != 0 || indices.any { it !in localVertices.indices }) return null
        val vertical = localVertices.map { rotate(it, heading, pitch, roll).z }
        val minZ = vertical.minOrNull() ?: return null
        val maxZ = vertical.maxOrNull() ?: return null
        val ground = if (marker.has("groundElevation") && !marker.isNull("groundElevation")) marker.optDouble("groundElevation", Double.NaN) else null
        val absoluteCenter = if (marker.has("centerAltitude") && !marker.isNull("centerAltitude")) marker.optDouble("centerAltitude", Double.NaN) else null
        if ((ground != null && !ground.isFinite()) || (absoluteCenter != null && !absoluteCenter.isFinite())) return null
        val center = modelCenterAltitude(ground, absoluteCenter, placement, offset, minZ, maxZ) ?: return null
        val vertices = localVertices.map { raw ->
            val local = rotate(raw, heading, pitch, roll)
            val point = localPosition(lat, lon, center + local.z, local.x, local.y)
            NativeModelSectionVertex(point.latitude.inDegrees, point.longitude.inDegrees, center + local.z)
        }
        return NativeModelSectionMesh(id, kind, vertices, indices)
    }

    private fun renderPin(
        marker: JSONObject,
        id: String,
        lat: Double,
        lon: Double,
        color: Int,
        previousMarkerPresentation: NativeMarkerFallbackPresentation?,
    ): NativeMarkerRenderResult {
        val mode = NativeMarkerPresentation.resolvedMode(marker.optDouble("_mapZoom", Double.NaN), marker.optString("_markerMode"))
        val title = marker.optString("name").ifBlank { marker.optString("note").ifBlank { "未命名" } }.take(120)
        val icon = marker.optString("icon", "pin").takeIf { it in MARKER_IDS } ?: "pin"
        val cssScale = safeCssScale(marker.optDouble("_cssScale", 1.0))
        val density = NativeMarkerPresentation.densityBucket(cssScale)
        val attrs = PlacemarkAttributes().apply {
            imageSource = markerImage(icon, color, title, density, mode)
            imageScale = NativeMarkerPresentation.imageScale(marker.optDouble("_mapZoom", Double.NaN), cssScale, density, mode)
            // WorldWind defaults to center anchoring. Pin/icon/badge art reaches y=62,
            // so its bottom-center remains tied to the ground. The distance dot is centered.
            imageOffset = if (mode == "dot") Offset.center() else Offset(FRACTION, 0.5, FRACTION, 2.0 / 64.0)
            imageColor = Color(1f,1f,1f,(AndroidColor.alpha(color)/255f))
            isDrawLabel = false
            isDrawLeader = false
            // Ordinary pins must be occluded by terrain and must not remain pickable through hills.
            isDepthTest = true
        }
        val placemark = NativeMarkerPlacemark(
            Position(lat.degrees, wrapLongitude(lon).degrees, 0.0), attrs, mode, density,
            previousMarkerPresentation,
        ).apply {
            altitudeMode = AltitudeMode.CLAMP_TO_GROUND
            isAlwaysOnTop = false
            synchronized(placemarkPresentation) {
                placemarkPresentation[this] = MarkerGlyphPresentation(icon, color, title, mode, density, attrs)
            }
        }
        val renderables=mutableListOf<Renderable>(placemark)
        val borehole=marker.optJSONObject("borehole")
        if(icon=="drill"&&borehole!=null&&!borehole.isNull("depth")){
            val depth=borehole.optDouble("depth",Double.NaN);val hasGround=marker.has("groundElevation")&&!marker.isNull("groundElevation");val ground=if(hasGround)marker.optDouble("groundElevation",Double.NaN)else null
            if(depth.isFinite()&&depth in .1..12000.0&&(ground==null||ground.isFinite())){
                val top=ground?:0.0;val altitudeMode=if(ground==null)AltitudeMode.RELATIVE_TO_GROUND else AltitudeMode.ABSOLUTE
                val path=Path(listOf(Position(lat.degrees,wrapLongitude(lon).degrees,top),Position(lat.degrees,wrapLongitude(lon).degrees,top-depth)),ShapeAttributes().apply{isDepthTest=false;isDrawInterior=false;isDrawOutline=true;outlineColor=colorWithOpacity(color,1.0);outlineWidth=2f}).apply{this.altitudeMode=altitudeMode;pickDelegate="shantu-object:$id"}
                renderables+=path
            }
        }
        return NativeMarkerRenderResult(id, NativeMarkerStatus.RENDERED, renderables)
    }

    /**
     * Computes the model center from raw, unexaggerated meter values. The WorldWind 2.1.1
     * Globe applies verticalExaggeration to ABSOLUTE altitude during geodetic conversion,
     * as it does for terrain. Keep DEM elevation, centerAltitude and offset in raw meters
     * here; callers must not pre-scale them. An explicit centerAltitude remains authoritative.
     */
    internal fun modelCenterAltitude(
        groundElevation: Double?,
        centerAltitude: Double?,
        placement: String,
        offset: Double,
        minZ: Double,
        maxZ: Double,
    ): Double? = when {
        centerAltitude != null -> centerAltitude
        groundElevation == null -> null
        placement == "surface" -> groundElevation + offset - minZ
        placement == "underground" -> groundElevation - offset - maxZ
        else -> null
    }

    private fun terrainCutMesh(
        marker:JSONObject,sampler:NativeTerrainSampler,lat:Double,lon:Double,kind:String,width:Double,length:Double,height:Double,
        heading:Double,pitch:Double,roll:Double,offset:Double,placement:String,center:Double,minZ:Double,maxZ:Double,
        footprint:List<Pair<Double,Double>>,
    ):NativeTerrainCutMesh? {
        val boundaryRaw=when(kind){
            "box"->buildList{for(z in listOf(-height/2,height/2))for(y in listOf(-length/2,length/2))for(x in listOf(-width/2,width/2))add(V3(x,y,z))}
            "cylinder"->(0 until 32).flatMap{i->val a=2*PI*i/32;listOf(V3(width/2*cos(a),width/2*sin(a),-height/2),V3(width/2*cos(a),width/2*sin(a),height/2))}
            "sphere"->(0 until 32).map{i->val a=2*PI*i/32;V3(width/2*cos(a),width/2*sin(a),0.0)}
            "prism"->footprint.flatMap{(x,y)->listOf(V3(x*width,y*length,-height/2),V3(x*width,y*length,height/2))}
            else->return null
        }
        val boundary=if(kind=="prism"&&abs(pitch)<1e-9&&abs(roll)<1e-9){
            footprint.map{(x,y)->rotate(V3(x*width,y*length,0.0),heading,pitch,roll).let{localPosition(lat,lon,center,it.x,it.y)}}
        }else{
            val projected=boundaryRaw.map{rotate(it,heading,pitch,roll).let{v->v.x to v.y}}
            convexHull(projected).map{(x,y)->localPosition(lat,lon,center,x,y)}
        }
        val lower=center+minZ;val upper=center+maxZ
        // The stencil must intersect the model we actually rendered. Re-anchoring only
        // the cut volume to a fresh centre DEM moved the hole away from saved models.
        return NativeTerrainCutMeshBuilder.build(marker.optString("id"),boundary,sampler,lower,upper,placement=="underground")
    }

    private fun convexHull(points:List<Pair<Double,Double>>):List<Pair<Double,Double>>{
        val sorted=points.distinct().sortedWith(compareBy<Pair<Double,Double>>{it.first}.thenBy{it.second});if(sorted.size<3)return sorted
        fun cross(o:Pair<Double,Double>,a:Pair<Double,Double>,b:Pair<Double,Double>)=(a.first-o.first)*(b.second-o.second)-(a.second-o.second)*(b.first-o.first)
        val lower=mutableListOf<Pair<Double,Double>>();for(p in sorted){while(lower.size>=2&&cross(lower[lower.lastIndex-1],lower.last(),p)<=0)lower.removeAt(lower.lastIndex);lower+=p}
        val upper=mutableListOf<Pair<Double,Double>>();for(p in sorted.asReversed()){while(upper.size>=2&&cross(upper[upper.lastIndex-1],upper.last(),p)<=0)upper.removeAt(upper.lastIndex);upper+=p}
        return lower.dropLast(1)+upper.dropLast(1)
    }

    private fun markerDotImage(color: Int, density: Int): earth.worldwind.render.image.ImageSource = markerGlyph("dot:$color:$density") {
        val key = "dot:$color:$density"
        markerImageSource(key) {
            val size = 9 * density
            val pixels = IntArray(size * size) { i ->
                val x = i % size / density.toDouble()
                val y = i / size / density.toDouble()
                val distance = kotlin.math.hypot(x - 4.0, y - 4.0)
                when { distance <= 2.5 -> color; distance <= 4.5 -> AndroidColor.WHITE; else -> 0 }
            }
            ArgbImage(size, size, pixels)
        }
    }

    private fun markerImage(icon:String,color:Int,title:String,density:Int,mode:String):earth.worldwind.render.image.ImageSource = when (mode) {
        "label" -> markerBadgeImage(icon,color,title,density)
        "dot" -> markerDotImage(color,density)
        else -> markerIconImage(icon,color,density)
    }

    private fun markerIconImage(icon:String,color:Int,density:Int):earth.worldwind.render.image.ImageSource = markerGlyph("icon:$icon:$color:$density") {
        val key = "icon:$icon:$color:$density"
        markerImageSource(key) {
            val bitmap=Bitmap.createBitmap(64*density,64*density,Bitmap.Config.ARGB_8888);val canvas=Canvas(bitmap).apply { scale(density.toFloat(),density.toFloat()) }
            val fill=Paint(Paint.ANTI_ALIAS_FLAG).apply{style=Paint.Style.FILL;this.color=color}
            val white=Paint(Paint.ANTI_ALIAS_FLAG).apply{style=Paint.Style.FILL;this.color=AndroidColor.WHITE}
            val border=Paint(Paint.ANTI_ALIAS_FLAG).apply{style=Paint.Style.STROKE;strokeWidth=3f;this.color=AndroidColor.WHITE}
            val path=android.graphics.Path().apply{moveTo(32f,62f);cubicTo(26f,51f,8f,35f,8f,23f);cubicTo(8f,9f,19f,3f,32f,3f);cubicTo(45f,3f,56f,9f,56f,23f);cubicTo(56f,35f,38f,51f,32f,62f);close()}
            canvas.drawPath(path,fill);canvas.drawCircle(32f,24f,16f,white);canvas.drawCircle(32f,24f,16f,border)
            drawMarkerGlyph(canvas,icon,color)
            val pixels=IntArray(bitmap.width*bitmap.height);bitmap.getPixels(pixels,0,bitmap.width,0,0,bitmap.width,bitmap.height);bitmap.recycle()
            ArgbImage(64*density,64*density,pixels)
        }
    }

    /** One placemark image contains icon, frame and text, so all three share one screen anchor. */
    private fun markerBadgeImage(icon: String, color: Int, title: String, density: Int): earth.worldwind.render.image.ImageSource =
        markerGlyph("badge:$icon:$color:$density:$title") {
            val key = "badge:$icon:$color:$density:$title"
            markerImageSource(key) {
            val logicalHeight = 64
            val textPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
                textSize = 20f
                typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
                this.color = if (AndroidColor.luminance(color) > 0.48f) AndroidColor.rgb(20, 42, 35) else AndroidColor.WHITE
            }
            val maxTextWidth = 200f
            val shownTitle = TextUtils.ellipsize(title, textPaint, maxTextWidth, TextUtils.TruncateAt.END).toString()
            val textWidth = textPaint.measureText(shownTitle)
            val logicalWidth = kotlin.math.ceil(40f + textWidth).toInt().coerceIn(64, 240)
            val bitmap = Bitmap.createBitmap(logicalWidth * density, logicalHeight * density, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap).apply { scale(density.toFloat(), density.toFloat()) }
            val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; this.color = color }
            val border = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2f; this.color = AndroidColor.WHITE }
            val body = android.graphics.RectF(1f, 1f, logicalWidth - 1f, 38f)
            canvas.drawRoundRect(body, 6.4f, 6.4f, fill)
            canvas.drawRoundRect(body, 6.4f, 6.4f, border)
            val tipX = logicalWidth / 2f
            val pointer = android.graphics.Path().apply {
                moveTo(tipX - 8f, 37f); lineTo(tipX + 8f, 37f); lineTo(tipX, 62f); close()
            }
            canvas.drawPath(pointer, fill)
            canvas.drawLine(tipX - 8f, 37f, tipX, 62f, border)
            canvas.drawLine(tipX, 62f, tipX + 8f, 37f, border)
            canvas.drawCircle(18f, 20f, 11f, Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; this.color = AndroidColor.WHITE })
            canvas.save()
            canvas.translate(-0.56f, 6.08f)
            canvas.scale(0.58f, 0.58f)
            drawMarkerGlyph(canvas, icon, color)
            canvas.restore()
            val metrics = textPaint.fontMetrics
            val baseline = 20f - (metrics.ascent + metrics.descent) / 2f
            canvas.drawText(shownTitle, 34f, baseline, textPaint)
            val pixels = IntArray(bitmap.width * bitmap.height)
            bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
            bitmap.recycle()
            ArgbImage(logicalWidth * density, logicalHeight * density, pixels)
            }
        }

    private fun safeCssScale(value: Double) = value.takeIf { it.isFinite() && it > 0.0 } ?: 1.0
    private val MARKER_IDS=setOf("pin","flag","star","camp","mountain","water","house","cave","danger","parking","bridge","tree","camera","sample","drill","hospital","food","gate")
    internal fun drawMarkerGlyph(canvas:Canvas,icon:String,color:Int){
        val line=Paint(Paint.ANTI_ALIAS_FLAG).apply{this.color=color;style=Paint.Style.STROKE;strokeWidth=3f;strokeCap=Paint.Cap.ROUND;strokeJoin=Paint.Join.ROUND}
        val fill=Paint(Paint.ANTI_ALIAS_FLAG).apply{this.color=color;style=Paint.Style.FILL}
        val p=android.graphics.Path()
        when(icon){
            "pin"->{canvas.drawCircle(32f,24f,7f,line);canvas.drawCircle(32f,24f,2.5f,fill)}
            "flag"->{p.moveTo(24f,35f);p.lineTo(24f,13f);p.moveTo(25f,14f);p.lineTo(42f,14f);p.lineTo(38f,20f);p.lineTo(42f,26f);p.lineTo(25f,26f);canvas.drawPath(p,line)}
            "star"->{for(i in 0 until 10){val a=-Math.PI/2+i*Math.PI/5;val r=if(i%2==0)12.0 else 5.5;val x=(32+kotlin.math.cos(a)*r).toFloat();val y=(24+kotlin.math.sin(a)*r).toFloat();if(i==0)p.moveTo(x,y)else p.lineTo(x,y)};p.close();canvas.drawPath(p,fill)}
            "camp"->{p.moveTo(20f,34f);p.lineTo(32f,13f);p.lineTo(44f,34f);p.close();canvas.drawPath(p,line);p.moveTo(28f,34f);p.lineTo(32f,27f);p.lineTo(36f,34f);canvas.drawPath(p,line)}
            "mountain"->{p.moveTo(19f,34f);p.lineTo(28f,15f);p.lineTo(34f,27f);p.lineTo(38f,20f);p.lineTo(45f,34f);p.close();canvas.drawPath(p,line);p.reset();p.moveTo(25f,23f);p.lineTo(28f,27f);p.lineTo(31f,23f);canvas.drawPath(p,line)}
            "water"->{p.moveTo(32f,12f);p.cubicTo(28f,19f,22f,25f,22f,29f);p.cubicTo(22f,36f,27f,39f,32f,39f);p.cubicTo(38f,39f,42f,35f,42f,29f);p.cubicTo(42f,24f,36f,17f,32f,12f);p.close();canvas.drawPath(p,line);p.reset();p.moveTo(27f,30f);p.cubicTo(27f,34f,29f,36f,33f,36f);canvas.drawPath(p,line)}
            "house"->{p.moveTo(20f,23f);p.lineTo(32f,13f);p.lineTo(44f,23f);p.moveTo(23f,21f);p.lineTo(23f,35f);p.lineTo(41f,35f);p.lineTo(41f,21f);p.moveTo(29f,35f);p.lineTo(29f,27f);p.lineTo(35f,27f);p.lineTo(35f,35f);canvas.drawPath(p,line)}
            "cave"->{p.moveTo(20f,35f);p.lineTo(24f,17f);p.lineTo(32f,13f);p.lineTo(40f,17f);p.lineTo(44f,35f);p.moveTo(27f,35f);p.lineTo(27f,29f);p.cubicTo(27f,22f,37f,22f,37f,29f);p.lineTo(37f,35f);canvas.drawPath(p,line)}
            "danger"->{p.moveTo(32f,13f);p.lineTo(44f,35f);p.lineTo(20f,35f);p.close();canvas.drawPath(p,line);canvas.drawLine(32f,21f,32f,28f,line);canvas.drawCircle(32f,32f,1.3f,fill)}
            "parking"->{p.moveTo(24f,35f);p.lineTo(24f,13f);p.lineTo(34f,13f);p.cubicTo(44f,13f,44f,26f,34f,26f);p.lineTo(24f,26f);canvas.drawPath(p,line)}
            "bridge"->{p.moveTo(21f,15f);p.lineTo(21f,35f);p.moveTo(43f,15f);p.lineTo(43f,35f);p.moveTo(21f,19f);p.cubicTo(27f,33f,37f,33f,43f,19f);p.moveTo(20f,33f);p.lineTo(44f,33f);p.moveTo(27f,27f);p.lineTo(27f,33f);p.moveTo(37f,27f);p.lineTo(37f,33f);canvas.drawPath(p,line)}
            "tree"->{p.moveTo(32f,13f);p.lineTo(22f,26f);p.lineTo(28f,26f);p.lineTo(20f,34f);p.lineTo(44f,34f);p.lineTo(36f,26f);p.lineTo(42f,26f);p.close();canvas.drawPath(p,fill);canvas.drawLine(32f,33f,32f,37f,line)}
            "camera"->{canvas.drawRoundRect(21f,18f,43f,34f,3f,3f,line);canvas.drawCircle(32f,26f,5f,line);canvas.drawLine(25f,18f,28f,14f,line);canvas.drawLine(28f,14f,36f,14f,line)}
            "sample"->{p.moveTo(27f,13f);p.lineTo(37f,13f);p.moveTo(29f,13f);p.lineTo(29f,24f);p.lineTo(22f,35f);p.lineTo(42f,35f);p.lineTo(35f,24f);p.lineTo(35f,13f);p.moveTo(26f,30f);p.lineTo(38f,30f);canvas.drawPath(p,line)}
            "drill"->{p.moveTo(22f,15f);p.lineTo(42f,15f);p.moveTo(32f,15f);p.lineTo(32f,33f);p.moveTo(27f,19f);p.lineTo(37f,23f);p.lineTo(27f,27f);p.lineTo(37f,31f);canvas.drawPath(p,line);p.reset();p.moveTo(27f,33f);p.lineTo(32f,38f);p.lineTo(37f,33f);canvas.drawPath(p,line)}
            "hospital"->{canvas.drawRect(29f,13f,35f,37f,fill);canvas.drawRect(22f,22f,42f,28f,fill)}
            "food"->{p.moveTo(24f,14f);p.lineTo(24f,20f);p.cubicTo(24f,25f,32f,25f,32f,20f);p.lineTo(32f,14f);p.moveTo(28f,14f);p.lineTo(28f,37f);p.moveTo(41f,14f);p.cubicTo(36f,19f,36f,25f,41f,25f);p.lineTo(41f,37f);canvas.drawPath(p,line)}
            "gate"->{canvas.drawRect(22f,14f,42f,36f,line);canvas.drawLine(29f,14f,29f,36f,line);p.moveTo(32f,25f);p.lineTo(43f,25f);p.moveTo(39f,21f);p.lineTo(43f,25f);p.lineTo(39f,29f);canvas.drawPath(p,line)}
        }
    }

    private data class V3(val x: Double, val y: Double, val z: Double)
    private fun boxVertices(w: Double, l: Double, h: Double) = buildList {
        for (z in listOf(-h / 2, h / 2)) for (y in listOf(-l / 2, l / 2)) for (x in listOf(-w / 2, w / 2)) add(V3(x, y, z))
    }

    private fun boxIndices(): IntArray {
        val faces = arrayOf(intArrayOf(0, 2, 3, 1), intArrayOf(4, 5, 7, 6), intArrayOf(0, 1, 5, 4), intArrayOf(2, 6, 7, 3), intArrayOf(0, 4, 6, 2), intArrayOf(1, 3, 7, 5))
        return faces.flatMap { listOf(it[0], it[1], it[2], it[0], it[2], it[3]) }.toIntArray()
    }

    private fun cylinderVertices(radius: Double, halfHeight: Double): List<V3> {
        val sides = 48
        return buildList {
            for (z in listOf(-halfHeight, halfHeight)) for (i in 0 until sides) {
                val angle = 2 * PI * i / sides
                add(V3(radius * cos(angle), radius * sin(angle), z))
            }
            add(V3(0.0, 0.0, -halfHeight))
            add(V3(0.0, 0.0, halfHeight))
        }
    }

    /** Match the WorldWind Ellipsoid render() resolution (32 slices × 20 stacks). */
    private fun sphereMesh(radius: Double): Pair<List<V3>, IntArray> {
        val slices = 32
        val stacks = 20
        val vertices = buildList {
            for (stack in 0..stacks) {
                val phi = PI * stack / stacks
                val z = radius * cos(phi)
                val ring = radius * sin(phi)
                for (slice in 0 until slices) {
                    val theta = 2 * PI * slice / slices
                    add(V3(ring * cos(theta), ring * sin(theta), z))
                }
            }
        }
        val indices = buildList {
            for (stack in 0 until stacks) for (slice in 0 until slices) {
                val next = (slice + 1) % slices
                val a = stack * slices + slice
                val b = stack * slices + next
                val c = (stack + 1) * slices + next
                val d = (stack + 1) * slices + slice
                addAll(listOf(a, b, c, a, c, d))
            }
        }.toIntArray()
        return vertices to indices
    }

    private fun cylinderIndices(sides: Int): IntArray = buildList {
        for (i in 0 until sides) {
            val next = (i + 1) % sides
            addAll(listOf(i, next, sides + next, i, sides + next, sides + i))
            addAll(listOf(2 * sides, next, i, 2 * sides + 1, sides + i, sides + next))
        }
    }.toIntArray()

    private fun prismVertices(footprint: List<Pair<Double, Double>>, width: Double, length: Double, height: Double) = buildList {
        for (z in listOf(-height / 2, height / 2)) footprint.forEach { (x, y) -> add(V3(x * width, y * length, z)) }
    }

    private fun prismIndices(footprint: List<Pair<Double, Double>>): IntArray {
        val cap = triangulate(footprint) ?: return intArrayOf()
        val n = footprint.size
        return buildList {
            for (i in cap.indices step 3) {
                add(cap[i]); add(cap[i + 2]); add(cap[i + 1])
                add(n + cap[i]); add(n + cap[i + 1]); add(n + cap[i + 2])
            }
            for (i in 0 until n) {
                val next = (i + 1) % n
                addAll(listOf(i, next, n + next, i, n + next, n + i))
            }
        }.toIntArray()
    }

    private fun triangulate(points: List<Pair<Double, Double>>): IntArray? {
        val area = points.indices.sumOf { i ->
            val a = points[i]; val b = points[(i + 1) % points.size]; a.first * b.second - b.first * a.second
        }
        if (abs(area) < 1e-10) return null
        val remaining = points.indices.toMutableList()
        if (area < 0) remaining.reverse()
        val out = mutableListOf<Int>()
        var guard = points.size * points.size
        while (remaining.size > 3 && guard-- > 0) {
            var clipped = false
            for (i in remaining.indices) {
                val prev = remaining[(i - 1 + remaining.size) % remaining.size]
                val current = remaining[i]
                val next = remaining[(i + 1) % remaining.size]
                if (cross(points[prev], points[current], points[next]) <= 1e-12) continue
                if (remaining.any { it != prev && it != current && it != next && insideTriangle(points[it], points[prev], points[current], points[next]) }) continue
                out += listOf(prev, current, next)
                remaining.removeAt(i)
                clipped = true
                break
            }
            if (!clipped) return null
        }
        if (remaining.size != 3) return null
        out += remaining
        return out.toIntArray()
    }

    private fun insideTriangle(p: Pair<Double, Double>, a: Pair<Double, Double>, b: Pair<Double, Double>, c: Pair<Double, Double>) =
        cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12

    private fun cross(a: Pair<Double, Double>, b: Pair<Double, Double>, c: Pair<Double, Double>) =
        (b.first - a.first) * (c.second - a.second) - (b.second - a.second) * (c.first - a.first)

    private fun rotate(v: V3, heading: Double, pitch: Double, roll: Double): V3 {
        // Three.js modelRotation(): Euler(pitch, roll, -heading, 'ZYX') => Rz * Ry * Rx.
        val x = pitch * PI / 180.0
        val y = roll * PI / 180.0
        val z = -heading * PI / 180.0
        val cx = cos(x); val sx = sin(x); val cy = cos(y); val sy = sin(y); val cz = cos(z); val sz = sin(z)
        return V3(
            (cz * cy) * v.x + (cz * sy * sx - sz * cx) * v.y + (cz * sy * cx + sz * sx) * v.z,
            (sz * cy) * v.x + (sz * sy * sx + cz * cx) * v.y + (sz * sy * cx - cz * sx) * v.z,
            (-sy) * v.x + (cy * sx) * v.y + (cy * cx) * v.z,
        )
    }

    private fun modelEdges(kind: String, footprint: List<Pair<Double, Double>>): Set<Pair<Int, Int>> = when (kind) {
        "box" -> setOf(0 to 1, 1 to 3, 3 to 2, 2 to 0, 4 to 5, 5 to 7, 7 to 6, 6 to 4, 0 to 4, 1 to 5, 2 to 6, 3 to 7)
        "cylinder" -> buildSet {
            val n = 48
            for (i in 0 until n) {
                val next = (i + 1) % n
                add(i to next); add(n + i to n + next); add(i to n + i)
            }
        }
        "prism" -> buildSet {
            val n = footprint.size
            for (i in 0 until n) {
                val next = (i + 1) % n
                add(i to next); add(n + i to n + next); add(i to n + i)
            }
        }
        else -> emptySet()
    }

    private fun edgePaths(
        edges: Set<Pair<Int, Int>>, vertices: List<V3>, lat: Double, lon: Double, center: Double,
        heading: Double, pitch: Double, roll: Double, color: Color, depthTest:Boolean=true,
    ): List<Renderable> {
        val attrs = ShapeAttributes().apply {
            isDrawInterior = false
            isDrawOutline = true
            isDepthTest = depthTest
            outlineColor = color
            outlineWidth = 1f
        }
        return edges.map { (a, b) ->
            val points = listOf(a, b).map { idx ->
                val local = rotate(vertices[idx], heading, pitch, roll)
                localPosition(lat, lon, center + local.z, local.x, local.y)
            }
            Path(points, attrs).apply { altitudeMode = AltitudeMode.ABSOLUTE }
        }
    }

    private fun localPosition(centerLat: Double, centerLon: Double, altitude: Double, east: Double, north: Double): Position {
        val distance = hypot(east, north)
        if (distance < 1e-8) return Position(centerLat.degrees, wrapLongitude(centerLon).degrees, altitude)
        val angular = distance / EARTH_RADIUS_METERS
        val bearing = atan2(east, north)
        val lat1 = centerLat * PI / 180.0
        val lon1 = centerLon * PI / 180.0
        val lat2 = kotlin.math.asin(sin(lat1) * cos(angular) + cos(lat1) * sin(angular) * cos(bearing))
        val lon2 = lon1 + atan2(sin(bearing) * sin(angular) * cos(lat1), cos(angular) - sin(lat1) * sin(lat2))
        return Position((lat2 * 180 / PI).degrees, wrapLongitude(lon2 * 180 / PI).degrees, altitude)
    }

    private fun parseFootprint(array: JSONArray?): List<Pair<Double, Double>>? {
        if (array == null || array.length() !in 3..6000) return null
        val points = (0 until array.length()).map { i ->
            val pair = array.optJSONArray(i) ?: return null
            if (pair.length() < 2) return null
            val x = pair.optDouble(0, Double.NaN); val y = pair.optDouble(1, Double.NaN)
            if (!x.isFinite() || !y.isFinite() || abs(x) > 0.500001 || abs(y) > 0.500001) return null
            x to y
        }
        if (points.zipWithNext().any { (a, b) -> hypot(a.first - b.first, a.second - b.second) < 1e-9 }) return null
        return points
    }

    private fun finiteBound(obj: JSONObject, key: String, min: Double, max: Double): Double? {
        val value = obj.optDouble(key, Double.NaN)
        return value.takeIf { it.isFinite() && it in min..max }
    }

    private fun colorWithOpacity(color: Int, opacity: Double) = Color(
        AndroidColor.red(color) / 255f, AndroidColor.green(color) / 255f,
        AndroidColor.blue(color) / 255f, (AndroidColor.alpha(color) / 255.0 * opacity).toFloat(),
    )

    private fun wrapLongitude(value: Double) = ((value + 180.0) % 360.0 + 360.0) % 360.0 - 180.0
    private fun result(id: String?, status: NativeMarkerStatus, reason: String? = null) = NativeMarkerRenderResult(id, status, reason = reason)
}
