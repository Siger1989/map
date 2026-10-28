package com.shantu.nativeapp.industry

import org.w3c.dom.Element
import org.w3c.dom.Node
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.security.MessageDigest
import java.nio.charset.CodingErrorAction
import java.nio.ByteBuffer
import java.util.zip.ZipInputStream
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory

data class NativeXlsxRow(val row: Int, val cells: Map<String, Any?>, val formulas: Map<String, String>)
data class NativeXlsxSheet(val name: String, val rows: List<NativeXlsxRow>)
data class NativeXlsxWorkbook(
    val filename: String,
    val sha256: String,
    val sheets: Map<String, NativeXlsxSheet>,
    val warnings: List<NativeIndustryIssue> = emptyList(),
)
data class NativeIndustryIssue(val severity: String, val code: String, val message: String, val cells: List<String> = emptyList())
data class NativeIndustryImportResult(val normalized: org.json.JSONObject, val issues: org.json.JSONArray)
class NativeIndustryImportException(message: String, val issues: org.json.JSONArray? = null) : IllegalArgumentException(message)

/** Bounded OOXML worksheet reader. It never evaluates formulas or follows external relationships. */
object NativeXlsxReader {
    const val MAX_COMPRESSED_BYTES = 20 * 1024 * 1024
    const val MAX_EXPANDED_BYTES = 64 * 1024 * 1024
    const val MAX_ROWS = 10_000
    private const val MAX_ENTRIES = 4096
    private val builtinDates = setOf(14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58)

