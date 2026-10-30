# Keep readable diagnostic names while enabling shrinking and code optimization.
-dontobfuscate

# JNI uses the Java class/method name to resolve the native entry point.
-keepclasseswithmembers,includedescriptorclasses class * {
    native <methods>;
}

# Android WebView resolves these methods by their exposed JavaScript names.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
