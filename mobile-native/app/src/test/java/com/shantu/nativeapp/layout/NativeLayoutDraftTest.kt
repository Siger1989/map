package com.shantu.nativeapp.layout

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35])
class NativeLayoutDraftTest {
    @Test fun v1ContractRoundTripsAllPropertiesAndLegacySelectors() {
        val json=JSONObject().put("format","shantu-layout-draft").put("version",1)
            .put("viewport",JSONObject().put("width",390).put("height",844))
            .put("entries",JSONArray().put(JSONObject().put("selector",".topbar").put("label","顶部")
                .put("dx",4).put("dy",5).put("width",280).put("height",48).put("scale",1.2).put("fontSize",14)
                .put("hidden",false).put("zIndex",12).put("anchor",JSONObject().put("reference","#home-bottom-nav").put("x","center").put("y","top").put("gapX",0).put("gapY",8))))
        val parsed=NativeLayoutDraft.parse(json.toString())
        val entry=parsed.entries.single()
        assertEquals("#home-topbar",entry.selector)
        assertEquals(280.0,entry.width!!,0.0); assertEquals(1.2,entry.scale,0.0)
        assertEquals("#home-bottom-nav",entry.anchor!!.reference)
        assertEquals(entry,NativeLayoutDraft.parse(parsed.toJson().toString()).entries.single())
    }

    @Test fun unknownSelectorsAreRetainedAndReportedAsNotKnown() {
        val json=JSONObject().put("format",NativeLayoutDraft.FORMAT).put("version",1)
            .put("viewport",JSONObject().put("width",390).put("height",844))
            .put("entries",JSONArray().put(JSONObject().put("selector",".custom-panel").put("label","custom").put("dx",0).put("dy",0).put("scale",1).put("width",JSONObject.NULL).put("height",JSONObject.NULL).put("fontSize",JSONObject.NULL).put("hidden",false)))
        val draft=NativeLayoutDraft.parse(json.toString())
        assertEquals(".custom-panel",draft.entries.single().selector)
        assertFalse(NativeLayoutDraft.known(draft.entries.single().selector))
    }

    @Test fun invalidRangesAndDuplicateSelectorsFailClosed() {
        val base=JSONObject().put("format",NativeLayoutDraft.FORMAT).put("version",1).put("viewport",JSONObject().put("width",390).put("height",844))
        val e=JSONObject().put("selector","#home-topbar").put("label","top").put("dx",0).put("dy",0).put("scale",1).put("width",JSONObject.NULL).put("height",JSONObject.NULL).put("fontSize",JSONObject.NULL).put("hidden",false)
        assertThrows(IllegalArgumentException::class.java) { NativeLayoutDraft.parse(JSONObject(base.toString()).put("entries",JSONArray().put(JSONObject(e.toString()).put("scale",3))).toString()) }
        assertThrows(IllegalArgumentException::class.java) { NativeLayoutDraft.parse(JSONObject(base.toString()).put("entries",JSONArray().put(e).put(JSONObject(e.toString()))).toString()) }
    }

    @Test fun explicitNativeSelectorOverridesLegacyAlias() {
        val base=JSONObject().put("format",NativeLayoutDraft.FORMAT).put("version",1).put("viewport",JSONObject().put("width",390).put("height",844))
        fun entry(selector:String,label:String)=JSONObject().put("selector",selector).put("label",label).put("dx",0).put("dy",0).put("scale",1).put("width",JSONObject.NULL).put("height",JSONObject.NULL).put("fontSize",JSONObject.NULL).put("hidden",false)
        val draft=NativeLayoutDraft.parse(base.put("entries",JSONArray().put(entry(".topbar","legacy")).put(entry("#home-topbar","native"))).toString())
        assertEquals(1,draft.entries.size)
        assertEquals("native",draft.entries.single().label)
    }
}
