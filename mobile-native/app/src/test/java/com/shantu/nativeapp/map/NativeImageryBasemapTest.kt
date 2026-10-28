package com.shantu.nativeapp.map

import android.graphics.Bitmap
import android.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeImageryBasemapTest {
    @Test fun `offline base delegates to the host layer instead of clearing to blank or claiming Sentinel`() {
        assertEquals("host", nativeImageryBaseSource("offline"))
        assertEquals("sentinel-latest", nativeImageryBaseSource("sentinel-latest"))
        assertEquals("sentinel-detail", nativeImageryBaseSource("sentinel-detail"))
    }

    @Test fun `GIBS default date is tied to VIIRS layer and five day search stays dated`() {
        val xml = """
            <Capabilities><Contents><Layer>
              <ows:Identifier>OtherLayer</ows:Identifier><Dimension><Default>2026-10-27</Default></Dimension>
            </Layer><Layer><ows:Identifier>VIIRS_SNPP_CorrectedReflectance_TrueColor</ows:Identifier>
              <Dimension><Default>2026-10-28</Default></Dimension></Layer></Contents></Capabilities>
        """.trimIndent()
        val date = parseGibsDefaultDate(xml)
        assertEquals(LocalDate.parse("2026-10-28"), date)
        assertEquals("https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/2026-10-28/GoogleMapsCompatible_Level9/8/36/17.jpeg",
            gibsImageTileUrl(date.toString(), 8, 17, 36))
        assertEquals(5, (0..4).map { date.minusDays(it.toLong()) }.size)
    }

    @Test fun `latest coverage probe uses web mercator XYZ coordinates and guards poles`() {
        val equator = satelliteProbeTile(0.0, 0.0)
        assertEquals(8, equator.z); assertEquals(128, equator.x); assertEquals(128, equator.y)
        val northPole = satelliteProbeTile(180.0, 90.0)
        assertTrue(northPole.x in 0..255 && northPole.y in 0..255)
        assertEquals(255, northPole.x)
    }

    @Test fun `latest source is not ready for blank tile pixels and needs a valid local patch`() {
        val bitmap = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888)
        try {
            bitmap.eraseColor(Color.BLACK)
            assertFalse(hasSatelliteCoverage(bitmap, 8.0, 8.0))
            for (y in 0 until 16) for (x in 0 until 16) bitmap.setPixel(x, y, Color.rgb(80, 90, 100))
            assertTrue(hasSatelliteCoverage(bitmap, 8.0, 8.0))
        } finally { bitmap.recycle() }
    }

    @Test fun `EOX attribution states modified Copernicus data and noncommercial share alike`() {
        assertTrue(NativeImageryBasemap.SENTINEL_ATTRIBUTION.contains("modified Copernicus Sentinel data 2025"))
        assertTrue(NativeImageryBasemap.SENTINEL_ATTRIBUTION.contains("CC BY-NC-SA 4.0"))
        assertTrue(NativeImageryBasemap.GIBS_ATTRIBUTION.contains("NASA GIBS / VIIRS Suomi NPP"))
    }
}
