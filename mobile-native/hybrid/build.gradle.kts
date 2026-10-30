@file:Suppress("DEPRECATION_ERROR")

import java.security.KeyStore
import java.security.MessageDigest

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Runtime probes stay isolated. Delivery reuses the existing personal app identity and key.
val personalDelivery = providers.gradleProperty("hybridDelivery").map(String::toBoolean).getOrElse(false)
val signingIdentity = rootProject.file("../config/android-standalone-signing.json").readText()
fun identityField(name: String): String = Regex("\"$name\"\\s*:\\s*\"([^\"]+)\"").find(signingIdentity)?.groupValues?.get(1)
    ?: error("Missing personal Android signing identity field: $name")
val personalSigningKey = providers.environmentVariable("GUANYUN_SIGNING_KEY").orNull?.let(::File)
    ?: rootProject.file("../mobile/.build/guanyun-test.jks")
val productIdentity = rootProject.file("../config/product.ts").readText()
val personalVersionName = Regex("APP_VERSION = '([^']+)'").find(productIdentity)?.groupValues?.get(1) ?: error("Missing app version")
val personalVersionCode = Regex("APP_VERSION_CODE = ([0-9]+)").find(productIdentity)?.groupValues?.get(1)?.toInt() ?: error("Missing app version code")
if (personalDelivery) {
    check(personalSigningKey.isFile) { "The existing personal Android signing key is unavailable; refusing a replacement identity." }
    val keyStore = KeyStore.getInstance("JKS").apply {
        personalSigningKey.inputStream().use { load(it, "android".toCharArray()) }
    }
    val certificate = keyStore.getCertificate("guanyun-test") ?: error("The existing Android signing alias is unavailable.")
    val fingerprint = MessageDigest.getInstance("SHA-256").digest(certificate.encoded).joinToString("") { "%02x".format(it) }
    check(fingerprint == identityField("certificateSha256")) { "Personal Android signing identity mismatch; refusing an incompatible update." }
}
val buildStage = providers.gradleProperty("buildStage").orElse("${System.getProperty("java.io.tmpdir")}/shantu-mobile-native-build").get()
val webAssets = rootProject.file("../mobile/dist-hybrid")
val mergedAssets = file("$buildStage/hybrid/generated/combinedAssets")
val sharedCadJni = file("$buildStage/hybrid/generated/cadJni")
val selectedTests = file("$buildStage/hybrid/generated/selectedTests")
layout.buildDirectory.set(file("$buildStage/hybrid"))

val verifyReactAssets by tasks.registering {
    inputs.dir(webAssets)
    doLast {
        check(webAssets.resolve("index.html").isFile) {
            "Build the private React assets first: npx vite build --config mobile/vite.config.ts --mode native-hybrid"
        }
    }
}

val prepareHybridAssets by tasks.registering(Sync::class) {
    dependsOn(verifyReactAssets, ":app:preparePrivateAssets", ":app:terrainAssets")
    from(webAssets)
    from(rootProject.file("app/src/main/assets"))
    from(rootProject.file("app/build/generated/privateAssets"))
    from(rootProject.file("../.openai/default-map-sources-private.json")) {
        into("native")
        rename { "default-map-sources.json" }
    }
    from(file("$buildStage/app/generated/nativeTerrainAssets"))
    from(rootProject.file("../public/industry"))
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    into(mergedAssets)
    outputs.cacheIf { false }
    doFirst {
        val privateSeeds = rootProject.file("../.openai/default-map-sources-private.json")
        val webSeeds = webAssets.resolve("native/default-map-sources.json")
        check(!webSeeds.isFile || webSeeds.readBytes().contentEquals(privateSeeds.readBytes())) {
            "React and native private source seeds differ; rebuild with the same personal configuration."
        }
        val terrain = file("$buildStage/app/generated/nativeTerrainAssets")
        terrain.walkTopDown().filter { it.isFile }.forEach { nativeFile ->
            val webFile = webAssets.resolve(nativeFile.relativeTo(terrain))
            check(!webFile.isFile || nativeFile.readBytes().contentEquals(webFile.readBytes())) {
                "React and native bundled terrain resources differ; rebuild the React assets."
            }
        }
    }
}

// Compile the shared CAD library once, then consume the same ABI binaries in both hosts.
val prepareSharedCadJni by tasks.registering(Sync::class) {
    dependsOn(":app:externalNativeBuildDebug")
    from(file("$buildStage/app/intermediates/cmake/debug/obj")) { include("**/libshantu_cad.so") }
    into(sharedCadJni)
    doLast {
        listOf("armeabi-v7a", "arm64-v8a", "x86", "x86_64").forEach { abi ->
            check(sharedCadJni.resolve("$abi/libshantu_cad.so").isFile) { "Missing shared native CAD ABI: $abi" }
        }
    }
}

