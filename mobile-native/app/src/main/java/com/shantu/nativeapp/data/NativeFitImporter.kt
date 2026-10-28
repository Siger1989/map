package com.shantu.nativeapp.data

import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.util.UUID
import kotlin.math.abs

/** Bounded FIT decoder for the activity/course, record, event, course-point and segment subsets. */
internal object NativeFitImporter {
    private const val MAX_INPUT = 8 * 1024 * 1024
    private const val FIT_EPOCH_MS = 631065600000L
    private const val MAX_POINTS = 6000
    private data class DefField(val number: Int, val size: Int, val base: Int)
    private data class Definition(val global: Int, val little: Boolean, val fields: List<DefField>, val developerBytes: Int)
    private data class Message(val definition: Definition, val fields: Map<Int, ByteArray>, val timestamp: Long?) {
        val global get() = definition.global
        val little get() = definition.little
    }
    private data class Point(val xy: JSONArray, val altitude: Double?, val time: Long?)

    fun parse(bytes: ByteArray, filename: String): JSONObject {
        require(bytes.size <= MAX_INPUT) { "FIT 文件超过8MB" }
        fun fail(): Nothing = throw IllegalArgumentException("FIT内容截断、CRC校验失败或结构无效")
        fun u16(at: Int, little: Boolean = true): Int { if (at < 0 || at + 2 > bytes.size) fail(); val a=bytes[at].toInt() and 255; val b=bytes[at+1].toInt() and 255; return if(little) a or (b shl 8) else (a shl 8) or b }
        fun u32(at: Int): Long { if (at < 0 || at + 4 > bytes.size) fail(); return ByteBuffer.wrap(bytes,at,4).order(ByteOrder.LITTLE_ENDIAN).int.toLong() and 0xffffffffL }
        val headerSize = bytes.firstOrNull()?.toInt()?.and(255) ?: fail()
        if (headerSize !in setOf(12,14) || bytes.size < headerSize + 2 || ((bytes[1].toInt() and 255) ushr 4) !in 1..2 || String(bytes, 8, 4, StandardCharsets.US_ASCII) != ".FIT") fail()
        val dataSize = u32(4)
        if (dataSize > MAX_INPUT || headerSize.toLong() + dataSize + 2 != bytes.size.toLong()) fail()
        if (headerSize == 14 && u16(headerSize - 2) != 0 && u16(headerSize - 2) != crc(bytes, 0, headerSize - 2)) fail()
        if (u16(bytes.size - 2) != crc(bytes, 0, bytes.size - 2)) fail()
        val dataEnd = headerSize + dataSize.toInt()
        val defs = arrayOfNulls<Definition>(16)
        val messages = ArrayList<Message>()
        var at = headerSize
        var lastTimestamp: Long? = null
        var messageCount = 0
        while (at < dataEnd) {
            if (++messageCount > 200_000) fail()
            val recordHeader = bytes[at++].toInt() and 255
            val compressed = recordHeader and 0x80 != 0
            if (!compressed && recordHeader and 0x10 != 0) fail()
            if (!compressed && recordHeader and 0x40 != 0) {
                if (at + 5 > dataEnd) fail()
                val local = recordHeader and 15
                if (bytes[at++].toInt() != 0) fail()
                val arch = bytes[at++].toInt() and 255
                if (arch !in 0..1) fail()
                val little = arch == 0
                val globalBytes = if (little) u16(at, true) else u16(at, false); at += 2
                val fieldCount = bytes[at++].toInt() and 255
                if (fieldCount > 64 || at.toLong() + fieldCount * 3L > dataEnd) fail()
                val fields = ArrayList<DefField>(fieldCount); val fieldNumbers=HashSet<Int>()
                repeat(fieldCount) { val no=bytes[at++].toInt() and 255; val size=bytes[at++].toInt() and 255; val base=bytes[at++].toInt() and 255; if(size==0 || !fieldNumbers.add(no)) fail(); fields += DefField(no,size,base) }
                if (globalBytes in setOf(0,20,21,31,32)) fields.forEach { f ->
                    val id = f.base and 31
                    val width = when (id) { 0,1,2,7,10,13 -> 1; 3,4,11 -> 2; 5,6,8,12 -> 4; 9,14,15,16 -> 8; else -> 0 }
                    if (f.base and 0x60 != 0 || width == 0 || (id != 7 && f.size % width != 0)) fail()
                }
                var developerBytes = 0
                if (recordHeader and 0x20 != 0) {
                    if (at >= dataEnd) fail(); val devCount=bytes[at++].toInt() and 255
                    if (devCount > 64 || at.toLong() + devCount * 3L > dataEnd) fail()
                    val devKeys=HashSet<Pair<Int,Int>>()
                    repeat(devCount) { val no=bytes[at++].toInt() and 255; val size=bytes[at++].toInt() and 255; val index=bytes[at++].toInt() and 255; if(size==0 || !devKeys.add(index to no)) fail(); developerBytes += size }
                }
                defs[local] = Definition(globalBytes, little, fields, developerBytes)
            } else {
                val local = if (compressed) (recordHeader shr 5) and 3 else recordHeader and 15
                val def = defs[local] ?: fail()
                if (compressed && (def.fields.firstOrNull()?.let { it.number == 253 && it.base == 0x86 && it.size == 4 } != true)) fail()
                if (!compressed && recordHeader and 0x20 != 0) fail()
                val compressedTimestampSize = if (compressed) def.fields.first().size else 0
                if (compressedTimestampSize !in setOf(0, 4)) fail()
                val payloadSize = def.fields.sumOf { it.size } - compressedTimestampSize + def.developerBytes
                if (at.toLong() + payloadSize > dataEnd) fail()
                val values = LinkedHashMap<Int, ByteArray>()
                def.fields.forEach { f ->
                    if (compressed && f.number == 253) return@forEach
                    values[f.number] = bytes.copyOfRange(at, at + f.size); at += f.size
                }
                at += def.developerBytes
                var timestamp = values[253]?.let { raw ->
                    if (raw.size != 4 || (def.fields.first { it.number == 253 }.base and 31) != 6) fail()
                    val n=ByteBuffer.wrap(raw).order(if(def.little) ByteOrder.LITTLE_ENDIAN else ByteOrder.BIG_ENDIAN).int.toLong() and 0xffffffffL
                    if (n == 0xffffffffL) fail(); n
                }
                if (compressed) {
                    val offset = recordHeader and 31
                    val previous = lastTimestamp ?: fail()
                    var expanded = (previous and -32L) or offset.toLong()
                    if (expanded < previous) expanded += 32
                    timestamp = expanded
                }
                if (timestamp != null) lastTimestamp = timestamp
                if (def.global == 0 || def.global == 20 || def.global == 21 || def.global == 31 || def.global == 32) {
                    messages += Message(def, values, timestamp)
                }
            }
        }
        if (at != dataEnd) fail()

        fun unsigned(message: Message, fieldNo: Int, expectedBase: Int, expectedSize: Int): Long? {
            val raw = message.fields[fieldNo] ?: return null
            val field = message.definition.fields.firstOrNull { it.number == fieldNo } ?: fail()
            val actual = field.base and 31
            val compatibleByte = expectedSize == 1 && expectedBase in setOf(0,2,13) && actual in setOf(0,2,13)
            if ((actual != expectedBase && !compatibleByte) || raw.size != expectedSize) throw IllegalArgumentException("FIT字段类型无效")
            var v=0L
            if(message.little) for(i in raw.indices.reversed()) v=(v shl 8) or (raw[i].toLong() and 255)
            else for(b in raw) v=(v shl 8) or (b.toLong() and 255)
            val invalid=when(expectedSize){1->0xffL;2->0xffffL;4->0xffffffffL;else->-1L}
            return if(v==invalid)null else v
        }
        fun signedCoord(message: Message, fieldNo: Int): Double? {
            val raw=message.fields[fieldNo] ?: return null
            val field=message.definition.fields.firstOrNull { it.number == fieldNo } ?: fail()
            if ((field.base and 31)!=5 || raw.size!=4) throw IllegalArgumentException("FIT坐标字段类型无效")
            val n=ByteBuffer.wrap(raw).order(if(message.little) ByteOrder.LITTLE_ENDIAN else ByteOrder.BIG_ENDIAN).int
            if(n==Int.MAX_VALUE)return null
            return n*180.0/2147483648.0
        }
        fun stringField(message: Message, number: Int): String? {
            val raw=message.fields[number] ?: return null
            val field=message.definition.fields.firstOrNull { it.number == number } ?: fail()
            if ((field.base and 31)!=7) throw IllegalArgumentException("FIT文本字段类型无效")
            return try { StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(raw)).toString().trimEnd('\u0000') } catch(e:Exception) { throw IllegalArgumentException("FIT文本编码无效",e) }
        }
        val tracks=JSONArray(); val pins=JSONArray(); val pieces=mutableListOf<MutableList<Point>>(); var current=mutableListOf<Point>(); var lastTime:Long?=null
        fun cut() { if(current.isNotEmpty()){pieces += current; current=mutableListOf()} }
        var routeName=fallback(filename); var sawFileId=false; var totalPoints=0
        for (message in messages) {
            if(message.global==0) {
                val type=unsigned(message,0,0,1)
                require(type==4L||type==6L) { "FIT文件不是活动或路线文件" }; sawFileId=true
            }
            if(message.global==31) routeName=stringField(message,5)?.takeIf { it.isNotBlank() }?.take(60) ?: routeName
            if(message.global==21) {
                val event=unsigned(message,0,0,1); val eventType=unsigned(message,1,0,1)
                if(event==0L && eventType in setOf(1L,4L,8L,9L)) cut()
            }
            if(message.global!=20 && message.global!=32) continue
            val cp=message.global==32
            val lat=signedCoord(message,if(cp)2 else 0); val lon=signedCoord(message,if(cp)3 else 1)
            if(lat==null||lon==null){if(!cp)cut();continue}
            require(abs(lat)<=85.051129 && abs(lon)<=180.0) { "FIT坐标超出地图范围" }
            val altitude=if(cp)null else unsigned(message,78,6,4) ?: unsigned(message,2,4,2)
            val time=message.timestamp?.let { it*1000L+FIT_EPOCH_MS }
            val point=Point(JSONArray().put(lon).put(lat),altitude?.let { it/5.0-500.0 },time)
            if(cp) {
                require(pins.length() < 2000) { "FIT标记超过2000个" }
                val name=stringField(message,6)?.takeIf { it.isNotBlank() }?.take(60) ?: fallback(filename)
                pins.put(NativeRouteFormats.annotation(name,point.xy,"",point.altitude)); continue
            }
            if(time!=null && lastTime!=null && time<lastTime!!)cut()
            current += point; totalPoints++; require(totalPoints<=MAX_POINTS) { "FIT点数超过6000" }; lastTime=time
        }
        if(!sawFileId) throw IllegalArgumentException("FIT缺少活动/路线文件标识")
        cut()
        val useful=pieces.filter { it.size>=2 }
        pieces.filter { it.size==1 }.forEach { pins.put(NativeRouteFormats.annotation(routeName,it.single().xy,"",it.single().altitude)) }
        if(useful.isNotEmpty()) {
            val coords=JSONArray(); val samples=JSONArray(); var hasSamples=false
            for(part in useful){ val line=JSONArray(); val sampleLine=JSONArray(); for(p in part){line.put(p.xy);sampleLine.put(JSONObject().put("time",p.time?:JSONObject.NULL).put("altitude",p.altitude?:JSONObject.NULL));if(p.time!=null||p.altitude!=null)hasSamples=true};coords.put(line);samples.put(sampleLine) }
            val track=JSONObject().put("id",UUID.randomUUID().toString()).put("name",routeName).put("createdAt",System.currentTimeMillis())
                .put("source","shared").put("importFormat","FIT").put("segments",coords)
            if(hasSamples)track.put("samples",samples)
            tracks.put(track)
        }
        require(tracks.length()+pins.length()>0) { "FIT文件没有可导入的路线或标记" }
        return NativeRouteFormats.transfer(tracks,pins)
    }

    private fun crc(bytes: ByteArray, start: Int, end: Int): Int {
        var crc=0
        for(i in start until end){ var tmp=(bytes[i].toInt() and 255) xor (crc and 255); repeat(8){tmp=if(tmp and 1!=0)(tmp ushr 1) xor 0xa001 else tmp ushr 1}; crc=(crc ushr 8) xor tmp }
        return crc and 0xffff
    }
    private fun fallback(filename: String)=filename.substringBeforeLast('.',filename).ifBlank { "导入线路" }.take(60)
}
