package com.shantu.nativeapp.hybrid

import android.graphics.Bitmap
import android.util.Base64
import com.shantu.nativeapp.offlineMaps.NativeOfflineMapStore
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest

@RunWith(RobolectricTestRunner::class)
@org.robolectric.annotation.Config(sdk = [28], manifest = org.robolectric.annotation.Config.NONE)
class NativeReactAssetStoreTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private lateinit var png: ByteArray
    private val metadata get() = JSONObject().put("id", "react-local-1").put("name", "registered map")
        .put("kind", "image").put("format", "PNG image").put("blobMime", "image/png")
        .put("bounds", JSONArray(listOf(100.0, 20.0, 101.0, 21.0))).put("minzoom", 0).put("maxzoom", 22)
        .put("attribution", "test source")

    @Before fun setup() {
        context.filesDir.resolve("native-offline-maps").deleteRecursively()
        context.cacheDir.resolve("hybrid-map-transfer").deleteRecursively()
        val bitmap = Bitmap.createBitmap(intArrayOf(0xffff0000.toInt(), 0xff00ff00.toInt(), 0xff0000ff.toInt(), -1), 2, 2, Bitmap.Config.ARGB_8888)
        png = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        bitmap.recycle()
    }

    @Test fun importsOrderedChunksAndLookupSurvivesNewSessionAndDualMapReuse() {
        val store = NativeReactAssetStore(context)
        val sha = sha(png)
        begin(store, "t1", metadata, png, sha)
        begin(store, "t2", metadata, png, sha) // Both map views missed lookup before the first commit.
        sendChunks(store, "t1", png, split = true)
        sendChunks(store, "t2", png, split = false)
        val first = store.command("mapAssetCommit", JSONObject().put("transferId", "t1"))!!
        val second = store.command("mapAssetCommit", JSONObject().put("transferId", "t2"))!!
        assertEquals(first.getString("nativeAssetId"), second.getString("nativeAssetId"))
        assertEquals(png.size.toLong(), first.getLong("size"))
        val again = NativeReactAssetStore(context)
        val lookup = again.command("mapAssetLookup", lookupPayload(metadata, sha))!!
        assertTrue(lookup.getBoolean("found"))
        assertEquals(first.getString("nativeAssetId"), lookup.getString("nativeAssetId"))
        assertEquals(1, NativeOfflineMapStore(context).list().size)
        assertEquals(first.getString("nativeAssetId"), again.command("mapAssetLookup", lookupPayload(metadata, sha))!!.getString("nativeAssetId"))
        assertNotNull(again.resolve(JSONObject(metadata.toString()).put("nativeAssetId", lookup.getString("nativeAssetId"))))
        store.close(); again.close()
    }

    @Test fun rejectsOutOfOrderChunksOversizeAndBadShaWithoutCommitting() {
        val store = NativeReactAssetStore(context)
        val sha = sha(png)
        val outOfOrder = JSONObject().put("transferId", "order").put("sourceId", "react-local-1")
            .put("size", png.size).put("sha256", sha).put("metadata", metadata).put("blobMime", "image/png")
        store.command("mapAssetBegin", outOfOrder)
        assertNotNull(runCatching { store.command("mapAssetChunk", JSONObject().put("transferId", "order").put("index", 1).put("base64", Base64.encodeToString(png, Base64.NO_WRAP))) }.exceptionOrNull())
        store.clearPending()
        assertNotNull(runCatching { store.command("mapAssetBegin", JSONObject(outOfOrder.toString()).put("transferId", "large").put("size", NativeOfflineMapStore.MAX_FILE_BYTES + 1)) }.exceptionOrNull())
        store.command("mapAssetBegin", JSONObject(outOfOrder.toString()).put("transferId", "bad-sha").put("sha256", "0".repeat(64)))
        store.command("mapAssetChunk", JSONObject().put("transferId", "bad-sha").put("index", 0).put("base64", Base64.encodeToString(png, Base64.NO_WRAP)))
        assertNotNull(runCatching { store.command("mapAssetCommit", JSONObject().put("transferId", "bad-sha")) }.exceptionOrNull())
        store.clearPending()
        assertTrue(NativeOfflineMapStore(context).list().isEmpty())
        assertTrue(context.cacheDir.resolve("hybrid-map-transfer").listFiles().orEmpty().isEmpty())
        store.close()
    }

    @Test fun metadataAndSourceMustMatchAndCloseKeepsCommittedFiles() {
        val store = NativeReactAssetStore(context)
        val sha = sha(png)
        val committed = import(store, "keep", metadata, png, sha)
        val changed = JSONObject(metadata.toString()).put("name", "different metadata")
        assertFalse(store.command("mapAssetLookup", lookupPayload(changed, sha))!!.getBoolean("found"))
        assertFalse(store.command("mapAssetLookup", lookupPayload(metadata, "f".repeat(64)))!!.getBoolean("found"))
        begin(store, "unfinished", metadata, png, sha)
        store.close()
        assertTrue(NativeOfflineMapStore(context).list().any { "${it.id}:$sha" == committed.getString("nativeAssetId") && File(it.filePath).isFile })
        assertTrue(context.cacheDir.resolve("hybrid-map-transfer").listFiles().orEmpty().isEmpty())
        val reopened = NativeReactAssetStore(context)
        assertTrue(reopened.command("mapAssetLookup", lookupPayload(metadata, sha))!!.getBoolean("found"))
        assertNotNull(runCatching { reopened.command("mapAssetLookup", JSONObject().put("sourceId", "other").put("sha256", sha).put("metadata", metadata)) }.exceptionOrNull())
        reopened.close()
    }

    @Test fun equivalentIntegralJsonNumbersKeepTheSameMirrorFingerprint() {
        val store = NativeReactAssetStore(context)
        val sha = sha(png)
        import(store, "number-normalization", metadata, png, sha)
        val integerBounds = JSONArray().put(100).put(20).put(101).put(21)
        val equivalent = JSONObject(metadata.toString()).put("bounds", integerBounds)
        assertTrue(store.command("mapAssetLookup", lookupPayload(equivalent, sha))!!.getBoolean("found"))
        store.close()
    }

    private fun import(store: NativeReactAssetStore, id: String, metadata: JSONObject, bytes: ByteArray, sha: String): JSONObject {
        begin(store, id, metadata, bytes, sha)
        sendChunks(store, id, bytes, split = true)
        return store.command("mapAssetCommit", JSONObject().put("transferId", id))!!
    }

    private fun begin(store: NativeReactAssetStore, id: String, metadata: JSONObject, bytes: ByteArray, sha: String) {
        store.command("mapAssetBegin", JSONObject().put("transferId", id).put("sourceId", metadata.getString("id"))
            .put("size", bytes.size).put("sha256", sha).put("metadata", metadata).put("blobMime", "image/png"))
    }

    private fun sendChunks(store: NativeReactAssetStore, id: String, bytes: ByteArray, split: Boolean) {
        // Deliberately split the stream to exercise monotonically ordered chunk writes.
        val chunks = if (split) { val cut = bytes.size / 2; listOf(bytes.copyOfRange(0, cut), bytes.copyOfRange(cut, bytes.size)) } else listOf(bytes)
        chunks.forEachIndexed { index, chunk ->
            store.command("mapAssetChunk", JSONObject().put("transferId", id).put("index", index)
                .put("base64", Base64.encodeToString(chunk, Base64.NO_WRAP)))
        }
    }

    private fun lookupPayload(metadata: JSONObject, sha: String) = JSONObject().put("sourceId", metadata.getString("id"))
        .put("sha256", sha).put("metadata", metadata)
    private fun sha(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}
