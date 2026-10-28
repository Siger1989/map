package com.shantu.nativeapp.cad

import android.content.Context
import com.shantu.nativeapp.data.WorkspaceStore
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import java.io.ByteArrayInputStream
import java.util.Base64

@RunWith(RobolectricTestRunner::class)
@org.robolectric.annotation.Config(sdk = [28], manifest = org.robolectric.annotation.Config.NONE)
class NativeDxfImporterTest {
    @Test fun decodesSupportedEntitiesLayersStylesAndPreservesSourceAndUnknownGroups() {
        val source = dxf(
            "TABLES" to listOf(
                record("TABLE", 2 to "LAYER", 70 to "1"),
                record("LAYER", 2 to "survey", 62 to "3", 6 to "CONTINUOUS"),
                record("ENDTAB"),
            ),
            "ENTITIES" to listOf(
                record("LINE", 5 to "A1", 8 to "survey", 10 to "104", 20 to "30", 30 to "12.5", 11 to "104.01", 21 to "30.01", 31 to "15", 999 to "keep-me"),
                record("POINT", 5 to "A2", 8 to "survey", 10 to "104.02", 20 to "30.02", 30 to "9"),
                record("LWPOLYLINE", 5 to "A3", 8 to "survey", 70 to "1", 10 to "104", 20 to "30", 10 to "104.01", 20 to "30", 10 to "104.01", 20 to "30.01"),
                record("ARC", 5 to "A4", 8 to "survey", 10 to "104", 20 to "30", 40 to "0.01", 50 to "0", 51 to "90"),
                record("CIRCLE", 5 to "A5", 8 to "survey", 10 to "104", 20 to "30", 40 to "0.01"),
                record("TEXT", 5 to "A6", 8 to "survey", 10 to "104", 20 to "30", 1 to "station"),
                record("MTEXT", 5 to "A7", 8 to "survey", 10 to "104", 20 to "30", 3 to "multi", 1 to "\\Pline"),
                record("ELLIPSE", 5 to "A8", 8 to "survey", 10 to "104", 20 to "30"),
            ),
            header = listOf(9 to "${'$'}INSUNITS", 70 to "6", 999 to "CAD source CRS is EPSG:4326"),
        )
        val decoded = NativeDxfImporter.decode("survey.dxf", source)
        assertEquals(7, decoded.features.size)
        assertEquals("meters", decoded.units)
        assertEquals(1.0, decoded.declaredUnitScale!!, 0.0)
        assertEquals("EPSG:4326", decoded.crsHint)
        assertEquals("#00ff00", decoded.features.first().color)
        assertEquals("keep-me", decoded.features.first().properties.getJSONArray("dxfRawGroups").let { raw -> raw.getJSONArray(raw.length() - 1).getString(1) })
        val line = decoded.features.first().geometry.getJSONArray("coordinates")
        assertEquals(12.5, line.getJSONArray(0).getDouble(2), 0.0)
        val polygon = decoded.features.first { it.entityType == "LWPOLYLINE" }.geometry.getJSONArray("coordinates").getJSONArray(0)
        assertEquals(polygon.getJSONArray(0).toString(), polygon.getJSONArray(polygon.length() - 1).toString())
        assertEquals("station", decoded.features.first { it.entityType == "TEXT" }.text)
        assertEquals("multi\nline", decoded.features.first { it.entityType == "MTEXT" }.text)
        assertTrue(decoded.features.first { it.entityType == "CIRCLE" }.geometry.getJSONArray("coordinates").getJSONArray(0).length() >= 25)
        assertEquals("#00ff00", decoded.layers.first { it.optString("name") == "survey" }.optString("color"))
        assertTrue(decoded.warnings.any { it.contains("ELLIPSE") })
        assertArrayEquals(source, decoded.sourceBytes)
    }

