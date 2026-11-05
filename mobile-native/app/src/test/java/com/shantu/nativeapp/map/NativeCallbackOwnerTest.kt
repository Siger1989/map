package com.shantu.nativeapp.map

import org.junit.Assert.*
import org.junit.Test

class NativeCallbackOwnerTest {
    private class Owner(var calls: Int = 0)

    @Test fun cachedCallbacksBecomeInertAfterDisposalWithoutChangingTheirIdentity() {
        val target = Owner()
        val handle = NativeCallbackOwner(target)
        val callback = { handle.get()?.let { ++it.calls } }
        val original = callback
        assertEquals(1, callback())
        handle.detach()
        handle.detach()
        assertNull(handle.get())
        assertNull(callback())
        assertEquals(1, target.calls)
        assertSame(original, callback)
    }

    @Test fun closingOneMapDoesNotDetachTheOtherMapsCallbacks() {
        val first = NativeCallbackOwner(Owner())
        val second = NativeCallbackOwner(Owner())
        first.detach()
        assertNull(first.get())
        assertNotNull(second.get())
    }
}
