# Android map host workspace

The current personal app uses the `:hybrid` host: the existing React/TypeScript UI and business modules run above a native WorldWind Kotlin 2.1.1 map. Android system services remain native. There is no hidden WebGL map fallback. The older `:app` native-UI prototype is retained for history and shared native modules; it is not the personal upgrade package.

Read `CURRENT_STATE.md` and `docs/native-android/hybrid-progress-20261028.md` before building. A successful build is not a device or visual acceptance result.

## React UI and native-map build

From the repository root, build the private UI assets first:

```powershell
npx vite build --config mobile/vite.config.ts --mode native-hybrid
cd mobile-native
.\build-android.ps1 -Task ':hybrid:testDebugUnitTest' -JdkRoot '<JDK17>' -SdkRoot '<AndroidSDK>'
.\build-android.ps1 -Task ':hybrid:assembleDebug' -JdkRoot '<JDK17>' -SdkRoot '<AndroidSDK>'
```

The default hybrid package is the isolated `com.shantu.hybridprobe` test app. For an authorized personal delivery, run `:hybrid:assembleDebug` with `-PhybridDelivery=true` and the same `-PbuildStage` after configuring JDK/SDK. This reuses the package, label, and certificate in `config/android-standalone-signing.json` and the existing local signing key; it refuses an incompatible certificate. It must never be replaced by a newly generated identity. The output is `<buildStage>/hybrid/outputs/apk/debug/hybrid-debug.apk` for either variant, so copy and verify each candidate before switching variants.

Only private local APKs are delivered. Private map configuration, signing keys, generated assets, and APKs must not be uploaded to the public repository or a public Release. Preserve existing saved data and historical APKs; save any in-memory drawing before upgrading.

## Shared toolchain and older prototype

```powershell
.\build-android.ps1 -JdkRoot 'D:\path\to\jdk-17' -SdkRoot 'D:\path\to\Android\Sdk'
```

The script runs the Gradle wrapper and defaults to `assembleDebug`. Run unit tests with `-Task testDebugUnitTest`. Its default build stage is `ShantuNativeTools/mobile-native-build` on the source drive: Android unit-test resource paths require the source and build stage to share a drive on Windows. Use `-BuildStage` to override it with another ASCII path on that drive. The local private Tianditu key and map source seed must exist at the repository root in `.env.local` and `.openai/default-map-sources-private.json`; Gradle creates `app/build/generated/privateAssets/native-private-config.json` during the build. This generated asset is ignored by Git and must never be copied into `app/src/main/assets`.

Toolchain pins: Gradle 9.5.0, Android Gradle Plugin 9.3.1, Kotlin Gradle Plugin 2.4.10, compileSdk 37, targetSdk 35, JDK 17. Core library desugaring is enabled for WorldWind's Android AAR.
