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
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

@RunWith(RobolectricTestRunner::class)
@org.robolectric.annotation.Config(sdk = [28], manifest = org.robolectric.annotation.Config.NONE)
class NativeRouteFormatsTest {
    private lateinit var context: Context
    private lateinit var store: WorkspaceStore

    @Before fun setUp() {
        context = RuntimeEnvironment.getApplication()
        context.filesDir.resolve("workspace-v2.json").delete()
        context.filesDir.resolve("workspace-v2.json.bak").delete()
        store = WorkspaceStore(context)
    }

    @Test fun importsGpxSegmentsTimeAltitudeNamesPinsAndStyle() {
        val gpx = """<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1"><wpt lat="20" lon="10"><name>Camp &amp; ridge</name><desc>water</desc></wpt><trk><name>Morning walk</name><extensions><shantu:route-style xmlns:shantu="urn:shantu:route-style:1">{"style":{"color":"#123456","width":3}}</shantu:route-style></extensions><trkseg><trkpt lat="20" lon="10"><ele>123.5</ele><time>2024-01-02T03:04:05Z</time></trkpt><trkpt lat="21" lon="11"><ele>124</ele><time>2024-01-02T03:05:05Z</time></trkpt></trkseg><trkseg><trkpt lat="22" lon="12"/><trkpt lat="23" lon="13"/></trkseg></trk></gpx>"""
        val imported = NativeRouteFormats.importFile(ByteArrayInputStream(gpx.toByteArray()), "walk.gpx").data
        store.importRoutes(imported)
        val core = store.load().getJSONObject("core")
        val track = core.getJSONArray("tracks").getJSONObject(0)
        assertEquals("Morning walk", track.getString("name"))
        assertTrue(track.getString("id").isNotBlank())
        assertEquals("#123456", track.getJSONObject("style").getString("color"))
        assertEquals(2, track.getJSONArray("segments").length())
        assertEquals(2, track.getJSONArray("segments").getJSONArray(0).length())
        assertEquals(11.0, track.getJSONArray("segments").getJSONArray(0).getJSONArray(1).getDouble(0), 0.0)
        assertEquals(123.5, track.getJSONArray("samples").getJSONArray(0).getJSONObject(0).getDouble("altitude"), 0.0)
        assertEquals(1704164645000L, track.getJSONArray("samples").getJSONArray(0).getJSONObject(0).getLong("time"))
        val pin = core.getJSONArray("annotations").getJSONObject(0)
        assertEquals("Camp & ridge", pin.getString("name"))
        assertEquals("water", pin.getString("note"))
        assertEquals(10.0, pin.getJSONArray("coordinates").getDouble(0), 0.0)
    }

    @Test fun importsKmlMultiLineAndPointWithWarning() {
        val kml = """<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Ridge</name><MultiGeometry><LineString><coordinates>10,20,100 11,21,101</coordinates></LineString><LineString><coordinates>12,22 13,23</coordinates></LineString><Point><coordinates>14,24,5</coordinates></Point></MultiGeometry></Placemark></Document></kml>"""
        val result = NativeRouteFormats.importFile(ByteArrayInputStream(kml.toByteArray()), "ridge.kml")
        assertTrue(result.warnings.any { it.contains("KML 原生子集") })
        store.importRoutes(result.data)
        val core = store.load().getJSONObject("core")
        val track = core.getJSONArray("tracks").getJSONObject(0)
        assertEquals(2, track.getJSONArray("segments").length())
        assertEquals("Ridge", track.getString("name"))
        assertEquals(100.0, track.getJSONArray("samples").getJSONArray(0).getJSONObject(0).getDouble("altitude"), 0.0)
        assertEquals(14.0, core.getJSONArray("annotations").getJSONObject(0).getJSONArray("coordinates").getDouble(0), 0.0)
    }

