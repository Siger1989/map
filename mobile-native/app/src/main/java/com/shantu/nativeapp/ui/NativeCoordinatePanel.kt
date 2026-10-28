package com.shantu.nativeapp.ui

import android.content.Context
import android.widget.EditText
import android.widget.LinearLayout
import com.shantu.nativeapp.coordinates.NativeCoordinateTransform
import com.shantu.nativeapp.coordinates.NativeProjectCrs
import com.shantu.nativeapp.data.NativeImportedSettings
import java.util.Locale

/** Explicit coordinate conversion tool. All project CRS and datum parameters come from settings. */
class NativeCoordinatePanel(private val context: Context, private val chrome: HomeChrome) {
    fun show() {
        val runtime = NativeImportedSettings.readRuntime(context)
        val project = runtime.projectCrs?.toNative()
        val source = chrome.input("源 CRS：EPSG / PROJ / WKT").apply {
            setText(project?.definition ?: project?.id ?: "EPSG:4326")
        }
        val target = chrome.input("目标 CRS：EPSG / PROJ / WKT").apply { setText("EPSG:4326") }
        val datum = chrome.input("源 datum 参数（3/7项，逗号分隔）").apply {
            setText(project?.datumParameters?.joinToString(",").orEmpty())
        }
        val coordinate = chrome.input("坐标 X,Y[,Z]").apply {
            setText(if (project?.id?.startsWith("EPSG:326") == true || project?.id?.startsWith("EPSG:454") == true) "500000,3500000" else "108.2,31.3")
        }
        val result = chrome.text("输入明确的源和目标坐标系；不会按坐标数值猜测投影。", 10)
        chrome.showPanel(PANEL_ID, "坐标转换", topAligned = true, width = 300) {
            addView(chrome.text(project?.let { "工程默认：${it.name} · ${it.id}${it.datumParameters?.let { p -> " · datum ${p.joinToString()}" } ?: ""}" } ?: "工程默认：WGS 84 · EPSG:4326", 10))
            addView(source, LinearLayout.LayoutParams(-1, chrome.dp(34)))
            addView(target, LinearLayout.LayoutParams(-1, chrome.dp(34)))
            addView(datum, LinearLayout.LayoutParams(-1, chrome.dp(34)))
            addView(coordinate, LinearLayout.LayoutParams(-1, chrome.dp(34)))
            addView(result, LinearLayout.LayoutParams(-1, chrome.dp(40)))
            addView(chrome.row("转换坐标") {
                runCatching { convertUsingDatum(coordinate.text.toString(), source.text.toString(), target.text.toString(), project, parseDatum(datum.text.toString())) }
                    .onSuccess { value -> result.text = value; result.setTextColor(ShantuColors.accent) }
                    .onFailure { error -> result.text = error.message ?: "坐标转换失败"; result.setTextColor(android.graphics.Color.rgb(255, 155, 120)) }
            }, LinearLayout.LayoutParams(-1, chrome.dp(30)))
            addView(chrome.row("将源 CRS 设为当前工程坐标系") {
                runCatching {
                    val base = NativeCoordinateTransform.resolve(source.text.toString())
                    NativeCoordinateTransform.resolve(base.copy(datumParameters = parseDatum(datum.text.toString())))
                }.onSuccess { crs ->
                    val saved = NativeProjectCrs(crs.id, crs.name, crs.definition, crs.datumParameters)
                    val raw = saved.toSettingsJson()
                    val ok = context.getSharedPreferences(NativeImportedSettings.PREFS, Context.MODE_PRIVATE).edit().putString("project-crs", raw.toString()).commit()
                    result.text = if (ok) "工程坐标系已保存：${saved.name}（${saved.id}）" else "保存失败，原坐标系设置保留"
                }.onFailure { result.text = it.message ?: "工程坐标系无效" }
            }, LinearLayout.LayoutParams(-1, chrome.dp(30)))
        }
    }

    companion object {
        const val PANEL_ID = "coordinate-transfer"

        internal fun convert(raw: String, sourceText: String, targetText: String, project: NativeProjectCrs?, datumParameters: List<Double>?): String =
            convert(raw, sourceText, targetText, project, datumParameters, ::format)

        internal fun convertUsingDatum(raw: String, sourceText: String, targetText: String, project: NativeProjectCrs?, datumParameters: List<Double>?): String =
            convert(raw, sourceText, targetText, project, datumParameters, ::format)

        internal fun convert(
            raw: String, sourceText: String, targetText: String, project: NativeProjectCrs?,
            formatter: (List<Double>) -> String,
        ): String = convert(raw, sourceText, targetText, project, project?.datumParameters, formatter)

        internal fun convert(
            raw: String, sourceText: String, targetText: String, project: NativeProjectCrs?, datumParameters: List<Double>?,
            formatter: (List<Double>) -> String,
        ): String {
            val coordinates = raw.split(',').map { it.trim().toDoubleOrNull() ?: error("坐标须为 X,Y 或 X,Y,Z 数字") }
            require(coordinates.size in 2..3) { "坐标须为 X,Y 或 X,Y,Z" }
            fun resolve(text: String, sourceSide: Boolean): NativeProjectCrs {
                val saved = project
                if (saved != null && (text.trim() == saved.id || text.trim() == saved.definition)) {
                    return NativeCoordinateTransform.resolve(saved.copy(datumParameters = if (sourceSide) datumParameters else saved.datumParameters))
                }
                val crs = NativeCoordinateTransform.resolve(text)
                return NativeCoordinateTransform.resolve(if (sourceSide) crs.copy(datumParameters = datumParameters) else crs)
            }
            return formatter(NativeCoordinateTransform.transform(coordinates, resolve(sourceText, true), resolve(targetText, false)))
        }

        internal fun parseDatum(raw: String): List<Double>? {
            if (raw.isBlank()) return null
            val values = raw.split(',').map { it.trim().toDoubleOrNull() ?: error("datum 参数须为数字") }
            require(values.size == 3 || values.size == 7) { "datum 参数须为3或7项" }
            return values
        }

        private fun format(values: List<Double>) = values.joinToString(", ") { String.format(Locale.ROOT, "%.8f", it) }
    }
}

private fun com.shantu.nativeapp.data.NativeProjectCrsSettings.toNative() = NativeProjectCrs(
    id = id, name = name, definition = definition, datumParameters = datumParameters.takeIf { it.isNotEmpty() },
)
private fun NativeProjectCrs.toSettingsJson() = org.json.JSONObject().put("id", id).put("name", name)
    .also { out -> definition?.let { out.put("definition", it) }; datumParameters?.let { out.put("datumParameters", org.json.JSONArray(it)) } }
