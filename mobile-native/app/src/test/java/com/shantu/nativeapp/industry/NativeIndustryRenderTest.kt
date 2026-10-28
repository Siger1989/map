package com.shantu.nativeapp.industry

import android.graphics.BitmapFactory
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.util.zip.ZipInputStream
import java.io.FileOutputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeIndustryRenderTest {
    @Test fun referenceScaleAcceptsNumericAndRatioNotationsWithoutChangingDepth() {
        assertEquals(200.0,NativeIntegratedDrillRenderer.parseScaleDenominator("1:200")!!,0.0)
        assertEquals(1000.0,NativeIntegratedDrillRenderer.parseScaleDenominator("1：1,000")!!,0.0)
        assertEquals(100.0,NativeIntegratedDrillRenderer.parseScaleDenominator(100)!!,0.0)
        assertNull(NativeIntegratedDrillRenderer.parseScaleDenominator(0))
        assertNull(NativeIntegratedDrillRenderer.parseScaleDenominator("未提供"))
    }
    @Test fun rendersSectionFixtureAsStructuredVectorAndCanvasPngAndBundlesTrace() {
        val file = File(repoRoot(), "tests/fixtures/industry/section_alt.xlsx")
        val normalized = NativeSectionImporter.importWorkbook(NativeXlsxReader.read(file.inputStream(), file.name)).normalized
        val rendered = NativeIndustryRenderer.render("section", normalized)
        assertTrue(rendered.mainSvg.contains("测线平面导线"))
        assertTrue(rendered.mainSvg.contains("实测剖面地形与产状推算层界"))
        assertTrue(rendered.mainSvg.contains("推算"))
        assertTrue(rendered.mainSvg.contains("<svg"))
        assertTrue(rendered.detailSvg.contains("平面测线"))
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(rendered.mainPng, 0, rendered.mainPng.size, bounds)
        assertTrue(bounds.outWidth > 0 && bounds.outHeight > 0)
        assertTrue(bounds.outWidth.toLong() * bounds.outHeight <= NativeIndustryRenderer.MAX_PNG_PIXELS)
        assertTrue(maxOf(bounds.outWidth, bounds.outHeight) <= NativeIndustryRenderer.MAX_PNG_SIDE)
        val names = bundleEntries(NativeIndustryBundle.create(rendered).bytes)
        assertEquals(setOf("主图.svg", "详图.svg", "主图.png", "附表.html", "附表数据.json", "来源追溯.json", "说明.txt"), names.keys)
        assertEquals(normalized.getJSONObject("source").getString("sha256"), JSONObject(names.getValue("附表数据.json")).getJSONObject("source").getString("sha256"))
        assertTrue(names.getValue("来源追溯.json").contains("audit"))
    }

    @Test fun rendersDrillFixtureWithFullAndDetailDepthWindows() {
        val file = File(repoRoot(), "tests/fixtures/industry/drill_alt.xlsx")
        val normalized = NativeDrillImporter.importWorkbook(NativeXlsxReader.read(file.inputStream(), file.name)).normalized
        val rendered = NativeIndustryRenderer.render("drill", normalized)
        assertTrue(rendered.title.contains("${normalized.getJSONObject("meta").optString("hole_id")}"))
        assertTrue(rendered.mainSvg.contains("全孔"))
        assertTrue(rendered.detailSvg.contains("详图 0–"))
        assertTrue(rendered.mainSvg.contains("化验值"))
        assertEquals(normalized.getJSONObject("meta").getDouble("endpoint_m"), rendered.audit.getJSONObject("layout").getDouble("endpoint_m"), 0.0)
    }

    @Test fun rendersIntegratedContinuous120SamplesAndWritesReviewArtifacts() {
        val file = File(repoRoot(), "public/industry/drill-integrated-v3-continuous-example.xlsx")
        val normalized = NativeDrillImporter.importWorkbook(NativeXlsxReader.read(file.inputStream(), file.name)).normalized
        val rendered = NativeIndustryRenderer.render("drill", normalized)
        val layout = rendered.audit.getJSONObject("layout")
        assertEquals(28.0, layout.getDouble("table_x"), 0.0)
        assertEquals(272.0, layout.getDouble("header_y"), 0.0)
        assertEquals(158.0, layout.getDouble("header_height"), 0.0)
        assertEquals(430.0, layout.getDouble("body_top"), 0.0)
        assertEquals(80.0 / 3.0, layout.getDouble("depth_scale_units_per_meter"), 1e-9)
        assertEquals(2160.0, layout.getDouble("table_width"), 0.0)
        assertEquals(120, layout.getInt("samples"))
        val fills = layout.getJSONArray("sample_fill")
        assertEquals(120, fills.length())
        for (i in 1 until fills.length()) assertNotEquals(fills.getString(i - 1), fills.getString(i))
        val heights = layout.getJSONArray("sample_segment_heights")
        val scale = layout.getDouble("depth_scale_units_per_meter")
        val sample = (0 until normalized.getJSONArray("samples").length()).map { normalized.getJSONArray("samples").getJSONObject(it) }.minBy { it.getDouble("top_m") }
        assertEquals((sample.getDouble("bottom_m") - sample.getDouble("top_m")) * scale, heights.getDouble(0), 1e-8)
        assertTrue(rendered.audit.getJSONObject("main").getInt("operation_count") > 1000)
        val headerText=Regex("<text\\b[^>]*>(.*?)</text>").findAll(rendered.mainSvg).joinToString("") { it.groupValues[1] }
        // The reference header renders vertical labels as separate text glyphs.
        assertTrue(headerText.contains("样品编号"))
        assertTrue(headerText.contains("分析结果"))
        val output = File(repoRoot(), ".openai/native-industry-20261028").apply { mkdirs() }
        File(output, "integrated-v3-continuous.svg").writeText(rendered.mainSvg)
        FileOutputStream(File(output, "integrated-v3-continuous.png")).use { it.write(rendered.mainPng) }
        val bitmap = BitmapFactory.decodeByteArray(rendered.mainPng, 0, rendered.mainPng.size)
        assertNotNull(bitmap)
        try {
            var colored = 0
            for (x in 0 until bitmap.width step 24) for (y in 0 until bitmap.height step 24) if (bitmap.getPixel(x, y) != android.graphics.Color.WHITE) colored++
            assertTrue("rendered PNG should contain visible marks", colored > 20)
        } finally {
            bitmap.recycle()
        }
    }

    @Test fun integratedPatternLookupUsesOnlyExactCatalogMappings() {
        assertEquals("short-dash-double-dot", NativeIntegratedDrillRenderer.resolvePatternId(JSONObject().put("lithology_name", "泥岩夹泥质粉砂岩")))
        assertEquals("dot-rows-thin-lines", NativeIntegratedDrillRenderer.resolvePatternId(JSONObject().put("material_code", "D002")))
        assertEquals("point-dash-ellipse-bands", NativeIntegratedDrillRenderer.resolvePatternId(JSONObject().put("pattern_id", "point-dash-ellipse-bands")))
        assertNull(NativeIntegratedDrillRenderer.resolvePatternId(JSONObject().put("lithology_name", "砂岩")))
        assertEquals("short-dash-double-dot", NativeIntegratedDrillRenderer.resolvePatternId(JSONObject().put("material_code", "D999").put("lithology_name", "泥岩夹泥质粉砂岩")))
    }

    @Test fun integratedPatternDrawingMatchesCatalogPrimitivesAndLeavesUnknownBlank() {
        val shortDash = NativeIndustryRenderer.Plan(180, 100)
        NativeIntegratedDrillRenderer.drawDrillPattern(shortDash, "short-dash-double-dot", 0.0, 0.0, 98.0, 84.0)
        assertTrue(shortDash.svg().contains("<circle"))
        assertTrue(shortDash.svg().contains("<line"))

        val dotted = NativeIndustryRenderer.Plan(180, 100)
        NativeIntegratedDrillRenderer.drawDrillPattern(dotted, "dot-rows-thin-lines", 0.0, 0.0, 98.0, 21.0)
        assertTrue(dotted.ops.size >= 20)

        val bands = NativeIndustryRenderer.Plan(180, 100)
        NativeIntegratedDrillRenderer.drawDrillPattern(bands, "point-dash-ellipse-bands", 0.0, 0.0, 98.0, 48.0)
        assertTrue(bands.svg().contains("<ellipse"))

        val pending = NativeIndustryRenderer.Plan(180, 100)
        NativeIntegratedDrillRenderer.drawDrillPattern(pending, null, 0.0, 0.0, 98.0, 84.0)
        assertEquals(0, pending.operationCount)
    }

    private fun bundleEntries(bytes: ByteArray): Map<String, String> {
        val out = linkedMapOf<String, String>()
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                out[entry.name] = zip.readBytes().toString(Charsets.UTF_8)
                zip.closeEntry()
            }
        }
        return out
    }

    private fun repoRoot(): File {
        var dir = File(System.getProperty("user.dir")).absoluteFile
        repeat(8) {
            if (File(dir, "tests/fixtures/industry/section_alt.xlsx").isFile) return dir
            dir = dir.parentFile ?: return@repeat
        }
        throw AssertionError("Cannot find repository industry fixtures")
    }
}
