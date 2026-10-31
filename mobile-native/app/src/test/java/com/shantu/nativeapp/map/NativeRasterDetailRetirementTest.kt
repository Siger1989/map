package com.shantu.nativeapp.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeRasterDetailRetirementTest {
    private data class FakeRenderable(val id: String)
    private data class FakeImageKey(val id: String)

    @Test
    fun `retiring one detail image removes only its renderable and texture`() {
        val base = FakeRenderable("base")
        val first = FakeRenderable("detail-1")
        val second = FakeRenderable("detail-2")
        val baseKey = FakeImageKey("base-image")
        val firstKey = FakeImageKey("detail-image-1")
        val secondKey = FakeImageKey("detail-image-2")
        val renderables = mutableListOf(base)
        val textures = linkedSetOf(baseKey, firstKey, secondKey)
        val mutation = mutation(renderables, textures)

        assertTrue(mutation.addIfCurrent(first, { true }) { true })
        assertTrue(mutation.addIfCurrent(second, { true }) { true })
        mutation.retire(first, firstKey)

        assertEquals(listOf(base, second), renderables)
        assertEquals(setOf(baseKey, secondKey), textures)
    }

    @Test
    fun `clear path retires every supplied detail resource and preserves base imagery`() {
        val base = FakeRenderable("base")
        val detailA = FakeRenderable("detail-a")
        val detailB = FakeRenderable("detail-b")
        val baseKey = FakeImageKey("base-image")
        val detailAKey = FakeImageKey("detail-a-image")
        val detailBKey = FakeImageKey("detail-b-image")
        val renderables = mutableListOf(base, detailA, detailB)
        val textures = linkedSetOf(baseKey, detailAKey, detailBKey)
        val mutation = mutation(renderables, textures)

        mutation.retireAll(listOf(detailA to detailAKey, detailB to detailBKey))

        assertEquals(listOf(base), renderables)
        assertEquals(setOf(baseKey), textures)
    }

    @Test
    fun `late tile callback after close cannot reattach a renderable`() {
        val renderable = FakeRenderable("late-detail")
        val renderables = mutableListOf<FakeRenderable>()
        val textures = linkedSetOf<FakeImageKey>()
        val mutation = mutation(renderables, textures)
        var closed = false
        var generation = 7
        val callbackGeneration = generation

        closed = true
        generation++
        val added = mutation.addIfCurrent(renderable, { !closed && callbackGeneration == generation }) { true }

        assertFalse(added)
        assertTrue(renderables.isEmpty())
        assertTrue(textures.isEmpty())
    }

    private fun mutation(
        renderables: MutableList<FakeRenderable>,
        textures: MutableSet<FakeImageKey>,
    ) = NativeRasterDetailSceneMutation<FakeRenderable, FakeImageKey>(
        renderMonitor = Any(),
        addRenderable = { assertTrue(renderables.add(it)) },
        removeRenderable = { assertTrue(renderables.remove(it)) },
        removeTexture = { assertTrue(textures.remove(it)) },
    )
}
