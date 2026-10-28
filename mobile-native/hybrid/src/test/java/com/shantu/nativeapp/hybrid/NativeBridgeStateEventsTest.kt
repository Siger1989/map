package com.shantu.nativeapp.hybrid

import com.shantu.nativeapp.geology.NativeGeologyState
import com.shantu.nativeapp.geology.NativeGeologyStatus
import com.shantu.nativeapp.geology.NativeGeologyUnit
import com.shantu.nativeapp.map.NativeImageryStatus
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class NativeBridgeStateEventsTest {
    @Test fun imageryUsesTheOriginalReactCallbackNames() {
        val value = NativeBridgeStateEvents.satellite(NativeImageryStatus("sentinel-latest", true, "2026-10-28", "ready"))
        assertEquals("2026-10-28", value.getString("date")); assertEquals("ready", value.getString("status")); assertTrue(value.getBoolean("ready"))
    }
    @Test fun geologyKeepsLegendSelectionSourcesAndRequiredUnitFields() {
        val unit = NativeGeologyUnit("unit1", "岩层", "年代", "岩性", "#123456", "描述", "Macrostrat", "https://macrostrat.org/")
        val value = NativeBridgeStateEvents.geology(NativeGeologyState(status = NativeGeologyStatus.READY, units = listOf(unit), selected = unit))
        assertEquals(1, value.getJSONArray("legend").length()); assertEquals(1, value.getJSONArray("sources").length())
        assertEquals("#123456", value.getJSONObject("selection").getString("color"))
        assertEquals("unit1", value.getJSONObject("cursorSelection").getString("key"))
        val denied = NativeBridgeStateEvents.geology(NativeGeologyState(units = listOf(unit.copy(sourceUrl = "https://example.test/?token=fixture"))))
        assertTrue(denied.getJSONArray("sources").getJSONObject(0).isNull("url"))
    }
    @Test fun sectionStatusReportsTheOriginalShapeAndDoesNotCallLoadingReady() {
        val value = NativeBridgeStateEvents.sectionPhase("sampling")
        assertEquals("loading", value.getString("phase"))
        listOf("min", "max", "spacing", "samples", "valid", "tiles", "models").forEach { assertTrue(value.has(it)) }
    }
}
