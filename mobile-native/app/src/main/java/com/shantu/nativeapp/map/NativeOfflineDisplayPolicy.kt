package com.shantu.nativeapp.map

private val NATIVE_OFFLINE_PROVIDERS = setOf("tianditu", "openfreemap", "imported")

/** Global render policy mirrored from the existing React offline-map package selector. */
data class NativeOfflineDisplayPolicyState(
    val version: Int = 1,
    val enabled: Boolean = false,
    val packageId: String? = null,
    val sourceId: String? = null,
    val provider: String? = null,
    val vectorTileTemplates: List<String> = emptyList(),
) {
    val hasSelectedPackage: Boolean
        get() = enabled && !packageId.isNullOrBlank() && provider in NATIVE_OFFLINE_PROVIDERS &&
            (provider != "imported" || !sourceId.isNullOrBlank())
}

/** Fail-closed cache-only decision. Membership is checked against that package's committed manifest. */
object NativeOfflineDisplayPolicy {
    @Volatile private var current = NativeOfflineDisplayPolicyState()
    private var lastMissReportNanos = 0L

    fun snapshot(): NativeOfflineDisplayPolicyState = current

    fun update(state: NativeOfflineDisplayPolicyState) {
        current = if (state.version == 1) state.copy(
            packageId = state.packageId?.takeIf { it.isNotBlank() },
            sourceId = state.sourceId?.takeIf { it.isNotBlank() },
            provider = state.provider?.takeIf { it in PROVIDERS },
            vectorTileTemplates = state.vectorTileTemplates.asSequence().filter(::validOpenFreeMapTemplate).distinct().take(MAX_TEMPLATES).toList(),
        ) else NativeOfflineDisplayPolicyState(enabled = state.enabled)
    }

    fun reset() { current = NativeOfflineDisplayPolicyState() }

    /** Whether a cache read is allowed. With cache-only on, only exact selected-manifest members pass. */
    fun permitsCachedRead(url: String, packageContains: (packageId: String, url: String) -> Boolean): Boolean {
        val state = current
        if (!state.enabled) return true
        val packageId = state.packageId ?: return false
        if (state.provider !in NATIVE_OFFLINE_PROVIDERS) return false
        if (state.provider == "imported" && state.sourceId.isNullOrBlank()) return false
        return runCatching { packageContains(packageId, url) }.getOrDefault(false)
    }

    suspend fun readSelectedCache(url: String): ByteArray? {
        val state = current
        if (!state.enabled) return null
        val packageId = state.packageId ?: run { reportMiss("未选择有效缓存包，离线地图保持空缺且不会联网"); return null }
        if (state.provider !in NATIVE_OFFLINE_PROVIDERS ||
            (state.provider == "imported" && state.sourceId.isNullOrBlank())) {
            reportMiss("当前离线缓存包信息无效，地图资源保持空缺")
            return null
        }
        // Native committed packages remain the first choice. Historical browser packages are
        // independently checked by the trusted JS reader against their exact original URL list.
        val nativeHit = if (NativeTileNetworkPool.containsSelectedPackageUrl(packageId, url)) {
            NativeTileNetworkPool.readSelectedPackageUrl(packageId, url)
        } else null
        if (nativeHit != null) return nativeHit
        val browserHit = NativeTileNetworkPool.readSelectedBrowserPackageUrl(packageId, url)
        if (browserHit != null && browserHit.size <= NativeBrowserCacheFallback.MAX_TILE_BYTES) return browserHit
        reportMiss("当前缓存包缺少此地图瓦片；离线模式不会联网补取")
        return null
    }

    fun isSelectedCacheMember(url: String): Boolean {
        val state = current
        if (!state.enabled) return false
        val packageId = state.packageId
        if (packageId == null || !permitsCachedRead(url) { id, requestedUrl ->
                id == packageId && NativeTileNetworkPool.containsSelectedPackageUrl(id, requestedUrl)
            }) {
            reportMiss("当前缓存包不包含此地图资源，已保持离线显示")
            return false
        }
        return true
    }

    /** Rebuild a URL only from the currently selected package's observed manifest template. */
    fun selectedOpenFreeMapTileUrl(z: Int, x: Int, y: Int): String? {
        val state = current
        if (!state.enabled || state.provider != "openfreemap" || z !in 0..14) return null
        val edge = 1 shl z
        if (x !in 0 until edge || y !in 0 until edge) return null
        val template = state.vectorTileTemplates.firstOrNull(::validOpenFreeMapTemplate) ?: return null
        return template.replace("{z}", z.toString()).replace("{x}", x.toString()).replace("{y}", y.toString())
    }

    fun reportMissingOpenFreeMapTemplate() = reportMiss("所选缓存包未保存可用的OpenFreeMap瓦片模板；道路与地名保持缺失且不会联网")

    private fun reportMiss(message: String) {
        val now = System.nanoTime()
        synchronized(this) {
            if (now - lastMissReportNanos < MISS_REPORT_INTERVAL_NANOS) return
            lastMissReportNanos = now
        }
        NativeTileNetworkPool.reportOfflineStatus(message)
    }

    /** Network is forbidden for every request while the selected-package-only mode is enabled. */
    fun permitsNetwork(explicitBulkDownload: Boolean = false): Boolean = explicitBulkDownload || !current.enabled

    private const val MISS_REPORT_INTERVAL_NANOS = 5_000_000_000L
    private const val MAX_TEMPLATES = 4
    private val PROVIDERS = NATIVE_OFFLINE_PROVIDERS
}

private fun validOpenFreeMapTemplate(template: String): Boolean =
    template.length <= 512 && template.matches(Regex("https://tiles\\.openfreemap\\.org/planet/[A-Za-z0-9._-]+/\\{z}/\\{x}/\\{y}\\.pbf"))
