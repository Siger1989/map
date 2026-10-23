"""Read-only verification of an actual macOS-mounted DMG; never prints payloads."""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import sys

volume = Path(sys.argv[1]).resolve()
contents = volume / "Shantu.app" / "Contents"
resources = contents / "Resources"
manifest = json.loads((resources / "manifest.json").read_text())
assert manifest["appVersion"] == "0.2.132-test"
assert manifest["visibility"] == "public"
assert len(manifest["files"]) == 1932
for relative, expected in manifest["files"].items():
    target = (resources / relative).resolve()
    assert target.is_relative_to(resources)
    assert hashlib.sha256(target.read_bytes()).hexdigest() == expected
for relative in ("Start-Mac.command", "runtime/node-arm64", "runtime/node-x64"):
    assert os.access(resources / relative, os.X_OK)
assert os.access(contents / "MacOS" / "Shantu", os.X_OK)
assert (contents / "MacOS" / "Shantu").read_bytes().startswith(b"#!/bin/sh\n")
assert (resources / "AppIcon.icns").read_bytes()[:4] == b"icns"
metadata = plistlib.loads((contents / "Info.plist").read_bytes())
assert metadata["CFBundleExecutable"] == "Shantu"
assert metadata["CFBundlePackageType"] == "APPL"
assert metadata["CFBundleShortVersionString"] == "0.2.132"
assert (volume / "Applications").is_symlink()
assert os.readlink(volume / "Applications") == "/Applications"
assert not (resources / "web/native/default-map-sources.json").exists()
print("Mounted HFS+ payload, bundle metadata, icon, symlink and executable modes: PASS")
