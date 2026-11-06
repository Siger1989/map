package com.shantu.nativeapp.geology

import com.shantu.nativeapp.map.NativeOfflineDisplayPolicy
import com.shantu.nativeapp.map.NativeCallbackOwner

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import earth.worldwind.WorldWindow
import earth.worldwind.geom.AltitudeMode
import earth.worldwind.geom.Angle.Companion.degrees
import earth.worldwind.geom.Position
import earth.worldwind.layer.RenderableLayer
import earth.worldwind.layer.mercator.MercatorTiledImageLayer
import earth.worldwind.layer.mercator.MercatorTileFactory
import earth.worldwind.layer.mercator.MercatorTiledSurfaceImage
import earth.worldwind.render.Color
import earth.worldwind.render.Renderable
import earth.worldwind.render.image.ImageSource
import earth.worldwind.shape.Path
import earth.worldwind.shape.Polygon
import earth.worldwind.shape.ShapeAttributes
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import java.util.concurrent.CancellationException
import kotlinx.coroutines.*
import kotlin.math.*

enum class NativeGeologySource { WORLD, GEO_CLOUD_200K }
enum class NativeGeologyStatus { OFF, LOADING, READY, EMPTY, ERROR, AUTHORIZATION }
class NativeGeologyAuthorizationException:Exception("地质云授权无效或无权访问")
internal fun geologyCloudFailureStatus(httpStatus:Int)=if(httpStatus==401||httpStatus==403)NativeGeologyStatus.AUTHORIZATION else NativeGeologyStatus.ERROR
data class NativeGeologyUnit(val key:String,val name:String,val age:String,val lithology:String,val color:String,val description:String,val source:String,val sourceUrl:String?)
data class NativeGeologyState(val source:NativeGeologySource=NativeGeologySource.WORLD,val status:NativeGeologyStatus=NativeGeologyStatus.OFF,val message:String="",val units:List<NativeGeologyUnit> = emptyList(),val selected:NativeGeologyUnit?=null,val legendImage:ByteArray?=null,val opacity:Double=.85,val attribution:String="")
data class NativeMvtFeature(val layer:String,val type:Int,val extent:Int,val properties:Map<String,String>,val paths:List<List<Pair<Int,Int>>>)

/** Explicit work ceilings for the compact floating map; legacy geology decoding remains unchanged. */
internal data class NativeMvtDecodeLimits(
    val maxBytes: Int = 4 * 1024 * 1024,
    val maxLayers: Int = 128,
    val maxCandidatesPerPriority: Int = 4096,
    val maxFeatures: Int = 1200,
    val maxVertices: Int = 24_000,
    val maxPaths: Int = 4_800,
    val maxPathsPerFeature: Int = 512,
    val maxGeometryCommandsPerFeature: Int = 16_384,
    val maxTagPairsPerFeature: Int = 128,
    val maxDictionaryEntries: Int = 8_192,
    val maxProperties: Int = 8_192,
    val maxLabelFeatures: Int = 48,
    val maxLabelVertices: Int = 2_400,
    val maxStringBytes: Int = 256,
)

internal data class NativeMvtDecodeStats(
    val inputBytes: Int,
    val scannedLayers: Int,
    val skippedLayers: Int,
    val scannedFeatures: Int,
    val irrelevantFeatures: Int,
    val candidateCapSkipped: Int,
    val commandLimitSkipped: Int,
    val tagLimitSkipped: Int,
    val geometryLimitSkipped: Int,
    val dictionaryCapSkipped: Int,
    val skippedByBudget: Int,
    val acceptedFeatures: Int,
    val acceptedPaths: Int,
    val acceptedVertices: Int,
    val skippedByLabelReserve: Int,
    val propertyCapSkipped: Int,
)

internal data class NativeMvtDecodeResult(val features: List<NativeMvtFeature>, val stats: NativeMvtDecodeStats)

/** Small bounded shared protobuf/MVT decoder for geology and native road-snap geometry. */
internal object NativeMvtDecoder {
    fun decode(bytes:ByteArray):List<NativeMvtFeature> {
        require(bytes.size <= 4*1024*1024) { "MVT payload size invalid" }
        val tile=Pb(bytes); val out=mutableListOf<NativeMvtFeature>()
        while(tile.more()) { val (field,wire)=tile.tag(); if(field==3&&wire==2) out+=layer(tile.blob(wire)) else tile.skip(wire) }
        return out
    }

    /**
     * Bounded, two-stage decoder for the small Canvas map. It indexes only byte spans first,
     * reserves room for labels, and materializes complete selected features in priority order.
     * It never truncates a line or polygon ring. The original decode(bytes) contract is untouched.
     */
    fun decodeForFloatingMap(bytes: ByteArray, limits: NativeMvtDecodeLimits = NativeMvtDecodeLimits()): NativeMvtDecodeResult {
        require(bytes.size <= minOf(limits.maxBytes, 4 * 1024 * 1024)) { "MVT payload size invalid" }
        require(limits.maxBytes > 0 && limits.maxDictionaryEntries >= 0 && limits.maxProperties >= 0 &&
            limits.maxLabelFeatures >= 0 && limits.maxLabelVertices >= 0 && limits.maxPathsPerFeature > 0)
        require(limits.maxBytes <= 4 * 1024 * 1024 && limits.maxLayers <= 128 && limits.maxCandidatesPerPriority <= 4096 &&
            limits.maxFeatures <= 1200 && limits.maxVertices <= 24_000 && limits.maxPaths <= 4_800 &&
            limits.maxPathsPerFeature <= 512 && limits.maxGeometryCommandsPerFeature <= 16_384 &&
            limits.maxTagPairsPerFeature <= 128 && limits.maxDictionaryEntries <= 8_192 &&
            limits.maxProperties <= 8_192 && limits.maxLabelFeatures <= 48 && limits.maxLabelVertices <= 2_400 &&
            limits.maxStringBytes <= 256) { "Floating map decode budget cannot exceed its hard ceiling" }
        require(limits.maxLayers > 0 && limits.maxCandidatesPerPriority > 0 && limits.maxFeatures > 0 &&
            limits.maxVertices > 0 && limits.maxPaths > 0 && limits.maxGeometryCommandsPerFeature > 0 &&
            limits.maxTagPairsPerFeature > 0 && limits.maxStringBytes > 0)
        val counters = BoundedDecodeCounters(bytes.size)
        val tile = SpanReader(bytes, 0, bytes.size)
        val layerSpans = ArrayList<ByteSpan>(minOf(limits.maxLayers, 16))
        while (tile.hasNext()) {
            val field = tile.nextField()
            if (field == 3 && tile.wire == 2) {
                counters.scannedLayers++
                val span = tile.readSpan()
                if (layerSpans.size < limits.maxLayers) layerSpans += span else {
                    counters.skippedLayers++
                    countSkippedLayerFeatures(bytes, span, counters)
                }
            } else tile.skip(tile.wire)
        }

        val candidates = Array(5) { ArrayList<FloatingCandidate>() }
        val candidateScans = IntArray(5)
        var dictionaryEntriesLeft = limits.maxDictionaryEntries
        val headers = layerSpans.mapNotNull { span ->
            val header = readFloatingLayerHeader(bytes, span, limits.maxStringBytes, 0)
            header?.let { it to floatingLayerPriority(it.name) }
        }.sortedWith(compareBy<Pair<FloatingLayer, Int?>> {
            if (it.second == LABEL_BUCKET) -1 else it.second ?: Int.MAX_VALUE
        })
        for ((rawHeader, nullablePriority) in headers) {
            if (nullablePriority == null) { countSkippedLayerFeatures(bytes, rawHeader.span, counters); continue }
            val priority = nullablePriority
            val headerWithDictionary = readFloatingLayerHeader(bytes, rawHeader.span, limits.maxStringBytes, dictionaryEntriesLeft) ?: continue
            val admitted = minOf(headerWithDictionary.keys.size + headerWithDictionary.values.size, dictionaryEntriesLeft)
            dictionaryEntriesLeft -= admitted
            val header = headerWithDictionary
            if (admitted == 0) counters.dictionaryCapSkipped++
            scanFloatingLayer(bytes, header, priority, candidates, candidateScans, counters, limits)
        }

        val selected = ArrayList<FloatingCandidate>(limits.maxFeatures)
        var verticesUsed = 0
        var pathsUsed = 0
        var labelsUsed = 0
        var labelVerticesUsed = 0

        // The compact map has a separate label density budget in the View. Reserve a small
        // share here too, so dense road/building tiles cannot consume every decoded feature.
        for (candidate in candidates[LABEL_BUCKET]) {
            if (labelsUsed >= limits.maxLabelFeatures) { counters.skippedByLabelReserve++; continue }
            val geometry = candidate.geometry
            if (geometry.vertices > limits.maxLabelVertices - labelVerticesUsed ||
                geometry.vertices > limits.maxVertices - verticesUsed ||
                geometry.paths > limits.maxPaths - pathsUsed || selected.size >= limits.maxFeatures) {
                counters.skippedByLabelReserve++
                continue
            }
            selected += candidate
            labelsUsed++
            verticesUsed += geometry.vertices
            pathsUsed += geometry.paths
            labelVerticesUsed += geometry.vertices
        }

        for (priority in 0 until LABEL_BUCKET) {
            for (candidate in candidates[priority]) {
                val geometry = candidate.geometry
                if (selected.size >= limits.maxFeatures ||
                    geometry.vertices > limits.maxVertices - verticesUsed ||
                    geometry.paths > limits.maxPaths - pathsUsed) {
                    counters.skippedByBudget++
                    continue
                }
                selected += candidate
                verticesUsed += geometry.vertices
                pathsUsed += geometry.paths
            }
        }
        // Preserve the existing service's stable priority order for any non-label remainder.
        for (candidate in candidates[OTHER_BUCKET]) {
            if (candidate.isLabel) continue
            val geometry = candidate.geometry
            if (selected.size >= limits.maxFeatures ||
                geometry.vertices > limits.maxVertices - verticesUsed ||
                geometry.paths > limits.maxPaths - pathsUsed) {
                counters.skippedByBudget++
                continue
            }
            selected += candidate
            verticesUsed += geometry.vertices
            pathsUsed += geometry.paths
        }

        val built = ArrayList<NativeMvtFeature>(selected.size)
        var propertiesLeft = limits.maxProperties
        selected.forEach { candidate ->
            val feature = materializeFloatingFeature(bytes, candidate, limits, propertiesLeft, counters)
            propertiesLeft -= feature.second
            built += feature.first
        }
        counters.acceptedFeatures = built.size
        counters.acceptedPaths = pathsUsed
        counters.acceptedVertices = verticesUsed
        return NativeMvtDecodeResult(built, counters.freeze())
    }

