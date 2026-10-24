#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
OUT="${1:-$ROOT/.openai/macos-launcher}"
mkdir -p "$OUT"
for arch in arm64 x86_64; do
  xcrun swiftc -O -parse-as-library -target "$arch-apple-macos13.0" \
    -framework AppKit -framework WebKit -framework UniformTypeIdentifiers \
    "$ROOT/desktop-web/macos/ShantuApp.swift" -o "$OUT/Shantu-$arch"
done
xcrun lipo -create "$OUT/Shantu-arm64" "$OUT/Shantu-x86_64" -output "$OUT/Shantu"
chmod 755 "$OUT/Shantu"
echo "$OUT/Shantu"
