package com.shantu.nativeapp.map

import earth.worldwind.shape.Ellipsoid
import earth.worldwind.shape.Path
import earth.worldwind.shape.Placemark
import earth.worldwind.shape.TriangleMesh
import earth.worldwind.geom.AltitudeMode
import earth.worldwind.render.image.ArgbImage
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeModelRendererTest {
    @Test fun `repeated terrain and selection redraws retain one icon identity while the borehole depth trace updates`() {
        var glyph: earth.worldwind.render.image.ImageSource? = null
        for(i in 0 until 100) {
            val marker=annotation("pin", "\"icon\":\"drill\",\"borehole\":{\"depth\":80},\"_mapZoom\":12")
                .put("groundElevation",100.0+i).put("_selected",i%2==0)
            val rendered=NativeModelRenderer.render(marker)
            val pin=rendered.renderables.first() as Placemark
            assertEquals(AltitudeMode.CLAMP_TO_GROUND,pin.altitudeMode)
            if(glyph==null)glyph=pin.attributes.imageSource else org.junit.Assert.assertSame(glyph,pin.attributes.imageSource)
            val trace=rendered.renderables[1] as Path
            assertEquals(100.0+i,trace.positions.first().altitude,0.0)
        }
    }
    @Test fun `marker glyph identities include name style and bounded density`() {
        fun marker(icon:String,color:String,zoom:Double=12.0,name:String="Model",cssScale:Double=1.0)=annotation("pin", "\"icon\":\"$icon\",\"_mapZoom\":$zoom,\"_cssScale\":$cssScale,\"name\":\"$name\"").put("color",color)
        fun image(icon:String,color:String,zoom:Double=12.0,name:String="Model",cssScale:Double=1.0)=(NativeModelRenderer.render(marker(icon,color,zoom,name,cssScale)).renderables.first() as Placemark).attributes.imageSource
        org.junit.Assert.assertSame(image("flag","#123456"),image("flag","#123456"))
        org.junit.Assert.assertNotSame(image("flag","#123456"),image("star","#123456"))
        org.junit.Assert.assertNotSame(image("flag","#123456"),image("flag","#123457"))
        org.junit.Assert.assertSame(image("flag","#123456"),image("flag","#123456",7.0))
        org.junit.Assert.assertNotSame(image("flag","#123456",12.0,"营地"),image("flag","#123456",12.0,"观景台"))
        org.junit.Assert.assertNotSame(image("flag","#123456",12.0,"Model",1.0),image("flag","#123456",12.0,"Model",2.8))
        for(i in 0..NativeModelRenderer.MAX_MARKER_GLYPHS+20)image("flag","#%06x".format(i))
        assertTrue(NativeModelRenderer.cachedMarkerGlyphCount()<=NativeModelRenderer.MAX_MARKER_GLYPHS)
    }

    @Test fun `zoom scales the whole badge in place without changing texture anchor or saved data`() {
        val input=annotation("pin", "\"icon\":\"flag\",\"_mapZoom\":12,\"_cssScale\":2.8")
        val result=NativeModelRenderer.render(input)
        val marker=result.renderables.filterIsInstance<Placemark>().single()
        val source=marker.attributes.imageSource
        val saved=input.toString()
        val anchor=marker.attributes.imageOffset
        val position=marker.position
        var previous=marker.attributes.imageScale
        assertNotNull(source)
        for (zoom in listOf(11.0, 9.15, 9.0, 8.85, 8.15, 8.0, 7.85, 4.0, 2.0)) {
            assertTrue(NativeModelRenderer.updateMarkerPresentation(result.renderables, zoom, 2.8, "label"))
            assertTrue(marker.attributes.imageScale <= previous)
            assertSame(source, marker.attributes.imageSource)
            assertSame(anchor, marker.attributes.imageOffset)
            assertSame(position, marker.position)
            assertFalse(marker.attributes.isDrawLabel) // No independent WorldWind text drawable.
            assertEquals(1, result.renderables.filterIsInstance<Placemark>().size)
            previous=marker.attributes.imageScale
        }
        assertTrue(NativeModelRenderer.updateMarkerPresentation(result.renderables, 16.0, 2.8, "label"))
        assertEquals(40.0*2.8/(64.0*3), marker.attributes.imageScale, 0.0001)
        assertSame(source, marker.attributes.imageSource)
        assertEquals(saved, input.toString())
        val distant=NativeModelRenderer.render(annotation("pin", "\"_mapZoom\":3,\"_selected\":true"))
        assertEquals(1,distant.renderables.filterIsInstance<Placemark>().size)
        val plain=NativeModelRenderer.render(annotation("pin", "\"_mapZoom\":3"))
        assertTrue((distant.renderables.single() as Placemark).attributes.imageSource === (plain.renderables.single() as Placemark).attributes.imageSource)
        assertTrue(NativeModelRenderer.updateMarkerPresentation(distant.renderables,3.0,1.0,"dot"))
    }

    @Test fun `legacy mode hints cannot separate the name frame from the distant icon`() {
        val near=NativeModelRenderer.render(annotation("pin", "\"_mapZoom\":16"))
            .renderables.single() as Placemark
        for (mode in listOf("label", "icon", "dot")) {
            val input=annotation("pin", "\"_mapZoom\":3,\"_markerMode\":\"$mode\"")
            val result=NativeModelRenderer.render(input)
            val placemark=result.renderables.single() as Placemark
            assertSame(near.attributes.imageSource, placemark.attributes.imageSource)
            assertEquals(14.0/64.0, placemark.attributes.imageScale, 0.0001)
            assertFalse(placemark.attributes.isDrawLabel)
        }
    }

    @Test fun `density replacement keeps one fallback badge and scales it during continuous zoom`() {
        val rendered = NativeModelRenderer.render(annotation("pin", "\"_mapZoom\":16"))
        val marker = rendered.renderables.single() as NativeMarkerPlacemark
        val originalSource = marker.attributes.imageSource
        assertTrue(NativeModelRenderer.updateMarkerPresentation(rendered.renderables, 12.0, 2.0, "label"))
        val densityTwoSource = marker.attributes.imageSource
        assertNotSame(originalSource, densityTwoSource)
        assertTrue(NativeModelRenderer.updateMarkerPresentation(rendered.renderables, 9.0, 3.0, "label"))
        val densityThreeSource = marker.attributes.imageSource
        assertNotSame(densityTwoSource, densityThreeSource)
        assertTrue(NativeModelRenderer.updateMarkerPresentation(rendered.renderables, 4.0, 3.0, "label"))
        assertSame(densityThreeSource, marker.attributes.imageSource)
        assertEquals(14.0/64.0, marker.attributes.imageScale, 0.0001)
        val fallback = marker.selectActiveAttributes(false, true)
        assertSame(originalSource, fallback.imageSource)
        assertEquals(14.0*3.0/64.0, fallback.imageScale, 0.0001)
        assertSame(densityThreeSource, marker.selectActiveAttributes(true, true).imageSource)
        assertNull(marker.fallbackImageSourceForTest())
    }

    @Test fun `replacement placemark inherits its previous ready glyph without adding a second shape`() {
        val previous = NativeModelRenderer.render(annotation("pin", "\"_mapZoom\":12"))
            .renderables.single() as NativeMarkerPlacemark
        val previousSource = previous.attributes.imageSource
        val replacementInput = annotation("pin", "\"_mapZoom\":12,\"name\":\"Renamed\"")
        val replacement = NativeModelRenderer.render(
            replacementInput,
            previousMarkerPresentation = previous.snapshotForReplacement(),
        )
        val next = replacement.renderables.single() as NativeMarkerPlacemark
        assertNotSame(previousSource, next.attributes.imageSource)
        assertSame(previousSource, next.selectActiveAttributes(false, true).imageSource)
        assertEquals(1, replacement.renderables.filterIsInstance<Placemark>().size)
    }

    @Test fun `placemark never draws WorldWind default square while every marker texture is missing`() {
        val marker = NativeModelRenderer.render(annotation("pin", "")).renderables.single() as NativeMarkerPlacemark
        val source = marker.attributes.imageSource
        assertTrue(marker.shouldSkipForMissingTexture(source, textureReady = false))
        assertFalse(marker.shouldSkipForMissingTexture(source, textureReady = true))
        assertFalse(marker.shouldSkipForMissingTexture(null, textureReady = false))
    }

    @Test fun `creating many source descriptors does not execute pixel factories and keys compare by value`() {
        val calls=java.util.concurrent.atomic.AtomicInteger()
        for(i in 0 until 2000) {
            NativeModelRenderer.markerImageSource("test-badge-$i") {
                calls.incrementAndGet()
                ArgbImage(1,1,intArrayOf(0xffffffff.toInt()))
            }
        }
        val key1="same-icon-name-color-density"
        val key2=String(key1.toCharArray())
        val first=NativeModelRenderer.markerImageSource(key1) { calls.incrementAndGet(); ArgbImage(1,1,intArrayOf(1)) }
        val same=NativeModelRenderer.markerImageSource(key2) { calls.incrementAndGet(); ArgbImage(1,1,intArrayOf(2)) }
        val different=NativeModelRenderer.markerImageSource("different-name") { calls.incrementAndGet(); ArgbImage(1,1,intArrayOf(3)) }
        assertEquals(first, same)
        assertEquals(first.hashCode(), same.hashCode())
        assertFalse(first == different)
        assertEquals(0, calls.get())
    }
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
        assertFalse(mark.attributes.isDrawLabel)
        assertEquals(40.0 / 64.0, mark.attributes.imageScale, 0.0)
        assertEquals(0.5, mark.attributes.imageOffset.x, 0.0)
        assertEquals(2.0 / 64.0, mark.attributes.imageOffset.y, 0.0)
        assertEquals(earth.worldwind.geom.OffsetMode.FRACTION, mark.attributes.imageOffset.yUnits)
        val compact = NativeModelRenderer.render(annotation("pin", "\"_mapZoom\":7")).renderables.single() as Placemark
        assertEquals(2.0 / 64.0, compact.attributes.imageOffset.y, 0.0)
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
        assertFalse(result.renderables.filterIsInstance<Placemark>().single().attributes.isDrawLabel)
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