    @Test fun importsKmlSharedLineStyleAndPlacemarkTimeMetadataAndRoundTripsIt() {
        val kml = """<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
            <Style id="trail"><LineStyle><color>ff332211</color><width>3</width></LineStyle></Style>
            <Placemark id="r"><name>Styled &amp; timed</name><styleUrl>#trail</styleUrl><TimeStamp><when>2024-01-02T03:04:05Z</when></TimeStamp>
              <LineString><coordinates>10,20,100 11,21,101</coordinates></LineString></Placemark>
        </Document></kml>"""
        store.importRoutes(NativeRouteFormats.importFile(ByteArrayInputStream(kml.toByteArray()), "trail.kml").data)
        val track = store.load().getJSONObject("core").getJSONArray("tracks").getJSONObject(0)
        assertEquals("Styled & timed", track.getString("name"))
        assertTrue(track.getString("id").isNotBlank())
        assertEquals("#112233", track.getJSONObject("style").getString("color"))
        assertEquals(3.0, track.getJSONObject("style").getDouble("width"), 0.0)
        assertEquals(1704164645000L, track.getJSONObject("kmlTime").getLong("when"))
        val geo = JSONObject(String(NativeRouteFormats.exportFile(NativeRouteFormats.Format.GEOJSON, store.load())))
        val round = NativeRouteFormats.importFile(ByteArrayInputStream(geo.toString().toByteArray()), "round.geojson").data
        assertEquals(track.getJSONObject("kmlTime").toString(), round.getJSONArray("tracks").getJSONObject(0).getJSONObject("kmlTime").toString())
    }

    @Test fun importsKmzAndOvKmlOnlyWithExplicitCoordinateChoice() {
        val kml = """<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Ridge</name><LineString><coordinates>116.404,39.915 116.405,39.916</coordinates></LineString></Placemark></Document></kml>"""
        val zipped = zip("doc.kml" to kml)
        val kmz = NativeRouteFormats.importFile(ByteArrayInputStream(zipped), "ridge.kmz")
        assertEquals("Ridge", kmz.data.getJSONArray("tracks").getJSONObject(0).getString("name"))
        val ov = runCatching { NativeRouteFormats.importFile(ByteArrayInputStream(kml.toByteArray()), "ridge.ovkml") }.exceptionOrNull()
        assertTrue(ov is IllegalArgumentException)
        val cgcs = NativeRouteFormats.importFile(ByteArrayInputStream(kml.toByteArray()), "ridge.ovkml",
            NativeRouteFormats.ImportOptions(NativeRouteFormats.CoordinateSystem.CGCS2000)).data
        assertEquals(116.404, cgcs.getJSONArray("tracks").getJSONObject(0).getJSONArray("segments").getJSONArray(0).getJSONArray(0).getDouble(0), 0.0)
        val gcj = NativeRouteFormats.importFile(ByteArrayInputStream(kml.toByteArray()), "ridge.ovkml",
            NativeRouteFormats.ImportOptions(NativeRouteFormats.CoordinateSystem.GCJ02)).data
        assertEquals(116.39775550083061, gcj.getJSONArray("tracks").getJSONObject(0).getJSONArray("segments").getJSONArray(0).getJSONArray(0).getDouble(0), 1e-9)
        assertTrue(NativeRouteFormats.importFile(ByteArrayInputStream(zip("routes/track.ovkml" to kml)), "ridge.ovkmz",
            NativeRouteFormats.ImportOptions(NativeRouteFormats.CoordinateSystem.CGCS2000)).warnings.any { it.contains("OVKML") })
    }

    @Test fun importsTcxMissingPositionAsSegmentBreakAndKeepsCoursePoint() {
        val tcx = """<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity><Id>2024-01-02T03:00:00Z</Id><Lap><Track>
          <Trackpoint><Time>2024-01-02T03:00:00Z</Time><Position><LatitudeDegrees>20</LatitudeDegrees><LongitudeDegrees>10</LongitudeDegrees></Position><AltitudeMeters>12</AltitudeMeters></Trackpoint>
          <Trackpoint><Time>2024-01-02T03:01:00Z</Time><Position><LatitudeDegrees>21</LatitudeDegrees><LongitudeDegrees>11</LongitudeDegrees></Position><AltitudeMeters>13</AltitudeMeters></Trackpoint>
          <Trackpoint><Time>2024-01-02T03:02:00Z</Time></Trackpoint>
          <Trackpoint><Time>2024-01-02T03:03:00Z</Time><Position><LatitudeDegrees>22</LatitudeDegrees><LongitudeDegrees>12</LongitudeDegrees></Position></Trackpoint>
          <Trackpoint><Time>2024-01-02T03:04:00Z</Time><Position><LatitudeDegrees>23</LatitudeDegrees><LongitudeDegrees>13</LongitudeDegrees></Position></Trackpoint>
        </Track></Lap><CoursePoint><Name>Camp</Name><Notes>water</Notes><Position><LatitudeDegrees>24</LatitudeDegrees><LongitudeDegrees>14</LongitudeDegrees></Position></CoursePoint></Activity></Activities></TrainingCenterDatabase>"""
        val result = NativeRouteFormats.importFile(ByteArrayInputStream(tcx.toByteArray()), "walk.tcx")
        store.importRoutes(result.data)
        val core = store.load().getJSONObject("core"); val track = core.getJSONArray("tracks").getJSONObject(0)
        assertEquals("2024-01-02T03:00:00Z", track.getString("name"))
        assertEquals(2, track.getJSONArray("segments").length())
        assertEquals(2, track.getJSONArray("segments").getJSONArray(0).length())
        assertEquals(1704164400000L, track.getJSONArray("samples").getJSONArray(0).getJSONObject(0).getLong("time"))
        assertEquals(12.0, track.getJSONArray("samples").getJSONArray(0).getJSONObject(0).getDouble("altitude"), 0.0)
        assertEquals("Camp", core.getJSONArray("annotations").getJSONObject(0).getString("name"))
        val exported = NativeRouteFormats.exportFile(NativeRouteFormats.Format.GPX, store.load())
        val reread = NativeRouteFormats.importFile(ByteArrayInputStream(exported), "reread.gpx").data
        assertEquals(2, reread.getJSONArray("tracks").getJSONObject(0).getJSONArray("segments").length())
    }

