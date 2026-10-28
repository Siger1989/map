package com.shantu.nativeapp.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.util.zip.CRC32

@RunWith(RobolectricTestRunner::class)
@org.robolectric.annotation.Config(sdk = [28], manifest = org.robolectric.annotation.Config.NONE)
class NativeRemainingRouteFormatsTest {
    private lateinit var context: Context
    private lateinit var store: WorkspaceStore

    @Before fun setUp() {
        context = RuntimeEnvironment.getApplication()
        context.filesDir.resolve("workspace-v2.json").delete()
        context.filesDir.resolve("workspace-v2.json.bak").delete()
        store = WorkspaceStore(context)
    }

    @Test fun fitChecksCrcAndKeepsSegmentsTimesAltitudeAndCoursepoint() {
        val bytes = fitFixture()
        val imported = NativeRouteFormats.importFile(ByteArrayInputStream(bytes), "activity.fit")
        store.importRoutes(imported.data)
        val core = store.load().getJSONObject("core")
        val route = core.getJSONArray("tracks").getJSONObject(0)
        assertEquals("FIT activity", route.getString("name"))
        assertEquals("FIT", route.getString("importFormat"))
        assertEquals(2, route.getJSONArray("segments").length())
        assertEquals(103.0, route.getJSONArray("samples").getJSONArray(0).getJSONObject(0).getDouble("altitude"), 1e-6)
        assertEquals(Instant.parse("2026-01-01T00:00:00Z").toEpochMilli(), route.getJSONArray("samples").getJSONArray(0).getJSONObject(0).getLong("time"))
        assertEquals("Summit", core.getJSONArray("annotations").getJSONObject(0).getString("name"))
        val gpx = NativeRouteFormats.exportFile(NativeRouteFormats.Format.GPX, store.load())
        val round = NativeRouteFormats.importFile(ByteArrayInputStream(gpx), "fit-round.gpx").data
        assertEquals(2, round.getJSONArray("tracks").getJSONObject(0).getJSONArray("segments").length())
        assertEquals(Instant.parse("2026-01-01T00:00:00Z").toEpochMilli(), round.getJSONArray("tracks").getJSONObject(0).getJSONArray("samples").getJSONArray(0).getJSONObject(0).getLong("time"))
        val corrupt = bytes.copyOf().also { it[it.lastIndex - 2] = (it[it.lastIndex - 2].toInt() xor 1).toByte() }
        assertTrue(runCatching { NativeRouteFormats.importFile(ByteArrayInputStream(corrupt), "bad.fit") }.exceptionOrNull()?.message.orEmpty().contains("CRC"))
        assertNotNull(runCatching { NativeRouteFormats.importFile(ByteArrayInputStream(bytes.copyOf(bytes.size - 1)), "truncated.fit") }.exceptionOrNull())
    }

    @Test fun oviJsonPreservesCoordinateAltitudeNameNoteAndAreaThroughGeoJson() {
        val source = JSONObject().put("ObjItems", JSONArray()
            .put(JSONObject().put("Object", JSONObject().put("Type", 7).put("Name", "Camp").put("Comment", "water")
                .put("ObjectDetail", JSONObject().put("Gcj02", 1).put("Lat", 39.915).put("Lng", 116.404).put("Altitude", 0))))
            .put(JSONObject().put("Object", JSONObject().put("Type", 13).put("Name", "Lot").put("Comment", "survey")
                .put("ObjectDetail", JSONObject().put("Gcj02", 0).put("Latlng", JSONArray().put(20).put(10).put(20).put(11).put(21).put(11).put(20).put(10))))))
        val parsed = NativeRouteFormats.importFile(ByteArrayInputStream(source.toString().toByteArray()), "ovi.json")
        store.importRoutes(parsed.data)
        val core = store.load().getJSONObject("core")
        val pin = core.getJSONArray("annotations").getJSONObject(0)
        assertEquals("Camp", pin.getString("name")); assertEquals("water", pin.getString("note"))
        assertEquals(0.0, pin.getDouble("groundElevation"), 0.0)
        assertEquals(116.39775550083061, pin.getJSONArray("coordinates").getDouble(0), 1e-9)
        assertEquals(1, core.getJSONArray("areas").length())
        val geo = NativeRouteFormats.exportFile(NativeRouteFormats.Format.GEOJSON, store.load())
        val reread = NativeRouteFormats.importFile(ByteArrayInputStream(geo), "round.geojson").data
        assertEquals(1, reread.getJSONArray("areas").length())
        assertEquals("survey", reread.getJSONArray("areas").getJSONObject(0).getString("note"))
        assertNotNull(runCatching { NativeRouteFormats.exportFile(NativeRouteFormats.Format.GPX, store.load()) }.exceptionOrNull())
    }

    @Test fun ovobjV105ParsesKnownDeltaLineAndWarnsWhenDatumIsAuto() {
        val parsed = NativeRouteFormats.importFile(ByteArrayInputStream(ovobjLine()), "sample.ovobj")
        assertEquals(1, parsed.warnings.size)
        store.importRoutes(parsed.data)
        val line = store.load().getJSONObject("core").getJSONArray("tracks").getJSONObject(0)
        assertEquals("Ridge", line.getString("name"))
        assertEquals(2, line.getJSONArray("segments").getJSONArray(0).length())
        assertEquals(104.0101, line.getJSONArray("segments").getJSONArray(0).getJSONArray(1).getDouble(0), 1e-7)
        val geo = NativeRouteFormats.exportFile(NativeRouteFormats.Format.GEOJSON, store.load())
        val round = NativeRouteFormats.importFile(ByteArrayInputStream(geo), "ovobj-round.geojson").data
        assertEquals(104.0101, round.getJSONArray("tracks").getJSONObject(0).getJSONArray("segments").getJSONArray(0).getJSONArray(1).getDouble(0), 1e-7)
        val explicit = NativeRouteFormats.importFile(ByteArrayInputStream(ovobjLine()), "sample.ovobj",
            NativeRouteFormats.ImportOptions(NativeRouteFormats.CoordinateSystem.GCJ02))
        assertTrue(explicit.warnings.isEmpty())
    }

