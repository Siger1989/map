package com.shantu.nativeapp.hybrid

import com.shantu.nativeapp.map.NativeMarkerPresentation
import org.junit.Assert.assertEquals
import org.junit.Test

class NativeMarkerPresentationTest {
    @Test fun distantMarkersKeepDotsAndNamesStartAtOriginalRawZoomNine() {
        assertEquals("dot", NativeMarkerPresentation.mode(3.0, false))
        assertEquals("dot", NativeMarkerPresentation.mode(7.999, false))
        assertEquals("icon", NativeMarkerPresentation.mode(8.0, false))
        assertEquals("icon", NativeMarkerPresentation.mode(8.999, false))
        assertEquals("label", NativeMarkerPresentation.mode(9.0, false))
        assertEquals("label", NativeMarkerPresentation.mode(3.0, true))
    }
}
