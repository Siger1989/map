# Shantu macOS DMG builder

This command converts a validated versioned Shantu portable macOS ZIP into a real UDIF disk image. It takes the app version from the ZIP manifest, checks that the single top-level package prefix matches that version, and uses the same version in the generated bundle metadata and volume README. It writes a case-insensitive HFS+ volume compressed as UDZO and can run on Windows, Linux, or macOS without `hdiutil`.

The DMG contains `Shantu.app` and an `Applications` link. The app is a small shell launcher with an icon and standard bundle metadata. It opens the existing local-browser edition in Terminal, starts the server on port 8787, then opens the map in the browser. It does not provide a native map window. Keep the launched Terminal session open while using the map; quitting it stops the local server.

## Build

Use Go 1.24 or newer. Pass either the public or private portable ZIP and the project logo PNG:

```powershell
$zip = Resolve-Path (Read-Host 'Path to the validated public or private macOS ZIP')
$prefix = [System.IO.Path]::GetFileNameWithoutExtension($zip.Path)
go run .\main.go -input $zip.Path -output (Join-Path (Get-Location) "$prefix.dmg") -icon ..\..\public\brand\shantu-logo.png
```

The output path must not already exist. The command validates the single ZIP prefix, rejects traversal paths, duplicates, symlinks and special entries, checks the manifest SHA-256 values and expected file counts, and confirms that the bundled Node executables contain arm64 and x86_64 Mach-O slices. It sets `Start-Mac.command` and both Node binaries to mode `0755`, with other files at `0644` and directories at `0755`. The JSON result on stdout contains image format, size, package visibility, architecture list, and SHA-256; it does not print payload contents or source paths.

The implementation uses `github.com/leaanthony/dmg` at commit `3d3581c3dfa304a59b0a91915229285805b43ff6` (`v0.0.0-20260731075144-3d3581c3dfa3`). Its `hfsplus`, `udif`, and `icns` packages are licensed under MIT; see [LICENSE](https://github.com/leaanthony/dmg/blob/3d3581c3dfa304a59b0a91915229285805b43ff6/LICENSE). The dependency and transitive module checksums are pinned in `go.sum`.

The pure-Go writer produces a real HFS+ filesystem inside a UDIF/UDZO container. A successful local build and its SHA-256 do not establish that macOS can mount the image or run the launcher; verify mounting and runtime behavior on a Mac.