val prepareHybridContractTests by tasks.registering(Sync::class) {
    from(rootProject.file("app/src/test/java")) {
        include("com/shantu/nativeapp/map/NativeOfflineDisplayPolicyTest.kt")
        include("com/shantu/nativeapp/map/BoundedTileNetworkTest.kt")
        include("com/shantu/nativeapp/map/TileRequestQueuePolicyTest.kt")
        include("com/shantu/nativeapp/map/TileRequestPermitSchedulerTest.kt")
        include("com/shantu/nativeapp/map/TileProjectedPriorityTest.kt")
        include("com/shantu/nativeapp/map/NativeRasterDetailTileStateTest.kt")
        include("com/shantu/nativeapp/map/NativeTileStageTelemetryTest.kt")
        include("com/shantu/nativeapp/map/NativeTileLayerVisibilityTest.kt")
        include("com/shantu/nativeapp/map/NativePersistentBrowseCacheTest.kt")
        include("com/shantu/nativeapp/map/NativeCartographyLayersTest.kt")
        include("com/shantu/nativeapp/map/NativeTiandituZoomPolicyTest.kt")
        include("com/shantu/nativeapp/map/NativeMapSourceTest.kt")
        include("com/shantu/nativeapp/map/NativeRasterDetailPlanTest.kt")
        include("com/shantu/nativeapp/map/NativeTerrainOverlaysTest.kt")
        include("com/shantu/nativeapp/map/NativeMissingTileFallbackTest.kt")
        include("com/shantu/nativeapp/map/NativeModelTerrainInputTest.kt")
        include("com/shantu/nativeapp/map/NativeBrowserCacheFallbackTest.kt")
        include("com/shantu/nativeapp/map/NativeImageSourceIdentityTest.kt")
        include("com/shantu/nativeapp/map/NativeRasterLoadTrackerTest.kt")
        include("com/shantu/nativeapp/map/NativePrintRasterFrameCoverageTest.kt")
        include("com/shantu/nativeapp/map/NativeBridgeFrameWitnessTest.kt")
        include("com/shantu/nativeapp/map/NativeBridgeEyeStateTest.kt")
        include("com/shantu/nativeapp/map/NativeTerrariumCoverageTest.kt")
        include("com/shantu/nativeapp/map/NativeTerrainBasemapTest.kt")
        include("com/shantu/nativeapp/map/NativeModelRendererTest.kt")
        include("com/shantu/nativeapp/map/NativeModelTerrainTest.kt")
    }
    into(selectedTests)
}

android {
    namespace = "com.shantu.nativeapp"
    compileSdk = 37
    ndkVersion = "28.2.13676358"
    defaultConfig {
        applicationId = if (personalDelivery) identityField("package") else "com.shantu.hybridprobe"
        minSdk = 26
        targetSdk = 35
        versionCode = if (personalDelivery) personalVersionCode else 1
        versionName = if (personalDelivery) personalVersionName else "0.1.0-hybrid-internal"
        manifestPlaceholders["hybridApplicationLabel"] = if (personalDelivery) identityField("applicationLabel") else "山兔·混合验证"
        ndk { abiFilters += listOf("armeabi-v7a", "arm64-v8a", "x86", "x86_64") }
    }
    if (personalDelivery) {
        signingConfigs.create("personal") {
            storeFile = personalSigningKey
            storePassword = "android"
            keyAlias = "guanyun-test"
            keyPassword = "android"
        }
        buildTypes.getByName("debug").signingConfig = signingConfigs.getByName("personal")
    }
    buildTypes.register("optimized") {
        initWith(buildTypes.getByName("release"))
        isDebuggable = false
        isMinifyEnabled = true
        isShrinkResources = false
        proguardFiles(
            getDefaultProguardFile("proguard-android-optimize.txt"),
            file("proguard-optimized.pro"),
        )
        if (personalDelivery) signingConfig = signingConfigs.getByName("personal")
    }
    sourceSets["main"].apply {
        java.srcDir("../app/src/main/java")
        java.srcDir("../../mobile/android/src")
        res.srcDir("../app/src/main/res")
        res.srcDir("../../mobile/android/res")
        assets.setSrcDirs(listOf(mergedAssets))
        jniLibs.srcDir(sharedCadJni)
    }
    sourceSets["test"].java.srcDir("../app/src/test/java/com/shantu/nativeapp/hybrid")
    sourceSets["test"].java.srcDir(selectedTests)
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }
    testOptions { unitTests.isIncludeAndroidResources = true }
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
tasks.named("preBuild").configure {
    dependsOn(prepareHybridAssets, prepareSharedCadJni)
}
tasks.matching { it.name == "preDebugUnitTestBuild" || it.name == "compileDebugUnitTestKotlin" || it.name == "compileDebugUnitTestJavaWithJavac" }
    .configureEach { dependsOn(prepareHybridContractTests) }
dependencies {
    implementation("androidx.core:core:1.15.0")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    implementation("earth.worldwind:worldwind:2.1.1")
    implementation("org.locationtech.proj4j:proj4j:1.4.3")
    implementation("org.locationtech.proj4j:proj4j-epsg:1.4.3")
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
}
