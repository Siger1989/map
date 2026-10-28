package com.shantu.nativeapp.industry

import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

data class NativeIndustryBundleFile(val bytes: ByteArray, val name: String, val mime: String = "application/zip")

/** Offline export bundle. Source workbook bytes remain in the saved project and are not repackaged. */
object NativeIndustryBundle {
    const val MAX_BUNDLE_BYTES = 64 * 1024 * 1024

    fun create(render: NativeIndustryRenderResult): NativeIndustryBundleFile {
        require(render.kind == "section" || render.kind == "drill") { "行业图件类型无效" }
        val prefix = safeName(render.title).ifBlank { if (render.kind == "section") "实测剖面" else "钻孔柱状图" }
        val normalized = render.normalized.toString(2)
        val audit = render.audit.toString(2)
        val appendix = appendixHtml(render)
        val readme = buildString {
            appendLine("山兔行业图件离线导出包")
            appendLine("类型：${if (render.kind == "section") "实测剖面" else "钻孔柱状图"}")
            appendLine("标题：${render.title}")
            appendLine("包含：主图.svg、详图.svg、主图.png、附表.html、附表数据.json、来源追溯.json")
            appendLine("来源工作簿原文件保存在应用项目记录中；此导出包不包含原始工作簿副本。")
            appendLine("岩性填充为当前原生渲染符号映射，不能视为标准认证图例。剖面推算层界在图中标为估算。")
            appendLine("PNG 按原生 Canvas 绘制，像素数上限 ${NativeIndustryRenderer.MAX_PNG_PIXELS}，单边上限 ${NativeIndustryRenderer.MAX_PNG_SIDE}。")
        }
        val entries = linkedMapOf(
            "主图.svg" to render.mainSvg.toByteArray(Charsets.UTF_8),
            "详图.svg" to render.detailSvg.toByteArray(Charsets.UTF_8),
            "主图.png" to render.mainPng,
            "附表.html" to appendix.toByteArray(Charsets.UTF_8),
            "附表数据.json" to normalized.toByteArray(Charsets.UTF_8),
            "来源追溯.json" to JSONObject().put("audit", render.audit).put("issues", render.audit.optJSONArray("issues") ?: JSONArray()).toString(2).toByteArray(Charsets.UTF_8),
            "说明.txt" to readme.toByteArray(Charsets.UTF_8),
        )
        val rawTotal = entries.values.sumOf { it.size.toLong() }
        require(rawTotal <= MAX_BUNDLE_BYTES) { "行业导出内容超过 64 MiB 上限" }
        val bytes = ByteArrayOutputStream().use { buffer ->
            ZipOutputStream(buffer).use { zip ->
                zip.setLevel(6)
                for ((name, content) in entries) {
                    zip.putNextEntry(ZipEntry(name))
                    zip.write(content)
                    zip.closeEntry()
                }
            }
            buffer.toByteArray()
        }
        require(bytes.size <= MAX_BUNDLE_BYTES) { "ZIP 导出包超过 64 MiB 上限" }
        return NativeIndustryBundleFile(bytes, "$prefix-行业图件.zip")
    }

    private fun appendixHtml(render: NativeIndustryRenderResult): String {
        val data = render.normalized
        val keys = when (render.kind) {
            "section" -> listOf("records", "nodes", "intervals", "stations", "attitudes", "samples")
            else -> listOf("layers", "turns", "samples", "structures")
        }
        val tables = keys.joinToString("") { key ->
            val rows = data.optJSONArray(key) ?: JSONArray()
            val body = buildString {
                for (i in 0 until rows.length()) {
                    val item = rows.optJSONObject(i) ?: continue
                    append("<tr><td>").append(i + 1).append("</td><td><pre>")
                    append(html(item.toString(2)))
                    append("</pre></td></tr>")
                }
            }
            "<h2>${html(key)}</h2><table><thead><tr><th>#</th><th>归一化记录</th></tr></thead><tbody>$body</tbody></table>"
        }
        val issues = render.audit.optJSONArray("issues") ?: JSONArray()
        val issueRows = buildString {
            for (i in 0 until issues.length()) {
                val issue = issues.optJSONObject(i) ?: continue
                append("<tr><td>").append(html(issue.optString("severity"))).append("</td><td>")
                    .append(html(issue.optString("code"))).append("</td><td>")
                    .append(html(issue.optString("message"))).append("</td><td>")
                    .append(html(arrayText(issue.optJSONArray("cells")))).append("</td></tr>")
            }
        }
        return """<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${html(render.title)} 附表</title>
<style>body{font:14px sans-serif;color:#202421;margin:24px}h1,h2{color:#245b42}table{border-collapse:collapse;width:100%;margin:8px 0 24px}td,th{border:1px solid #cfd6d1;padding:6px;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font:12px monospace}.note{background:#f2f4ed;padding:12px}</style>
<h1>${html(render.title)} · ${if (render.kind == "section") "实测剖面" else "钻孔柱状图"}附表</h1>
<p class="note">本附表来自保存的归一化数据，来源单元格与审核记录保留在“来源追溯.json”。原始工作簿副本保存在应用项目中，不在此 ZIP 内。岩性符号为当前项目映射，推算层界仅作估算。</p>
<h2>审核问题（${issues.length()}）</h2><table><thead><tr><th>级别</th><th>代码</th><th>说明</th><th>来源单元格</th></tr></thead><tbody>$issueRows</tbody></table>
$tables
</html>"""
    }

    private fun safeName(value: String) = value.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").trim().take(80)
    private fun arrayText(a: JSONArray?): String = a?.let { (0 until it.length()).joinToString(", ") { i -> it.optString(i) } }.orEmpty()
    private fun html(value: String) = value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;")
}
