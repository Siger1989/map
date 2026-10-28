package com.shantu.nativeapp.geometry

import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import java.util.Locale

/** Original area-unit contract; geometry and exported boundaries remain canonical WGS84. */
object NativeAreaDisplay {
    data class Unit(val id: String, val label: String, val squareMetres: Double)
    val units = listOf(
        Unit("m2", "m²", 1.0), Unit("km2", "km²", 1_000_000.0), Unit("ha", "ha", 10_000.0),
        Unit("mu", "亩", 2000.0 / 3.0), Unit("ft2", "ft²", .09290304),
        Unit("acre", "英亩", 4046.8564224), Unit("mi2", "mi²", 2_589_988.110336),
    )

    fun unit(id: String): Unit = units.firstOrNull { it.id == id } ?: units.first()
    fun value(squareMetres: Double, unitId: String): Double {
        if (!squareMetres.isFinite() || squareMetres < 0) return 0.0
        return squareMetres / unit(unitId).squareMetres
    }

    fun valueText(squareMetres: Double, unitId: String): String = java.math.BigDecimal.valueOf(value(squareMetres, unitId))
        .round(MathContext(4, RoundingMode.HALF_UP)).stripTrailingZeros().toPlainString()

    /** Matches the legacy maximum of four significant digits without locale-dependent units. */
    fun format(squareMetres: Double, unitId: String): String {
        val symbols = DecimalFormatSymbols.getInstance(Locale.ROOT)
        val rounded = BigDecimal.valueOf(value(squareMetres, unitId)).round(MathContext(4, RoundingMode.HALF_UP))
        val format = DecimalFormat("#,##0.################", symbols).apply { isGroupingUsed = true }
        return "${format.format(rounded)} ${unit(unitId).label}"
    }
}