    @Test fun requiresExplicitCrsAxisAndScaleAndProjectsOnlySupportedCrs() {
        val decoded = NativeDxfImporter.decode("plain.dxf", dxf("ENTITIES" to listOf(record("POINT", 5 to "P1", 10 to "11600000", 20 to "4000000", 30 to "4"))))
        assertTrue(runCatching { NativeDxfImporter.buildDocument(decoded, null, NativeCadAxis.XY, 1.0) }.isFailure)
        assertTrue(runCatching { NativeDxfImporter.projectFeatures(decoded, NativeCadCrs.WEB_MERCATOR, null, 1.0) }.isFailure)
        val result = NativeDxfImporter.projectFeatures(decoded, NativeCadCrs.WEB_MERCATOR, NativeCadAxis.XY, 1.0).single()
        val coordinate = result.geometry.getJSONArray("coordinates")
        assertEquals(104.2045729578645, coordinate.getDouble(0), 1e-9)
        assertEquals(33.8, coordinate.getDouble(1), .2)
        assertEquals(4.0, coordinate.getDouble(2), 0.0)
        val built = NativeDxfImporter.buildDocument(decoded, NativeCadCrs.WEB_MERCATOR, NativeCadAxis.XY, 1.0, 1234)
        assertEquals("dxf", built.getString("format"))
        assertEquals(Base64.getEncoder().encodeToString(decoded.sourceBytes), built.getString("sourceBase64"))
        assertEquals(1234L, built.getLong("createdAt"))
        val geographic = NativeDxfImporter.decode("wgs84.dxf", dxf("ENTITIES" to listOf(record("POINT", 10 to "104", 20 to "30"))))
        assertEquals(104.0, NativeDxfImporter.projectFeatures(geographic, NativeCadCrs.WGS84, NativeCadAxis.XY, 1.0).single().geometry.getJSONArray("coordinates").getDouble(0), 0.0)
        val declared = NativeDxfImporter.decode("declared.dxf", dxf("ENTITIES" to listOf(record("POINT", 10 to "1", 20 to "1")), header = listOf(9 to "${'$'}CRS", 1 to "EPSG:32650")))
        assertTrue("Known-but-unsupported EPSG is explicit and cannot be overridden", runCatching { NativeDxfImporter.projectFeatures(declared, NativeCadCrs.WGS84, NativeCadAxis.XY, 1.0) }.isFailure)
    }

    @Test fun projectionScalesHorizontalCadUnitsButPreservesZLikeOriginalProjectCad() {
        val geographic = NativeDxfImporter.decode("wgs84.dxf", dxf("ENTITIES" to listOf(record("POINT", 10 to "104", 20 to "30", 30 to "123.45"))))
        val geographicPoint = NativeDxfImporter.projectFeatures(geographic, NativeCadCrs.WGS84, NativeCadAxis.XY, 1.0).single().geometry.getJSONArray("coordinates")
        assertEquals(104.0, geographicPoint.getDouble(0), 0.0)
        assertEquals(30.0, geographicPoint.getDouble(1), 0.0)
        assertEquals("WGS84 third coordinate remains original altitude; it is not multiplied by degree scale", 123.45, geographicPoint.getDouble(2), 0.0)

        val projected = NativeDxfImporter.decode("projected.dxf", dxf("ENTITIES" to listOf(record("POINT", 10 to "11600000", 20 to "4000000", 30 to "123.45"))))
        val projectedPoint = NativeDxfImporter.projectFeatures(projected, NativeCadCrs.WEB_MERCATOR, NativeCadAxis.XY, .001).single().geometry.getJSONArray("coordinates")
        assertEquals(123.45, projectedPoint.getDouble(2), 0.0)
    }

    @Test fun expandsNestedBlockTransformsWithStableDistinctIdsAndStopsCycles() {
        val source = dxf(
            "BLOCKS" to listOf(
                record("BLOCK", 2 to "INNER", 10 to "1", 20 to "2"),
                record("LINE", 5 to "L", 10 to "1", 20 to "2", 11 to "2", 21 to "2"),
                record("ENDBLK"),
                record("BLOCK", 2 to "OUTER"),
                record("INSERT", 5 to "N", 2 to "INNER", 10 to "10", 20 to "20", 41 to "2", 42 to "2", 50 to "90"),
                record("INSERT", 5 to "C", 2 to "OUTER"),
                record("ENDBLK"),
                record("BLOCK", 2 to "CYCLE"),
                record("INSERT", 5 to "R", 2 to "CYCLE"),
                record("ENDBLK"),
            ),
            "ENTITIES" to listOf(
                record("INSERT", 5 to "I1", 2 to "INNER", 10 to "100", 20 to "200"),
                record("INSERT", 5 to "I2", 2 to "INNER", 10 to "200", 20 to "300"),
                record("INSERT", 5 to "I0", 2 to "OUTER", 10 to "300", 20 to "400"),
                record("INSERT", 5 to "I3", 2 to "CYCLE"),
            ),
        )
        val decoded = NativeDxfImporter.decode("blocks.dxf", source)
        assertEquals(3, decoded.features.size)
        assertNotEquals(decoded.features[0].id, decoded.features[1].id)
        val first = decoded.features[0].geometry.getJSONArray("coordinates").getJSONArray(0)
        assertEquals(100.0, first.getDouble(0), 0.0)
        assertEquals(200.0, first.getDouble(1), 0.0)
        val nested = decoded.features[2].geometry.getJSONArray("coordinates").getJSONArray(0)
        assertEquals(310.0, nested.getDouble(0), 1e-9)
        assertEquals(420.0, nested.getDouble(1), 1e-9)
        assertTrue(decoded.warnings.any { it.contains("循环块引用") })
    }

