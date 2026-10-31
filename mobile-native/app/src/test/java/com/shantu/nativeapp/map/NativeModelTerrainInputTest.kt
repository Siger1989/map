package com.shantu.nativeapp.map

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeModelTerrainInputTest {
    private fun saved()=JSONObject().put("kind","box").put("groundElevation",2400.0)
        .put("offset",5.0).put("placement","surface").put("centerAltitude",2500.0)

    @Test fun `DEM changes leave ordinary SDK clamped pins alone while refreshing meshes and real boreholes`() {
        val pin=JSONObject().put("kind","pin").put("icon","pin").put("groundElevation",2400.0)
        assertFalse(NativeModelTerrainInput.needsTerrainRefresh(pin))
        assertFalse(NativeModelTerrainInput.needsTerrainRefresh(JSONObject(pin.toString()).put("groundElevation",JSONObject.NULL)))
        val drill=JSONObject(pin.toString()).put("icon","drill").put("borehole",JSONObject().put("depth",80.0))
        assertTrue(NativeModelTerrainInput.needsTerrainRefresh(drill))
        assertFalse(NativeModelTerrainInput.needsTerrainRefresh(JSONObject(drill.toString()).put("icon","flag")))
        assertFalse(NativeModelTerrainInput.needsTerrainRefresh(JSONObject(drill.toString()).put("borehole",JSONObject().put("depth",JSONObject.NULL))))
        for(kind in listOf("box","sphere","cylinder","prism"))assertTrue(NativeModelTerrainInput.needsTerrainRefresh(saved().put("kind",kind)))
    }

    @Test fun `current raw DEM replaces stale render ground without rewriting saved or explicit placement`() {
        val saved=saved()
        val render=NativeModelTerrainInput.prepare(saved,true,2320.25)
        assertEquals(2320.25,render.getDouble("groundElevation"),0.0)
        assertEquals(2400.0,saved.getDouble("groundElevation"),0.0)
        assertEquals(2500.0,render.getDouble("centerAltitude"),0.0)
        assertEquals(5.0,render.getDouble("offset"),0.0)
    }
    @Test fun `terrain off binds relative placement to display plane and terrain on rebinds current ground`() {
        val saved=saved().apply { remove("centerAltitude");put("placement","underground") }
        assertEquals(0.0,NativeModelTerrainInput.prepare(saved,false,2400.0).getDouble("groundElevation"),0.0)
        val on=NativeModelTerrainInput.prepare(saved,true,2300.0)
        assertEquals(2300.0,on.getDouble("groundElevation"),0.0)
        assertEquals("underground",on.getString("placement"))
        assertEquals(5.0,on.getDouble("offset"),0.0)
    }
    @Test fun `late terrain preserves supplied fallback then updates while unknown ground stays unknown`() {
        assertEquals(2400.0,NativeModelTerrainInput.prepare(saved(),true,null).getDouble("groundElevation"),0.0)
        val unknown=JSONObject().put("groundElevation",JSONObject.NULL)
        assertTrue(NativeModelTerrainInput.prepare(unknown,true,null).isNull("groundElevation"))
        assertEquals(1250.5,NativeModelTerrainInput.prepare(unknown,true,1250.5).getDouble("groundElevation"),0.0)
    }
    @Test fun `terrain switch and exaggeration changes invalidate model placement with unchanged DEM revision`() {
        val original=NativeModelTerrainInput.Stamp(1,true,1.0)
        assertNotEquals(original,NativeModelTerrainInput.Stamp(1,false,1.0))
        assertNotEquals(original,NativeModelTerrainInput.Stamp(1,true,2.0))
        assertNotEquals(original,NativeModelTerrainInput.Stamp(2,true,1.0))
    }
}
