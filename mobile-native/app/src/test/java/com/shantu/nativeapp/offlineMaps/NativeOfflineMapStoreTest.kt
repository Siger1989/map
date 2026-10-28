package com.shantu.nativeapp.offlineMaps

import android.database.sqlite.SQLiteDatabase
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.json.JSONObject
import com.shantu.nativeapp.map.NativeMapSourceCatalog
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

@RunWith(RobolectricTestRunner::class)
@org.robolectric.annotation.Config(sdk=[28],manifest=org.robolectric.annotation.Config.NONE)
class NativeOfflineMapStoreTest {
 private val context get()=RuntimeEnvironment.getApplication()
 private lateinit var store:NativeOfflineMapStore
 @Before fun setup(){context.filesDir.resolve("native-offline-maps").deleteRecursively();context.filesDir.resolve("legacy-offline-migration").deleteRecursively();store=NativeOfflineMapStore(context)}
 @Test fun importsReadOnlyMbtilesAndReadsTmsMetadata(){val src=context.filesDir.resolve("fixture.mbtiles");val db=SQLiteDatabase.openOrCreateDatabase(src,null);db.execSQL("CREATE TABLE metadata (name TEXT,value TEXT)");db.execSQL("CREATE TABLE tiles (zoom_level INTEGER,tile_column INTEGER,tile_row INTEGER,tile_data BLOB)");db.execSQL("INSERT INTO metadata VALUES('format','png')");db.execSQL("INSERT INTO metadata VALUES('scheme','tms')");db.execSQL("INSERT INTO metadata VALUES('bounds','100,20,101,21')");db.execSQL("INSERT INTO tiles VALUES(2,1,2,?)",arrayOf(png));db.close();val map=store.importFile("fixture.mbtiles",ByteArrayInputStream(src.readBytes()));assertEquals("mbtiles",map.kind);assertEquals(2,map.minZoom);assertEquals(listOf(100.0,20.0,101.0,21.0),map.bounds);assertTrue(map.filePath.endsWith(".mbtiles"));assertEquals(0,NativeOfflineMapLayer.tmsRow(2,3));assertEquals(3,NativeOfflineMapLayer.tmsRow(2,0));val catalog=NativeMapSourceCatalog.fromJson(JSONObject().put("maps",org.json.JSONArray().put(JSONObject().put("id",map.id).put("name",map.name).put("kind","mbtiles").put("filePath",map.filePath).put("format","MBTiles").put("bounds",org.json.JSONArray(map.bounds)) )));assertEquals("mbtiles",catalog.sources.single().kind)}
 @Test fun rejectsOversizedOrUnsupportedFilesWithoutPartialRows(){assertNotNull(runCatching{store.importFile("x.bin",ByteArrayInputStream(ByteArray(1024)))}.exceptionOrNull());assertTrue(store.list().isEmpty());assertNotNull(runCatching{store.importFile("big.mbtiles",ByteArrayInputStream(ByteArray((NativeOfflineMapStore.MAX_FILE_BYTES+1).toInt())))}.exceptionOrNull());assertTrue(store.list().isEmpty())}
 @Test fun rejectsGeoTiffWithoutExplicitGeoreferencing(){val minimal=byteArrayOf(0x49,0x49,42,0,8,0,0,0,0,0);assertNotNull(runCatching{store.importFile("unreferenced.tif",ByteArrayInputStream(minimal))}.exceptionOrNull());assertTrue(store.list().isEmpty())}
 @Test fun materializesAndRoundTripsLegacyWorkspaceImageBlobsWithRegistrationAndRenders() {
  val bitmap=android.graphics.Bitmap.createBitmap(intArrayOf(android.graphics.Color.RED,android.graphics.Color.GREEN,android.graphics.Color.BLUE,android.graphics.Color.WHITE),2,2,android.graphics.Bitmap.Config.ARGB_8888)
  val bytes=ByteArrayOutputStream().also{bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}.toByteArray();bitmap.recycle()
  val legacy=JSONObject().put("id","legacy-image").put("name","registered").put("kind","image").put("format","PNG image").put("attribution","field map").put("bounds",org.json.JSONArray(listOf(0.0,0.0,1.0,1.0))).put("minzoom",0).put("maxzoom",22).put("tileSize",256).put("bytes",bytes.size).put("blobMime","image/png").put("blobBase64",java.util.Base64.getEncoder().encodeToString(bytes)).put("imageGeoref",JSONObject().put("sourceCrs","EPSG:4326").put("affine",org.json.JSONArray(listOf(.5,0.0,0.0,0.0,-.5,1.0))).put("width",2).put("height",2))
  val imported=store.importLegacyStoredMap(legacy)
  assertEquals("image",imported.kind);assertEquals("EPSG:4326",imported.sourceCrs);assertEquals(listOf(.5,0.0,0.0,0.0,-.5,1.0),imported.imageAffine);assertEquals(listOf(0.0,0.0,1.0,1.0),imported.bounds)
  val layer=NativeOfflineMapLayer.image(imported);assertNotNull(layer)
  val tile=NativeOfflineMapLayer.renderImageTile(imported,4,3,3);assertNotNull(tile);val pixels=IntArray(tile!!.width*tile.height);tile.getPixels(pixels,0,tile.width,0,0,tile.width,tile.height);assertTrue(pixels.any{android.graphics.Color.alpha(it)>0});tile.recycle()
  val exported=store.exportLegacyStoredMap(imported.id);assertEquals("image",exported.getString("kind"));assertEquals(bytes.size,android.util.Base64.decode(exported.getString("blobBase64"),android.util.Base64.DEFAULT).size);assertEquals("EPSG:4326",exported.getJSONObject("imageGeoref").getString("sourceCrs"));assertEquals(6,exported.getJSONObject("imageGeoref").getJSONArray("affine").length())
 }
 @Test fun rejectsZipTraversalAndImportsExplicitLegacyStoreManifest(){val bad=ByteArrayOutputStream();ZipOutputStream(bad).use{z->z.putNextEntry(ZipEntry("../escape.json"));z.write(byteArrayOf(1));z.closeEntry()};assertNotNull(runCatching{NativeLegacyOfflineArchive(context).importZip(ByteArrayInputStream(bad.toByteArray()))}.exceptionOrNull())
  val id="legacy-test";val url="https://tiles.example.test/2/1/1.png";val line=(url+"\n").toByteArray();val digest=MessageDigest.getInstance("SHA-256").digest(line).joinToString(""){"%02x".format(it)};val base=sha(id.toByteArray());val tileName=sha(url.toByteArray())+".tile";val task=JSONObject().put("id",id).put("name","Legacy cache").put("provider","imported").put("total",1).put("manifestDigest",digest).toString().toByteArray();val zip=ByteArrayOutputStream();ZipOutputStream(zip).use{z->z.putNextEntry(ZipEntry("$base.json"));z.write(task);z.closeEntry();z.putNextEntry(ZipEntry("$base.urls"));z.write(line);z.closeEntry();z.putNextEntry(ZipEntry(tileName));z.write(png);z.closeEntry()};val archive=NativeLegacyOfflineArchive(context);val result=archive.importZip(ByteArrayInputStream(zip.toByteArray()));assertEquals(1,result.importedTasks);assertEquals(1,result.importedTiles);assertArrayEquals(png,archive.lookupTile(url))}
 private fun sha(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)}
 private val png=java.util.Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL7WQAAAABJRU5ErkJggg==")
}
