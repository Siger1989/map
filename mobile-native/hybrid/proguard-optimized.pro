# Keep readable diagnostic names while enabling shrinking and code optimization.
-dontobfuscate

# The contour layer applies the optional SDK draw-color hook through the public JVM setter.
-keepclassmembers class earth.worldwind.layer.mvt.MvtBatchedLineTile {
    public void setOutlineColorTransform(kotlin.jvm.functions.Function1);
}

# JNI uses the Java class/method name to resolve the native entry point.
-keepclasseswithmembers,includedescriptorclasses class * {
    native <methods>;
}

# Android WebView resolves these methods by their exposed JavaScript names.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
