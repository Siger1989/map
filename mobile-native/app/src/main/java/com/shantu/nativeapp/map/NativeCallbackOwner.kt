package com.shantu.nativeapp.map

import java.util.concurrent.atomic.AtomicReference

/**
 * Callbacks stored in shared texture keys can outlive their map. Capture this handle locally,
 * not the owning window, and detach on disposal so cached images cannot keep a closed map alive.
 * An already executing callback may finish; existing generation/cancellation checks still apply.
 */
internal class NativeCallbackOwner<T : Any>(owner: T) {
    private val reference = AtomicReference<T?>(owner)
    fun get(): T? = reference.get()
    fun detach() { reference.set(null) }
}