    @Test fun warnsAndSkipsNonDefaultOcsButRejectsBinaryAndEnforcesAllInputLimits() {
        val decoded = NativeDxfImporter.decode("ocs.dxf", dxf("ENTITIES" to listOf(
            record("CIRCLE", 5 to "C1", 10 to "1", 20 to "2", 40 to "3", 210 to "1", 220 to "0", 230 to "0"),
        )))
        assertTrue(decoded.features.isEmpty())
        assertTrue(decoded.warnings.any { it.contains("非默认 OCS") })
        assertTrue(runCatching { NativeDxfImporter.decode("x.dxf", byteArrayOf(0, 0, 0)) }.isFailure)
        assertTrue(runCatching { NativeDxfImporter.decode("x.dwg", byteArrayOf(65, 67, 49, 48, 48, 57)) }.exceptionOrNull()?.message?.contains("DWG") == true)
        val oversized = ByteArray(NativeDxfImporter.MAX_INPUT_BYTES + 1)
        assertTrue(runCatching { NativeDxfImporter.readBounded(ByteArrayInputStream(oversized)) }.isFailure)
        assertTrue(runCatching { NativeDxfImporter.decode("large.dxf", oversized) }.isFailure)
        val tooManyPairs = buildString { repeat(600_001) { append("999\ncomment\n") } }.toByteArray()
        assertTrue(runCatching { NativeDxfImporter.decode("pairs.dxf", tooManyPairs) }.isFailure)
        val tooManyEntities = dxf("ENTITIES" to List(NativeDxfImporter.MAX_ENTITIES + 1) { record("POINT", 10 to "104", 20 to "30") })
        assertTrue(runCatching { NativeDxfImporter.decode("entities.dxf", tooManyEntities) }.isFailure)
        val tooManyVertices = polylineDxf(NativeDxfImporter.MAX_VERTICES + 1)
        assertTrue(runCatching { NativeDxfImporter.decode("vertices.dxf", tooManyVertices) }.isFailure)
    }

    @Test fun importedDocumentPassesWorkspaceCadSchemaAndMalformedImportLeavesSnapshotUntouched() {
        val decoded = NativeDxfImporter.decode("small.dxf", dxf("ENTITIES" to listOf(
            record("LINE", 5 to "L1", 10 to "104", 20 to "30", 11 to "104.01", 21 to "30.01"),
        )))
        val doc = NativeDxfImporter.buildDocument(decoded, NativeCadCrs.WGS84, NativeCadAxis.XY, 1.0)
        val context: Context = RuntimeEnvironment.getApplication()
        context.filesDir.resolve("workspace-v2.json").delete()
        context.filesDir.resolve("workspace-v2.json.bak").delete()
        val store = WorkspaceStore(context)
        store.upsert("cadDocuments", doc)
        val beforeStream = java.io.ByteArrayOutputStream()
        store.exportWorkspace(beforeStream)
        val before = beforeStream.toByteArray()
        val invalid = JSONObject(doc.toString()).put("mapFeatures", JSONArray())
        assertTrue(runCatching { store.upsert("cadDocuments", invalid) }.isFailure)
        val afterStream = java.io.ByteArrayOutputStream()
        store.exportWorkspace(afterStream)
        val after = afterStream.toByteArray()
        assertArrayEquals(before, after)
    }

    private fun dxf(vararg sections: Pair<String, List<String>>, header: List<Pair<Int, String>> = emptyList()): ByteArray {
        val out = StringBuilder("0\nSECTION\n2\nHEADER\n")
        header.forEach { (code, value) -> out.append(code).append('\n').append(value).append('\n') }
        out.append("0\nENDSEC\n")
        sections.forEach { (name, records) ->
            out.append("0\nSECTION\n2\n").append(name).append('\n')
            records.forEach { out.append(it) }
            out.append("0\nENDSEC\n")
        }
        out.append("0\nEOF\n")
        return out.toString().toByteArray(Charsets.UTF_8)
    }

    private fun record(type: String, vararg groups: Pair<Int, String>): String = buildString {
        append("0\n").append(type).append('\n')
        groups.forEach { (code, value) -> append(code).append('\n').append(value).append('\n') }
    }

    private fun polylineDxf(vertices: Int): ByteArray = buildString {
        append("0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n70\n0\n")
        repeat(vertices) { i -> append("10\n").append(104.0 + i * .000001).append("\n20\n30\n") }
        append("0\nENDSEC\n0\nEOF\n")
    }.toByteArray(Charsets.UTF_8)
}
