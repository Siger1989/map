package com.shantu.nativeapp.industry

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.ByteArrayOutputStream
import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class NativeIndustryImportTest {
    @Test fun parsesSectionAltFixtureAndMatchesGoldenGeometry() {
        val root = repoRoot()
        val file = File(root, "tests/fixtures/industry/section_alt.xlsx")
        val golden = JSONObject(File(root, "tests/fixtures/industry/pc-section-alt.json").readText())
        val book = NativeXlsxReader.read(file.inputStream(), file.name)
        val result = NativeSectionImporter.importWorkbook(book)
        val actual = result.normalized
        assertEquals("canonical_xlsx_v1", actual.getJSONObject("source").getString("adapter"))
        assertEquals(golden.getJSONObject("source").getString("sha256"), actual.getJSONObject("source").getString("sha256"))
        assertEquals(golden.getJSONArray("records").length(), actual.getJSONArray("records").length())
        assertEquals(golden.getJSONObject("summary").getDouble("endpoint_east_m"), actual.getJSONObject("summary").getDouble("endpoint_east_m"), 1e-10)
        assertEquals(golden.getJSONObject("summary").getDouble("total_vertical_m"), actual.getJSONObject("summary").getDouble("total_vertical_m"), 1e-10)
        assertEquals("T1", actual.getJSONArray("samples").getJSONObject(0).getString("id"))
        assertEquals("explicit_offset", actual.getJSONArray("samples").getJSONObject(0).getString("location_status"))
        assertEquals("测段!F2", actual.getJSONArray("records").getJSONObject(0).getJSONObject("source_cells").getString("length_m"))
        assertEquals(0, result.issues.length())
    }

    @Test fun parsesDrillAltAndRetainsThinLayerSourceAndOverlapWarning() {
        val root = repoRoot()
        val file = File(root, "tests/fixtures/industry/drill_alt.xlsx")
        val golden = JSONObject(File(root, "tests/fixtures/industry/pc-drill-alt.json").readText())
        val result = NativeDrillImporter.importWorkbook(NativeXlsxReader.read(file.inputStream(), file.name))
        val normalized = result.normalized
        assertEquals("drill-1.0", normalized.getString("schema_version"))
        assertEquals(2, normalized.getJSONArray("turns").length())
        assertEquals(3, normalized.getJSONArray("layers").length())
        assertEquals(3, normalized.getJSONArray("samples").length())
        assertEquals(golden.getJSONObject("meta").getDouble("endpoint_m"), normalized.getJSONObject("meta").getDouble("endpoint_m"), 0.0)
        assertEquals(0.02, normalized.getJSONArray("layers").getJSONObject(1).getDouble("thickness_m"), 1e-9)
        assertEquals(0.15, normalized.getJSONArray("samples").getJSONObject(0).getJSONObject("assays").getDouble("Au"), 1e-9)
        assertEquals("样品", normalized.getJSONArray("samples").getJSONObject(0).getJSONObject("source").getString("sheet"))
        assertTrue((0 until result.issues.length()).any { result.issues.getJSONObject(it).getString("code") == "OVERLAPPING_SAMPLES" })
        assertEquals("原始沿孔深", normalized.getJSONObject("meta").getString("depth_basis"))
        assertEquals("S1", normalized.getJSONArray("samples").getJSONObject(0).getString("id"))
        assertTrue(normalized.getJSONArray("samples").getJSONObject(1).getJSONObject("assays").isNull("Au"))
    }

    @Test fun recognizesAndLosslesslyRetainsIntegratedDrillV2AndV3WorkbookTables() {
        val root = repoRoot()
        val cases = listOf(Triple("drill-integrated-example.xlsx", "v2", null), Triple("drill-integrated-v3-continuous-example.xlsx", "v3", 120))
        for ((filename, version, expectedSamples) in cases) {
            val file = File(root, "public/industry/$filename")
            val result = NativeIntegratedDrillImporter.importWorkbook(NativeXlsxReader.read(file.inputStream(), file.name))
            val normalized = result.normalized
            assertEquals("drill-integrated-native-1.0", normalized.getString("schema_version"))
            assertEquals(version, normalized.getString("template_version"))
            val tables = normalized.getJSONObject("source_tables")
            assertEquals(11, tables.length())
            for (sheet in listOf("钻孔基本信息", "回次表", "分层-原始记录", "分层-地质综合", "采样", "自定义测试项目", "样品测试结果", "孔深校正及弯曲度", "图签", "图面示意", "填写说明")) assertTrue("missing $sheet", tables.has(sheet))
            assertTrue(tables.getJSONObject("回次表").getJSONArray("rows").length() > 0)
            assertTrue(tables.getJSONObject("采样").getJSONArray("rows").length() > 0)
            assertTrue(normalized.getJSONArray("layers").length() > 0)
            assertTrue(normalized.getJSONArray("turns").length() > 0)
            assertTrue(normalized.getJSONArray("samples").length() > 0)
            assertTrue(normalized.getJSONArray("analysis_items").length() > 0)
            assertTrue(normalized.getJSONObject("depth_measurements").getJSONArray("records").length() > 0)
            if (expectedSamples != null) {
                val samples = normalized.getJSONArray("samples")
                assertEquals(expectedSamples, samples.length())
                for (i in 0 until samples.length()) {
                    val sample = samples.getJSONObject(i)
                    assertTrue(sample.getDouble("bottom_m") > sample.getDouble("top_m"))
                    if (i > 0) assertEquals(samples.getJSONObject(i - 1).getDouble("bottom_m"), sample.getDouble("top_m"), 1e-9)
                }
            }
            val firstTurn = normalized.getJSONArray("turns").getJSONObject(0)
            if (!firstTurn.isNull("core_m")) {
                val rawTurn = firstTurn.getJSONObject("raw")
                val recordedAdvance = rawTurn.optDouble("回次进尺_m", rawTurn.optDouble("回次进尺_m（原填）", firstTurn.optDouble("advance_m")))
                val denominator = if (recordedAdvance > 0) recordedAdvance else firstTurn.getDouble("advance_m")
                assertEquals(firstTurn.getDouble("core_m") / denominator * 100.0, firstTurn.getDouble("recovery_percent"), 1e-9)
            }
            // Large Canvas/PNG output is exercised under NATIVE graphics in
            // NativeIndustryRenderTest. This suite verifies workbook data and provenance.
        }
    }

    @Test fun rejectsBlankIntegratedTemplateAsInvalidWhilePreservingIssueLocations() {
        val root = repoRoot()
        val file = File(root, "public/industry/drill-integrated-v3-template.xlsx")
        val error = runCatching { NativeDrillImporter.importWorkbook(NativeXlsxReader.read(file.inputStream(), file.name)) }.exceptionOrNull() as? NativeIndustryImportException
        assertNotNull(error)
        val issues = error!!.issues ?: throw AssertionError("blank template rejection must include review issues")
        assertTrue((0 until issues.length()).any { issues.getJSONObject(it).optString("severity") == "error" })
        assertTrue(issues.toString().contains("钻孔基本信息!F5") || issues.toString().contains("INTEGRATED_REQUIRED_DATA_EMPTY"))
    }

    @Test fun integratedV2AndV3LargeCasesKeepVersionSpecificRecoveryAndZeroResults() {
        for (version in listOf("v2", "v3")) {
            val book = largeIntegratedCase(version)
            val parsed = NativeIntegratedDrillImporter.importWorkbook(book)
            val value = parsed.normalized
            assertEquals(version, value.getString("template_version"))
            assertEquals(100, value.getJSONArray("turns").length())
            assertEquals(30, value.getJSONArray("layers").length())
            assertEquals(120, value.getJSONArray("samples").length())
            assertEquals(720, value.getJSONObject("source_tables").getJSONObject("样品测试结果").getJSONArray("rows").length())
            assertEquals(11, value.getJSONObject("source_tables").length())
            val turns = value.getJSONArray("turns")
            val expectedTurn = if (version == "v2") 80.0 else 40.0
            assertEquals(expectedTurn, turns.getJSONObject(0).getDouble("recovery_percent"), 1e-8)
            val layers = value.getJSONArray("layers")
            assertEquals(if (version == "v2") 60.0 else 50.0, layers.getJSONObject(0).getDouble("recovery_percent"), 1e-6)
            val sample = value.getJSONArray("samples").getJSONObject(0)
            assertEquals(if (version == "v2") 50.0 else 25.0, sample.getDouble("recovery_percent"), 1e-8)
            assertEquals(0.0, sample.getJSONObject("assays").getDouble("A0"), 0.0)
            val sourceRow = value.getJSONObject("source_tables").getJSONObject("回次表").getJSONArray("rows").getJSONObject(0)
            assertTrue(sourceRow.has("values")); assertTrue(sourceRow.has("cells")); assertTrue(sourceRow.has("formulas"))
        }
    }

    @Test fun integratedImporterRejectsDuplicateIdsOverlapUnknownAssayFormulaAndMissingV3Advance() {
        val baseV2 = largeIntegratedCase("v2")
        assertIntegratedError("DUPLICATE_ID", mutateRow(baseV2, "回次表", 7) { it["B7"] = "R001" })
        assertIntegratedError("DUPLICATE_SAMPLE", mutateRow(baseV2, "采样", 7) { it["B7"] = "S001" })
        assertIntegratedError("OVERLAPPING_SAMPLES", mutateRow(baseV2, "采样", 7) { it["G7"] = 0.25 })
        assertIntegratedError("UNKNOWN_ANALYSIS_CODE", mutateRow(baseV2, "样品测试结果", 6) { it["B6"] = "UNKNOWN" })
        val formula = mutateRow(baseV2, "回次表", 6) { }.let { book ->
            val sheet = book.sheets.getValue("回次表")
            book.copy(sheets = book.sheets + ("回次表" to sheet.copy(rows = sheet.rows.map { row -> if (row.row == 6) row.copy(formulas = row.formulas + ("H6" to "1+1")) else row })))
        }
        assertIntegratedError("FORMULA_VALUE", formula)
        val missingAdvance = mutateRow(largeIntegratedCase("v3"), "回次表", 6) { it.remove("D6") }
        assertIntegratedError("MISSING_MANUAL_ADVANCE", missingAdvance)
        val overEndpoint = mutateRow(baseV2, "分层-原始记录", 35) { it["G35"] = 101.0 }
        assertIntegratedError("INTERVAL_OUT_OF_RANGE", overEndpoint)
    }

    private fun assertIntegratedError(code: String, book: NativeXlsxWorkbook) {
        val error = runCatching { NativeIntegratedDrillImporter.importWorkbook(book) }.exceptionOrNull() as? NativeIndustryImportException
        assertNotNull("expected $code", error)
        assertTrue(error!!.issues.toString().contains(code))
    }

    private fun mutateRow(book: NativeXlsxWorkbook, sheetName: String, rowNumber: Int, edit: (MutableMap<String, Any?>) -> Unit): NativeXlsxWorkbook {
        val sheet = book.sheets.getValue(sheetName)
        val changed = sheet.rows.map { row -> if (row.row == rowNumber) row.copy(cells = row.cells.toMutableMap().also(edit)) else row }
        return book.copy(sheets = book.sheets + (sheetName to sheet.copy(rows = changed)))
    }

    private fun largeIntegratedCase(version: String): NativeXlsxWorkbook {
        val root = repoRoot()
        val file = File(root, "public/industry/${if (version == "v2") "drill-integrated-example.xlsx" else "drill-integrated-v3-example.xlsx"}")
        val base = NativeXlsxReader.read(file.inputStream(), file.name)
        val mutableSheets = base.sheets.toMutableMap()
        fun headers(name: String) = base.sheets.getValue(name).rows.first { it.row == 5 }.cells.mapValues { it.value.toString() }
        fun makeRow(name: String, row: Int, values: Map<String, Any?>): NativeXlsxRow {
            val columns = headers(name).entries.associate { it.value to it.key.substringWhileLetters() }
            return NativeXlsxRow(row, values.mapNotNull { (label, value) -> columns[label]?.let { "$it$row" to value } }.toMap(), emptyMap())
        }
        fun replace(name: String, generated: List<NativeXlsxRow>) {
            val sheet = base.sheets.getValue(name)
            val header = sheet.rows.first { it.row == 5 }
            mutableSheets[name] = sheet.copy(rows = listOf(header) + generated)
        }
        val basic = base.sheets.getValue("钻孔基本信息")
        mutableSheets["钻孔基本信息"] = basic.copy(rows = basic.rows.map { row ->
            if (row.row == 5) row.copy(cells = row.cells + ("F5" to 100.0)) else row
        })
        replace("回次表", (1..100).map { i -> makeRow("回次表", i + 5, mapOf("回次号" to "R%03d".format(i), "下界记录孔深_m" to i.toDouble(), "回次进尺_m" to 2.0, "处理后岩心长_m（手填）" to 0.8, "回次采取率_pct（原填）" to 0.0)) })
        replace("分层-原始记录", (1..30).map { i -> makeRow("分层-原始记录", i + 5, mapOf("层号" to "L%02d".format(i), "换层累计孔深_m" to (100.0 * i / 30), "分层进尺_m" to 4.0, "分层岩心长_m" to 2.0, "分层采取率_pct（原填）" to 0.0, "岩性名称" to "砂岩")) })
        replace("采样", (1..120).map { i -> makeRow("采样", i + 5, mapOf("样品编号" to "S%03d".format(i), "孔深自_m" to (i - 1) * 0.5, "孔深至_m" to i * 0.5, "进尺_m" to 1.0, "岩心长度_m" to 0.25, "采取率_pct（原填）" to 0.0)) })
        val analysisRows = (0..5).map { index -> makeRow("自定义测试项目", index + 6, mapOf("项目代码" to "A$index", "项目名称/元素" to "分析$index", "单位" to "ppm", "显示顺序" to index, "图中显示" to "是")) }
        replace("自定义测试项目", analysisRows)
        val resultRows = (1..120).flatMap { sample -> (0..5).map { assay -> makeRow("样品测试结果", 5 + (sample - 1) * 6 + assay + 1, mapOf("样品编号" to "S%03d".format(sample), "项目代码" to "A$assay", "结果原文" to if (sample == 1 && assay == 0) "0" else "1", "数值结果（可空）" to if (sample == 1 && assay == 0) 0.0 else 1.0, "结果标记" to "", "单位" to "ppm")) } }
        replace("样品测试结果", resultRows)
        return base.copy(sheets = mutableSheets)
    }

    private fun String.substringWhileLetters() = takeWhile { it.isLetter() }

    @Test fun rejectsDtdEntityAndDoesNotResolveExternalContent() {
        val bytes = zip(mapOf(
            "xl/workbook.xml" to """<?xml version="1.0"?><!DOCTYPE x [<!ENTITY ext SYSTEM "file:///etc/passwd">]><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets>&ext;</sheets></workbook>""",
            "xl/_rels/workbook.xml.rels" to "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"/>"
        ))
        val error = runCatching { NativeXlsxReader.read(ByteArrayInputStream(bytes), "evil.xlsx") }.exceptionOrNull()
        assertTrue(error is NativeIndustryImportException)
        assertTrue(error!!.message.orEmpty().contains("DOCTYPE/ENTITY"))
    }

    @Test fun formulaAndDuplicateIdsFailWithOriginalCellLocations() {
        val root = repoRoot(); val file = File(root, "tests/fixtures/industry/section_alt.xlsx")
        val parsed = NativeXlsxReader.read(file.inputStream(), file.name)
        val segment = parsed.sheets.getValue("测段")
        val targetRow = segment.rows.last()
        val formulaCell = "F${targetRow.row}"
        val formulaRow = targetRow.copy(formulas = mapOf(formulaCell to "E${targetRow.row}-D${targetRow.row}"))
        val formulaBook = parsed.copy(sheets = parsed.sheets + ("测段" to segment.copy(rows = segment.rows.map { row -> if (row.row == targetRow.row) formulaRow else row })))
        val formulaError = runCatching { NativeSectionImporter.importWorkbook(formulaBook) }.exceptionOrNull() as? NativeIndustryImportException
        assertTrue(formulaError?.message.orEmpty().contains("测段!$formulaCell"))
        assertTrue(formulaError?.message.orEmpty().contains("是公式"))

        val idCell = "A${targetRow.row}"
        val duplicateRow = targetRow.copy(cells = targetRow.cells + (idCell to "R1"))
        val duplicateBook = parsed.copy(sheets = parsed.sheets + ("测段" to segment.copy(rows = segment.rows.map { row -> if (row.row == targetRow.row) duplicateRow else row })))
        val duplicate = runCatching { NativeSectionImporter.importWorkbook(duplicateBook) }.exceptionOrNull() as? NativeIndustryImportException
        assertTrue(duplicate?.issues?.toString().orEmpty().contains("DUPLICATE_RECORD_ID"))
        assertTrue(duplicate?.issues?.toString().orEmpty().contains("测段!$idCell"))
    }

    @Test fun rejectsWorkbookInputOverCompressedLimitBeforeParsing() {
        val huge = object : InputStream() {
            private var produced = 0
            override fun read(): Int { if (produced > NativeXlsxReader.MAX_COMPRESSED_BYTES) return -1; produced++; return 0 }
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (len == 0) return 0
                if (produced > NativeXlsxReader.MAX_COMPRESSED_BYTES) return -1
                val count = minOf(len, NativeXlsxReader.MAX_COMPRESSED_BYTES + 1 - produced)
                java.util.Arrays.fill(b, off, off + count, 0.toByte())
                produced += count
                return count
            }
        }
        val error = runCatching { NativeXlsxReader.read(huge, "large.xlsx") }.exceptionOrNull()
        assertTrue(error is NativeIndustryImportException)
        assertTrue(error!!.message.orEmpty().contains("压缩文件超过"))
    }

    private fun repoRoot(): File {
        var dir = File(System.getProperty("user.dir")).absoluteFile
        repeat(8) {
            if (File(dir, "tests/fixtures/industry/section_alt.xlsx").isFile) return dir
            dir = dir.parentFile ?: dir
        }
        throw AssertionError("Cannot find repository test fixtures from ${System.getProperty("user.dir")}")
    }
    private fun zip(entries: Map<String, String>): ByteArray = ByteArrayOutputStream().also { output ->
        ZipOutputStream(output).use { out -> entries.forEach { (name, value) -> out.putNextEntry(ZipEntry(name)); out.write(value.toByteArray()); out.closeEntry() } }
    }.toByteArray()
}
