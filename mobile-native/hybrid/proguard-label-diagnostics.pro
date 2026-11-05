# The external, same-certificate QA helper reads bounded numeric layout counters.
# No coordinates, text, credentials or rendering objects are exposed by this method.
-keepclassmembers class earth.worldwind.layer.mvt.MvtLabelCollider {
    public void copyLineLayoutStatistics(long[]);
}
