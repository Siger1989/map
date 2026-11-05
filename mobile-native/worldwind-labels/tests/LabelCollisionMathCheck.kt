package earth.worldwind.layer.mvt

import earth.worldwind.geom.Vec2
import kotlin.math.PI

private fun near(expected: Double, actual: Double) {
    check(kotlin.math.abs(expected - actual) < 0.001) { "Expected $expected, actual $actual" }
}

private fun box(y: Double, width: Double, height: Double, anchorY: Double = 0.0, scale: Double = 1.0): FloatArray =
    FloatArray(4).also {
        MvtLabelCollisionMath.bounds(100.0, y, width, height, width / 2, anchorY, scale, 3f, it)
    }

private fun overlaps(a: FloatArray, b: FloatArray) =
    a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]

fun main() {
    // A 14sp font at high density has device metrics far larger than the logical 14.
    // Two baselines 30px apart must collide when the actual glyph texture is 53px tall.
    val actualHeight = MvtLabelCollisionMath.textureHeight(-36.4f, 9.1f, 1, 2)
    near(53.0, actualHeight)
    check(overlaps(box(100.0, 80.0, actualHeight), box(130.0, 80.0, actualHeight)))
    check(!overlaps(box(100.0, 80.0, 14.0 * 1.3), box(130.0, 80.0, 14.0 * 1.3)))

    // OpenGL Y increases upward: a bottomCenter label occupies the area above its anchor.
    val bottomCenter = box(400.0, 80.0, 53.0)
    near(397.0, bottomCenter[1].toDouble())
    near(456.0, bottomCenter[3].toDouble())
    check(overlaps(bottomCenter, box(440.0, 80.0, 20.0)))
    check(!overlaps(bottomCenter, box(365.0, 80.0, 20.0)))

    val topCenter = box(400.0, 80.0, 53.0, anchorY = 53.0)
    near(344.0, topCenter[1].toDouble())
    near(403.0, topCenter[3].toDouble())

    val center = box(400.0, 80.0, 54.0, anchorY = 27.0)
    near(370.0, center[1].toDouble())
    near(430.0, center[3].toDouble())

    // Text scale changes dimensions and anchor displacement together; padding stays in screen px.
    val scaled = box(400.0, 80.0, 54.0, anchorY = 27.0, scale = 2.0)
    near(343.0, scaled[1].toDouble())
    near(457.0, scaled[3].toDouble())
    near(17.0, scaled[0].toDouble())
    near(183.0, scaled[2].toDouble())

    // Two rows plus the exact rasterizer border/halo must not use a one-line collision height.
    near(100.0, MvtLabelCollisionMath.textureHeight(-36.4f, 9.1f, 2, 2))

    // W is row 4 of the actual row-major MVP, not eye distance or the projection's Z row.
    val mvp = DoubleArray(16)
    mvp[12] = 2.0; mvp[13] = 3.0; mvp[14] = -4.0; mvp[15] = 7.0
    near(7.0, MvtLabelCollisionMath.clipW(mvp, 5.0, 6.0, 7.0))

    // With a 10:1 depth ratio, linear geographic t=.5 projects to u=.909, not the desired .5.
    val corrected = MvtLabelCollisionMath.perspectiveFraction(0.5, 1.0, 10.0)
    near(1.0 / 11.0, corrected)
    near(0.5, corrected * 10.0 / ((1.0 - corrected) + corrected * 10.0))
    check(kotlin.math.abs(0.5 * 10.0 / (0.5 + 0.5 * 10.0) - 0.5) > 0.4)

    near(0.0, MvtLabelCollisionMath.perspectiveFraction(0.0, 2.0, 9.0))
    near(1.0, MvtLabelCollisionMath.perspectiveFraction(1.0, 2.0, 9.0))
    near(0.35, MvtLabelCollisionMath.perspectiveFraction(0.35, 8.0, 8.0))
    check(MvtLabelCollisionMath.perspectiveFraction(0.5, -1.0, 9.0).isNaN())
    check(MvtLabelCollisionMath.perspectiveFraction(Double.NaN, 1.0, 9.0).isNaN())

    check(MvtLabelCollisionMath.projectionMatches(102.0, 200.0, 100.0, 200.0))
    check(!MvtLabelCollisionMath.projectionMatches(102.01, 200.0, 100.0, 200.0))
    check(!MvtLabelCollisionMath.projectionMatches(102.0, 202.0, 100.0, 200.0))
    check(!MvtLabelCollisionMath.projectionMatches(Double.NaN, 200.0, 100.0, 200.0))

    val rotated = FloatArray(4)
    MvtLabelCollisionMath.rotatedBounds(100.0, 200.0, 20.0, 10.0, 10.0, 5.0, 1.0, PI / 2.0, 0f, rotated)
    near(95.0, rotated[0].toDouble()); near(190.0, rotated[1].toDouble())
    near(105.0, rotated[2].toDouble()); near(210.0, rotated[3].toDouble())

    // Mirror Label's actual transform, including the unscaled pivot at scale=2; do not assume
    // a centered scaled glyph rotates about its geographic anchor in the unmodified SDK.
    MvtLabelCollisionMath.rotatedBounds(100.0, 200.0, 20.0, 10.0, 10.0, 5.0, 2.0, PI / 2.0, 0f, rotated)
    near(75.0, rotated[0].toDouble()); near(185.0, rotated[1].toDouble())
    near(95.0, rotated[2].toDouble()); near(225.0, rotated[3].toDouble())

    val plain = FloatArray(4)
    MvtLabelCollisionMath.bounds(100.0, 200.0, 20.0, 10.0, 10.0, 0.0, 1.7, 3f, plain)
    MvtLabelCollisionMath.rotatedBounds(100.0, 200.0, 20.0, 10.0, 10.0, 0.0, 1.7, 0.0, 3f, rotated)
    for (i in plain.indices) near(plain[i].toDouble(), rotated[i].toDouble())

    check(MvtLabelCollisionMath.readableAngles(floatArrayOf(0.0f, 0.2f, 0.4f), 3))
    check(MvtLabelCollisionMath.readableAngles(floatArrayOf(-1.4f, -1.3f), 2))
    check(!MvtLabelCollisionMath.readableAngles(floatArrayOf(0.0f, 2.9f), 2))
    check(!MvtLabelCollisionMath.readableAngles(floatArrayOf(0.0f, 0.6f), 2))
    check(!MvtLabelCollisionMath.readableAngles(floatArrayOf(-0.6f, -0.3f, 0f, 0.3f, 0.6f), 5))

    // Exercise the unchanged SDK placer itself, rather than recreating its centering rules.
    val straight = MvtCurvedTextPlacer.place(listOf(Vec2(0.0, 0.0), Vec2(1000.0, 0.0)),
        "测试道路", floatArrayOf(20f, 20f, 20f, 20f), 80f, 1100f)
    check(straight.size == 1)
    near(500.0, straight.single().centerX.toDouble()) // original collider incorrectly used x=1000
    check(straight.single().glyphs.all { it.angleRad == 0f })

    // A net-eastward hairpin has both valid eastward runs and locally inverted westward runs.
    // Rejecting the latter must leave the former available; no whole-feature suppression.
    val hairpin = MvtCurvedTextPlacer.place(listOf(Vec2(0.0, 0.0), Vec2(500.0, 0.0),
        Vec2(500.0, 80.0), Vec2(0.0, 80.0), Vec2(800.0, 160.0)),
        "测试道路", floatArrayOf(30f, 30f, 30f, 30f), 120f, 100f)
    val legible = hairpin.count { run ->
        MvtLabelCollisionMath.readableAngles(run.glyphs.map { it.angleRad }.toFloatArray(), run.glyphs.size)
    }
    check(legible > 0 && legible < hairpin.size)
    check(hairpin.all { it.glyphs.map { g -> g.char }.joinToString("") == "测试道路" })

    // Place labels occupy the shared buffer first. A collision at one repeat cannot consume
    // or disable a second clear repeat, which then participates in subsequent line collisions.
    val ax1 = floatArrayOf(100f, 0f); val ay1 = floatArrayOf(100f, 0f)
    val ax2 = floatArrayOf(160f, 0f); val ay2 = floatArrayOf(160f, 0f)
    val blockedRepeat = floatArrayOf(110f, 110f, 150f, 140f)
    val clearRepeat = floatArrayOf(400f, 110f, 450f, 140f)
    check(MvtLabelCollisionMath.overlapsAccepted(blockedRepeat, ax1, ay1, ax2, ay2, 1))
    check(!MvtLabelCollisionMath.overlapsAccepted(clearRepeat, ax1, ay1, ax2, ay2, 1))
    ax1[1] = clearRepeat[0]; ay1[1] = clearRepeat[1]; ax2[1] = clearRepeat[2]; ay2[1] = clearRepeat[3]
    check(MvtLabelCollisionMath.overlapsAccepted(floatArrayOf(430f, 120f, 470f, 150f), ax1, ay1, ax2, ay2, 2))
    // The visible iterator retains the SDK's start/spacing/tangent formula on ordinary geometry.
    val layouts = listOf(
        listOf(Vec2(0.0, 0.0), Vec2(1000.0, 0.0)),
        listOf(Vec2(0.0, 0.0), Vec2(500.0, 0.0), Vec2(500.0, 80.0), Vec2(0.0, 80.0), Vec2(800.0, 160.0)),
        listOf(Vec2(0.0, 0.0), Vec2(0.0, 0.0), Vec2(330.0, 210.0), Vec2(880.0, 330.0)),
    )
    val counts = LongArray(2)
    for (path in layouts) {
        val expected = MvtCurvedTextPlacer.place(path, "测试道路", floatArrayOf(30f, 30f, 30f, 30f), 120f, 100f)
        val actual = MvtLabelCollisionMath.placeVisible(path, "测试道路", floatArrayOf(30f, 30f, 30f, 30f), 120f, 100f,
            -10000.0, -10000.0, 10000.0, 10000.0, counts)
        check(expected.size == actual.size && counts[0] == actual.size.toLong() && counts[1] == 0L)
        for (i in actual.indices) for (j in actual[i].glyphs.indices) {
            val e = expected[i].glyphs[j]; val a = actual[i].glyphs[j]
            check(e.char == a.char && e.segIndex == a.segIndex)
            near(e.x.toDouble(), a.x.toDouble()); near(e.y.toDouble(), a.y.toDouble())
            near(e.angleRad.toDouble(), a.angleRad.toDouble())
        }
    }

    val path = listOf(Vec2(-10000.0, 100.0), Vec2(1500.0, 300.0), Vec2(10000.0, 100.0))
    val all = MvtCurvedTextPlacer.place(path, "测试道路", floatArrayOf(30f, 30f, 30f, 30f), 120f, 100f)
    val expectedVisible = all.filter { run -> run.glyphs.any { it.x >= 0f && it.x <= 2000f && it.y >= 0f && it.y <= 400f } }
    val actualVisible = MvtLabelCollisionMath.placeVisible(path, "测试道路", floatArrayOf(30f, 30f, 30f, 30f), 120f, 100f,
        0.0, 0.0, 2000.0, 400.0, counts)
    check(expectedVisible.size == actualVisible.size)
    check(counts[0] == all.size.toLong() && counts[1] == (all.size - actualVisible.size).toLong())
    for (i in actualVisible.indices) near(expectedVisible[i].centerX.toDouble(), actualVisible[i].centerX.toDouble())

    // A near-plane segment may span billions of projected pixels. Enumerate only visible repeats,
    // retaining subpixel local spacing even though the SDK's stored Float segU loses precision here.
    val largeStart = System.nanoTime()
    val huge = MvtLabelCollisionMath.placeVisible(listOf(Vec2(-1e9, 0.0), Vec2(1e9, 0.0)),
        "测试道路", floatArrayOf(30f, 30f, 30f, 30f), 120f, 1100f, -2000.0, -100.0, 2000.0, 100.0, counts)
    check(counts[0] > 1_000_000 && huge.size in 1..8)
    for (run in huge) for (i in 1 until run.glyphs.size)
        near(30.0, (run.glyphs[i].x - run.glyphs[i - 1].x).toDouble())
    val glyph = huge.first().glyphs.first()
    val preciseU = MvtLabelCollisionMath.screenFraction(glyph.x.toDouble(), 0.0, -1e9, 0.0, 1e9, 0.0)
    near(glyph.x.toDouble(), -1e9 + 2e9 * preciseU)
    println("visible-repeat stress: planned=" + counts[0] + ", materialized=" + huge.size +
        ", elapsed_ns=" + (System.nanoTime() - largeStart))
    println("PASS: 20 contracts (6 metrics/anchor, MVP W, perspective mapping/guards, residual gate, rotated bounds/scale, upright curvature, original placer midpoint/hairpin, independent repeat collision, original-formula equivalence, viewport phase, bounded offscreen enumeration)")
}
