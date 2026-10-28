package com.shantu.nativeapp.ui

import com.shantu.nativeapp.navigation.NativeCoordinate
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
@org.robolectric.annotation.Config(sdk=[28],manifest=org.robolectric.annotation.Config.NONE)
class NativeReturnHomePanelTest {
 @Test fun breadcrumbReverseKeepsRecordingSegmentsSeparate(){
  val first=listOf(NativeCoordinate(0.0,0.0),NativeCoordinate(.001,0.0))
  val second=listOf(NativeCoordinate(1.0,1.0),NativeCoordinate(1.001,1.0))
  val a=nativeBreadcrumbFavorite("记录",first,0).getJSONObject("route").getJSONArray("coordinates")
  val b=nativeBreadcrumbFavorite("记录",second,1).getJSONObject("route").getJSONArray("coordinates")
  assertEquals(.001,a.getJSONArray(0).getDouble(0),0.000001)
  assertEquals(0.0,a.getJSONArray(a.length()-1).getDouble(0),0.000001)
  assertEquals(1.001,b.getJSONArray(0).getDouble(0),0.000001)
  assertEquals(1.0,b.getJSONArray(b.length()-1).getDouble(0),0.000001)
 }
 @Test fun breadcrumbRejectsInvalidGeometryAndShortSegments(){
  assertNotNull(runCatching{nativeBreadcrumbFavorite("bad",listOf(NativeCoordinate(0.0,0.0),NativeCoordinate(181.0,0.0)),0)}.exceptionOrNull())
  assertNotNull(runCatching{nativeBreadcrumbFavorite("short",listOf(NativeCoordinate(0.0,0.0),NativeCoordinate(.00001,0.0)),0)}.exceptionOrNull())
 }
}
