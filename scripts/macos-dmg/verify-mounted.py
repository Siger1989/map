"""Read-only verification of an actual macOS-mounted DMG; never prints payloads."""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import sys

volume = Path(sys.argv[1]).resolve()
contents = volume / "Shantu.app" / "Contents"
resources = contents / "Resources"
manifest = json.loads((resources / "manifest.json").read_text())
version = manifest["appVersion"]
semver = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$")
assert semver.fullmatch(version)
assert manifest["format"] == "shantu-macos-portable" and manifest["formatVersion"] == 1
assert manifest["visibility"] == "public"
assert len(manifest["files"]) >= 7
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
bundle_version = version.split("+", 1)[0].split("-", 1)[0]
assert metadata["CFBundleExecutable"] == "Shantu"
assert metadata["CFBundlePackageType"] == "APPL"
assert metadata["CFBundleShortVersionString"] == bundle_version
assert metadata["CFBundleVersion"] == bundle_version
assert f"Shantu for macOS {version}" in (volume / "README.txt").read_text()
assert (volume / "Applications").is_symlink()
assert os.readlink(volume / "Applications") == "/Applications"
assert not (resources / "web/native/default-map-sources.json").exists()
print("Mounted HFS+ payload, bundle metadata, icon, symlink and executable modes: PASS")
