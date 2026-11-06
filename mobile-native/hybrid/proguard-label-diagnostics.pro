# The external, same-certificate QA helper reads bounded numeric layout counters.
# No coordinates, text, credentials or rendering objects are exposed by this method.
-keepclassmembers class earth.worldwind.layer.mvt.MvtLabelCollider {
    public void copyLineLayoutStatistics(long[]);
}
# The same-certificate private QA helper reads only bounded overlay state and window bounds.
-keepclassmembers class com.shantu.nativeapp.floating.FloatingNavigationService {
    public static com.shantu.nativeapp.floating.FloatingNavigationService$Companion Companion;
}
-keep class com.shantu.nativeapp.floating.FloatingNavigationService$Companion {
    public org.json.JSONObject status();
}

# Keep only the reflection entry points used by the isolated synthetic floating-map probe.
-keep class com.shantu.nativeapp.floating.FloatingNavigationView {
    public <init>(android.content.Context);
    public void setLockscreenPresentation(boolean);
    public void setRoute(java.util.List);
    public void setKind(java.lang.String);
    public void setRouteColor(int);
    public void setRecordedSegments(java.util.List);
    public void setRecordingPhase(java.lang.String);
    public void setZoom(int);
    public void setCenter(com.shantu.nativeapp.floating.FloatingCoordinate);
    public void setHasRealLocation(boolean);
    public void setMapBearing(java.lang.Double);
    public void setHeading(java.lang.Double);
    public void setMode(java.lang.String);
    public void setStateText(java.lang.String);
    public void setRouteRemainingMeters(java.lang.Double);
    public void setLabel(java.lang.String);
    public void setTiles(java.util.List);
}
-keep class com.shantu.nativeapp.floating.FloatingCoordinate {
    public <init>(double, double);
}
-keep class com.shantu.nativeapp.floating.FloatingTileGeometry {
    public <init>(int, int, int, java.util.List);
}
-keep class com.shantu.nativeapp.geology.NativeMvtFeature {
    public <init>(java.lang.String, int, int, java.util.Map, java.util.List);
}
-keep class kotlin.Pair {
    public <init>(java.lang.Object, java.lang.Object);
}
