package com.guanyun.weather

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.security.MessageDigest

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class HybridOfflineTilesTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private fun tile(x: Int, host: Int = 0, key: String = "fixture") = "https://t$host.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&LAYER=img&TILEMATRIX=12&TILECOL=$x&TILEROW=2&tk=$key"
    @Test fun selectedManifestRestrictsMembershipAndNormalizesTdtHostAndCredentialRotation() {
        val id = "membership-test"
        val lines = (1..20).map { tile(it) }
        var digest = ""
        lines.forEach { line -> digest = sha(digest.toByteArray(Charsets.US_ASCII) + (line + "\n").toByteArray()) }
        OfflineStore.write(OfflineStore.urlsFile(context, id), (lines.joinToString("\n") + "\n").toByteArray())
        OfflineStore.write(OfflineStore.job(context, id), JSONObject().put("id", id).put("provider", "imported").put("total", lines.size).put("manifestDigest", digest).toString().toByteArray())
        assertTrue(HybridOfflineTiles.containsPackageUrl(context, id, tile(4, 7, "rotated-fixture")))
        assertFalse(HybridOfflineTiles.containsPackageUrl(context, id, tile(30)))
        assertFalse(HybridOfflineTiles.containsPackageUrl(context, "missing", tile(4)))
        OfflineStore.write(OfflineStore.job(context, id), JSONObject().put("id", id).put("total", lines.size).put("manifestDigest", "bad").toString().toByteArray())
        assertFalse(HybridOfflineTiles.containsPackageUrl(context, id, tile(4)))
    }
    @Test fun legacyCommittedUrlsWorkButStagingAloneDoesNotGrantMembership() {
        val id = "legacy-membership"
        OfflineStore.write(OfflineStore.job(context, id), JSONObject().put("id", id).put("total", 2)
            .put("urls", JSONArray(listOf(tile(91), tile(92)))).toString().toByteArray())
        assertTrue(HybridOfflineTiles.containsPackageUrl(context, id, tile(91)))
        assertFalse(HybridOfflineTiles.containsPackageUrl(context, id, tile(93)))
        val stageId = "not-committed"
        OfflineStore.write(OfflineStore.stage(context, stageId), JSONObject().put("id", stageId).put("total", 1)
            .put("urls", JSONArray(listOf(tile(91)))).toString().toByteArray())
        assertFalse(HybridOfflineTiles.containsPackageUrl(context, stageId, tile(91)))
    }
    private fun sha(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}
