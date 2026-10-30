package com.shantu.nativeapp.map

import earth.worldwind.shape.Ellipsoid
import earth.worldwind.shape.Path
import earth.worldwind.shape.Placemark
import earth.worldwind.shape.TriangleMesh
import earth.worldwind.geom.AltitudeMode
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeModelRendererTest {
    @Test fun `fresh terrain placement aligns visible mesh and section geometry without changing saved ground`() {
        val saved=annotation("box", "\"groundElevation\":2400")
        val prepared=NativeModelTerrainInput.prepare(saved,true,2320.25)
        val visible=NativeModelRenderer.render(prepared).renderables.first() as TriangleMesh
        val section=NativeModelRenderer.sectionMesh(prepared)!!
        assertEquals(2320.25,visible.positions.minOf { it.altitude },1e-6)
        assertEquals(2320.25,section.vertices.minOf { it.altitudeMeters },1e-6)
        assertEquals(2400.0,saved.getDouble("groundElevation"),0.0)
        val flat=NativeModelRenderer.render(NativeModelTerrainInput.prepare(saved,false,null)).renderables.first() as TriangleMesh
        assertEquals(0.0,flat.positions.minOf { it.altitude },1e-6)
    }
    @Test fun `pin icons use their marker glyph and drill borehole draws a depth trace`() {
        val pin = NativeModelRenderer.render(annotation("pin", "\"icon\":\"flag\""))
        assertEquals(NativeMarkerStatus.RENDERED, pin.status)
        val mark = pin.renderables.single() as Placemark
        assertNotNull(mark.attributes.imageSource)
        assertEquals(24.0 / 64.0, mark.attributes.imageScale, 0.0)
        assertEquals(0.5, mark.attributes.imageOffset.x, 0.0)
        assertEquals(2.0 / 64.0, mark.attributes.imageOffset.y, 0.0)
        assertEquals(earth.worldwind.geom.OffsetMode.FRACTION, mark.attributes.imageOffset.yUnits)
        val dot = NativeModelRenderer.render(annotation("pin", "\"_mapZoom\":7")).renderables.single() as Placemark
        assertEquals(0.5, dot.attributes.imageOffset.y, 0.0)
        val borehole = NativeModelRenderer.render(annotation("pin", """"icon":"drill","borehole":{"depth":80}"""))
        assertEquals(NativeMarkerStatus.RENDERED, borehole.status)
        assertEquals(2, borehole.renderables.size)
        val trace = borehole.renderables[1] as Path
        assertEquals(10.0, trace.positions.first().altitude, 0.0)
        assertEquals(-70.0, trace.positions.last().altitude, 0.0)
        val unknownGround=annotation("pin", """"icon":"drill","groundElevation":null,"borehole":{"depth":80}""")
        val relative=NativeModelRenderer.render(unknownGround).renderables[1] as Path
        assertEquals(AltitudeMode.RELATIVE_TO_GROUND,relative.altitudeMode)
        assertFalse(relative.attributes.isDepthTest)
    }

    @Test fun `terrain flags need DEM and produce true intersection line plus independent ground mask`() {
        val marker = annotation("box", """"terrainCut":true,"terrainIntersection":true""")
        assertEquals(NativeMarkerStatus.NEEDS_ELEVATION, NativeModelRenderer.render(marker).status)
        val result = NativeModelRenderer.render(marker, NativeTerrainSampler { _, _ -> 12.0 })
        assertEquals(NativeMarkerStatus.RENDERED, result.status)
        val clipped = result.renderables.first() as TriangleMesh
        assertTrue(clipped.positions.any { it.altitude < 12.0 }) // model stays intact; the ground mask removes terrain separately
        assertTrue(result.renderables.drop(1).filterIsInstance<Path>().isNotEmpty())
        assertTrue((clipped.attributes.isDepthTest))
        assertNotNull(result.terrainCutMesh)
        assertTrue(result.terrainCutMesh!!.triangles.isNotEmpty())
    }

    @Test fun `underground model keeps xray geometry while cut mask removes ground pixels`() {
        val underground=annotation("box", """"placement":"underground","offset":2,"terrainCut":true""")
        val result=NativeModelRenderer.render(underground,NativeTerrainSampler{_,_->10.0})
        assertEquals(NativeMarkerStatus.RENDERED,result.status)
        val mesh=result.renderables.first() as TriangleMesh
        assertFalse(mesh.attributes.isDepthTest)
        assertTrue(mesh.positions.all{it.altitude<10.0})
        assertTrue(result.terrainCutMesh!!.triangles.isNotEmpty())
    }

    @Test fun `ordinary pin is terrain depth tested and not always on top`() {
        val pin = NativeModelRenderer.render(annotation("pin", "")).renderables.single() as Placemark
        assertTrue(pin.attributes.isDepthTest)
        assertFalse(pin.isAlwaysOnTop)
    }

    @Test
    fun `renders real box mesh with exact ground offset rotation and edges`() {
        val result = NativeModelRenderer.render(annotation("box", """"groundElevation":100,"offset":2,"width":20,"length":30,"height":10,"heading":90"""))
        assertEquals(NativeMarkerStatus.RENDERED, result.status)
        val mesh = result.renderables.first() as TriangleMesh
        assertEquals(8, mesh.positions.size)
        assertEquals(36, mesh.indices.size)
        assertEquals(102.0, mesh.positions.minOf { it.altitude }, 1e-6)
        assertEquals(112.0, mesh.positions.maxOf { it.altitude }, 1e-6)
        assertEquals(12, result.renderables.filterIsInstance<Path>().size)
        assertEquals(1, result.renderables.filterIsInstance<Placemark>().size)
    }

    @Test fun `model center preserves surface underground and explicit absolute placement in raw meters`() {
        assertEquals(112.0, NativeModelRenderer.modelCenterAltitude(100.0, null, "surface", 2.0, -10.0, 10.0)!!, 0.0)
        assertEquals(88.0, NativeModelRenderer.modelCenterAltitude(100.0, null, "underground", 2.0, -10.0, 10.0)!!, 0.0)
        assertEquals(150.0, NativeModelRenderer.modelCenterAltitude(100.0, 150.0, "surface", 2.0, -10.0, 10.0)!!, 0.0)
        assertEquals(null, NativeModelRenderer.modelCenterAltitude(null, null, "surface", 0.0, -5.0, 5.0))
        assertEquals(null, NativeModelRenderer.modelCenterAltitude(100.0, null, "unknown", 0.0, -5.0, 5.0))
    }

    @Test
    fun `sphere uses native ellipsoid radii and model rotations`() {
        val result = NativeModelRenderer.render(annotation("sphere", """"groundElevation":20,"width":8,"heading":35,"pitch":12,"roll":7"""))
        assertEquals(NativeMarkerStatus.RENDERED, result.status)
        val sphere = result.renderables.filterIsInstance<Ellipsoid>().single()
        assertEquals(4.0, sphere.xRadius, 0.0)
        assertEquals(4.0, sphere.yRadius, 0.0)
        assertEquals(4.0, sphere.zRadius, 0.0)
        assertEquals(35.0, sphere.heading.inDegrees, 1e-9)
        assertEquals(12.0, sphere.pitch.inDegrees, 1e-9)
        assertEquals(7.0, sphere.roll.inDegrees, 1e-9)
        assertEquals(24.0, sphere.center.altitude, 1e-9)
    }

    @Test
    fun `cylinder and prism have closed mesh surfaces and prism true footprint`() {
        val cylinder = NativeModelRenderer.render(annotation("cylinder", """"groundElevation":0,"width":6,"height":12"""))
        assertEquals(NativeMarkerStatus.RENDERED, cylinder.status)
        val cylinderMesh = cylinder.renderables.first() as TriangleMesh
        assertEquals(98, cylinderMesh.positions.size)
        assertEquals(48 * 12, cylinderMesh.indices.size)

        val prism = NativeModelRenderer.render(annotation("prism", """"groundElevation":5,"width":20,"length":10,"height":8,"footprint":[[-0.5,-0.5],[0.5,-0.5],[0.5,0.5],[0,0.1],[-0.5,0.5]]"""))
        assertEquals(NativeMarkerStatus.RENDERED, prism.status)
        val prismMesh = prism.renderables.first() as TriangleMesh
        assertEquals(10, prismMesh.positions.size)
        assertEquals(5.0, prismMesh.positions.minOf { it.altitude }, 1e-6)
        assertEquals(13.0, prismMesh.positions.maxOf { it.altitude }, 1e-6)
        assertTrue(prismMesh.indices.size >= 48)
    }

    @Test
    fun `does not fabricate missing elevation and handles hidden and unsupported records`() {
        val noGround = NativeModelRenderer.render(annotation("box", """"groundElevation":null"""))
        assertEquals(NativeMarkerStatus.NEEDS_ELEVATION, noGround.status)
        assertTrue(noGround.renderables.isEmpty())
        val absolute = NativeModelRenderer.render(annotation("box", """"groundElevation":null,"centerAltitude":150"""))
        assertEquals(NativeMarkerStatus.RENDERED, absolute.status)
        assertEquals(145.0, (absolute.renderables.first() as TriangleMesh).positions.minOf { it.altitude }, 1e-6)
        val hidden = NativeModelRenderer.render(annotation("box", """"visible":false"""))
        assertEquals(NativeMarkerStatus.HIDDEN, hidden.status)
        val unsupported = NativeModelRenderer.render(annotation("borehole", """"groundElevation":10"""))
        assertEquals(NativeMarkerStatus.UNSUPPORTED, unsupported.status)
        assertFalse(unsupported.reason.isNullOrBlank())
    }

    private fun annotation(kind: String, fields: String): JSONObject {
        val value = JSONObject("""{"id":"fixture-$kind","kind":"$kind","name":"Model","note":"","coordinates":[11,28],"color":"#336699","groundElevation":10,"placement":"surface","offset":0,"width":10,"length":20,"height":10,"heading":0,"pitch":0,"roll":0,"opacity":0.55,"terrainIntersection":false,"visible":true}""")
        val overrides = JSONObject("{$fields}")
        val keys = overrides.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            value.put(key, overrides.get(key))
        }
        return value
    }
}