    private const val ROAD_BUCKET = 0
    private const val WATER_BUCKET = 1
    private const val BUILDING_BUCKET = 2
    private const val OTHER_BUCKET = 3
    private const val LABEL_BUCKET = 4

    private data class ByteSpan(val start: Int, val end: Int) { val size get() = end - start }
    private data class FloatingLayer(val span: ByteSpan, val name: String, val extent: Int, val keys: List<ByteSpan>, val values: List<ByteSpan>)
    private data class GeometrySummary(val paths: Int, val vertices: Int, val commandCount: Int)
    private data class FloatingCandidate(
        val layer: FloatingLayer,
        val keySpans: List<ByteSpan>,
        val valueSpans: List<ByteSpan>,
        val featureSpan: ByteSpan,
        val type: Int,
        val tagSpan: ByteSpan,
        val geometrySpan: ByteSpan,
        val geometry: GeometrySummary,
        val priority: Int,
        val isLabel: Boolean,
    )

    private class BoundedDecodeCounters(val inputBytes: Int) {
        var scannedLayers = 0; var skippedLayers = 0; var scannedFeatures = 0; var irrelevantFeatures = 0
        var candidateCapSkipped = 0; var commandLimitSkipped = 0; var tagLimitSkipped = 0; var geometryLimitSkipped = 0; var dictionaryCapSkipped = 0
        var skippedByBudget = 0; var acceptedFeatures = 0; var acceptedPaths = 0; var acceptedVertices = 0
        var skippedByLabelReserve = 0; var propertyCapSkipped = 0
        fun freeze() = NativeMvtDecodeStats(inputBytes, scannedLayers, skippedLayers, scannedFeatures, irrelevantFeatures,
            candidateCapSkipped, commandLimitSkipped, tagLimitSkipped, geometryLimitSkipped, dictionaryCapSkipped, skippedByBudget, acceptedFeatures,
            acceptedPaths, acceptedVertices, skippedByLabelReserve, propertyCapSkipped)
    }

    /** Minimal bounded reader over a byte span; length-delimited fields are never copied. */
    private class SpanReader(private val bytes: ByteArray, start: Int, private val end: Int) {
        var position: Int = start
            private set
        var wire: Int = 0
            private set
        fun hasNext() = position < end
        fun nextField(): Int {
            val tag = varint().toInt()
            wire = tag and 7
            val field = tag ushr 3
            require(field > 0) { "Invalid protobuf field" }
            return field
        }
        fun varint(): Long {
            var value = 0L; var shift = 0
            while (position < end && shift < 64) {
                val byte = bytes[position++].toInt() and 255
                value = value or ((byte and 127).toLong() shl shift)
                if (byte < 128) return value
                shift += 7
            }
            throw IllegalArgumentException("Invalid protobuf varint")
        }
        fun readSpan(): ByteSpan {
            require(wire == 2) { "Invalid protobuf wire type" }
            val length = varint()
            require(length in 0..Int.MAX_VALUE.toLong())
            val fieldEnd = position + length.toInt()
            require(fieldEnd >= position && fieldEnd <= end) { "Invalid protobuf length" }
            return ByteSpan(position, fieldEnd).also { position = fieldEnd }
        }
        fun skip(fieldWire: Int) {
            when (fieldWire) {
                0 -> varint()
                1 -> { require(position + 8 <= end); position += 8 }
                2 -> readSpan()
                5 -> { require(position + 4 <= end); position += 4 }
                else -> throw IllegalArgumentException("Invalid protobuf wire type")
            }
        }
        fun slice(span: ByteSpan) = SpanReader(bytes, span.start, span.end)
    }

    private fun floatingLayerPriority(name: String): Int? {
        val layer = name.lowercase()
        return when {
            layer.contains("place") || layer.contains("label") || layer.contains("poi") -> LABEL_BUCKET
            layer.contains("transport") || layer.contains("road") -> ROAD_BUCKET
            layer.contains("water") -> WATER_BUCKET
            layer.contains("building") -> BUILDING_BUCKET
            else -> null
        }
    }

    private fun isFloatingLabel(name: String): Boolean {
        val layer = name.lowercase()
        return layer.contains("place") || layer.contains("label") || layer.contains("poi")
    }

