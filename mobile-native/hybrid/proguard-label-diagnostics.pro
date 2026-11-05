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