    @Test fun importsCsvAndTsvWithExplicitHeadersNamesTimeAltitudeAndSegments() {
        val csv = "name,longitude,latitude,elevation,time,segment,type\n\"Creek, North\",10,20,3,2024-01-02T03:04:05Z,A,track\n\"Creek, North\",11,21,4,2024-01-02T03:05:05Z,A,track\n\"Creek, North\",12,22,5,2024-01-02T03:06:05Z,B,track\n\"Creek, North\",13,23,6,2024-01-02T03:07:05Z,B,track\nCamp,14,24,,, ,point\n"
        val parsed = NativeRouteFormats.importFile(ByteArrayInputStream(csv.toByteArray()), "routes.csv")
        store.importRoutes(parsed.data)
        var core = store.load().getJSONObject("core"); var track = core.getJSONArray("tracks").getJSONObject(0)
        assertEquals("Creek, North", track.getString("name")); assertEquals(2, track.getJSONArray("segments").length())
        assertEquals(1704164645000L, track.getJSONArray("samples").getJSONArray(0).getJSONObject(0).getLong("time"))
        assertEquals("Camp", core.getJSONArray("annotations").getJSONObject(0).getString("name"))
        val tsv = "longitude\tlatitude\tname\n10\t20\tHill\n11\t21\tHill\n"
        val tab = NativeRouteFormats.importFile(ByteArrayInputStream(tsv.toByteArray()), "hill.tsv").data
        assertEquals("Hill", tab.getJSONArray("tracks").getJSONObject(0).getString("name"))
        val exported = NativeRouteFormats.exportFile(NativeRouteFormats.Format.GEOJSON, store.load())
        val reread = NativeRouteFormats.importFile(ByteArrayInputStream(exported), "reread.geojson").data
        assertEquals(1, reread.getJSONArray("tracks").length())
        assertEquals(2, reread.getJSONArray("tracks").getJSONObject(0).getJSONArray("segments").length())
    }

    @Test fun importsDjiWpmlWaypointSubsetFromKmzAndWarnsAboutFlightFields() {
        val wpml = """<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2"><Document><Folder><name>Survey</name>
          <Placemark><Point><coordinates>103.002,30,100</coordinates></Point><wpml:index>2</wpml:index><wpml:executeHeight>100</wpml:executeHeight></Placemark>
          <Placemark><Point><coordinates>103,30,90</coordinates></Point><wpml:index>0</wpml:index><wpml:executeHeight>90</wpml:executeHeight></Placemark>
          <Placemark><Point><coordinates>103.001,30,95</coordinates></Point><wpml:index>1</wpml:index><wpml:executeHeight>95</wpml:executeHeight></Placemark>
        </Folder></Document></kml>"""
        val result = NativeRouteFormats.importFile(ByteArrayInputStream(zip("wpmz/waylines.wpml" to wpml, "wpmz/template.kml" to "<kml/>")), "survey.kmz")
        assertTrue(result.warnings.any { it.contains("飞行高度") })
        store.importRoutes(result.data)
        val track = store.load().getJSONObject("core").getJSONArray("tracks").getJSONObject(0)
        assertEquals("Survey", track.getString("name")); assertEquals("DJI WPML", track.getString("importFormat"))
        assertEquals(103.0, track.getJSONArray("segments").getJSONArray(0).getJSONArray(0).getDouble(0), 0.0)
        assertNotNull(runCatching { NativeRouteFormats.importFile(ByteArrayInputStream(zip("wpmz/waylines.wpml" to wpml.replace("<wpml:index>1</wpml:index>", "<wpml:index>4</wpml:index>"))), "bad.kmz") }.exceptionOrNull())
    }