    private fun readFloatingLayerHeader(bytes: ByteArray, span: ByteSpan, maxStringBytes: Int, maxDictionaryEntries: Int): FloatingLayer? {
        val reader = SpanReader(bytes, span.start, span.end)
        var name = ""; var extent = 4096
        val keys = ArrayList<ByteSpan>(minOf(16, maxDictionaryEntries)); val values = ArrayList<ByteSpan>(minOf(16, maxDictionaryEntries))
        while (reader.hasNext()) {
            val field = reader.nextField()
            when (field) {
                1 -> { val value = reader.readSpan(); name = readUtf8(bytes, value, maxStringBytes) }
                2 -> reader.skip(reader.wire)
                3 -> { val value = reader.readSpan(); if (keys.size + values.size < maxDictionaryEntries) keys += value }
                4 -> { val value = reader.readSpan(); if (keys.size + values.size < maxDictionaryEntries) values += value }
                5 -> { if (reader.wire == 0) extent = reader.varint().toInt().coerceIn(1, 1_000_000) else reader.skip(reader.wire) }
                else -> reader.skip(reader.wire)
            }
        }
        if (name.isBlank()) return null
        return FloatingLayer(span, name, extent, keys, values)
    }

    private fun scanFloatingLayer(
        bytes: ByteArray, layer: FloatingLayer, priority: Int,
        buckets: Array<ArrayList<FloatingCandidate>>, candidateScans: IntArray, counters: BoundedDecodeCounters,
        limits: NativeMvtDecodeLimits,
    ) {
        // Layer header spans exist without payload copies. Bound the number of entries that can
        // be referenced by selected feature candidates across the tile.
        val keys = layer.keys
        val values = layer.values
        val reader = SpanReader(bytes, layer.span.start, layer.span.end)
        val target = buckets[priority]
        val bucketLimit = limits.maxCandidatesPerPriority
        while (reader.hasNext()) {
            val field = reader.nextField()
            if (field != 2 || reader.wire != 2) { reader.skip(reader.wire); continue }
            val featureSpan = reader.readSpan(); counters.scannedFeatures++
            if (candidateScans[priority] >= bucketLimit) { counters.candidateCapSkipped++; continue }
            candidateScans[priority]++
            val candidate = scanFloatingFeature(bytes, featureSpan, layer, keys, values, priority, limits, counters)
            if (candidate == null) counters.irrelevantFeatures++ else target += candidate
        }
    }

    private fun countSkippedLayerFeatures(bytes: ByteArray, span: ByteSpan, counters: BoundedDecodeCounters) {
        val reader = SpanReader(bytes, span.start, span.end)
        while (reader.hasNext()) {
            val field = reader.nextField()
            if (field == 2 && reader.wire == 2) { reader.readSpan(); counters.scannedFeatures++; counters.irrelevantFeatures++ }
            else reader.skip(reader.wire)
        }
    }

    private fun scanFloatingFeature(
        bytes: ByteArray, span: ByteSpan, layer: FloatingLayer, keys: List<ByteSpan>, values: List<ByteSpan>,
        priority: Int, limits: NativeMvtDecodeLimits, counters: BoundedDecodeCounters,
    ): FloatingCandidate? {
        val reader = SpanReader(bytes, span.start, span.end)
        var type = 0; var tags: ByteSpan? = null; var geometry: ByteSpan? = null
        while (reader.hasNext()) {
            val field = reader.nextField()
            when {
                field == 2 && reader.wire == 2 -> tags = reader.readSpan()
                field == 3 && reader.wire == 0 -> type = reader.varint().toInt()
                field == 4 && reader.wire == 2 -> geometry = reader.readSpan()
                else -> reader.skip(reader.wire)
            }
        }
        val tagSpan = tags ?: ByteSpan(span.start, span.start)
        val geometrySpan = geometry ?: return null
        if (type !in 1..3) return null
        val tagReader = SpanReader(bytes, tagSpan.start, tagSpan.end)
        var pairs = 0
        while (tagReader.hasNext()) { tagReader.varint(); pairs++; if (pairs > limits.maxTagPairsPerFeature * 2) { counters.tagLimitSkipped++; return null } }
        if (pairs % 2 != 0) { counters.geometryLimitSkipped++; return null }
        val summary = summarizeGeometry(bytes, geometrySpan, type, limits, counters) ?: return null
        if (summary.vertices <= 0 || summary.paths <= 0 || summary.paths > limits.maxPathsPerFeature) { counters.geometryLimitSkipped++; return null }
        return FloatingCandidate(layer, keys, values, span, type, tagSpan, geometrySpan, summary, priority, priority == LABEL_BUCKET)
    }

    /** Count geometry without allocating coordinate pairs; reject whole features on any limit. */
    private fun summarizeGeometry(bytes: ByteArray, span: ByteSpan, type: Int, limits: NativeMvtDecodeLimits, counters: BoundedDecodeCounters): GeometrySummary? {
        val reader = SpanReader(bytes, span.start, span.end)
        var x = 0L; var y = 0L; var firstX = 0L; var firstY = 0L
        var commandCount = 0; var pending = 0; var command = 0
        var vertices = 0; var paths = 0; var pathVertices = 0
        fun finishPath() { if (pathVertices > 0) { paths++; pathVertices = 0 } }
        while (reader.hasNext()) {
            if (pending == 0) {
                val rawPacked = reader.varint()
                if (rawPacked !in 0..Int.MAX_VALUE.toLong()) { counters.geometryLimitSkipped++; return null }
                val packed = rawPacked.toInt()
                command = packed and 7; pending = packed ushr 3
                commandCount += pending
                if (commandCount > limits.maxGeometryCommandsPerFeature) { counters.commandLimitSkipped++; return null }
                if (pending <= 0) { counters.geometryLimitSkipped++; return null }
                when (command) {
                    1, 2 -> Unit
                    7 -> {
                        if (type == 3 && pathVertices >= 3 && (x != firstX || y != firstY)) { vertices++; pathVertices++ }
                        if (vertices > limits.maxVertices) { counters.geometryLimitSkipped++; return null }
                        finishPath(); pending = 0; continue
                    }
                    else -> { counters.geometryLimitSkipped++; return null }
                }
                if (command == 1 && pathVertices > 0) finishPath()
            }
            if (command == 1 || command == 2) {
                val dx = reader.varint(); val dy = reader.varint()
                if (dx !in 0..0xFFFF_FFFFL || dy !in 0..0xFFFF_FFFFL) { counters.geometryLimitSkipped++; return null }
                x += zig(dx.toInt()).toLong(); y += zig(dy.toInt()).toLong()
                if (command == 1 && pathVertices == 0) { firstX = x; firstY = y }
                vertices++; pathVertices++; pending--
                if (vertices > limits.maxVertices) { counters.geometryLimitSkipped++; return null }
            }
        }
        if (pathVertices > 0) finishPath()
        if (paths > limits.maxPaths) { counters.geometryLimitSkipped++; return null }
        return GeometrySummary(paths, vertices, commandCount)
    }