    fun read(input: InputStream, filename: String): NativeXlsxWorkbook {
        val bytes = readBounded(input, MAX_COMPRESSED_BYTES)
        val names = validateCentralDirectory(bytes)
        val wanted = names.filter { it == "xl/workbook.xml" || it == "xl/_rels/workbook.xml.rels" || it == "xl/styles.xml" || it == "xl/sharedStrings.xml" || it.matches(Regex("xl/worksheets/[^/]+\\.xml")) }.toSet()
        val entries = LinkedHashMap<String, ByteArray>()
        var expanded = 0L
        try {
            ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    val name = safeZipName(entry.name)
                    if (name in wanted) {
                        val out = ByteArrayOutputStream()
                        val buf = ByteArray(8192)
                        while (true) {
                            val n = zip.read(buf)
                            if (n < 0) break
                            expanded += n
                            if (expanded > MAX_EXPANDED_BYTES) fail("解压内容超过 ${MAX_EXPANDED_BYTES} 字节上限")
                            out.write(buf, 0, n)
                        }
                        entries[name] = out.toByteArray()
                    } else {
                        // Drain only so ZipInputStream verifies CRCs; cap all expanded payload, not just XML.
                        val buf = ByteArray(8192)
                        while (true) {
                            val n = zip.read(buf)
                            if (n < 0) break
                            expanded += n
                            if (expanded > MAX_EXPANDED_BYTES) fail("解压内容超过 ${MAX_EXPANDED_BYTES} 字节上限")
                        }
                    }
                    zip.closeEntry()
                }
            }
        } catch (e: NativeIndustryImportException) { throw e } catch (e: Exception) { fail("ZIP 解压失败或CRC校验失败") }
        val workbook = parseXml(entries, "xl/workbook.xml")
        val rels = parseXml(entries, "xl/_rels/workbook.xml.rels")
        val date1904 = workbook.getElementsByTagNameNS("*", "workbookPr").item(0)?.let { (it as Element).getAttribute("date1904").let { v -> v == "1" || v.equals("true", true) } } ?: false
        val dateStyles = parseDateStyles(entries["xl/styles.xml"])
        val relationships = linkedMapOf<String, String>()
        val relNodes = rels.getElementsByTagNameNS("*", "Relationship")
        for (i in 0 until relNodes.length) {
            val el = relNodes.item(i) as Element
            if (el.getAttribute("TargetMode") == "External") fail("工作表关系不能指向外部文件")
            val id = el.getAttribute("Id"); val target = el.getAttribute("Target")
            if (id.isNotBlank() && target.isNotBlank()) {
                if (relationships.put(id, target) != null) fail("工作簿关系编号重复：$id")
            }
        }
        val shared = mutableListOf<String>()
        entries["xl/sharedStrings.xml"]?.let { xml ->
            val doc = parseXml(xml, "xl/sharedStrings.xml")
            val sis = doc.getElementsByTagNameNS("*", "si")
            for (i in 0 until sis.length) shared += textChildren(sis.item(i) as Element, "t")
        }
        val sheets = linkedMapOf<String, NativeXlsxSheet>()
        var totalRows = 0
        val sheetNodes = workbook.getElementsByTagNameNS("*", "sheet")
        for (i in 0 until sheetNodes.length) {
            val node = sheetNodes.item(i) as Element
            val name = node.getAttribute("name").trim()
            val relId = node.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id").ifBlank { node.getAttribute("r:id") }
            val target = relationships[relId]
            if (name.isBlank() || target.isNullOrBlank()) fail("工作表名称/关系缺失：${name.ifBlank { "未命名" }}")
            if (sheets.containsKey(name)) fail("工作簿工作表名称重复：$name")
            val path = worksheetPath(target!!)
            val doc = parseXml(entries, path)
            val data = doc.getElementsByTagNameNS("*", "sheetData").item(0) ?: fail("$name 工作表数据缺失")
            val rows = mutableListOf<NativeXlsxRow>()
            val seenRows = mutableSetOf<Int>()
            val rowNodes = (data as Element).getElementsByTagNameNS("*", "row")
            for (ri in 0 until rowNodes.length) {
                val rowNode = rowNodes.item(ri) as Element
                val rowNumber = rowNode.getAttribute("r").toIntOrNull() ?: -1
                if (rowNumber !in 1..MAX_ROWS) fail("$name 行号超出 1–$MAX_ROWS 限制")
                if (!seenRows.add(rowNumber)) fail("$name!第${rowNumber}行重复")
                totalRows++; if (totalRows > MAX_ROWS) fail("工作簿总行数超过 $MAX_ROWS 限制")
                val cells = linkedMapOf<String, Any?>(); val formulas = linkedMapOf<String, String>()
                val cellNodes = rowNode.getElementsByTagNameNS("*", "c")
                for (ci in 0 until cellNodes.length) {
                    val cell = cellNodes.item(ci) as Element
                    val address = cell.getAttribute("r")
                    if (!address.matches(Regex("[A-Z]+[1-9][0-9]*")) || columnIndex(address) !in 0..16383 || address.substringWhileDigitsEnd() != rowNumber) fail("$name!${address.ifBlank { "第${rowNumber}行" }} 单元格坐标无效")
                    if (cells.containsKey(address)) fail("$name!$address 单元格重复")
                    val formula = cell.firstChildNamed("f")?.textContent.orEmpty()
                    if (formula.isNotEmpty()) formulas[address] = formula
                    cells[address] = decodeCell(cell, shared, dateStyles, date1904)
                }
                if (cells.values.any { it != null && it != "" } || formulas.isNotEmpty()) rows += NativeXlsxRow(rowNumber, cells, formulas)
            }
            sheets[name] = NativeXlsxSheet(name, rows)
        }
        if (sheets.isEmpty()) fail("工作簿没有工作表")
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        return NativeXlsxWorkbook(filename, digest, sheets)
    }

    private fun readBounded(input: InputStream, limit: Int): ByteArray {
        val output = ByteArrayOutputStream(); val buf = ByteArray(8192)
        while (true) { val n = input.read(buf); if (n < 0) break; if (output.size() + n > limit) fail("压缩文件超过 $limit 字节上限"); output.write(buf, 0, n) }
        if (output.size() < 22) fail("ZIP中央目录缺失或文件已损坏")
        return output.toByteArray()
    }

    private fun validateCentralDirectory(bytes: ByteArray): List<String> {
        fun u16(i: Int) = (bytes[i].toInt() and 255) or ((bytes[i + 1].toInt() and 255) shl 8)
        fun u32(i: Int) = (u16(i).toLong() or (u16(i + 2).toLong() shl 16))
        var eocd = -1
        for (i in (bytes.size - 65557).coerceAtLeast(0)..bytes.size - 22) if (u32(i) == 0x06054b50L && i + 22 + u16(i + 20) == bytes.size) eocd = i
        if (eocd < 0) fail("ZIP中央目录缺失或文件已损坏")
        val disk = u16(eocd + 4); val cdDisk = u16(eocd + 6); val entries = u16(eocd + 10); val cdSize = u32(eocd + 12); val cdStart = u32(eocd + 16)
        if (disk != 0 || cdDisk != 0 || entries == 0xffff || cdSize == 0xffffffffL || cdStart == 0xffffffffL) fail("不支持分卷ZIP或ZIP64")
        if (entries > MAX_ENTRIES || cdStart + cdSize > eocd) fail("ZIP中央目录范围异常")
        var offset = cdStart.toInt(); val names = linkedSetOf<String>(); var expanded = 0L
        repeat(entries) {
            if (offset + 46 > bytes.size || u32(offset) != 0x02014b50L) fail("ZIP中央目录条目损坏")
            val flags = u16(offset + 8); val compressed = u32(offset + 20); val uncompressed = u32(offset + 24)
            val nameLength = u16(offset + 28); val extraLength = u16(offset + 30); val commentLength = u16(offset + 32)
            if (flags and 1 != 0) fail("不支持加密工作簿")
            if (compressed == 0xffffffffL || uncompressed == 0xffffffffL) fail("不支持ZIP64条目")
            val nameStart = offset + 46; val end = nameStart + nameLength + extraLength + commentLength
            if (end > bytes.size) fail("ZIP目录文件名越界")
            val raw = strictUtf8(bytes.copyOfRange(nameStart, nameStart + nameLength), "ZIP文件名")
            val name = safeZipName(raw)
            if (!names.add(name)) fail("ZIP存在重名文件：$name")
            expanded += uncompressed; if (expanded > MAX_EXPANDED_BYTES) fail("解压内容超过 $MAX_EXPANDED_BYTES 字节上限")
            offset = end
        }
        if (offset.toLong() != cdStart + cdSize) fail("ZIP中央目录长度不匹配")
        return names.toList()
    }

    private fun safeZipName(raw: String): String {
        val n = raw.replace('\\', '/')
        if (n.startsWith('/') || Regex("^[A-Za-z]:").containsMatchIn(n) || n.split('/').any { it == ".." || it == "." }) fail("ZIP路径越界：$raw")
        return n
    }
    private fun worksheetPath(target: String): String {
        val original = target.replace('\\', '/')
        val path = if (original.startsWith('/')) original.drop(1) else "xl/$original"
        val parts = mutableListOf<String>()
        for (part in path.split('/')) when (part) { "", "." -> Unit; ".." -> { if (parts.isEmpty()) fail("工作表关系路径越界"); parts.removeAt(parts.lastIndex) }; else -> parts += part }
        val result = parts.joinToString("/"); if (!result.startsWith("xl/worksheets/")) fail("工作表关系不指向 xl/worksheets：$target"); return result
    }
    private fun parseXml(entries: Map<String, ByteArray>, path: String) = parseXml(entries[path] ?: fail("缺少文件 $path"), path)
    private fun parseXml(bytes: ByteArray, path: String): org.w3c.dom.Document {
        val source = strictUtf8(bytes, path)
        if (Regex("<!\\s*(?:DOCTYPE|ENTITY)\\b", RegexOption.IGNORE_CASE).containsMatchIn(source)) fail("$path 包含不支持的 DOCTYPE/ENTITY")
        try {
            val factory = DocumentBuilderFactory.newInstance().apply {
                isNamespaceAware = true
                setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true)
                setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
                setFeature("http://xml.org/sax/features/external-general-entities", false)
                setFeature("http://xml.org/sax/features/external-parameter-entities", false)
                setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false)
                runCatching { setAttribute("http://javax.xml.XMLConstants/property/accessExternalDTD", "") }
                runCatching { setAttribute("http://javax.xml.XMLConstants/property/accessExternalSchema", "") }
            }
            return factory.newDocumentBuilder().parse(ByteArrayInputStream(bytes))
        } catch (_: Exception) { fail("$path XML 无法安全解析") }
    }
    private fun parseDateStyles(bytes: ByteArray?): Set<Int> {
        if (bytes == null) return emptySet()
        val doc = parseXml(bytes, "xl/styles.xml"); val formats = mutableMapOf<Int, String>()
        val fmts = doc.getElementsByTagNameNS("*", "numFmt")
        for (i in 0 until fmts.length) { val e = fmts.item(i) as Element; val id = e.getAttribute("numFmtId").toIntOrNull(); if (id != null) formats[id] = e.getAttribute("formatCode") }
        val xfs = doc.getElementsByTagNameNS("*", "cellXfs").item(0) as? Element ?: return emptySet()
        val children = xfs.childElements("xf"); return children.mapIndexedNotNull { index, e ->
            val id = e.getAttribute("numFmtId").toIntOrNull() ?: 0
            val format = formats[id].orEmpty().replace(Regex("\"(?:[^\"]|\"\")*\"|\\\\.|\\[[^\\]]*]"), "").lowercase()
            if (id in builtinDates || format.contains(Regex("y|d|h|s")) || Regex("m\\s*[-/]|[-/]\\s*m").containsMatchIn(format)) index else null
        }.toSet()
    }
    private fun decodeCell(cell: Element, shared: List<String>, dateStyles: Set<Int>, date1904: Boolean): Any? {
        val type = cell.getAttribute("t"); val raw = cell.firstChildNamed("v")?.textContent.orEmpty()
        if (type == "inlineStr") return cell.firstChildNamed("is")?.let { textChildren(it, "t") } ?: ""
        if (type == "s") { val index = raw.toIntOrNull() ?: -1; if (index !in shared.indices) fail("${cell.getAttribute("r")} shared string 索引无效"); return shared[index] }
        if (type == "e") fail("${cell.getAttribute("r")} 是 Excel 错误值 $raw")
        if (type == "b") return raw == "1"
        if (type == "d") { if (!raw.matches(Regex("\\d{4}-\\d\\d-\\d\\d(?:T\\d\\d:\\d\\d:\\d\\d(?:\\.\\d+)?(?:Z|[+-]\\d\\d:\\d\\d)?)?"))) fail("${cell.getAttribute("r")} 日期文本无效"); return raw }
        if (type == "str") return raw
        if (raw.isEmpty()) return null
        val n = raw.toDoubleOrNull()?.takeIf { it.isFinite() } ?: fail("${cell.getAttribute("r")} 数字无效")
        val styleIndex = cell.getAttribute("s").toIntOrNull()
        if (styleIndex != null && styleIndex in dateStyles) return excelDate(n, date1904)
        return n
    }
    private fun excelDate(serial: Double, date1904: Boolean): String {
        val day = kotlin.math.floor(serial).toLong(); val fraction = serial - day
        if (!date1904 && day == 60L) return "1900-02-29" + if (fraction == 0.0) "" else "T" + java.time.Instant.ofEpochMilli(kotlin.math.round(fraction * 86400000).toLong()).toString().substring(11)
        val corrected = if (!date1904 && day > 60) day - 1 else day
        val epoch = if (date1904) java.time.LocalDate.of(1904, 1, 1) else java.time.LocalDate.of(1899, 12, 31)
        val dt = epoch.plusDays(corrected).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().plusMillis(kotlin.math.round(fraction * 86400000).toLong())
        val text = dt.toString(); return if (fraction == 0.0) text.substring(0, 10) else text.replace(".000Z", "Z")
    }
    private fun textChildren(parent: Element, tag: String): String = parent.getElementsByTagNameNS("*", tag).let { list -> buildString { for (i in 0 until list.length) append(list.item(i).textContent) } }
    private fun strictUtf8(bytes: ByteArray, label: String): String = try {
        Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
    } catch (_: Exception) { fail("$label 不是有效UTF-8") }
    private fun Element.firstChildNamed(local: String): Element? { val nodes = getElementsByTagNameNS("*", local); return if (nodes.length == 0) null else nodes.item(0) as Element }
    private fun Element.childElements(local: String): List<Element> = buildList { val nodes = childNodes; for (i in 0 until nodes.length) { val n = nodes.item(i); if (n.nodeType == Node.ELEMENT_NODE && (n.localName == local || n.nodeName.substringAfter(':') == local)) add(n as Element) } }
    private fun columnIndex(address: String): Int { var result = 0; for (c in address.takeWhile { it.isLetter() }) result = result * 26 + c.uppercaseChar().code - 64; return result - 1 }
    private fun String.substringWhileDigitsEnd(): Int = substringWhileDigitsStart().let { substring(it).toIntOrNull() ?: -1 }
    private fun String.substringWhileDigitsStart(): Int = indexOfFirst { it.isDigit() }.let { if (it < 0) length else it }
    private fun fail(message: String): Nothing = throw NativeIndustryImportException("XLSX：$message")
}
