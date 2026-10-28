plugins {
    id("com.android.application") version "9.3.1" apply false
    id("org.jetbrains.kotlin.android") version "2.4.10" apply false
}

val buildStage = providers.gradleProperty("buildStage").orElse("${System.getProperty("java.io.tmpdir")}/shantu-mobile-native-build").get()
layout.buildDirectory.set(file("$buildStage/root"))