    private fun materializeFloatingFeature(
        bytes: ByteArray, candidate: FloatingCandidate, limits: NativeMvtDecodeLimits,
        propertiesLeft: Int, counters: BoundedDecodeCounters,
    ): Pair<NativeMvtFeature, Int> {
        val tagReader = SpanReader(bytes, candidate.tagSpan.start, candidate.tagSpan.end)
        val props = LinkedHashMap<String, String>(); var count = 0
        while (tagReader.hasNext()) {
            val keyIndex = tagReader.varint().toInt(); if (!tagReader.hasNext()) break
            val valueIndex = tagReader.varint().toInt()
            if (keyIndex !in candidate.keySpans.indices || valueIndex !in candidate.valueSpans.indices) continue
            if (count >= propertiesLeft) { counters.propertyCapSkipped++; continue }
            val key = readUtf8(bytes, candidate.keySpans[keyIndex], limits.maxStringBytes)
            val value = decodeValueBounded(bytes, candidate.valueSpans[valueIndex], limits.maxStringBytes)
            if (key.isNotEmpty() && value.isNotEmpty() && key !in props) { props[key] = value; count++ }
        }
        val paths = ArrayList<List<Pair<Int, Int>>>(candidate.geometry.paths)
        val reader = SpanReader(bytes, candidate.geometrySpan.start, candidate.geometrySpan.end)
        var x = 0L; var y = 0L; var command = 0; var pending = 0; var path = ArrayList<Pair<Int, Int>>()
        fun finish(close: Boolean = false) {
            if (path.isNotEmpty()) {
                if (close && path.size >= 3 && path.first() != path.last()) path += path.first()
                paths += path; path = ArrayList()
            }
        }
        while (reader.hasNext()) {
            if (pending == 0) {
                val packed = reader.varint().toInt(); command = packed and 7; pending = packed ushr 3
                if (command == 7) { finish(candidate.type == 3); pending = 0; continue }
                if (command == 1 && path.isNotEmpty()) finish()
            }
            if (command == 1 || command == 2) {
                x += zig(reader.varint().toInt()).toLong(); y += zig(reader.varint().toInt()).toLong()
                path += x.coerceIn(-candidate.layer.extent.toLong(), 2L * candidate.layer.extent).toInt() to
                    y.coerceIn(-candidate.layer.extent.toLong(), 2L * candidate.layer.extent).toInt()
                pending--
            }
        }
        finish()
        return NativeMvtFeature(candidate.layer.name, candidate.type, candidate.layer.extent, props, paths) to count
    }

    private fun readUtf8(bytes: ByteArray, span: ByteSpan, maxBytes: Int): String {
        if (span.size > maxBytes) return ""
        return bytes.copyOfRange(span.start, span.end).toString(Charsets.UTF_8)
    }

    private fun decodeValueBounded(bytes: ByteArray, span: ByteSpan, maxBytes: Int): String {
        val r = SpanReader(bytes, span.start, span.end)
        while (r.hasNext()) {
            val field = r.nextField()
            when (field) {
                1 -> if (r.wire == 2) return readUtf8(bytes, r.readSpan(), maxBytes) else r.skip(r.wire)
                in 2..7 -> return when (r.wire) {
                    0 -> r.varint().toString()
                    1, 5 -> { r.skip(r.wire); "" }
                    2 -> readUtf8(bytes, r.readSpan(), maxBytes)
                    else -> { r.skip(r.wire); "" }
                }
                else -> r.skip(r.wire)
            }
        }
        return ""
    }
    private fun layer(data:ByteArray):List<NativeMvtFeature> {
        val p=Pb(data); var name="";var extent=4096;val features=mutableListOf<ByteArray>();val keys=mutableListOf<String>();val values=mutableListOf<String>()
        while(p.more()) { val(f,w)=p.tag(); when(f){1->name=p.string(w);2->features+=p.blob(w);3->keys+=p.string(w);4->values+=decodeValue(p.blob(w));5->extent=p.varint(w).toInt().coerceAtLeast(1);else->p.skip(w)} }
        return features.mapNotNull { feature(it,name,extent,keys,values) }
    }
    private fun decodeValue(data:ByteArray):String { val p=Pb(data);while(p.more()){val(f,w)=p.tag();if(f==1&&w==2)return p.string(w);if(f in 2..7)return when(w){0->p.varint(w).toString();1->p.fixed64(w).toString();2->p.string(w);5->p.fixed32(w).toString();else->{p.skip(w);""}} else p.skip(w)};return "" }
    private fun feature(data:ByteArray,layer:String,extent:Int,keys:List<String>,values:List<String>):NativeMvtFeature? {
        val p=Pb(data);var type=0;var tags=byteArrayOf();var geom=byteArrayOf()
        while(p.more()){val(f,w)=p.tag();when(f){2->tags=p.blob(w);3->type=p.varint(w).toInt();4->geom=p.blob(w);else->p.skip(w)}}
        if(type !in 1..3||geom.isEmpty())return null
        val tp=Pb(tags);val tagInts=mutableListOf<Int>();while(tp.more())tagInts+=tp.varint(0).toInt()
        val props=tagInts.chunked(2).mapNotNull { pair -> if(pair.size==2&&pair[0] in keys.indices&&pair[1] in values.indices)keys[pair[0]] to values[pair[1]] else null }.toMap()
        val gp=Pb(geom);var x=0;var y=0;var command=0;var left=0;var path=mutableListOf<Pair<Int,Int>>();val paths=mutableListOf<List<Pair<Int,Int>>>()
        while(gp.more()) { if(left==0){val c=gp.varint(0).toInt();command=c and 7;left=c shr 3;if(command==7){if(path.isNotEmpty()){if(path.size>=3&&path.first()!=path.last())path+=path.first();paths+=path};path=mutableListOf();left=0;continue};if(command !in setOf(1,2)||left>100000)return null;if(command==1&&path.isNotEmpty()){paths+=path;path=mutableListOf()}}
            if(command==1||command==2){x+=zig(gp.varint(0).toInt());y+=zig(gp.varint(0).toInt());path+=x to y;left--}
        }
        if(path.isNotEmpty())paths+=path
        return NativeMvtFeature(layer,type,extent,props,paths.map { it.map { (px,py)->px.coerceIn(-extent,2*extent) to py.coerceIn(-extent,2*extent) } })
    }
    private fun zig(v:Int)=(v ushr 1) xor -(v and 1)
    private class Pb(private val b:ByteArray){var i=0;fun more()=i<b.size;fun tag():Pair<Int,Int>{val t=varint(0);return (t shr 3).toInt() to (t and 7).toInt()};fun varint(w:Int):Long{var v=0L;var s=0;while(i<b.size&&s<64){val c=b[i++].toInt() and 255;v=v or ((c and 127).toLong() shl s);if(c<128)return v;s+=7};throw IllegalArgumentException("Invalid protobuf varint")};fun blob(w:Int):ByteArray{require(w==2);val n=varint(0).toInt();require(n>=0&&i+n<=b.size);return b.copyOfRange(i,i+n).also{i+=n}};fun string(w:Int)=blob(w).toString(Charsets.UTF_8);fun fixed64(w:Int):Long{require(w==1&&i+8<=b.size);var x=0L;repeat(8){x=x or ((b[i++].toLong() and 255) shl (8*it))};return x};fun fixed32(w:Int):Int{require(w==5&&i+4<=b.size);var x=0;repeat(4){x=x or ((b[i++].toInt() and 255) shl (8*it))};return x};fun skip(w:Int){when(w){0->varint(0);1->{require(i+8<=b.size);i+=8};2->{val n=varint(0).toInt();require(n>=0&&i+n<=b.size);i+=n};5->{require(i+4<=b.size);i+=4};else->throw IllegalArgumentException("Invalid protobuf wire type")}}}
}

fun geologyUnit(properties:Map<String,String>):NativeGeologyUnit {
    fun get(k:String,d:String="")=properties[k]?.trim().orEmpty().ifBlank{d}
    val color=get("color","#a8b5be").takeIf{Regex("#[0-9a-fA-F]{6}").matches(it)}?:"#a8b5be"
    val name=get("name","未命名地质单元");val age=get("age","年代未标注");val lith=get("lith","岩性未标注")
    val source=get("ref_name",get("ref_source","Macrostrat 原始图源 ${get("source_id","未标注")}"))+get("ref_year").takeIf{it.isNotBlank()}?.let{" · $it"}.orEmpty()
    return NativeGeologyUnit("$color:$name:$age",name,age,lith,color,get("descrip"),source,get("ref_url").takeIf{it.startsWith("https://")||it.startsWith("http://")})
}

