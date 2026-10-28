package com.shantu.nativeapp.ui

import kotlin.math.min
import kotlin.math.roundToInt

/** Geometry shared by the native home chrome and its focused layout tests. */
internal object HomeChromeMetrics {
    const val HEADER_HEIGHT_DP = 48
    const val HEADER_CONTROL_DP = 44
    const val FOOTER_HEIGHT_DP = 56
    const val MAP_CONTROL_DP = 44
    const val PANEL_GAP_DP = 4
    const val CARD_RADIUS_DP = 8
    const val CONTROL_RADIUS_DP = 4
    const val PANEL_LEFT_DP = 8
    const val TOOL_RIGHT_CLEARANCE_DP = 56
    const val TOP_PANEL_MARGIN_DP = 56
    const val BOTTOM_PANEL_MARGIN_DP = FOOTER_HEIGHT_DP + 8

    data class PanelFrame(
        val widthDp: Int,
        val leftMarginDp: Int,
        val topMarginDp: Int,
        val bottomMarginDp: Int,
        val maxHeightDp: Int,
    )

    /** Matches homeMap.css: record sits footer + 60px; the hide-UI lock is another 60px above. */
    fun recordingBottomMarginDp(viewportHeightDp: Int): Int = FOOTER_HEIGHT_DP + 60

    fun focusLockBottomMarginDp(): Int = FOOTER_HEIGHT_DP + 120

    /** Current web workbench override: min(52dvh, 440px, available height minus 236px). */
    fun collectionSplitHeightDp(viewportHeightDp: Int): Int = minOf(
        (viewportHeightDp.coerceAtLeast(0) * .52f).roundToInt(),
        440,
        (viewportHeightDp - 236).coerceAtLeast(0),
    )

    fun panelFrame(
        id: String,
        requestedWidthDp: Int,
        viewportWidthDp: Int,
        viewportHeightDp: Int,
        topAligned: Boolean,
    ): PanelFrame {
        val sourcePanel = id == "sources"
        val left = if (sourcePanel) 56 else PANEL_LEFT_DP
        val right = if (sourcePanel) 58 else TOOL_RIGHT_CLEARANCE_DP
        val defaultWidth = when (id) {
            "sources" -> 276
            "marker" -> 220
            "place", "search" -> 248
            "record" -> 240
            else -> requestedWidthDp
        }
        val width = min(defaultWidth, (viewportWidthDp - left - right).coerceAtLeast(0))

        val height = viewportHeightDp.coerceAtLeast(0)
        val top = if (topAligned) {
            if (id == "navigation") HEADER_HEIGHT_DP + 4 else TOP_PANEL_MARGIN_DP
        } else 0
        val bottom = BOTTOM_PANEL_MARGIN_DP
        val available = (height - top - bottom).coerceAtLeast(0)
        val cap = when (id) {
            // Source/layer browsing is an established content-panel exception.
            "sources", "layers" -> minOf(480, (height * .62f).roundToInt(), (height - 140).coerceAtLeast(0))
            // The source editor embeds a 450dp native form; industry review is a tall
            // document canvas in the legacy UI (height capped at 820px and viewport-inset).
            "source-editor" -> 480
            "industry" -> 820
            // The legacy photo page is content-driven and reaches about 330px at phone size.
            "native-photos" -> 330
            // Full section list/profile content has fixed header/footer and a scrollable body.
            "native-section", "native-section-profile" -> 480
            "marker" -> 240
            "record" -> 500
            "favorite" -> minOf((height * .52f).roundToInt(), 440, (available - 236).coerceAtLeast(0))
            else -> 200
        }
        return PanelFrame(width, left, top, bottom, min(cap, available))
    }

    fun showLockEntry(locked: Boolean, panelId: String?, taskActive: Boolean): Boolean =
        locked || panelId == "navigation" || (panelId == null && !taskActive)
}
