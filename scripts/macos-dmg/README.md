# Shantu macOS DMG builder

This command converts a validated versioned Shantu portable macOS ZIP and an explicitly built native launcher into a real UDIF disk image. It takes the app version from the ZIP manifest, checks that the single top-level package prefix matches that version, and uses the same version in the generated bundle metadata and volume README. It writes a case-insensitive HFS+ volume compressed as UDZO and can run on Windows, Linux, or macOS without `hdiutil`.

The DMG contains `Shantu.app` and an `Applications` link. `Shantu.app/Contents/MacOS/Shantu` is the supplied universal arm64/x86_64 Mach-O executable; the builder rejects scripts, thin binaries, malformed slices, and binaries missing either architecture. The app opens a native WebKit window and starts the bundled local service. The bundle identifier stays `org.shantu.map.launcher` and its minimum system version is macOS 13.0. The Info.plist adds no camera/location usage strings because the current native wrapper does not request those system permissions. The builder does not sign or notarize the app.

## Build

Use Go 1.24 or newer. Build the standalone universal launcher with `desktop-web/macos/build-launcher.sh`, then pass the private portable ZIP, the project logo PNG, and the compiled Mach-O executable. Public fixtures remain available only for credential-free CI tests; user deliveries include the registered Tianditu configuration.

```powershell
$zip = Resolve-Path (Read-Host 'Path to the validated public or private macOS ZIP')
$prefix = [System.IO.Path]::GetFileNameWithoutExtension($zip.Path)
$launcher = Resolve-Path ..\..\.openai\macos-launcher\Shantu
go run .\main.go -input $zip.Path -output (Join-Path (Get-Location) "$prefix.dmg") -icon ..\..\public\brand\shantu-logo.png -launcher $launcher.Path
```

The output path must not already exist. `-launcher` is required and must point to the compiled universal binary output, not the `.app` bundle or a build script. The command validates both launcher slices before writing the DMG, validates the single ZIP prefix, rejects traversal paths, duplicates, symlinks and special entries, checks the manifest SHA-256 values and expected file counts, and confirms that the bundled Node executables contain arm64 and x86_64 Mach-O slices. It preserves `Start-Mac.command`, all payload files and manifest hashes, the private map-source payload when building a private ZIP, the app icon, and the Applications link. The native app executable is written at mode `0755`; bundled command/Node files remain executable. The JSON result on stdout contains image format, size, package visibility, architecture list, and SHA-256; it does not print payload contents or source paths.

The implementation uses `github.com/leaanthony/dmg` at commit `3d3581c3dfa304a59b0a91915229285805b43ff6` (`v0.0.0-20260731075144-3d3581c3dfa3`). Its `hfsplus`, `udif`, and `icns` packages are licensed under MIT; see [LICENSE](https://github.com/leaanthony/dmg/blob/3d3581c3dfa304a59b0a91915229285805b43ff6/LICENSE). The dependency and transitive module checksums are pinned in `go.sum`.

The pure-Go writer produces a real HFS+ filesystem inside a UDIF/UDZO container. A successful local build and its SHA-256 do not establish that macOS can mount the image, launch WebKit, or pass Gatekeeper; the builder does not assume a signing identity. Verify the mounted contents and the launcher's `--smoke-test <json-output-path>` on macOS CI or a Mac.
