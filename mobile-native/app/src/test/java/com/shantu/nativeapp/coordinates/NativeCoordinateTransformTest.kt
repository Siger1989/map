package com.shantu.nativeapp.coordinates

import org.junit.Assert.*
import org.junit.Test

class NativeCoordinateTransformTest {
    @Test fun knownUtmCentralMeridian(){
        val p=NativeCoordinateTransform.transform(listOf(500000.0,0.0,12.0),NativeCoordinateTransform.resolve("EPSG:32650"))
        assertEquals(117.0,p[0],1e-8);assertEquals(0.0,p[1],1e-8);assertEquals(12.0,p[2],0.0)
    }
    @Test fun cgcsGaussExplicitEastAndNorth(){
        val p=NativeCoordinateTransform.transform(listOf(500000.0,0.0),NativeCoordinateTransform.resolve("EPSG:4547"))
        assertEquals(114.0,p[0],1e-7);assertEquals(0.0,p[1],1e-7)
    }
    @Test fun historicalDatumRequiresParameters(){
        assertThrows(IllegalArgumentException::class.java){NativeCoordinateTransform.transform(listOf(117.0,31.0),NativeCoordinateTransform.resolve("BJ54"))}
        val crs=NativeCoordinateTransform.resolve("BJ54").copy(datumParameters=listOf(0.0,0.0,0.0))
        assertTrue(NativeCoordinateTransform.transform(listOf(117.0,31.0),crs).all{it.isFinite()})
    }
    @Test fun mercatorRoundtrip(){
        val wgs=NativeCoordinateTransform.resolve("EPSG:4326");val merc=NativeCoordinateTransform.resolve("EPSG:3857")
        val p=NativeCoordinateTransform.transform(listOf(104.067,30.572),wgs,merc)
        val q=NativeCoordinateTransform.transform(p,merc,wgs)
        assertEquals(104.067,q[0],1e-7);assertEquals(30.572,q[1],1e-7)
    }
}
