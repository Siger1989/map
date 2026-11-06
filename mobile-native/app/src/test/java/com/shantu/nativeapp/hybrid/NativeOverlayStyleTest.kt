package com.shantu.nativeapp.hybrid

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeOverlayStyleTest {
    @Test fun selectedRouteColorDoesNotFadeWithZoomButExplicitOpacityAndHaloArePreserved() {
        for (role in listOf("routePath", "track", "selectedEdge", "guidance", "ribbon")) {
            assertEquals(1.0, NativeOverlayStyle.routeStrokeOpacity(1.0, .55, role), .0001)
            assertEquals(.4, NativeOverlayStyle.routeStrokeOpacity(.4, .85, role), .0001)
            val actual = NativeOverlayStyle.color("#ffbb00", NativeOverlayStyle.routeStrokeOpacity(1.0, .85, role))
            assertEquals(1f, actual.red, .0001f)
            assertEquals(187f / 255f, actual.green, .0001f)
            assertEquals(0f, actual.blue, .0001f)
            assertEquals(1f, actual.alpha, .0001f)
        }
        assertEquals(.85, NativeOverlayStyle.routeStrokeOpacity(1.0, .85, "routeOutline"), .0001)
    }
    @Test fun cssWidthIsConvertedFromCssPixelsToNativePhysicalPixels() {
        assertEquals(8f, NativeOverlayStyle.widthInPixels(2.0, 4.0), 0.001f)
        assertEquals(0.5f, NativeOverlayStyle.widthInPixels(0.5, 1.0), 0.001f)
    }

    @Test fun routeStrokeZoomCurveMatchesTheWebExpressionStopsAndPreservesNearWidth() {
        val stops = listOf(0.0 to 0.12, 6.0 to 0.12, 10.0 to 0.3, 14.0 to 0.7, 16.0 to 1.0)
        stops.forEach { (zoom, scale) -> assertEquals(scale, NativeOverlayStyle.routeWidthScale(zoom), 0.0001) }
        assertEquals(0.21, NativeOverlayStyle.routeWidthScale(8.0), 0.0001)
        assertEquals(0.85, NativeOverlayStyle.routeWidthScale(15.0), 0.0001)
        assertEquals(1.0, NativeOverlayStyle.routeWidthScale(20.0), 0.0001)
        assertEquals(1.0, NativeOverlayStyle.routeWidthScale(Double.NaN), 0.0001)
    }

    @Test fun routeOpacityCurveMatchesWebStopsAndComposesFromOriginalAlphaOnZoomRoundTrips() {
        val stops = listOf(0.0 to 0.35, 6.0 to 0.35, 10.0 to 0.55, 14.0 to 0.85, 16.0 to 1.0)
        stops.forEach { (zoom, scale) -> assertEquals(scale, NativeOverlayStyle.routeOpacityScale(zoom), 0.0001) }
        assertEquals(0.45, NativeOverlayStyle.routeOpacityScale(8.0), 0.0001)
        assertEquals(0.925, NativeOverlayStyle.routeOpacityScale(15.0), 0.0001)
        val zoomSequence = listOf(6.0, 10.0, 14.0, 16.0, 6.0, 16.0)
        zoomSequence.forEach { zoom ->
            assertEquals(0.4 * NativeOverlayStyle.routeOpacityScale(zoom), NativeOverlayStyle.routeFeatureOpacity(0.4, zoom), 0.0001)
        }
        assertEquals(0.4, NativeOverlayStyle.routeFeatureOpacity(0.4, 16.0), 0.0001)
        assertEquals(0.14, NativeOverlayStyle.routeFeatureOpacity(0.4, 6.0), 0.0001)
        assertEquals(0.35, NativeOverlayStyle.routeFeatureOpacity(Double.NaN, 6.0), 0.0001)
    }

    @Test fun zoomScalingOnlyTargetsRouteTrackAndGuidanceStrokeRoles() {
        listOf("routePath", "routeOutline", "routeAccess", "track", "trackHalo", "selectedEdge",
            "guidance", "ribbon", "offset-reference").forEach { role ->
            assertEquals(role, true, NativeOverlayStyle.scalesRouteAppearance(role))
        }
        listOf("routePoint", "trackNode", "guidanceTarget", "chevron", "note", "warning", "linePoint")
            .forEach { role -> assertEquals(role, false, NativeOverlayStyle.scalesRouteAppearance(role)) }
    }

    @Test fun pointImageScaleKeepsRequestedCssDiameterAcrossViewportScales() {
        assertEquals(0.25, NativeOverlayStyle.imageScaleForCssSize(8.0, 2.0, 64), 0.0001)
        assertEquals(0.375, NativeOverlayStyle.imageScaleForCssSize(8.0, 3.0, 64), 0.0001)
        assertEquals(16.0, NativeOverlayStyle.imageScaleForCssSize(8.0, 2.0, 0), 0.0001)
    }

    @Test fun selectedAndActiveTrackNodesGetLegibleNativeSizesWithoutChangingSavedPointSize() {
        assertEquals(8.0, NativeOverlayStyle.emphasizedPointCssSize(8.0, false, false), 0.0)
        assertEquals(10.0, NativeOverlayStyle.emphasizedPointCssSize(8.0, true, false), 0.0)
        assertEquals(16.0, NativeOverlayStyle.emphasizedPointCssSize(8.0, true, true), 0.0)
        assertEquals(22.0, NativeOverlayStyle.emphasizedPointCssSize(22.0, false, true), 0.0)
    }

    @Test fun nodeIconSupportsCssColorSyntaxForItsBitmap() {
        val color = NativeOverlayStyle.androidColor("rgba(255, 64, 0, 0.5)")
        assertEquals(128, android.graphics.Color.alpha(color))
        assertEquals(255, android.graphics.Color.red(color))
        assertEquals(64, android.graphics.Color.green(color))
    }

    @Test fun rgbaAlphaAndFeatureOpacityAreMultiplied() {
        val color = NativeOverlayStyle.color("rgba(255, 64, 0, 0.5)", 0.4)
        assertEquals(1f, color.red, 0.001f)
        assertEquals(64f / 255f, color.green, 0.001f)
        assertEquals(0f, color.blue, 0.001f)
        assertEquals(0.2f, color.alpha, 0.001f)
    }

    @Test fun routeZoomFadeMultipliesOriginalCssAlphaWithoutCumulativeMutation() {
        val cssColor = "rgba(255, 64, 0, 0.5)"
        val baseOpacity = 0.6
        val near = NativeOverlayStyle.color(cssColor, NativeOverlayStyle.routeFeatureOpacity(baseOpacity, 16.0))
        val far = NativeOverlayStyle.color(cssColor, NativeOverlayStyle.routeFeatureOpacity(baseOpacity, 6.0))
        val nearAgain = NativeOverlayStyle.color(cssColor, NativeOverlayStyle.routeFeatureOpacity(baseOpacity, 16.0))
        assertEquals(0.3f, near.alpha, 0.001f)
        assertEquals(0.105f, far.alpha, 0.001f)
        assertEquals(near.alpha, nearAgain.alpha, 0.001f)
    }

    @Test fun cssEightDigitHexAndPercentageChannelsAreSupported() {
        assertEquals(0.25f, NativeOverlayStyle.color("#ff000040", 1.0).alpha, 0.01f)
        assertEquals(0.5f, NativeOverlayStyle.color("rgb(50% 25% 0%)", 1.0).red, 0.001f)
        assertEquals(1f, NativeOverlayStyle.color("#f00", 1.0).red, 0.001f)
        assertEquals(0x88 / 255f, NativeOverlayStyle.color("#f008", 1.0).alpha, 0.01f)
    }

    @Test fun malformedColorsAndNonFiniteWidthsFallBackWithoutThrowing() {
        val color = NativeOverlayStyle.color("rgba(garbage)", Double.NaN)
        assertEquals(208f / 255f, color.red, 0.001f)
        assertEquals(247f / 255f, color.green, 0.001f)
        assertEquals(2f, NativeOverlayStyle.widthInPixels(Double.NaN, Double.POSITIVE_INFINITY), 0.001f)
    }

    @Test fun dashArrayIsSerializedAsARepeatingStippleRatherThanIgnoredOrSolid() {
        val even = NativeOverlayStyle.dashStyle(JSONArray("[2,2]"), 4.0, 3.0)
        assertEquals(0xff00.toShort(), even?.pattern)
        assertEquals(3, even?.factor)
        assertNotNull(NativeOverlayStyle.dashStyle(JSONArray("[3,2]"), 5.0, 3.0))
        assertEquals(null, NativeOverlayStyle.dashStyle(JSONArray("[0,2]"), 2.0, 3.0))
    }
}