data class NativeGeologyCredentials(val token:String,val service:String,val layer:String="")
fun interface NativeGeologyCredentialProvider { fun get():NativeGeologyCredentials? }
data class NativeGeologyMatrix(val id:String,val resolution:Double,val originX:Double,val originY:Double,val tileWidth:Int,val tileHeight:Int,val matrixWidth:Int,val matrixHeight:Int,val minCol:Int=0,val maxCol:Int=matrixWidth-1,val minRow:Int=0,val maxRow:Int=matrixHeight-1)
data class CloudMetadata(val title:String,val attribution:String,val projection:String,val layer:String,val style:String,val format:String,val matrixSet:String,val matrices:List<NativeGeologyMatrix>,val hasLegend:Boolean,val legendUrl:String?)

/** Direct CGS WMTS client. Credentials are injected by the host's private preference provider and are never logged. */
class NativeGeologyCloudClient(private val credentials:NativeGeologyCredentialProvider):AutoCloseable {
    private val executor=Executors.newCachedThreadPool()
    private val activeConnections=ConcurrentHashMap.newKeySet<HttpURLConnection>()
    private val gateway="https://geocloud.cgs.gov.cn/igss/igs/rest/ogc/"
    @Volatile private var cached:CloudMetadata?=null
    suspend fun capabilities():CloudMetadata {
        val cfg=credentials.get()?:throw NativeGeologyAuthorizationException()
        require(cfg.token.isNotBlank()&&cfg.service.matches(Regex("[a-zA-Z0-9_-]{1,120}"))) { "地质云服务配置缺失" }
        cached?.let{return it}
        val xml=fetch(url(cfg,mapOf("REQUEST" to "GetCapabilities"))).toString(Charsets.UTF_8)
        return parseGeocloudCapabilities(xml,cfg.layer).also{cached=it}
    }
    suspend fun tile(metadata:CloudMetadata,matrix:String,col:Int,row:Int):ByteArray {
        val cfg=credentials.get()?:throw NativeGeologyAuthorizationException()
        val m=metadata.matrices.firstOrNull{it.id==matrix}?:error("WMTS矩阵不存在")
        require(col in m.minCol..m.maxCol&&row in m.minRow..m.maxRow)
        return fetch(url(cfg,mapOf("REQUEST" to "GetTile","LAYER" to metadata.layer,"STYLE" to metadata.style,"FORMAT" to metadata.format,"TILEMATRIXSET" to metadata.matrixSet,"TILEMATRIX" to matrix,"TILECOL" to col.toString(),"TILEROW" to row.toString())))
    }
    suspend fun legend(metadata:CloudMetadata):ByteArray? {
        val href=metadata.legendUrl?:return null;val cfg=credentials.get()?:throw NativeGeologyAuthorizationException()
        val u=URL(href);require(u.protocol=="https"&&u.host in setOf("geocloud.cgs.gov.cn","igss.cgs.gov.cn")&&u.port in setOf(-1,443,6160))
        val query=u.query.orEmpty().split('&').filter{it.isNotBlank()&&!it.startsWith("tk=")}.joinToString("&")
        return fetch(URL("${u.protocol}://${u.authority}${u.path}?${query}${if(query.isEmpty())"" else "&"}tk=${enc(cfg.token)}"),allowNotFound=true).takeIf{it.isNotEmpty()}
    }
    private fun url(cfg:NativeGeologyCredentials,params:Map<String,String>):URL {
        val q=(params+mapOf("tk" to cfg.token)).entries.joinToString("&"){enc(it.key)+"="+enc(it.value)}
        return URL("$gateway${enc(cfg.service)}/WMTSServer?$q")
    }
    private suspend fun fetch(url:URL,allowNotFound:Boolean=false):ByteArray {
        if (NativeOfflineDisplayPolicy.snapshot().enabled) {
            return NativeOfflineDisplayPolicy.readSelectedCache(url.toString())
                ?: throw IllegalStateException("当前缓存包不含该地质图资源，离线模式不会联网补取")
        }
        return suspendCancellableCoroutine { c ->
        val connection=AtomicReference<HttpURLConnection?>();val future=AtomicReference<Future<*>?>()
        val task=executor.submit {
            try {
                val conn=url.openConnection() as HttpURLConnection
                connection.set(conn)
                if(!c.isActive||Thread.currentThread().isInterrupted){conn.disconnect();throw CancellationException("request cancelled")}
                activeConnections+=conn
                conn.instanceFollowRedirects=false;conn.connectTimeout=15000;conn.readTimeout=15000
                conn.setRequestProperty("Accept", "application/xml,image/png,image/jpeg,*/*;q=0.5")
                val status=conn.responseCode
                if(status==401||status==403)throw NativeGeologyAuthorizationException()
                if(allowNotFound&&status==404){if(c.isActive)c.resume(byteArrayOf());return@submit}
                if(status !in 200..299)throw IllegalStateException("地质云WMTS服务读取失败")
                checkDeclaredLength(conn.getHeaderFieldLong("Content-Length",-1L),MAX_CLOUD_RESPONSE_BYTES,"地质云WMTS响应超过限制")
                val bytes=conn.inputStream.use{boundedHttpRead(it, MAX_CLOUD_RESPONSE_BYTES,"地质云WMTS响应超过限制")}
                if(bytes.take(1024).toByteArray().toString(Charsets.UTF_8).let{Regex("Token失效|token.{0,30}(invalid|expired)|请重新登录|未授权|没有权限",RegexOption.IGNORE_CASE).containsMatchIn(it)})throw NativeGeologyAuthorizationException()
                if(c.isActive)c.resume(bytes)
            }catch(e:NativeGeologyAuthorizationException){if(c.isActive)c.resumeWithException(e)}
            catch(e:CancellationException){if(c.isActive)c.resumeWithException(e)}
            catch(_:Exception){if(c.isActive)c.resumeWithException(IllegalStateException("地质云WMTS服务读取失败"))}
            finally{connection.get()?.let{activeConnections.remove(it);it.disconnect()}}
        }
        future.set(task);if(!c.isActive)task.cancel(true)
        c.invokeOnCancellation { connection.get()?.disconnect();future.get()?.cancel(true) }
        }
    }
    private fun enc(s:String)=URLEncoder.encode(s,"UTF-8")
    fun cancelRequests(){activeConnections.toList().forEach{it.disconnect()}}
    override fun close(){cancelRequests();executor.shutdownNow();cached=null}

    private companion object { const val MAX_CLOUD_RESPONSE_BYTES=4*1024*1024 }
}