    @Test fun oviJsonAutoRejectsUnknownDatumAndDoesNotCommitPartialBatch() {
        val before = store.load().toString()
        val json = """{"ObjItems":[{"Object":{"Type":7,"Name":"p","ObjectDetail":{"Lat":20,"Lng":10}}}]}"""
        assertNotNull(runCatching { NativeRouteFormats.importFile(ByteArrayInputStream(json.toByteArray()), "bad.json") }.exceptionOrNull())
        assertEquals(before, store.load().toString())
    }

    private fun fitFixture(): ByteArray {
        val data = ByteArrayOutputStream()
        fun u8(v: Int) = data.write(v and 255)
        fun u16(v: Int) { u8(v); u8(v ushr 8) }
        fun u32(v: Long) { u8(v.toInt()); u8((v ushr 8).toInt()); u8((v ushr 16).toInt()); u8((v ushr 24).toInt()) }
        fun definition(local: Int, global: Int, vararg fields: Triple<Int, Int, Int>) {
            u8(0x40 or local); u8(0); u8(0); u16(global); u8(fields.size)
            fields.forEach { (number,size,base) -> u8(number); u8(size); u8(base) }
        }
        fun dataHeader(local: Int) = u8(local)
        fun i32(v: Int) = u32(v.toLong())
        val fitTime = Instant.parse("2026-01-01T00:00:00Z").epochSecond - 631065600L
        definition(0,0,Triple(0,1,0)); dataHeader(0); u8(4)
        val name = "FIT activity".toByteArray(); definition(1,31,Triple(5,name.size+1,7)); dataHeader(1); data.write(name); u8(0)
        definition(2,20,Triple(0,4,5),Triple(1,4,5),Triple(2,2,4),Triple(253,4,6))
        fun record(lat: Double, lon: Double, altitude: Double, seconds: Long) {
            dataHeader(2); i32((lat * 2147483648.0 / 180.0).toInt()); i32((lon * 2147483648.0 / 180.0).toInt()); u16(((altitude + 500) * 5).toInt()); u32(seconds)
        }
        record(30.0,103.0,103.0,fitTime)
        record(30.001,103.001,104.0,fitTime+1)
        definition(3,21,Triple(0,1,0),Triple(1,1,0)); dataHeader(3); u8(0); u8(1)
        record(30.01,103.01,105.0,fitTime+2)
        record(30.011,103.011,106.0,fitTime+3)
        definition(4,32,Triple(2,4,5),Triple(3,4,5),Triple(6,7,7))
        dataHeader(4); i32((30.2 * 2147483648.0 / 180.0).toInt()); i32((103.2 * 2147483648.0 / 180.0).toInt()); data.write("Summit".toByteArray()); u8(0)
        val payload = data.toByteArray()
        val out = ByteArrayOutputStream(); out.write(byteArrayOf(12,0x20,0,0)); out.write(byteArrayOf(payload.size.toByte(),(payload.size ushr 8).toByte(),(payload.size ushr 16).toByte(),(payload.size ushr 24).toByte())); out.write(".FIT".toByteArray()); out.write(payload)
        val covered=out.toByteArray(); val crc=fitCrc(covered)
        out.write(crc and 255); out.write(crc ushr 8)
        return out.toByteArray()
    }

    private fun ovobjLine(): ByteArray {
        val body = ByteArrayOutputStream()
        fun u8(v: Int) = body.write(v and 255)
        fun u32(v: Long) { repeat(4) { u8((v ushr (8*it)).toInt()) } }
        fun i64(v: Long) { repeat(8) { u8((v ushr (8*it)).toInt()) } }
        u32(103); repeat(96) { u8(0) }
        val title="Ridge".toByteArray(); u8(title.size); body.write(title); u8(0); u32(0); i64(2)
        i64(3000000000); i64(10401000000)
        // Two 1e-4 degree positive deltas encoded as equal 17-bit magnitudes.
        u8(0x10); u8(0x4e); u8(0x20); u8(0x27); u8(0x10)
        val payload=body.toByteArray()
        val frame=ByteArrayOutputStream(); repeat(16){frame.write(0)}; frame.write(byteArrayOf(payload.size.toByte(),(payload.size ushr 8).toByte(),0,0)); frame.write(byteArrayOf(8,0,0,0)); repeat(40){frame.write(0)}; frame.write(payload)
        val obj=frame.toByteArray(); val file=ByteArray(264+obj.size)
        "OviO".toByteArray().copyInto(file,0); putU32(file,12,105); putU64(file,24,file.size.toLong()); putU32(file,244,31); putU64(file,248,obj.size.toLong()); obj.copyInto(file,264)
        return file
    }

    private fun putU32(out: ByteArray, at: Int, value: Long) { repeat(4) { out[at+it]=(value ushr (8*it)).toByte() } }
    private fun putU64(out: ByteArray, at: Int, value: Long) { repeat(8) { out[at+it]=(value ushr (8*it)).toByte() } }
    private fun fitCrc(bytes: ByteArray): Int { var crc=0; for(b in bytes){var tmp=(b.toInt() and 255) xor (crc and 255);repeat(8){tmp=if(tmp and 1!=0)(tmp ushr 1) xor 0xa001 else tmp ushr 1};crc=(crc ushr 8) xor tmp};return crc and 0xffff }
}
