package com.shantu.nativeapp.ui
import org.junit.Assert.*
import org.junit.Test
class NativeScaleMathTest {
    @Test fun niceScaleNeverExceedsRealMaximum() {
        val mark=NativeScaleMath.mark(327.0,44f)!!
        assertEquals(200.0,mark.meters,0.0);assertEquals(26.9113,mark.width.toDouble(),.001)
        assertEquals("200 m",mark.label)
        assertEquals("2 km",NativeScaleMath.mark(4200.0,44f)!!.label)
        assertNull(NativeScaleMath.mark(Double.NaN,44f));assertNull(NativeScaleMath.mark(0.0,44f))
    }
}
