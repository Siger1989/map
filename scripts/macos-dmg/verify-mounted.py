"""Read-only verification of an actual macOS-mounted DMG; never prints payloads."""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import struct
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
launcher = contents / "MacOS" / "Shantu"
assert os.access(launcher, os.X_OK)
launcher_bytes = launcher.read_bytes()
assert len(launcher_bytes) >= 8
magic_bytes = launcher_bytes[:4]
fat_formats = {
    b"\xca\xfe\xba\xbe": (">", "IIIII"),
    b"\xca\xfe\xba\xbf": (">", "IIQQII"),
    b"\xbe\xba\xfe\xca": ("<", "IIIII"),
    b"\xbf\xba\xfe\xca": ("<", "IIQQII"),
}
assert magic_bytes in fat_formats, "CFBundleExecutable must be a universal Mach-O binary, not a script or thin executable"
byte_order, arch_format = fat_formats[magic_bytes]
arch_count = struct.unpack_from(byte_order + "I", launcher_bytes, 4)[0]
assert 2 <= arch_count <= 32
arch_size = struct.calcsize(arch_format)
assert len(launcher_bytes) >= 8 + arch_count * arch_size
architectures = set()
for index in range(arch_count):
    entry = struct.unpack_from(byte_order + arch_format, launcher_bytes, 8 + index * arch_size)
    cpu, offset, size = entry[0], entry[2], entry[3]
    assert cpu in (0x0100000C, 0x01000007) and cpu not in architectures
    assert size >= 8 and offset <= len(launcher_bytes) and size <= len(launcher_bytes) - offset
    slice_bytes = launcher_bytes[offset:offset + size]
    if slice_bytes[:4] == b"\xcf\xfa\xed\xfe":
        slice_cpu = struct.unpack_from("<I", slice_bytes, 4)[0]
    elif slice_bytes[:4] == b"\xfe\xed\xfa\xcf":
        slice_cpu = struct.unpack_from(">I", slice_bytes, 4)[0]
    else:
        raise AssertionError("universal launcher contains a non-64-bit Mach-O slice")
    assert slice_cpu == cpu
    architectures.add(cpu)
assert architectures == {0x0100000C, 0x01000007}, "launcher must contain arm64 and x86_64 slices"
assert (resources / "AppIcon.icns").read_bytes()[:4] == b"icns"
metadata = plistlib.loads((contents / "Info.plist").read_bytes())
bundle_version = version.split("+", 1)[0].split("-", 1)[0]
assert metadata["CFBundleExecutable"] == "Shantu"
assert metadata["CFBundlePackageType"] == "APPL"
assert metadata["CFBundleIdentifier"] == "org.shantu.map.launcher"
assert metadata["LSMinimumSystemVersion"] == "13.0"
assert metadata["CFBundleShortVersionString"] == bundle_version
assert metadata["CFBundleVersion"] == bundle_version
volume_readme = (volume / "README.txt").read_text()
assert f"Shantu for macOS {version}" in volume_readme
assert "native WebKit window" in volume_readme and "Terminal" not in volume_readme
assert (volume / "Applications").is_symlink()
assert os.readlink(volume / "Applications") == "/Applications"
assert not (resources / "web/native/default-map-sources.json").exists()
print("Mounted HFS+ payload, bundle metadata, icon, symlink and executable modes: PASS")
