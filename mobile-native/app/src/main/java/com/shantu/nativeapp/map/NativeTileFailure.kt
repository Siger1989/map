package com.shantu.nativeapp.map

import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.Collections
import java.util.IdentityHashMap
import java.util.concurrent.TimeoutException
import javax.net.ssl.SSLException

internal enum class NativeTileFailureKind(val safeLabel: String) {
    DOMAIN_UNRESOLVED("图源域名无法解析"),
    TLS_CONNECTION("图源 TLS 连接失败"),
    TIMEOUT("图源请求超时"),
    OTHER("地图网络请求失败"),
}

/** Classify only exception types/cause chains; never surface provider messages or URLs. */
internal fun classifyNativeTileFailure(error: Throwable): NativeTileFailureKind {
    val seen = Collections.newSetFromMap(IdentityHashMap<Throwable, Boolean>())
    var current: Throwable? = error
    var foundTls = false
    var foundTimeout = false
    var depth = 0
    while (current != null && depth < MAX_CAUSE_DEPTH && seen.add(current)) {
        when (current) {
            is UnknownHostException -> return NativeTileFailureKind.DOMAIN_UNRESOLVED
            is SSLException -> foundTls = true
            is SocketTimeoutException, is TimeoutException -> foundTimeout = true
        }
        current = current.cause
        depth++
    }
    return when {
        foundTls -> NativeTileFailureKind.TLS_CONNECTION
        foundTimeout -> NativeTileFailureKind.TIMEOUT
        else -> NativeTileFailureKind.OTHER
    }
}

internal fun nativeTileFailureStatus(error: Throwable, retryExhausted: Boolean): String {
    val suffix = if (retryExhausted) "；已达到本轮重试上限" else "；当前瓦片暂缓，可点重试"
    return classifyNativeTileFailure(error).safeLabel + suffix
}

private const val MAX_CAUSE_DEPTH = 16