/** Validates service identity, projections and matrix limits instead of inferring a tile grid. */
internal fun parseGeocloudCapabilities(xml:String,layerOverride:String=""):CloudMetadata {
    require(xml.length<=4*1024*1024&&!Regex("<!DOCTYPE|<!ENTITY",RegexOption.IGNORE_CASE).containsMatchIn(xml))
    val f=DocumentBuilderFactory.newInstance().apply{isNamespaceAware=true;setFeature("http://apache.org/xml/features/disallow-doctype-decl",true);setFeature("http://xml.org/sax/features/external-general-entities",false);setFeature("http://xml.org/sax/features/external-parameter-entities",false)}
    val doc=f.newDocumentBuilder().parse(xml.byteInputStream())
    fun Element.children(name:String)=(0 until childNodes.length).mapNotNull{childNodes.item(it) as? Element}.filter{it.localName==name||it.tagName.substringAfter(':')==name}
    fun Element.child(name:String)=children(name).firstOrNull()
    fun Element.value(name:String)=child(name)?.textContent?.trim().orEmpty()
    val root=doc.documentElement;val contents=root.child("Contents")?:error("WMTS capabilities incomplete");val layerNodes=contents.children("Layer")
    val layers=layerNodes.map{e->e to e.value("Identifier")};val chosen=layers.firstOrNull{it.second==layerOverride&&layerOverride.isNotBlank()}?.first?:layers.firstOrNull{(e,_)->val title=e.value("Title");Regex("1\\s*[:：∶/]\\s*200\\s*,?\\s*000|1\\s*[:：∶/]\\s*20\\s*万").containsMatchIn(title)&&title.contains("地质")&&!Regex("地球化学|水文").containsMatchIn(title)}?.first?:if(layers.size==1)layers.single().first else error("没有可验证的1∶20万地质图层")
    val title=chosen.value("Title");require(Regex("1\\s*[:：∶/]\\s*200\\s*,?\\s*000|1\\s*[:：∶/]\\s*20\\s*万").containsMatchIn(title)) { "服务元数据未确认1∶20万地质图" }
    val formats=chosen.children("Format").map{it.textContent.trim()};val format=formats.firstOrNull{it=="image/png"}?:formats.firstOrNull{it=="image/jpeg"}?:error("WMTS不支持PNG/JPEG")
    val link=chosen.children("TileMatrixSetLink").mapNotNull{it.child("TileMatrixSet")?.textContent?.trim()}.toSet();val sets=contents.children("TileMatrixSet").filter{it.value("Identifier") in link}
    val set=sets.firstOrNull{it.value("SupportedCRS").matches(Regex(".*(?:3857|900913)(?:\\D*$)"))}?:sets.firstOrNull{it.value("SupportedCRS").matches(Regex(".*(?:4326|4490|CRS84)(?:\\D*$)",RegexOption.IGNORE_CASE))}?:error("不支持该WMTS坐标系")
    val crs=set.value("SupportedCRS");val projection=if(Regex("3857|900913").containsMatchIn(crs))"mercator" else "geographic";val setId=set.value("Identifier")
    val limits=chosen.children("TileMatrixSetLink").firstOrNull{it.value("TileMatrixSet")==setId}?.child("TileMatrixSetLimits")?.children("TileMatrixLimits").orEmpty().associateBy{it.value("TileMatrix")}
    val matrices=set.children("TileMatrix").map{m->val origin=m.value("TopLeftCorner").split(Regex("\\s+")).mapNotNull{it.toDoubleOrNull()};require(origin.size==2);val lonFirst=projection=="mercator"||crs.contains("CRS84",true)||abs(origin[0])>90;val oX=if(lonFirst)origin[0] else origin[1];val oY=if(lonFirst)origin[1] else origin[0];val resolution=(m.value("ScaleDenominator").toDoubleOrNull()?:error("矩阵分辨率无效"))*0.00028/(if(projection=="geographic")111319.49079327358 else 1.0);val width=m.value("MatrixWidth").toInt();val height=m.value("MatrixHeight").toInt();val tw=m.value("TileWidth").toInt();val th=m.value("TileHeight").toInt();require(resolution>0&&width in 1..65536&&height in 1..65536&&tw in 1..1024&&th in 1..1024);val l=limits[m.value("Identifier")];NativeGeologyMatrix(m.value("Identifier"),resolution,oX,oY,tw,th,width,height,l?.value("MinTileCol")?.toIntOrNull()?:0,l?.value("MaxTileCol")?.toIntOrNull()?:width-1,l?.value("MinTileRow")?.toIntOrNull()?:0,l?.value("MaxTileRow")?.toIntOrNull()?:height-1)}
    require(matrices.isNotEmpty()&&matrices.size<=32)
    val style=chosen.children("Style").firstOrNull{it.getAttribute("isDefault")=="true"}?:chosen.child("Style");val legend=style?.child("LegendURL")?.child("OnlineResource")?.let{it.getAttributeNS("http://www.w3.org/1999/xlink","href").ifBlank{it.getAttribute("href")}}?.takeIf{it.isNotBlank()}
    val attribution="中国地质调查局 · 地质云（1∶20万授权WMTS）"
    return CloudMetadata(title,attribution,projection,chosen.value("Identifier"),style?.value("Identifier")?.ifBlank{"default"}?:"default",format,setId,matrices,legend!=null,legend)
}

