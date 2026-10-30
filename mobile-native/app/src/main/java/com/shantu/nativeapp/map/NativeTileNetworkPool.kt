package com.shantu.nativeapp.map

import android.content.Context
import java.lang.ref.WeakReference
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** Process-wide tile loader. Leases keep it alive without retaining any Activity or Service owner. */
internal object NativeTileNetworkPool {
    private val lock=Any()
    private val nextId=AtomicLong()
    private val listeners=linkedMapOf<Long,WeakReference<(String)->Unit>>()
    private var shared:BoundedTileNetwork?=null
    private var references=0
    @Volatile private var companionOfflineReader:((String)->ByteArray?)?=null
    @Volatile private var companionOfflinePackageMembership:((String,String)->Boolean)?=null
    @Volatile private var browserCacheReader:(suspend (String,String)->ByteArray?)?=null

    /** A host may expose its unchanged existing cache without coupling this module to that host. */
    fun installOfflineReader(reader:((String)->ByteArray?)?) { companionOfflineReader=reader }
    /** Exact URL membership in the selected committed package's original manifest. */
    fun installOfflinePackageMembership(reader:((String,String)->Boolean)?) { companionOfflinePackageMembership=reader }
    /** Async read-only fallback into the trusted WebView's currently selected CacheStorage package. */
    fun installBrowserCacheReader(reader:(suspend (String,String)->ByteArray?)?) { browserCacheReader=reader }
    internal fun containsSelectedPackageUrl(packageId:String,url:String):Boolean =
        runCatching { companionOfflinePackageMembership?.invoke(packageId,url) == true }.getOrDefault(false)
    internal fun readSelectedPackageUrl(packageId:String,url:String):ByteArray? =
        if(containsSelectedPackageUrl(packageId,url)) runCatching { companionOfflineReader?.invoke(url) }.getOrNull() else null
    internal suspend fun readSelectedBrowserPackageUrl(packageId:String,url:String):ByteArray? {
        val reader=browserCacheReader ?: return null
        return try { reader(packageId,url) }
        catch (cancelled:kotlinx.coroutines.CancellationException) { throw cancelled }
        catch (_:Exception) { null }
    }
    internal fun selectedPackageMembershipInstalled():Boolean = companionOfflinePackageMembership != null

    internal class Lease internal constructor(
        val network:BoundedTileNetwork,
        private val id:Long,
        keepAlive:(String)->Unit,
    ) : AutoCloseable {
        private val released=AtomicBoolean()
        @Volatile private var callback:((String)->Unit)?=keepAlive
        override fun close() {
            if(!released.compareAndSet(false,true))return
            callback=null
            release(id)
        }
        internal fun retainsCallbackForTest():Boolean=callback!=null
    }

    fun acquire(context:Context,onStatus:(String)->Unit):Lease = acquire(context,onStatus,null)

    internal fun acquire(context:Context,onStatus:(String)->Unit,client:TileHttpClient?):Lease = synchronized(lock) {
        val app=context.applicationContext
        val network=shared ?: run {
            val persistent=NativePersistentBrowseCache(app)
            (if(client==null) BoundedTileNetwork(app.cacheDir.resolve("shantu-native-map-tiles"),::dispatch,persistentCache=persistent)
            else BoundedTileNetwork(app.cacheDir.resolve("shantu-native-map-tiles"),::dispatch,client,isValidImage={true},persistentCache=persistent)).also {
                val legacy=com.shantu.nativeapp.offlineMaps.NativeLegacyOfflineArchive(context.applicationContext)
                it.legacyReader={url->legacy.lookupTile(url)?:companionOfflineReader?.invoke(url)};shared=it
            }
        }
        val id=nextId.incrementAndGet()
        listeners[id]=WeakReference(onStatus)
        references++
        Lease(network,id,onStatus)
    }

    private fun dispatch(message:String) {
        val targets=synchronized(lock) {
            listeners.entries.removeIf { it.value.get()==null }
            listeners.values.mapNotNull { it.get() }
        }
        targets.forEach { callback -> runCatching { callback(message) } }
    }

    internal fun reportOfflineStatus(message:String) = dispatch(message)

    private fun release(id:Long) {
        var toClose:BoundedTileNetwork?=null
        synchronized(lock) {
            listeners.remove(id)
            references=(references-1).coerceAtLeast(0)
            if(references==0) { toClose=shared; shared=null }
        }
        toClose?.close()
    }

    internal fun referenceCount():Int=synchronized(lock) { references }
}
