package com.shantu.nativeapp.offlineMaps

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.graphics.BitmapFactory
import android.util.AtomicFile
import com.shantu.nativeapp.coordinates.NativeCoordinateTransform
import org.json.JSONObject
import java.io.*
import java.security.MessageDigest
import java.util.zip.ZipInputStream

data class NativeOfflineMap(val id:String,val name:String,val kind:String,val format:String,val filePath:String,val bytes:Long,val minZoom:Int,val maxZoom:Int,val tileCount:Int,val bounds:List<Double>?,val attribution:String,val detail:String="",val sourceCrs:String?=null,val imageAffine:List<Double>?=null,val imageWidth:Int?=null,val imageHeight:Int?=null,val mimeType:String?=null)
data class NativeLegacyImportResult(val importedTiles:Int,val importedTasks:Int,val ignoredEntries:Int)

/** Imports user-selected local files only. No probing of another application's private directory. */
class NativeOfflineMapStore(context:Context) {
 private val root=File(context.applicationContext.filesDir,"native-offline-maps").apply{mkdirs()}
 companion object {const val MAX_FILE_BYTES=64L*1024*1024;const val MAX_TOTAL_BYTES=256L*1024*1024;const val MAX_MAPS=100;const val MAX_TILES=100000}
 @Synchronized fun list():List<NativeOfflineMap> = root.listFiles{f->f.isDirectory}?.flatMap{d->d.listFiles{f->f.name=="source.json"}?.mapNotNull{runCatching{readMetadata(it)}.getOrNull()}?: emptyList()}?: emptyList()
 @Synchronized fun importFile(displayName:String,input:InputStream):NativeOfflineMap {
  val safeName=displayName.substringAfterLast('/').substringAfterLast('\\').take(160).ifBlank{"offline-map"};val temp=File(root,".import-${System.nanoTime()}.tmp");var total=0L;var createdId=""
  try{FileOutputStream(temp).use{out->val b=ByteArray(32768);while(true){val n=input.read(b);if(n<0)break;total+=n;require(total<=MAX_FILE_BYTES){"单个离线文件不能超过64MiB"};out.write(b,0,n)};out.fd.sync()};require(total>0){"文件为空"};val magic=RandomAccessFile(temp,"r").use{f->ByteArray(minOf(16L,f.length()).toInt()).also(f::readFully)}
   if(magic.size>=4&&magic[0]==0x50.toByte()&&magic[1]==0x4b.toByte()) throw IllegalArgumentException("检测到ZIP；请使用离线缓存迁入流程导入旧版归档")
   val id=sha((safeName+":"+System.nanoTime()).toByteArray()).take(32);createdId=id;val dir=File(root,id);require(!dir.exists());val map=when{String(magic,0, minOf(16,magic.size),Charsets.US_ASCII).startsWith("SQLite format 3")->inspectMbtiles(temp,id,safeName);isTiff(magic)->inspectGeoTiff(temp,id,safeName);else->throw IllegalArgumentException("仅支持 MBTiles 与已配准 GeoTIFF 文件")}
   val bytes=temp.length();val existing=list();require(existing.size<MAX_MAPS){"离线图源最多100项"};require(existing.sumOf{it.bytes}+bytes<=MAX_TOTAL_BYTES){"离线图源总量不能超过256MiB"}
   dir.mkdirs();val ext=if(map.kind=="mbtiles")"mbtiles" else "tif";val localFile=File(dir,"source.$ext");check(temp.renameTo(localFile)){"离线图文件提交失败"};val saved=map.copy(filePath=localFile.absolutePath,bytes=bytes);writeMetadata(File(dir,"source.json"),saved);return saved
  }catch(e:Exception){temp.delete();if(createdId.isNotEmpty())File(root,createdId).deleteRecursively();throw e}
 }
 /** Imports a PNG/JPEG/WebP with an explicit world file and CRS; no location is inferred. */
 @Synchronized fun importGeoreferencedImage(displayName:String,input:InputStream,mimeType:String,worldFile:String,sourceCrs:String,expectedWidth:Int?=null,expectedHeight:Int?=null):NativeOfflineMap {
  val crs=NativeCoordinateTransform.resolve(sourceCrs)
  val mime=normalizeImageMime(mimeType)
  val safeName=displayName.substringAfterLast('/').substringAfterLast('\\').take(160).ifBlank{"registered-image"}
  val id=sha((safeName+":"+System.nanoTime()).toByteArray()).take(32);val dir=File(root,id);val temp=File(root,".image-${System.nanoTime()}.tmp")
  try {
   copyLimited(input,temp,MAX_FILE_BYTES)
   val dimensions=imageDimensions(temp,mime)
   require((expectedWidth==null||expectedWidth==dimensions.first)&&(expectedHeight==null||expectedHeight==dimensions.second)){"工程影像配准记录与图像尺寸不一致"}
   val affine=NativeCalibratedImage.worldFileAffine(worldFile,dimensions.first,dimensions.second)
   val bounds=NativeCalibratedImage.bounds(affine,dimensions.first,dimensions.second,crs)
   val bytes=temp.length();val current=list();require(current.size<MAX_MAPS){"离线图源最多100项"};require(current.sumOf{it.bytes}+bytes<=MAX_TOTAL_BYTES){"离线图源总量不能超过256MiB"}
   dir.mkdirs();val ext=when(mime){"image/png"->"png";"image/jpeg"->"jpg";else->"webp"};val file=File(dir,"source.$ext");check(temp.renameTo(file)){"配准影像提交失败"}
   val result=NativeOfflineMap(id,safeName,"image","${ext.uppercase()} image",file.absolutePath,bytes,0,22,1,bounds,"用户导入的配准影像","${crs.id} · ${dimensions.first}×${dimensions.second} · 世界文件配准",crs.id,affine,dimensions.first,dimensions.second,mime)
   writeMetadata(File(dir,"source.json"),result);return result
  }catch(error:Exception){temp.delete();dir.deleteRecursively();throw error}
 }
 /** Materializes a legacy StoredMap image from a workspace backup while preserving its original bytes and bounds. */
 @Synchronized fun importLegacyStoredImage(record:JSONObject):NativeOfflineMap {
  require(record.optString("kind")=="image"){"旧版图源不是已配准影像"}
  val encoded=record.optString("blobBase64");require(encoded.isNotBlank()){"旧版配准影像缺少blobBase64"}
  record.optJSONObject("imageGeoref")?.let { georef ->
   val crs=georef.optString("sourceCrs");val affine=georef.optJSONArray("affine")?:throw IllegalArgumentException("工程影像仿射配准无效")
   require(affine.length()==6&&(0 until 6).all{affine.optDouble(it).isFinite()}){"工程影像仿射配准无效"}
   val a=affine.getDouble(0);val b=affine.getDouble(1);val c=affine.getDouble(2);val d=affine.getDouble(3);val e=affine.getDouble(4);val f=affine.getDouble(5)
   val world=listOf(a,d,b,e,c+(a+b)*.5,f+(d+e)*.5).joinToString("\n")
   return preserveLegacyMetadata(importGeoreferencedImage(record.optString("name"),ByteArrayInputStream(decodeBlob(encoded)),record.optString("blobMime"),world,crs,georef.optInt("width").takeIf{it>0},georef.optInt("height").takeIf{it>0}),record)
  }
  val format=record.optString("format").lowercase();val mimeValue=record.optString("blobMime").lowercase()
  if(format.contains("geotiff")||mimeValue=="image/tiff"||mimeValue=="image/geotiff") return preserveLegacyMetadata(importFile(record.optString("name"),ByteArrayInputStream(decodeBlob(encoded))),record)
  val mime=normalizeImageMime(record.optString("blobMime"))
  val raw=decodeBlob(encoded)
  require(raw.size<=MAX_FILE_BYTES){"旧版单张图源超过64MiB"}
  checkImageHeader(raw.copyOfRange(0,minOf(raw.size,16)),mime)
  val boundsArray=record.optJSONArray("bounds")?:throw IllegalArgumentException("旧版配准影像缺少明确地理范围")
  require(boundsArray.length()==4);val bounds=(0..3).map(boundsArray::getDouble);require(bounds.all(Double::isFinite)&&bounds[0]<bounds[2]&&bounds[1]<bounds[3]&&bounds[0]>=-180&&bounds[2]<=180&&bounds[1]>=-85.051129&&bounds[3]<=85.051129){"旧版配准影像范围无效"}
  val dim=BitmapFactory.Options().apply{inJustDecodeBounds=true}.let{opts->BitmapFactory.decodeByteArray(raw,0,raw.size,opts);opts.outWidth to opts.outHeight}
  require(dim.first in 2..16000&&dim.second in 2..16000&&dim.first.toLong()*dim.second<=16_000_000){"旧版配准影像最多支持1600万像素"}
  val affine=listOf((bounds[2]-bounds[0])/dim.first,0.0,bounds[0],0.0,-(bounds[3]-bounds[1])/dim.second,bounds[3])
  val safeName=record.optString("name").trim().take(240).ifBlank{"旧版配准影像"};val id=sha((record.optString("id")+":"+System.nanoTime()).toByteArray()).take(32);val ext=when(mime){"image/png"->"png";"image/jpeg"->"jpg";else->"webp"};val dir=File(root,id).apply{mkdirs()};val file=File(dir,"source.$ext")
  try{FileOutputStream(file).use{it.write(raw);it.fd.sync()};val used=list().sumOf{it.bytes};require(list().size<=MAX_MAPS&&used+raw.size<=MAX_TOTAL_BYTES){"离线图源库容量不足"};val m=NativeOfflineMap(id,safeName,"image",mime.substringAfter('/').uppercase(),file.absolutePath,raw.size.toLong(),0,22,1,bounds,record.optString("attribution","用户导入的地理影像").take(1000),"旧版StoredMap · ${record.optString("datum","wgs84")} · ${dim.first}×${dim.second}","EPSG:4326",affine,dim.first,dim.second,mime);writeMetadata(File(dir,"source.json"),m);return m}catch(error:Exception){dir.deleteRecursively();throw error}
 }
 private fun preserveLegacyMetadata(map:NativeOfflineMap,record:JSONObject):NativeOfflineMap {
  val saved=map.copy(attribution=record.optString("attribution",map.attribution).take(1000),detail=record.optString("detail",map.detail).take(2000))
  writeMetadata(File(File(root,saved.id),"source.json"),saved);return saved
 }
 @Synchronized fun importLegacyStoredMap(record:JSONObject):NativeOfflineMap = when(record.optString("kind")) {
  "image" -> importLegacyStoredImage(record)
  "mbtiles" -> {
   val encoded=record.optString("blobBase64");require(encoded.isNotBlank()){"旧版MBTiles图源缺少blobBase64"}
   val map=importFile(record.optString("name"),ByteArrayInputStream(decodeBlob(encoded)))
   val saved=map.copy(attribution=record.optString("attribution",map.attribution).take(1000),detail=record.optString("detail",map.detail).take(2000))
   writeMetadata(File(File(root,saved.id),"source.json"),saved);saved
  }
  else -> throw IllegalArgumentException("该工程图源不是本地栅格文件")
 }
 /** Streaming mirror of a React StoredMap. The original row, ID and bytes stay in IndexedDB. */
 @Synchronized fun importStoredMapFile(record:JSONObject,source:File,mime:String):NativeOfflineMap {
  require(source.isFile&&source.length() in 1..MAX_FILE_BYTES){"离线图源文件大小无效"}
  if(record.optString("kind")=="mbtiles"||record.optString("format").contains("tif",true)||mime in setOf("image/tiff","image/geotiff"))
   return preserveLegacyMetadata(FileInputStream(source).use{importFile(record.optString("name"),it)},record)
  require(record.optString("kind")=="image"){"不是本地影像图源"}
  record.optJSONObject("imageGeoref")?.let{geo->
   val affine=geo.optJSONArray("affine")?:throw IllegalArgumentException("工程影像仿射配准缺失")
   require(affine.length()==6&&(0..5).all{affine.optDouble(it).isFinite()})
   val a=affine.getDouble(0);val b=affine.getDouble(1);val c=affine.getDouble(2);val d=affine.getDouble(3);val e=affine.getDouble(4);val f=affine.getDouble(5)
   val world=listOf(a,d,b,e,c+(a+b)*.5,f+(d+e)*.5).joinToString("\n")
   return preserveLegacyMetadata(FileInputStream(source).use{importGeoreferencedImage(record.optString("name"),it,mime,world,geo.optString("sourceCrs"),geo.optInt("width").takeIf{it>0},geo.optInt("height").takeIf{it>0})},record)
  }
  val imageMime=normalizeImageMime(mime);val dim=imageDimensions(source,imageMime)
  val rawBounds=record.optJSONArray("bounds")?:throw IllegalArgumentException("配准影像缺少地理范围")
  require(rawBounds.length()==4)
  val bounds=(0..3).map(rawBounds::getDouble)
  require(bounds.all(Double::isFinite)&&bounds[0]>=-180&&bounds[2]<=180&&bounds[1]>=-85.051129&&bounds[3]<=85.051129&&bounds[0]<bounds[2]&&bounds[1]<bounds[3]){"配准范围无效"}
  val current=list();require(current.size<MAX_MAPS&&current.sumOf{it.bytes}+source.length()<=MAX_TOTAL_BYTES){"离线图源库容量不足"}
  val id=sha((record.optString("id")+":"+System.nanoTime()).toByteArray()).take(32)
  val dir=File(root,id).apply{mkdirs()};val ext=when(imageMime){"image/png"->"png";"image/jpeg"->"jpg";else->"webp"};val file=File(dir,"source.$ext")
  try{
   FileInputStream(source).use{copyLimited(it,file,MAX_FILE_BYTES)}
   val affine=listOf((bounds[2]-bounds[0])/dim.first,0.0,bounds[0],0.0,-(bounds[3]-bounds[1])/dim.second,bounds[3])
   val map=NativeOfflineMap(id,record.optString("name"),"image",ext.uppercase(),file.absolutePath,file.length(),record.optInt("minzoom",0),record.optInt("maxzoom",22),1,bounds,record.optString("attribution"),record.optString("detail"),"EPSG:4326",affine,dim.first,dim.second,imageMime)
   writeMetadata(File(dir,"source.json"),map);return map
  }catch(error:Exception){dir.deleteRecursively();throw error}
 }
 /** Re-export a native raster as the legacy StoredMap blob contract, retaining image affine/CRS. */
 @Synchronized fun exportLegacyStoredMap(id:String):JSONObject {
  val map=list().firstOrNull{it.id==id}?:throw IllegalArgumentException("本地图源不存在")
  require(map.kind=="image"||map.kind=="geotiff"||map.kind=="mbtiles"){"仅导出本地栅格图源"}
  val file=File(map.filePath);require(file.isFile&&file.length() in 1..MAX_FILE_BYTES){"本地图源文件无效或超过64MiB"}
  val bytes=FileInputStream(file).use{readBounded(it,MAX_FILE_BYTES)}
  val ext=file.extension.lowercase();val mime=when(ext){"png"->"image/png";"jpg","jpeg"->"image/jpeg";"webp"->"image/webp";"tif","tiff"->"image/tiff";"mbtiles"->"application/vnd.sqlite3";else->"application/octet-stream"}
  val out=JSONObject().put("id",map.id).put("name",map.name).put("kind",if(map.kind=="geotiff")"image" else map.kind).put("format",map.format).put("attribution",map.attribution).put("minzoom",map.minZoom).put("maxzoom",map.maxZoom).put("tileSize",256).put("bytes",map.bytes).put("detail",map.detail).put("blobMime",mime).put("blobBase64",android.util.Base64.encodeToString(bytes,android.util.Base64.NO_WRAP))
  map.bounds?.let{out.put("bounds",org.json.JSONArray(it))}
  if(map.kind=="image"&&map.imageAffine?.size==6&&map.sourceCrs!=null)out.put("imageGeoref",JSONObject().put("sourceCrs",map.sourceCrs).put("affine",org.json.JSONArray(map.imageAffine)).put("width",map.imageWidth).put("height",map.imageHeight))
  return out
 }
 @Synchronized fun delete(id:String){require(id.matches(Regex("[a-f0-9]{32}")));File(root,id).deleteRecursively()}
 private fun inspectMbtiles(file:File,id:String,filename:String):NativeOfflineMap {
  val db=SQLiteDatabase.openDatabase(file.absolutePath,null,SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.NO_LOCALIZED_COLLATORS)
  try{val meta=mutableMapOf<String,String>();db.rawQuery("SELECT name,value FROM metadata LIMIT 101",null).use{c->while(c.moveToNext())meta[c.getString(0)]=c.getString(1)};require(meta["format"]?.lowercase() in setOf(null,"png","jpg","jpeg","webp","mixed")){"MBTiles仅支持栅格PNG/JPEG/WebP，不支持矢量或加密瓦片"};require(meta["scheme"].isNullOrEmpty()||meta["scheme"]=="tms"){"MBTiles必须使用标准TMS行号"};val z=IntArray(3);db.rawQuery("SELECT min(zoom_level),max(zoom_level),count(*) FROM tiles",null).use{c->require(c.moveToFirst());z[0]=c.getInt(0);z[1]=c.getInt(1);z[2]=c.getInt(2)};require(z[2] in 1..MAX_TILES&&z[0]>=0&&z[1] in z[0]..22){"MBTiles瓦片数量或级别无效"};db.rawQuery("SELECT 1 FROM tiles WHERE zoom_level != CAST(zoom_level AS INTEGER) OR tile_column<0 OR tile_row<0 OR tile_column >= (1 << zoom_level) OR tile_row >= (1 << zoom_level) OR length(tile_data)>4194304 LIMIT 1",null).use{require(!it.moveToFirst()){"MBTiles含无效瓦片编号或超过4MiB瓦片"}};val blob=db.rawQuery("SELECT tile_data FROM tiles LIMIT 1",null).use{c->require(c.moveToFirst());c.getBlob(0)};checkRaster(blob);val parsed=meta["bounds"]?.split(',')?.mapNotNull{it.toDoubleOrNull()}?.takeIf{it.size==4&&it[0]<it[2]&&it[1]<it[3]&&it[0]>=-180&&it[2]<=180&&it[1]>=-85.051129&&it[3]<=85.051129};require(meta["bounds"].isNullOrBlank()||parsed!=null){"MBTiles地理范围无效或跨日期变更线"};val bounds=parsed?:inferBounds(db,z[0]);return NativeOfflineMap(id,meta["name"]?.take(240)?.ifBlank{null}?:filename,"mbtiles","MBTiles","",file.length(),z[0],z[1],z[2],bounds,meta["attribution"]?.take(1000)?:"用户导入的离线地图", "标准TMS · ${z[2]}张栅格瓦片")
  }finally{db.close()}
 }
 private fun inferBounds(db:SQLiteDatabase,minZoom:Int):List<Double>? {
  val row=db.rawQuery("SELECT min(tile_column),max(tile_column),min(tile_row),max(tile_row) FROM tiles WHERE zoom_level=?",arrayOf(minZoom.toString())).use{c->if(!c.moveToFirst()||c.isNull(0))return null;longArrayOf(c.getLong(0),c.getLong(1),c.getLong(2),c.getLong(3))}
  val n=1L shl minZoom;val northRow=(n-1-row[3]).toDouble();val southRow=(n-1-row[2]).toDouble()
  fun lat(y:Double):Double = Math.toDegrees(kotlin.math.atan(kotlin.math.sinh(Math.PI*(1.0-2.0*y/n.toDouble()))))
  return listOf(row[0].toDouble()/n*360-180,lat(southRow+1), (row[1]+1).toDouble()/n*360-180,lat(northRow))
 }
 private fun inspectGeoTiff(file:File,id:String,filename:String):NativeOfflineMap {
  // Parse classic TIFF georeferencing before accepting it; missing CRS/georeference is rejected.
  val info=NativeGeoTiff.inspect(file);return NativeOfflineMap(id,filename.take(240),"geotiff","GeoTIFF","",file.length(),0,22,1,info.bounds,"用户导入的地理影像",info.detail,"EPSG:${info.epsg}",info.affine,info.width,info.height,null)
 }
 private fun isTiff(b:ByteArray)=b.size>=4&&((b[0]==0x49.toByte()&&b[1]==0x49.toByte()&&b[2]==42.toByte()&&b[3]==0.toByte())||(b[0]==0x4d.toByte()&&b[1]==0x4d.toByte()&&b[2]==0.toByte()&&b[3]==42.toByte()))
 private fun checkRaster(b:ByteArray){require((b.size>=4&&b[0]==0x89.toByte()&&b[1]==0x50.toByte()&&b[2]==0x4e.toByte()&&b[3]==0x47.toByte())||(b.size>=3&&b[0]==0xff.toByte()&&b[1]==0xd8.toByte()&&b[2]==0xff.toByte())||(b.size>=12&&String(b,0,4)=="RIFF"&&String(b,8,4)=="WEBP")){"MBTiles包含不支持的瓦片格式"};require(b.size<=4*1024*1024){"单张瓦片超过4MiB"}}
 private fun readMetadata(file:File):NativeOfflineMap {val o=JSONObject(file.readText());return NativeOfflineMap(o.getString("id"),o.getString("name"),o.getString("kind"),o.getString("format"),o.getString("filePath"),o.getLong("bytes"),o.getInt("minZoom"),o.getInt("maxZoom"),o.getInt("tileCount"),o.optJSONArray("bounds")?.let{(0 until it.length()).map(it::getDouble)},o.getString("attribution"),o.optString("detail"),o.optString("sourceCrs").ifEmpty{null},o.optJSONArray("imageAffine")?.let{(0 until it.length()).map(it::getDouble)},o.optInt("imageWidth").takeIf{it>0},o.optInt("imageHeight").takeIf{it>0},o.optString("mimeType").ifEmpty{null})}
 private fun writeMetadata(file:File,m:NativeOfflineMap){val o=JSONObject().put("id",m.id).put("name",m.name).put("kind",m.kind).put("format",m.format).put("filePath",m.filePath).put("bytes",m.bytes).put("minZoom",m.minZoom).put("maxZoom",m.maxZoom).put("tileCount",m.tileCount).put("attribution",m.attribution).put("detail",m.detail);m.bounds?.let{o.put("bounds",org.json.JSONArray(it))};m.sourceCrs?.let{o.put("sourceCrs",it)};m.imageAffine?.let{o.put("imageAffine",org.json.JSONArray(it))};m.imageWidth?.let{o.put("imageWidth",it)};m.imageHeight?.let{o.put("imageHeight",it)};m.mimeType?.let{o.put("mimeType",it)};val a=AtomicFile(file);var out:FileOutputStream?=null;try{val stream=a.startWrite();out=stream;stream.write(o.toString().toByteArray());a.finishWrite(stream)}catch(e:Exception){out?.let(a::failWrite);throw e}}
 private fun copyLimited(input:InputStream,out:File,limit:Long){var total=0L;FileOutputStream(out).use{stream->val buffer=ByteArray(32768);while(true){val n=input.read(buffer);if(n<0)break;total+=n;require(total<=limit){"配准影像文件超过64MiB"};stream.write(buffer,0,n)};stream.fd.sync()};require(total>0){"影像文件为空"}}
 private fun decodeBlob(encoded:String):ByteArray {require(encoded.length<=((MAX_FILE_BYTES+2)/3*4+8)){"旧版图源Base64超过64MiB"};val raw=try{android.util.Base64.decode(encoded,android.util.Base64.DEFAULT)}catch(_:Exception){throw IllegalArgumentException("旧版图源Base64无效")};require(raw.size<=MAX_FILE_BYTES){"旧版单张图源超过64MiB"};return raw}
 private fun readBounded(input:InputStream,limit:Long):ByteArray {val out=ByteArrayOutputStream();val b=ByteArray(32768);var total=0L;while(true){val n=input.read(b);if(n<0)break;total+=n;require(total<=limit){"本地图源文件超过64MiB"};out.write(b,0,n)};return out.toByteArray()}
 private fun imageDimensions(file:File,mime:String):Pair<Int,Int>{val options=BitmapFactory.Options().apply{inJustDecodeBounds=true};BitmapFactory.decodeFile(file.absolutePath,options);require(options.outWidth>0&&options.outHeight>0&&options.outWidth<=16000&&options.outHeight<=16000&&options.outWidth.toLong()*options.outHeight<=16_000_000){"配准影像最多支持1600万像素"};val header=FileInputStream(file).use{it.readNBytes(16)};checkImageHeader(header,mime);return options.outWidth to options.outHeight}
 private fun normalizeImageMime(mime:String):String=when(mime.substringBefore(';').trim().lowercase()){"image/png","png"->"image/png";"image/jpeg","image/jpg","jpg","jpeg"->"image/jpeg";"image/webp","webp"->"image/webp";else->throw IllegalArgumentException("配准影像仅支持PNG/JPEG/WebP")}
 private fun checkImageHeader(b:ByteArray,mime:String){val okay=when(mime){"image/png"->b.size>=8&&b[0]==0x89.toByte()&&b[1]==0x50.toByte()&&b[2]==0x4e.toByte()&&b[3]==0x47.toByte();"image/jpeg"->b.size>=3&&b[0]==0xff.toByte()&&b[1]==0xd8.toByte()&&b[2]==0xff.toByte();else->b.size>=12&&String(b,0,4)=="RIFF"&&String(b,8,4)=="WEBP"};require(okay){"影像内容与所选格式不一致"}}
 private fun sha(b:ByteArray)=MessageDigest.getInstance("SHA-256").digest(b).joinToString(""){"%02x".format(it)}
}