    @Test fun importsGeoJsonFeaturesAndExportsGpxAndGeoJson() {
        val source = """{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"name":"Pine"},"geometry":{"type":"Point","coordinates":[10,20]}},{"type":"Feature","properties":{"name":"Creek","style":{"color":"#aabbcc","width":4}},"geometry":{"type":"MultiLineString","coordinates":[[[10,20,3],[11,21,4]],[[12,22],[13,23]]]}}]}"""
        store.importRoutes(NativeRouteFormats.importFile(ByteArrayInputStream(source.toByteArray()), "data.geojson").data)
        val gpx = String(NativeRouteFormats.exportFile(NativeRouteFormats.Format.GPX, store.load()))
        val geo = JSONObject(String(NativeRouteFormats.exportFile(NativeRouteFormats.Format.GEOJSON, store.load())))
        assertTrue(gpx.contains("<name>Pine</name>"))
        assertTrue(gpx.contains("<name>Creek</name>"))
        assertTrue(gpx.contains("<ele>3.0</ele>"))
        val features = geo.getJSONArray("features")
        assertEquals(2, features.length())
        val line = (0 until features.length()).map { features.getJSONObject(it) }.first { it.getJSONObject("geometry").optString("type") == "MultiLineString" }
        assertEquals(2, line.getJSONObject("geometry").getJSONArray("coordinates").length())
        assertTrue(line.getJSONObject("properties").getString("id").isNotBlank())
        assertEquals("#aabbcc", line.getJSONObject("properties").getJSONObject("style").getString("color"))
    }

    @Test fun rejectsEntitiesOversizeAndUnsupportedGeometries() {
        val before = store.load().toString()
        val entity = "<!DOCTYPE gpx [<!ENTITY x SYSTEM \"file:///etc/passwd\">]><gpx>&x;</gpx>"
        assertNotNull(runCatching { NativeRouteFormats.importFile(ByteArrayInputStream(entity.toByteArray()), "bad.gpx") }.exceptionOrNull())
        assertNotNull(runCatching { NativeRouteFormats.importFile(ByteArrayInputStream(ByteArray(20 * 1024 * 1024 + 1)), "huge.gpx") }.exceptionOrNull())
        val polygon = """{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[]}}"""
        assertNotNull(runCatching { store.importRoutes(NativeRouteFormats.importFile(ByteArrayInputStream(polygon.toByteArray()), "area.geojson").data) }.exceptionOrNull())
        assertEquals(before, store.load().toString())
    }

    private fun zip(vararg entries: Pair<String, String>): ByteArray {
        val bytes = ByteArrayOutputStream()
        ZipOutputStream(bytes).use { zip -> entries.forEach { (name, content) -> zip.putNextEntry(ZipEntry(name)); zip.write(content.toByteArray()); zip.closeEntry() } }
        return bytes.toByteArray()
    }

    @Test fun failedRouteImportDoesNotPartiallyCommit() {
        val existing = JSONObject().put("id", "stable").put("name", "keep").put("createdAt", 1)
            .put("segments", JSONArray().put(JSONArray().put(JSONArray().put(10).put(20))))
        val core = JSONObject().put("format", "guanyun-backup").put("version", 1)
            .put("tracks", JSONArray().put(existing)).put("annotations", JSONArray()).put("favorites", JSONArray())
        val envelope = JSONObject().put("format", "shantu-workspace").put("version", 2).put("core", core)
            .put("photos", JSONArray()).put("settings", JSONObject()).put("mapSources", JSONArray()).put("cadDocuments", JSONArray())
        store.importWorkspace(ByteArrayInputStream(envelope.toString().toByteArray()))
        val before = store.load().toString()
        val invalid = JSONObject().put("format", "guanyun-backup").put("version", 1).put("tracks", JSONArray().put(existing)
            .put(JSONObject(existing.toString()).put("id", "bad").put("segments", JSONArray().put(JSONArray().put(JSONArray().put(999).put(999))))))
            .put("annotations", JSONArray()).put("favorites", JSONArray())
        assertNotNull(runCatching { store.importRoutes(invalid) }.exceptionOrNull())
        assertEquals(before, store.load().toString())
    }
}
