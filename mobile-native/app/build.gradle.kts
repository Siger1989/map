@file:Suppress("DEPRECATION_ERROR")

import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import java.nio.charset.StandardCharsets

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val privateConfigSource = rootProject.file("../.openai/default-map-sources-private.json")
val envFile = rootProject.file("../.env.local")
val buildStage = providers.gradleProperty("buildStage").orElse("${System.getProperty("java.io.tmpdir")}/shantu-mobile-native-build").get()
val generatedPrivateAssets = rootProject.file("app/build/generated/privateAssets")
val generatedTerrainAssets = file("$buildStage/app/generated/nativeTerrainAssets")
val repositoryRoot = rootProject.projectDir.parentFile
val privateAssetFile = generatedPrivateAssets.resolve("native-private-config.json")

val preparePrivateAssets by tasks.registering {
    inputs.file(privateConfigSource)
    inputs.file(envFile)
    outputs.file(privateAssetFile)
    outputs.cacheIf { false }
    doLast {
        val sourceAssets = rootProject.file("app/src/main/assets/native-private-config.json")
        check(!sourceAssets.exists()) {
            "Private map config must only be generated from local private inputs, never stored in app/src/main/assets."
        }
        check(privateConfigSource.isFile) { "Required local private map source config is missing." }
        check(envFile.isFile) { "Required local .env.local file is missing." }

        val key = envFile.readLines().firstNotNullOfOrNull { line ->
            val trimmed = line.trim()
            if (trimmed.startsWith("NEXT_PUBLIC_TIANDITU_KEY=")) {
                trimmed.substringAfter('=').trim().trim('"', '\'')
            } else null
        }.orEmpty()
        check(key.isNotBlank()) { "Required Tianditu key is missing from local .env.local." }
        val privateEnvironment = envFile.readLines().mapNotNull { line ->
            val text=line.trim()
            if(text.startsWith("#") || !text.contains('=')) null
            else text.substringBefore('=').trim() to text.substringAfter('=').trim().trim('"','\'')
        }.toMap()
        val geocloud=privateEnvironment["GEOCLOUD_TOKEN"]?.takeIf { it.isNotBlank() }?.let { token ->
            mapOf("token" to token,"service" to (privateEnvironment["GEOCLOUD_SERVICE"] ?: "qg20_20210401_FCnDDRJd"),"layer" to (privateEnvironment["GEOCLOUD_LAYER"] ?: ""))
        }

        @Suppress("UNCHECKED_CAST")
        val root = JsonSlurper().parse(privateConfigSource) as? Map<String, Any?>
            ?: error("Local private map source config is invalid.")
        @Suppress("UNCHECKED_CAST")
        val maps = (root["maps"] as? List<Map<String, Any?>>)
            ?: error("Local private map source config has no maps array.")
        check(maps.isNotEmpty()) { "Local private map source config has no map sources." }

        privateAssetFile.parentFile.mkdirs()
        privateAssetFile.writeText(
            JsonOutput.toJson(linkedMapOf("tiandituKey" to key, "mapSources" to maps).apply { if(geocloud!=null)put("geocloud",geocloud) }),
            StandardCharsets.UTF_8
        )
    }
}

val terrainAssets by tasks.registering(Sync::class) {
    val fabdemSource = repositoryRoot.resolve("public/terrain/fabdem-v1-2")
    val repairSource = repositoryRoot.resolve("public/terrain/repairs-v1")
    val coverageSource = repositoryRoot.resolve("modules/terrain/ground-coverage.json")
    inputs.dir(fabdemSource)
    inputs.dir(repairSource)
    inputs.file(coverageSource)
    outputs.dir(generatedTerrainAssets)
    from(fabdemSource) { into("terrain/fabdem-v1-2") }
    from(repairSource) { into("terrain/repairs-v1") }
    from(repositoryRoot.resolve("public/basemaps")) { into("basemaps") }
    from(coverageSource) {
        into("native")
        rename { "ground-coverage.json" }
    }
    into(generatedTerrainAssets)
    doLast {
        val fabdemCount = fileTree(generatedTerrainAssets.resolve("terrain/fabdem-v1-2")) { include("**/*.png") }.files.size
        val repairCount = fileTree(generatedTerrainAssets.resolve("terrain/repairs-v1")) { include("**/*.png") }.files.size
        check(fabdemCount == 473) { "Native terrain asset sync expected 473 existing FABDEM tiles; found $fabdemCount." }
        check(repairCount == 23) { "Native terrain asset sync expected 23 existing repair tiles; found $repairCount." }
        check(generatedTerrainAssets.resolve("terrain/repairs-v1/coverage.json").isFile) { "Repair coverage metadata was not copied." }
        check(generatedTerrainAssets.resolve("terrain/repairs-v1/SOURCE.json").isFile) { "Repair source metadata was not copied." }
        check(generatedTerrainAssets.resolve("terrain/fabdem-v1-2/SOURCE.json").isFile) { "FABDEM source metadata was not copied." }
        check(generatedTerrainAssets.resolve("native/ground-coverage.json").isFile) { "FABDEM coverage metadata was not copied." }
    }
}

layout.buildDirectory.set(file("$buildStage/app"))

android {
    namespace = "com.shantu.nativeapp"
    compileSdk = 37
    ndkVersion = "28.2.13676358"
    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
            buildStagingDirectory = file("$buildStage/cxx")
        }
    }

    defaultConfig {
        applicationId = "com.shantu.nativeapp"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.1.1-native-test"
        ndk { abiFilters += listOf("armeabi-v7a", "arm64-v8a", "x86", "x86_64") }
    }

    sourceSets["main"].assets.srcDir(generatedPrivateAssets)
    sourceSets["main"].assets.srcDir(generatedTerrainAssets)
    sourceSets["main"].assets.srcDir("../../public/industry")

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

tasks.named("preBuild").configure {
    dependsOn(preparePrivateAssets)
    dependsOn(terrainAssets)
}

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
