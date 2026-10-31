package com.shantu.nativeapp.map

import earth.worldwind.PickedObject
import earth.worldwind.PickedObjectList
import earth.worldwind.geom.Position
import org.junit.Assert.*
import org.junit.Test

class NativeRenderedPickResultsTest {
    private class Pick(id: Int, delegate: Any, top: Boolean, terrain: Boolean = false) :
        PickedObject(id, delegate, terrainPosition = if (terrain) Position() else null) {
        init { isOnTop = top }
    }
    private fun result(vararg picks: PickedObject) = PickedObjectList().also { list -> picks.forEach(list::offerPickedObject) }

    @Test fun emptyPixelCannotSelectAnUnhitPreviouslyRegisteredObject() {
        val rect = result(Pick(1, "shantu-object:old-object", false), Pick(2, Position(), true, true))
        assertEquals(2, rect.count) // The SDK rectangle result still contains the unhit candidate.
        assertTrue(NativeRenderedPickResults.objectIds(rect).isEmpty())
    }

    @Test fun actualTargetWinsEvenWhenAnOlderCandidatePrecedesIt() {
        val rect = result(Pick(1, "shantu-object:old-object", false), Pick(2, "shantu-object:target", true))
        assertEquals(listOf("target"), NativeRenderedPickResults.objectIds(rect))
        assertEquals(listOf("old-object"), NativeRenderedPickResults.objectIds(
            result(Pick(1, "shantu-object:old-object", true), Pick(2, "shantu-object:target", false))))
    }

    @Test fun actualPhotoRouteSectionAndGeologyHitsKeepTheirDelegatesAndUnknownCandidatesStayExcluded() {
        val route="shantu-bridge:{\"kind\":\"route\"}"
        val rect=result(Pick(1, "shantu-photo:p", true), Pick(2, route, true), Pick(3, "geology:u", true),
            Pick(4, "shantu-section:s", true), Pick(5, "shantu-object:target", true),
            Pick(6, "shantu-object:target", true), Pick(7, "unknown", true), Pick(8, "shantu-object:old-object", false))
        assertEquals(listOf("shantu-photo:p", route, "geology:u", "shantu-section:s", "target"), NativeRenderedPickResults.objectIds(rect))
        assertTrue(NativeRenderedPickResults.objectIds(null).isEmpty())
    }
}
