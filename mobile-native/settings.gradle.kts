import groovy.json.JsonSlurper
import java.security.MessageDigest

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        if (providers.gradleProperty("isolatedOldEngine").map(String::toBoolean).getOrElse(false)) {
            val patchRoot = file("worldwind-labels")
            val repositoryRoot = file("../.openai/worldwind-label-maven")
            val artifactRoot = repositoryRoot.resolve("earth/worldwind/worldwind-android/2.1.1")
            val manifestFile = artifactRoot.resolve("build-manifest.json")
            check(manifestFile.isFile) { "Build the isolated label SDK first: python mobile-native/worldwind-labels/build.py" }
            val manifest = JsonSlurper().parse(manifestFile) as Map<*, *>
            fun digest(file: File) = MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString("") { "%02x".format(it) }
            val sourceFiles = manifest["source_files"] as List<*>
            val expectedPaths = sourceFiles.map { row ->
                val record = row as Map<*, *>
                val path = record["path"] as String
                check(path.startsWith("src/") && !path.contains("..")) { "Invalid label SDK source path" }
                val source = patchRoot.resolve(path)
                check(source.isFile && digest(source) == record["sha256"]) { "Label SDK source changed; rebuild the local AAR before packaging: $path" }
                path
            }.toSet()
            check(patchRoot.resolve("src").walkTopDown().filter { it.isFile && it.extension == "kt" }
                .map { it.relativeTo(patchRoot).invariantSeparatorsPath }.toSet() == expectedPaths) { "Label SDK source set changed; rebuild the local AAR" }
            val aar = artifactRoot.resolve("worldwind-android-2.1.1.aar")
            check(aar.isFile && digest(aar) == (manifest["patched_aar"] as Map<*, *>)["sha256"]) { "Isolated label SDK artifact integrity mismatch" }
            exclusiveContent {
                forRepository { maven { name = "isolatedWorldWindLabels"; url = uri(repositoryRoot) } }
                filter { includeModule("earth.worldwind", "worldwind-android") }
            }
        }
        google()
        mavenCentral()
    }
}

rootProject.name = "mobile-native"
include(":app")
include(":hybrid")
