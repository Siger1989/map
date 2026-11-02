# C25 MVT payload filter - isolated failed performance experiment

These four Kotlin files are preserved for cross-computer investigation only. They are outside every production/test source set and are not included in 164.

The experiment filters protobuf source-layer payloads before style-specific SDK decoding, preserving required layer content. JVM allocation decreased in its isolated fixture, but the complete C23-C25-C23 drag comparison did not consistently improve. Do not reactivate or claim success from the microbenchmark alone.

See `docs/native-android/dual-map-163-resume-20261102.md` and `artifacts/performance/native163-resume-20261102/mvt-filter-aba.json`. The original WorldWind 2.1.1 dependency remains in production. If revisiting, use an isolated worktree, port tests into its selected test source set, wire the filter only to the corresponding background style layers, and repeat exact full-app warm-drag comparisons. No credentials, APKs or user data belong here.