/** Self-updating geology overlay. Host adds both returned layers to WorldWindow.engine.layers. */
class NativeGeologyLayer(private val window:WorldWindow,private val onState:(NativeGeologyState)->Unit,private val cloud:NativeGeologyCloudClient?=null):AutoCloseable {
    val renderLayer=RenderableLayer("Geology vectors")
    val cloudRenderLayer=RenderableLayer("Geology cloud WMTS")
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
    private val callbackOwner=NativeCallbackOwner(this)
    private val cached=linkedMapOf<String,List<Renderable>>()
    private val featureUnits=linkedMapOf<String,NativeGeologyUnit>()
    private val requested=mutableSetOf<String>()
    private var state=NativeGeologyState()
    private var enabled=false
    private var source=NativeGeologySource.WORLD
    private var opacity=.85
    private var cloudMetadata:CloudMetadata?=null
    private var poll=0
    private var closed=false
    private val viewportTick=object:Runnable{override fun run(){if(closed)return;if(enabled){if(source==NativeGeologySource.WORLD)requestVisibleWorldTiles() else requestCloudMetadata()};main.postDelayed(this,750)}}
    private val main=android.os.Handler(android.os.Looper.getMainLooper())
    init { renderLayer.isEnabled=false;cloudRenderLayer.isEnabled=false;main.post(viewportTick) }
    fun setEnabled(value:Boolean){enabled=value;renderLayer.isEnabled=value&&source==NativeGeologySource.WORLD;cloudRenderLayer.isEnabled=value&&source==NativeGeologySource.GEO_CLOUD_200K;if(!enabled){poll++;scope.coroutineContext.cancelChildren();cloud?.cancelRequests();requested.clear();cached.clear();featureUnits.clear();renderLayer.clearRenderables();cloudRenderLayer.clearRenderables();cloudMetadata=null;publish(state.copy(status=NativeGeologyStatus.OFF,units=emptyList(),selected=null,legendImage=null))}else publish(state.copy(status=NativeGeologyStatus.LOADING,message="正在读取当前视口地质",opacity=opacity))}
    fun setSource(value:NativeGeologySource){if(source==value)return;source=value;renderLayer.isEnabled=enabled&&source==NativeGeologySource.WORLD;cloudRenderLayer.isEnabled=enabled&&source==NativeGeologySource.GEO_CLOUD_200K;poll++;scope.coroutineContext.cancelChildren();cloud?.cancelRequests();requested.clear();cached.clear();renderLayer.clearRenderables();cloudRenderLayer.clearRenderables();cloudMetadata=null;publish(NativeGeologyState(source,if(enabled)NativeGeologyStatus.LOADING else NativeGeologyStatus.OFF,opacity=opacity));if(enabled){if(value==NativeGeologySource.WORLD)requestVisibleWorldTiles()else requestCloudMetadata()}}
    fun setOpacity(value:Double){require(value.isFinite()&&value in 0.0..1.0);opacity=value;renderLayer.opacity=value.toFloat();cloudRenderLayer.opacity=value.toFloat();publish(state.copy(opacity=value));window.requestRedraw()}
    fun retry(){if(!enabled)return;poll++;scope.coroutineContext.cancelChildren();cloud?.cancelRequests();requested.clear();cloudMetadata=null;if(source==NativeGeologySource.WORLD)requestVisibleWorldTiles()else requestCloudMetadata()}
    /** Call with the exact WorldWind picked delegate; no bounds-based substitute. */
    fun selectFeature(delegate:String){publish(state.copy(selected=featureUnits[delegate.removePrefix("geology:")]))}
    private fun requestVisibleWorldTiles(){if(!enabled||source!=NativeGeologySource.WORLD||closed)return;val cam=window.engine.camera;val altitude=cam.position.altitude.coerceAtLeast(100.0);val fov=cam.fieldOfView.inDegrees.coerceIn(5.0,120.0);val width=window.engine.viewport.width.coerceAtLeast(1);val groundWidth=2*altitude*kotlin.math.tan(Math.toRadians(fov/2))*width.toDouble()/window.engine.viewport.height.coerceAtLeast(1);val z=kotlin.math.floor(kotlin.math.ln((40_075_016.0/groundWidth.coerceAtLeast(1.0))/256.0)/kotlin.math.ln(2.0)+4).toInt().coerceIn(0,5);val n=1 shl z;val lat=cam.position.latitude.inDegrees.coerceIn(-85.0,85.0);val lon=cam.position.longitude.inDegrees;val cx=(((lon+180)/360*n).toInt()).coerceIn(0,n-1);val sinLat=kotlin.math.sin(Math.toRadians(lat));val cy=((.5-kotlin.math.ln((1+sinLat)/(1-sinLat))/(4*PI))*n).toInt().coerceIn(0,n-1);val radius=if(z<2)0 else 1;val visible=buildSet{for(dy in -radius..radius)for(dx in -radius..radius){val xx=Math.floorMod(cx+dx,n);val yy=cy+dy;if(yy in 0 until n)add("$z/$xx/$yy")}};cached.keys.filter{it !in visible}.forEach{key->cached.remove(key)?.forEach(renderLayer::removeRenderable)};val retained=cached.values.flatten().mapNotNull{it.pickDelegate?.toString()?.removePrefix("geology:")}.toSet();featureUnits.keys.filter{it !in retained}.toList().forEach(featureUnits::remove);visible.filter{it !in cached&&it !in requested}.forEach{key->requested+=key;val parts=key.split('/').map(String::toInt);val generation=poll;scope.launch{try{val features=loadWorldTile(parts[0],parts[1],parts[2]);if(!enabled||source!=NativeGeologySource.WORLD||generation!=poll)return@launch;drawWorldTile(key,features,parts[0],parts[1],parts[2])}catch(_:CancellationException){}catch(_:Exception){if(enabled&&generation==poll)publish(state.copy(status=NativeGeologyStatus.ERROR,message="世界地质数据请求失败，点击重试"))}finally{requested.remove(key)}}}}
    private suspend fun loadWorldTile(z:Int,x:Int,y:Int):List<NativeMvtFeature>{val b=cancellableHttp(URL("https://tiles.macrostrat.org/carto/$z/$x/$y.mvt"));return NativeMvtDecoder.decode(b)}
    private fun requestCloudMetadata(){if(cloudMetadata!=null||!enabled||source!=NativeGeologySource.GEO_CLOUD_200K)return;val client=cloud?:run{publish(state.copy(status=NativeGeologyStatus.AUTHORIZATION,message="尚未配置地质云授权，请在设置中添加已获授权的服务凭据"));return};val generation=poll;scope.launch{try{val meta=client.capabilities();if(!enabled||generation!=poll)return@launch;cloudMetadata=meta;cloudRenderLayer.clearRenderables();val raster=buildCloudSurface(meta,client);cloudRenderLayer.addRenderable(raster);cloudRenderLayer.opacity=opacity.toFloat();window.requestRedraw();val legend=if(meta.hasLegend)client.legend(meta)else null;publish(state.copy(status=NativeGeologyStatus.LOADING,message="授权通过，等待当前视口原图瓦片",attribution=meta.attribution,legendImage=legend));}catch(_:CancellationException){}catch(e:NativeGeologyAuthorizationException){if(generation==poll)publish(state.copy(status=NativeGeologyStatus.AUTHORIZATION,message=e.message.orEmpty()))}catch(_:Exception){if(generation==poll)publish(state.copy(status=NativeGeologyStatus.ERROR,message="地质云WMTS服务读取失败，可重试"))}}}
    private fun buildCloudSurface(meta:CloudMetadata,client:NativeGeologyCloudClient):MercatorTiledSurfaceImage {
        val owner=callbackOwner
        val onLoaded:()->Unit={owner.get()?.onCloudRasterTileLoaded()}
        val factory=object:MercatorTileFactory {
            override val contentType="Geocloud WMTS ${meta.layer}"
            override fun getImageSource(x:Int,y:Int,z:Int):ImageSource=
                ImageSource.fromImageFactory(CloudRasterImageFactory(meta,client,x,y,z,onLoaded))
        }
        return MercatorTiledImageLayer.buildTiledSurfaceImage(factory,true,tileSize=256,maxZoom=16,minZoom=0)
    }
    private fun onCloudRasterTileLoaded() {
        val owner=callbackOwner
        main.post {
            owner.get()?.let { layer ->
                if(layer.enabled&&layer.source==NativeGeologySource.GEO_CLOUD_200K&&layer.state.status==NativeGeologyStatus.LOADING)
                    layer.publish(layer.state.copy(status=NativeGeologyStatus.READY,message="已加载地质云原图瓦片"))
            }
        }
    }
    private fun drawWorldTile(tileKey:String,fs:List<NativeMvtFeature>,z:Int,x:Int,y:Int){val items=mutableListOf<Renderable>();val unitKeys=mutableSetOf<String>();fs.filter{it.layer=="units"&&it.type==3}.forEach{feature->val unit=geologyUnit(feature.properties);unitKeys+=unit.key;featureUnits[unit.key]=unit;val paths=feature.paths.map{ring->ring.map{(px,py)->tilePosition(z,x,y,px,py,feature.extent)}};if(paths.isEmpty())return@forEach;val rgb=parseColor(unit.color);val attrs=ShapeAttributes().apply{isDepthTest=true;isDrawInterior=true;isDrawOutline=true;interiorColor=Color(rgb[0],rgb[1],rgb[2],(.85*opacity).toFloat());outlineColor=Color(.16f,.18f,.22f,.5f);outlineWidth=.65f};val outerRings=paths.filter{it.size>=4&&ringArea(it)<0};val holes=paths.filter{it.size>=4&&ringArea(it)>0};outerRings.forEach{outer->val polygon=Polygon(outer,attrs).apply{altitudeMode=AltitudeMode.CLAMP_TO_GROUND};holes.filter{pointInRing(it.first(),outer)}.forEach(polygon::addBoundary);polygon.pickDelegate="geology:${unit.key}";items+=polygon}}
        fs.filter{it.layer=="lines"&&it.type==2}.forEach{feature->val unit=geologyUnit(feature.properties);unitKeys+=unit.key;featureUnits[unit.key]=unit;feature.paths.forEach{line->if(line.size>=2){val color=if(feature.properties["type"].orEmpty().contains("fault",true))Color(.55f,.09f,.15f,1f) else Color(.14f,.24f,.44f,1f);val path=Path(line.map{(px,py)->tilePosition(z,x,y,px,py,feature.extent)},ShapeAttributes().apply{isDepthTest=true;isDrawInterior=false;isDrawOutline=true;outlineColor=color;outlineWidth=1.6f}).apply{altitudeMode=AltitudeMode.CLAMP_TO_GROUND;pickDelegate="geology:${unit.key}"};items+=path}}}
        cached[tileKey]=items;items.forEach(renderLayer::addRenderable);window.requestRedraw();val allUnits=(state.units+unitKeys.mapNotNull(featureUnits::get)).distinctBy{it.key};publish(state.copy(status=if(allUnits.isEmpty())NativeGeologyStatus.EMPTY else NativeGeologyStatus.READY,units=allUnits,attribution="Macrostrat · CC BY 4.0 · Chorlton / Geological Survey of Canada (2007), world overview, source coverage through zoom 5"))}
    private fun tilePosition(z:Int,x:Int,y:Int,px:Int,py:Int,extent:Int):Position{val n=2.0.pow(z);val lon=(x+px.toDouble()/extent)/n*360-180;val merc=PI*(1-2*(y+py.toDouble()/extent)/n);return Position(Math.toDegrees(atan(sinh(merc))).degrees,lon.degrees,0.0)}
    private fun ringArea(p:List<Position>):Double=p.indices.sumOf{i->val a=p[i];val b=p[(i+1)%p.size];a.longitude.inDegrees*b.latitude.inDegrees-b.longitude.inDegrees*a.latitude.inDegrees}
    private fun pointInRing(p:Position,ring:List<Position>):Boolean{var inside=false;var j=ring.lastIndex;for(i in ring.indices){val a=ring[i];val b=ring[j];if((a.latitude.inDegrees>p.latitude.inDegrees)!=(b.latitude.inDegrees>p.latitude.inDegrees)&&p.longitude.inDegrees<(b.longitude.inDegrees-a.longitude.inDegrees)*(p.latitude.inDegrees-a.latitude.inDegrees)/(b.latitude.inDegrees-a.latitude.inDegrees)+a.longitude.inDegrees)inside=!inside;j=i};return inside}
    private fun parseColor(s:String):FloatArray{val n=s.removePrefix("#").toLongOrNull(16)?:0xa8b5be;return floatArrayOf(((n shr 16)and 255)/255f,((n shr 8)and 255)/255f,(n and 255)/255f,1f)}
    private fun publish(s:NativeGeologyState){state=s;onState(s)}
    override fun close(){callbackOwner.detach();closed=true;main.removeCallbacks(viewportTick);poll++;enabled=false;scope.cancel();cloud?.close();renderLayer.clearRenderables();cloudRenderLayer.clearRenderables();cached.clear();requested.clear();featureUnits.clear()}
}

