# Native CAD decoder

The app uses GNU LibreDWG through a small C/JNI adapter. No WebView or JavaScript DWG runtime is embedded.

- Upstream: https://github.com/LibreDWG/libredwg
- Source commit: `b39eb1c29857df13d4de3568b601a6cd4201971d`
- Included source archive: `libredwg-b39eb1c.tar.gz`
- Archive SHA-256: `2f856e86bc0a16cac3f0f39618ad1999130611c8b6c0408d27e690c695fb652a`
- License: GNU GPL version 3 or later; full upstream COPYING is retained here and in app assets.
- Build: NDK `28.2.13676358`, CMake `3.22.1`, all four Android ABIs, max ELF page size 16384.

The archive is a complete `git archive` of the fixed source revision, including upstream notices and tests. CMake extracts it into the configured external ASCII build directory and builds a static library linked into `libshantu_cad.so`. Corresponding adapter source is under `app/src/main/cpp/` and Kotlin wrapper under `cad/NativeDwgDecoder.kt`.

DWG import retains original source bytes for export. Parsing failures and bounded output errors do not overwrite existing documents. Reproduction requires the Android SDK/NDK versions above and the ordinary project Gradle dependencies. A build alone does not establish a decoder or file's rendering accuracy on a device.
