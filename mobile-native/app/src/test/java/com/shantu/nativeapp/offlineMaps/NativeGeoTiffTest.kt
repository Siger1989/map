package com.shantu.nativeapp.offlineMaps

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.DeflaterOutputStream

@RunWith(RobolectricTestRunner::class)
@org.robolectric.annotation.Config(sdk=[28],manifest=org.robolectric.annotation.Config.NONE)
class NativeGeoTiffTest {
 @Test fun readsAffineGeoreferencedRasterAcrossCompressionTypesAndSampleFormats(){
  val dir=RuntimeEnvironment.getApplication().cacheDir
  for(method in listOf(1,5,8,32946,32773)){
   val f=dir.resolve("geotiff-$method.tif");f.writeBytes(fixture(compression=method,tiled=method==5));val r=NativeGeoTiff.load(f)
   assertEquals(2,r.width);assertEquals(4326,r.epsg);assertNotEquals(0.0,r.affine[1],1e-12);assertNotEquals(0.0,r.affine[3],1e-12);assertTrue(r.bounds[0]>=10.0&&r.bounds[2]>r.bounds[0]);assertEquals(255,r.rgba[3].toInt() and 255)
  }
  val predicted=dir.resolve("pred.tif");predicted.writeBytes(fixture(predictor=2));assertTrue((NativeGeoTiff.load(predicted).rgba[7].toInt() and 255)>0)
  val sixteen=dir.resolve("16.tif");sixteen.writeBytes(fixture(bits=16));assertEquals(255,NativeGeoTiff.load(sixteen).rgba[3].toInt() and 255)
  val floats=dir.resolve("float.tif");floats.writeBytes(fixture(bits=32,sampleFormat=3));assertEquals(255,NativeGeoTiff.load(floats).rgba[3].toInt() and 255)
  val nodata=dir.resolve("nodata.tif");nodata.writeBytes(fixture(noData="10"));assertEquals(0,NativeGeoTiff.load(nodata).rgba[3].toInt() and 255)
 }
 private data class Tag(val id:Int,val type:Int,val count:Int,val data:ByteArray)
 private fun fixture(compression:Int=1,predictor:Int=1,bits:Int=8,sampleFormat:Int=1,noData:String?=null,tiled:Boolean=false):ByteArray {
  val raw=when(bits){8->if(predictor==2)byteArrayOf(10,10,10,10)else byteArrayOf(10,20,30,40);16->ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).apply{putShort(10);putShort(1000);putShort(2000);putShort(3000)}.array();32->ByteBuffer.allocate(16).order(ByteOrder.LITTLE_ENDIAN).apply{putFloat(1f);putFloat(2f);putFloat(3f);putFloat(4f)}.array();else->error("bits")}
  val pixel=when(compression){1->raw;32773->byteArrayOf((raw.size-1).toByte())+raw;5->lzw(raw);8,32946->ByteArrayOutputStream().also{o->DeflaterOutputStream(o).use{it.write(raw)}}.toByteArray();else->error("compression")}
  fun shorts(vararg v:Int)=ByteBuffer.allocate(v.size*2).order(ByteOrder.LITTLE_ENDIAN).apply{v.forEach{putShort(it.toShort())}}.array()
  fun longs(vararg v:Int)=ByteBuffer.allocate(v.size*4).order(ByteOrder.LITTLE_ENDIAN).apply{v.forEach{putInt(it)}}.array()
  val matrix=ByteBuffer.allocate(128).order(ByteOrder.LITTLE_ENDIAN).apply{doubleArrayOf(.01,.002,0.0,10.0,.003,-.01,0.0,30.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0).forEach{putDouble(it)}}.array()
  val keys=shorts(1,1,0,3,1024,0,1,2,1025,0,1,1,2048,0,1,4326)
  val offsetTag=if(tiled)324 else 273;val countTag=if(tiled)325 else 279
  val specs=mutableListOf(
   Triple(256,4,longs(2)),Triple(257,4,longs(2)),Triple(258,3,shorts(bits)),Triple(259,3,shorts(compression)),Triple(262,3,shorts(1)),Triple(offsetTag,4,longs(0)),Triple(countTag,4,longs(pixel.size)),Triple(277,3,shorts(1)),Triple(284,3,shorts(1)),Triple(317,3,shorts(predictor)),Triple(339,3,shorts(sampleFormat)),Triple(34264,12,matrix),Triple(34735,3,keys))
  if(tiled){specs.add(Triple(322,4,longs(2)));specs.add(Triple(323,4,longs(2)))}else specs.add(Triple(278,4,longs(2)))
  if(noData!=null)specs.add(Triple(42113,2,(noData+"\u0000").toByteArray()))
  val sorted=specs.sortedBy{it.first};val ifdEnd=8+2+sorted.size*12+4;var cursor=ifdEnd;val ext=mutableMapOf<Int,Int>()
  for((id,_,data) in sorted)if(data.size>4){if(cursor%2!=0)cursor++;ext[id]=cursor;cursor+=data.size}
  if(cursor%2!=0)cursor++;val pixelsAt=cursor;val all=ByteBuffer.allocate(pixelsAt+pixel.size).order(ByteOrder.LITTLE_ENDIAN);all.put(0,'I'.code.toByte());all.put(1,'I'.code.toByte());all.putShort(2,42);all.putInt(4,8);all.putShort(8,sorted.size.toShort());var entry=10
  for((id,type,data) in sorted){all.putShort(entry,id.toShort());all.putShort(entry+2,type.toShort());all.putInt(entry+4,if(id==34264)16 else if(id==34735)16 else if(id==42113)data.size else 1);if(id==offsetTag)all.putInt(entry+8,pixelsAt)else if(data.size<=4){data.forEachIndexed{i,b->all.put(entry+8+i,b)}}else all.putInt(entry+8,ext[id]!!);entry+=12}
  all.putInt(entry,0);for((id,_,data) in sorted)ext[id]?.let{all.position(it);all.put(data)};all.position(pixelsAt);all.put(pixel);return all.array()
 }
 private fun lzw(raw:ByteArray):ByteArray {val codes=mutableListOf(256);raw.forEach{codes.add(it.toInt() and 255)};codes.add(257);val out=ByteArrayOutputStream();var acc=0;var bits=0;for(c in codes){acc=(acc shl 9)or c;bits+=9;while(bits>=8){bits-=8;out.write((acc ushr bits)and 255)}};if(bits>0)out.write((acc shl(8-bits))and 255);return out.toByteArray()}
}