internal suspend fun cancellableHttp(url:URL):ByteArray {
    if (NativeOfflineDisplayPolicy.snapshot().enabled) {
        return NativeOfflineDisplayPolicy.readSelectedCache(url.toString())
            ?: throw IllegalStateException("当前缓存包不含该地图资源，离线模式不会联网补取")
    }
    return suspendCancellableCoroutine { cont->
    val connection=AtomicReference<HttpURLConnection?>();val executor=Executors.newSingleThreadExecutor();val future=AtomicReference<Future<*>?>()
    val task=executor.submit {
        try {
            val c=url.openConnection() as HttpURLConnection;connection.set(c);if(!cont.isActive||Thread.currentThread().isInterrupted){c.disconnect();throw CancellationException("request cancelled")};c.instanceFollowRedirects=false;c.connectTimeout=15000;c.readTimeout=15000
            c.setRequestProperty("Accept", "application/vnd.mapbox-vector-tile,application/x-protobuf,*/*;q=0.5")
            if(c.responseCode !in 200..299)throw IllegalStateException("地图矢量瓦片请求失败")
            val declared=c.getHeaderFieldLong("Content-Length",-1L)
            checkDeclaredLength(declared,MAX_MVT_RESPONSE_BYTES,"地图矢量瓦片超过大小限制")
            val bytes=c.inputStream.use{boundedHttpRead(it,MAX_MVT_RESPONSE_BYTES,"地图矢量瓦片超过大小限制")}
            if(cont.isActive)cont.resume(bytes)
        }catch(e:CancellationException){if(cont.isActive)cont.resumeWithException(e)}
        catch(_:Exception){if(cont.isActive)cont.resumeWithException(IllegalStateException("地图矢量瓦片读取失败"))}
        finally{connection.get()?.disconnect();executor.shutdown()}
    }
    future.set(task);if(!cont.isActive)task.cancel(true);cont.invokeOnCancellation{connection.get()?.disconnect();future.get()?.cancel(true);executor.shutdownNow()}
    }
}

internal const val MAX_MVT_RESPONSE_BYTES=4*1024*1024
internal fun checkDeclaredLength(length:Long,limit:Int,message:String) {
    require(length >= -1L && limit > 0)
    if(length>limit)throw IllegalStateException(message)
}
internal fun boundedHttpRead(input:java.io.InputStream,limit:Int,message:String):ByteArray {
    require(limit>0)
    val output=ByteArrayOutputStream(minOf(limit,32*1024));val buffer=ByteArray(8192);var total=0
    while(true){if(Thread.currentThread().isInterrupted)throw CancellationException("request cancelled");val count=input.read(buffer,0,minOf(buffer.size,limit-total+1));if(count<0)break;total+=count;if(total>limit)throw IllegalStateException(message);output.write(buffer,0,count)}
    return output.toByteArray()
}

private class CloudRasterImageFactory(private val metadata:CloudMetadata,private val service:NativeGeologyCloudClient,private val x:Int,private val y:Int,private val z:Int,private val onLoaded:()->Unit):ImageSource.NetworkBoundImageFactory {
    override suspend fun createCachedBitmap():Bitmap?=null
    override suspend fun createBitmap():Bitmap?=withContext(Dispatchers.IO){
        val half=20037508.342789244;val n=2.0.pow(z);val targetResolution=2*half/n/256
        val matrix=metadata.matrices.minByOrNull{abs(ln(it.resolution/targetResolution))}?:return@withContext null
        val coords=Array(256){py->Array(256){px->val east=((x+(px+.5)/256)/n-.5)*2*half;val north=(.5-(y+(py+.5)/256)/n)*2*half;val mx=if(metadata.projection=="geographic")(east/(2*half))*360 else east;val my=if(metadata.projection=="geographic")Math.toDegrees(atan(sinh(north/6_378_137.0))) else north;val col=floor((mx-matrix.originX)/matrix.resolution).toInt();val row=floor((matrix.originY-my)/matrix.resolution).toInt();intArrayOf(col,row)}}
        val keys=coords.flatMap{row->row.map{p->"${p[0]/matrix.tileWidth}/${p[1]/matrix.tileHeight}"}}.toSet().filter{key->val a=key.split('/').map(String::toInt);a[0] in matrix.minCol..matrix.maxCol&&a[1] in matrix.minRow..matrix.maxRow};if(keys.size>16)return@withContext null
        val tiles=coroutineScope{keys.map{key->async{val p=key.split('/').map(String::toInt);val bytes=service.tile(metadata,matrix.id,p[0],p[1]);val opts=BitmapFactory.Options().apply{inJustDecodeBounds=true};BitmapFactory.decodeByteArray(bytes,0,bytes.size,opts);require(opts.outWidth==matrix.tileWidth&&opts.outHeight==matrix.tileHeight&&opts.outWidth.toLong()*opts.outHeight<=1_048_576L){"WMTS tile dimensions unsupported"};key to (BitmapFactory.decodeByteArray(bytes,0,bytes.size)?:error("WMTS image decode failed"))}}.awaitAll().toMap()}
        try {val out=Bitmap.createBitmap(256,256,Bitmap.Config.ARGB_8888);for(py in 0..255)for(px in 0..255){val p=coords[py][px];val col=p[0];val row=p[1];val tc=Math.floorDiv(col,matrix.tileWidth);val tr=Math.floorDiv(row,matrix.tileHeight);val bm=tiles["$tc/$tr"];if(bm!=null){val sx=Math.floorMod(col,matrix.tileWidth).coerceIn(0,bm.width-1);val sy=Math.floorMod(row,matrix.tileHeight).coerceIn(0,bm.height-1);out.setPixel(px,py,bm.getPixel(sx,sy))}};onLoaded();out} finally {tiles.values.forEach{it.recycle()}}
    }
}
