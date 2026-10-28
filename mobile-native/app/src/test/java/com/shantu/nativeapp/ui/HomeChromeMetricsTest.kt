package com.shantu.nativeapp.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeChromeMetricsTest {
    @Test
    fun homeChromeControlsMatchHomepageDimensions() {
        assertEquals(48, HomeChromeMetrics.HEADER_HEIGHT_DP)
        assertEquals(44, HomeChromeMetrics.HEADER_CONTROL_DP)
        assertEquals(56, HomeChromeMetrics.FOOTER_HEIGHT_DP)
        assertEquals(44, HomeChromeMetrics.MAP_CONTROL_DP)
        assertEquals(4, HomeChromeMetrics.PANEL_GAP_DP)
        assertEquals(8, HomeChromeMetrics.CARD_RADIUS_DP)
        assertEquals(4, HomeChromeMetrics.CONTROL_RADIUS_DP)
    }

    @Test
    fun recordingAndFocusLockStayAtTheirSeparateHomepageAnchors() {
        assertEquals(116, HomeChromeMetrics.recordingBottomMarginDp(785))
        assertEquals(116, HomeChromeMetrics.recordingBottomMarginDp(732))
        assertEquals(176, HomeChromeMetrics.focusLockBottomMarginDp())
    }

    @Test
    fun collectionSplitUsesTheInsetConsumedRootViewport() {
        assertEquals(408, HomeChromeMetrics.collectionSplitHeightDp(785))
        assertEquals(381, HomeChromeMetrics.collectionSplitHeightDp(732))
        val remainingMap = 785 - HomeChromeMetrics.collectionSplitHeightDp(785)
        assertEquals(377, remainingMap)
        assertTrue(remainingMap >= 180)
    }

    @Test
    fun sourceMenuMatchesReferencePositionAndFitsNarrowPhones() {
        val reference = HomeChromeMetrics.panelFrame("sources", 300, 390, 857, topAligned = true)
        assertEquals(56, reference.leftMarginDp)
        assertEquals(276, reference.widthDp)
        assertEquals(56, reference.topMarginDp)
        assertEquals(480, reference.maxHeightDp)

        val narrow = HomeChromeMetrics.panelFrame("sources", 300, 360, 780, topAligned = true)
        assertEquals(56, narrow.leftMarginDp)
        assertEquals(246, narrow.widthDp)
        assertEquals(480, narrow.maxHeightDp)
    }

    @Test
    fun compactPanelsRespectWidthAndHeightExceptions() {
        val route = HomeChromeMetrics.panelFrame("route", 300, 390, 857, topAligned = false)
        assertEquals(300, route.widthDp)
        assertEquals(200, route.maxHeightDp)

        val marker = HomeChromeMetrics.panelFrame("marker", 300, 390, 857, topAligned = true)
        assertEquals(220, marker.widthDp)
        assertEquals(240, marker.maxHeightDp)

        val shortSource = HomeChromeMetrics.panelFrame("sources", 300, 390, 480, topAligned = true)
        assertEquals(298, shortSource.maxHeightDp)
    }

    @Test
    fun sectionContentPanelsRetainTheirDeclaredHeightException() {
        for (id in listOf("native-section", "native-section-profile")) {
            val normal = HomeChromeMetrics.panelFrame(id, 320, 390, 857, topAligned = true)
            assertEquals(480, normal.maxHeightDp)
            val narrow = HomeChromeMetrics.panelFrame(id, 320, 360, 780, topAligned = true)
            assertEquals(480, narrow.maxHeightDp)
            val short = HomeChromeMetrics.panelFrame(id, 320, 390, 480, topAligned = true)
            assertEquals(360, short.maxHeightDp)
        }
        assertEquals(200, HomeChromeMetrics.panelFrame("draw", 300, 390, 857, true).maxHeightDp)
        assertEquals(200, HomeChromeMetrics.panelFrame("native-section-edit", 320, 390, 857, true).maxHeightDp)
    }

    @Test
    fun onlyLegacyContentPanelsReceiveTheirExplicitTallCaps() {
        assertEquals(480, HomeChromeMetrics.panelFrame("source-editor", 320, 390, 857, true).maxHeightDp)
        assertEquals(737, HomeChromeMetrics.panelFrame("industry", 340, 390, 857, true).maxHeightDp)
        assertEquals(820, HomeChromeMetrics.panelFrame("industry", 390, 390, 1024, true).maxHeightDp)
        assertEquals(330, HomeChromeMetrics.panelFrame("native-photos", 320, 390, 857, true).maxHeightDp)
        assertEquals(200, HomeChromeMetrics.panelFrame("native-cad", 320, 390, 857, true).maxHeightDp)
    }

    @Test
    fun navigationCardMatchesHomepageAnchorAndLeavesUnlockEntryAvailable() {
        val frame = HomeChromeMetrics.panelFrame("navigation", 300, 390, 857, topAligned = true)
        assertEquals(300, frame.widthDp)
        assertEquals(52, frame.topMarginDp)
        assertEquals(200, frame.maxHeightDp)
        assertTrue(HomeChromeMetrics.showLockEntry(false, "navigation", false))
        assertFalse(HomeChromeMetrics.showLockEntry(false, "favorite", false))
        assertTrue(HomeChromeMetrics.showLockEntry(true, "favorite", true))
    }

    @Test
    fun markerEditorUsesOrdinaryPanelCapRatherThanQuickMenuException() {
        val frame = HomeChromeMetrics.panelFrame("marker-editor", 220, 390, 857, topAligned = true)
        assertEquals(220, frame.widthDp)
        assertEquals(200, frame.maxHeightDp)
    }
}
