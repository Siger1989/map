package com.shantu.nativeapp.coordinates

import org.locationtech.proj4j.CRSFactory
import org.locationtech.proj4j.CoordinateTransformFactory
import org.locationtech.proj4j.ProjCoordinate
import kotlin.math.abs

data class NativeProjectCrs(val id:String,val name:String=id,val definition:String?=null,val datumParameters:List<Double>?=null)

/** Explicit project CRS transformation. Never infers a projection from coordinate magnitudes. */
object NativeCoordinateTransform {
    private val factory=CRSFactory()
    private val transforms=CoordinateTransformFactory()
    private val crsCache=ThreadLocal.withInitial{linkedMapOf<NativeProjectCrs,org.locationtech.proj4j.CoordinateReferenceSystem>()}
    private val transformCache=ThreadLocal.withInitial{linkedMapOf<Pair<NativeProjectCrs,NativeProjectCrs>,org.locationtech.proj4j.CoordinateTransform>()}
    private val parameterLimits=listOf(1e6,1e6,1e6,3600.0,3600.0,3600.0,10000.0)
    fun resolve(value:String):NativeProjectCrs {
        val text=value.trim();val compact=text.uppercase().replace(" ","")
        val alias=when(compact){"4326","WGS84","CRS:84"->"EPSG:4326";"4490","CGCS2000"->"EPSG:4490";"4214","BJ54","BEIJING54"->"EPSG:4214";"4610","XIAN80"->"EPSG:4610";"3857","WEBMERCATOR"->"EPSG:3857";else->compact}
        if(alias.matches(Regex("EPSG:[0-9]{4,6}"))) {
            val definition=when(alias){"EPSG:4490"->"+proj=longlat +ellps=GRS80 +towgs84=0,0,0";"EPSG:4214"->"+proj=longlat +ellps=krass";"EPSG:4610"->"+proj=longlat +a=6378140 +rf=298.257";else->null}
            val crs=NativeProjectCrs(alias,alias,definition)
            native(crs);return crs
        }
        require(text.startsWith("+proj=")||Regex("^(GEOGCS|PROJCS|GEODCRS|PROJCRS|GEOGCRS)\\[",RegexOption.IGNORE_CASE).containsMatchIn(text)){"请提供明确EPSG、PROJ或WKT定义"}
        val crs=NativeProjectCrs("CUSTOM","自定义坐标系",if(text.startsWith("+"))text else wktToProj(text));native(crs);return crs
    }
    fun resolve(crs:NativeProjectCrs):NativeProjectCrs {
        val datum=crs.datumParameters
        require(datum==null||datum.size in listOf(3,7)&&datum.withIndex().all{(i,v)->v.isFinite()&&abs(v)<=parameterLimits[i]}){"datum参数必须为3或7个允许范围内数字"}
        val base=if(crs.definition==null)resolve(crs.id) else crs.copy(definition=if(crs.definition.startsWith("+"))crs.definition else wktToProj(crs.definition))
        val result=base.copy(name=crs.name.take(120),datumParameters=datum);native(result);return result
    }
    private fun definition(crs:NativeProjectCrs):String? {
        val raw=crs.definition?:return null
        require(raw.length in 1..8192 && raw.none{it.code<32}){"坐标系定义无效"}
        return crs.datumParameters?.let{raw.replace(Regex("\\s*\\+towgs84=[^\\s]+"),"")+" +towgs84="+it.joinToString(",")}?:raw
    }
    private fun native(crs:NativeProjectCrs):org.locationtech.proj4j.CoordinateReferenceSystem {
        val cache=crsCache.get();cache[crs]?.let{return it}
        val result=try{definition(crs)?.let{factory.createFromParameters(crs.id,it)}?:factory.createFromName(crs.id)}catch(e:Exception){throw IllegalArgumentException("坐标系定义无效或不受支持",e)}
        if(cache.size>=128)cache.remove(cache.keys.first());cache[crs]=result;return result
    }
    fun transform(point:List<Double>,source:NativeProjectCrs,target:NativeProjectCrs=resolve("EPSG:4326")):List<Double> {
        require(point.size in 2..3&&point.all{it.isFinite()&&abs(it)<=50_000_000}){"坐标超出范围"}
        val src=resolve(source);val dst=resolve(target)
        for(crs in listOf(src,dst)) {
            val d=definition(crs).orEmpty()
            if(crs.id in listOf("EPSG:4214","EPSG:4610") || (d.isNotBlank()&&!Regex("\\+(datum|ellps)=WGS84\\b|\\+towgs84=",RegexOption.IGNORE_CASE).containsMatchIn(d)))
                require(src.id==dst.id || crs.datumParameters!=null || d.contains("+towgs84=")){"源基准需要明确的3或7参数转换；不能假设与WGS84重合"}
        }
        val a=ProjCoordinate(point[0],point[1]);val b=ProjCoordinate()
        val cache=transformCache.get();val key=src to dst
        val converter=cache[key]?:transforms.createTransform(native(src),native(dst)).also{if(cache.size>=128)cache.remove(cache.keys.first());cache[key]=it}
        converter.transform(a,b)
        require(b.x.isFinite()&&b.y.isFinite()&&abs(b.x)<=50_000_000&&abs(b.y)<=50_000_000){"坐标转换超出范围"}
        if(dst.id=="EPSG:4326")require(b.x in -180.0..180.0 && b.y in -90.0..90.0){"转换超出经纬度范围"}
        return if(point.size==3)listOf(b.x,b.y,point[2]) else listOf(b.x,b.y)
    }
    private fun wktToProj(wkt:String):String {
        require(wkt.length in 1..8192){"WKT定义过长"}
        // The authority is explicit metadata; accept projected top-level authority only.
        Regex("(?:AUTHORITY|ID)\\s*\\[\\s*\"EPSG\"\\s*,\\s*\"?(\\d+)\"?\\s*]\\s*]\\s*$",RegexOption.IGNORE_CASE).find(wkt)?.let{
            return factory.createFromName("EPSG:"+it.groupValues[1]).parameterString
        }
        val ellipsoid=Regex("(?:SPHEROID|ELLIPSOID)\\s*\\[\\s*\"[^\"]*\"\\s*,\\s*([\\d.eE+-]+)\\s*,\\s*([\\d.eE+-]+)",RegexOption.IGNORE_CASE).find(wkt)?:error("WKT缺少椭球定义")
        val a=ellipsoid.groupValues[1].toDouble();val rf=ellipsoid.groupValues[2].toDouble();require(a in 6e6..7e6&&rf in 250.0..350.0){"WKT椭球参数无效"}
        val method=Regex("(?:PROJECTION|METHOD)\\s*\\[\\s*\"([^\"]+)\"",RegexOption.IGNORE_CASE).find(wkt)?.groupValues?.get(1)?.lowercase()
        val proj=when {method==null->"longlat";"transverse_mercator" in method||"gauss" in method||"transverse mercator" in method->"tmerc";"mercator" in method->"merc";"lambert" in method&&"conformal" in method->"lcc";"albers" in method->"aea";else->error("WKT投影方法暂不支持，请提供等价PROJ定义")}
        val names=mapOf("central_meridian" to "lon_0","longitude_of_natural_origin" to "lon_0","longitude of natural origin" to "lon_0","latitude_of_origin" to "lat_0","latitude of natural origin" to "lat_0","scale_factor" to "k","scale factor at natural origin" to "k","false_easting" to "x_0","false easting" to "x_0","false_northing" to "y_0","false northing" to "y_0","standard_parallel_1" to "lat_1","standard_parallel_2" to "lat_2")
        val parameters=Regex("PARAMETER\\s*\\[\\s*\"([^\"]+)\"\\s*,\\s*([\\d.eE+-]+)",RegexOption.IGNORE_CASE).findAll(wkt).map{m->val key=names[m.groupValues[1].lowercase()]?:error("未知WKT投影参数 ${m.groupValues[1]}");"+$key=${m.groupValues[2].toDouble().also{require(it.isFinite())}}"}.joinToString(" ")
        val towgs=Regex("TOWGS84\\s*\\[([^]]+)]",RegexOption.IGNORE_CASE).find(wkt)?.groupValues?.get(1)?.replace(" ","")
        val knownWgs=wkt.contains("WGS_1984",true)||wkt.contains("WGS 84",true)
        return "+proj=$proj +a=$a +rf=$rf $parameters "+(if(towgs!=null)"+towgs84=$towgs" else if(knownWgs)"+datum=WGS84" else "")+if(proj!="longlat")" +units=m" else ""
    }
}