/** Strictly imports the legacy OfflineStore folder archive format from an explicitly selected SAF ZIP. */
class NativeLegacyOfflineArchive(context:Context){
 private val root=File(context.applicationContext.filesDir,"legacy-offline-migration").apply{mkdirs()}
 fun importZip(input:InputStream):NativeLegacyImportResult {
  val staging=File(root,".stage-${java.util.UUID.randomUUID()}").apply{mkdirs()};val seen=hashSetOf<String>();var total=0L
  try {
   ZipInputStream(BufferedInputStream(input)).use{zip->while(true){val e=zip.nextEntry?:break;val path=e.name;require(!e.isDirectory&&path.isNotBlank()&&!path.startsWith('/')&&!path.startsWith('\\')&&!path.contains('\\')&&path.split('/').none{it==".."||it=="."||it.isBlank()}){"归档路径无效"};require(path=="active"||path.matches(Regex("[a-f0-9]{64}\\.(?:json|urls|tile|progress)"))){"归档包含不符合旧版OfflineStore结构的路径"};require(seen.size<MAX_ENTRIES&&seen.add(path)){"归档包含重复路径或文件过多"};val limit=when{path.endsWith(".tile")->MAX_TILE_BYTES;path.endsWith(".urls")->MAX_MANIFEST_BYTES;path.endsWith(".json")->MAX_TASK_BYTES;path.endsWith(".progress")->MAX_PROGRESS_BYTES;else->1024L};val outFile=File(staging,path);var written=0L;FileOutputStream(outFile).use{out->val b=ByteArray(64*1024);while(true){val n=zip.read(b);if(n<0)break;written+=n;total+=n;require(total<=MAX_ARCHIVE_BYTES){"旧版离线归档解压后不能超过8GiB"};require(written<=limit){"旧版离线归档单文件超过对应格式上限"};out.write(b,0,n)};out.fd.sync()};zip.closeEntry()}}
   val jobs=staging.listFiles{f->f.isFile&&f.name.matches(Regex("[a-f0-9]{64}\\.json"))}?: emptyArray();var tiles=0;var taskCount=0;val retainedTiles=hashSetOf<String>();val retainedUrls=hashSetOf<String>()
   for(jobFile in jobs){val job=JSONObject(jobFile.readText(Charsets.UTF_8));val id=job.optString("id");require(id.isNotBlank()&&id.length<=160&&job.optString("provider")=="imported"){"旧版任务清单无效"};val base=sha(id.toByteArray());val urlFile=File(staging,"$base.urls");require(urlFile.isFile){"旧版任务缺少.urls清单"};var count=0;var chain="";val canonicalUrls=File(staging,"task-${base.take(32)}.urls")
    BufferedReader(InputStreamReader(FileInputStream(urlFile),Charsets.UTF_8)).use{reader->FileOutputStream(canonicalUrls).use{out->while(true){val line=reader.readLine()?:break;require(line.isNotBlank()&&line.length<=8192&&allowedUrl(line)){"旧版瓦片URL无效或不受支持"};count++;require(count<=MAX_URLS){"旧版瓦片清单超过25万项"};val lineBytes=(line+"\n").toByteArray(Charsets.UTF_8);out.write(lineBytes);val digest=MessageDigest.getInstance("SHA-256");digest.update(chain.toByteArray(Charsets.US_ASCII));digest.update(lineBytes);chain=digest.digest().joinToString(""){"%02x".format(it)};val tileName=sha(tileIdentity(line).toByteArray())+".tile";val tile=File(staging,tileName);if(tile.isFile&&retainedTiles.add(tileName))tiles++};out.fd.sync()}}
    require(count in 1..MAX_URLS&&job.optInt("total",count)==count){"旧版瓦片清单数量无效"};val expected=job.optString("manifestDigest");require(expected.isBlank()||expected==chain){"旧版离线清单摘要不匹配"};retainedUrls.add(urlFile.name);writeAtomic(File(staging,"task-${base.take(32)}.json"),job.toString().toByteArray());jobFile.delete();taskCount++
   }
   require(jobs.isNotEmpty()){"归档中没有旧版OfflineStore任务JSON"};staging.listFiles()?.filter{it.name.endsWith(".tile")&&it.name !in retainedTiles}?.forEach(File::delete);staging.listFiles()?.filter{(it.name.endsWith(".urls")&&it.name !in retainedUrls)||it.name.endsWith(".progress")||it.name=="active"}?.forEach(File::delete);val ignored=(seen.size-jobs.size-retainedUrls.size-tiles).coerceAtLeast(0);val destination=File(root,"legacy-${staging.name.removePrefix(".stage-")}");check(staging.renameTo(destination)){"旧版归档迁入提交失败"};return NativeLegacyImportResult(tiles,taskCount,ignored)
  }catch(e:Exception){staging.deleteRecursively();throw e}
 }
 fun lookupTile(url:String):ByteArray? {if(!allowedUrl(url))return null;val name=sha(tileIdentity(url).toByteArray())+".tile";val hit=root.listFiles{f->f.isDirectory&&f.name.startsWith("legacy-")}?.firstNotNullOfOrNull{File(it,name).takeIf(File::isFile)}?:return null;return hit.takeIf{it.length() in 1..MAX_TILE_BYTES}?.readBytes()}
 private fun sourceUrl(value:String):String=runCatching{val u=android.net.Uri.parse(value);if(u.host=="appassets.androidplatform.net"&&u.scheme=="https"&&u.path=="/api/map-tile")u.getQueryParameter("url")?:value else value}.getOrDefault(value)
 private fun allowedUrl(value:String):Boolean=runCatching{val u=android.net.Uri.parse(sourceUrl(value));val h=u.host?.lowercase()?:return@runCatching false;u.scheme in setOf("http","https")&&u.userInfo==null&&u.fragment==null&&!u.path.orEmpty().contains("..")&&!listOf("tianditu.gov.cn","tianditu.com","openstreetmap.org","openstreetmap.fr").any{h==it||h.endsWith(".$it")}}.getOrDefault(false)
 private fun tileIdentity(value:String):String=runCatching{val u=android.net.Uri.parse(sourceUrl(value));val h=u.host?.lowercase().orEmpty();if(Regex("t[0-7]\\.tianditu\\.gov\\.cn").matches(h)){val params=u.queryParameterNames.associate{it.lowercase() to u.getQueryParameter(it)};"tdt:${params["layer"]}:${params["tilematrix"]}:${params["tilecol"]}:${params["tilerow"]}"}else value}.getOrDefault(value)
 private fun writeAtomic(file:File,b:ByteArray){val a=AtomicFile(file);var out:FileOutputStream?=null;try{val s=a.startWrite();out=s;s.write(b);a.finishWrite(s)}catch(e:Exception){out?.let(a::failWrite);throw e}}
 private fun sha(b:ByteArray)=MessageDigest.getInstance("SHA-256").digest(b).joinToString(""){"%02x".format(it)}
 companion object{const val MAX_ARCHIVE_BYTES=8L*1024*1024*1024;const val MAX_MANIFEST_BYTES=128L*1024*1024;const val MAX_URLS=250000;const val MAX_ENTRIES=500002;const val MAX_TASK_BYTES=12L*1024*1024;const val MAX_TILE_BYTES=4L*1024*1024;const val MAX_PROGRESS_BYTES=4L*1024*1024}
}
