#!/usr/bin/env python3
"""Build a checksum-locked Android WorldWind overlay without Gradle or cache mutation."""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import urllib.request
import zipfile

PATCH_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = PATCH_ROOT.parents[1]
COORDINATE = Path("earth/worldwind/worldwind-android/2.1.1")
BASE_URL = "https://repo.maven.apache.org/maven2/earth/worldwind/worldwind-android/2.1.1/"
INPUTS = {
    "worldwind-android-2.1.1.aar": "7d1312f400016e9a746c5736944b9205d0c834458f0e978c88e7753ec5fa6c01",
    "worldwind-android-2.1.1-sources.jar": "0c97de300c578bd73956ca498f4eed8b5d582f3715bc22d7360863247ce9dbdc",
    "worldwind-android-2.1.1.pom": "06b74ad11e5c947e9a1a5394331181b576c3431fcbd5654038886e6ac74ae30c",
    "worldwind-android-2.1.1.module": "93f147ac8d1323357d246c4247421721c057acae8398912a1ca25e3202cce94d",
}
ORIGINAL_JAR_SHA256 = "8b6ea302913e35d247b1a95012ebc24da7914f25dd9f5b072445bdf8cb8b9e30"
PREFIX = "earth/worldwind/layer/mvt/"
REPLACE = {PREFIX + name for name in (
    "LabelDedup.class", "LabelGeoDedup.class", "Math.class", "MvtCurvedLineLabel.class",
    "MvtLabelCollider.class", "MvtLabelCollider$Companion.class", "MvtLabelColliderKt.class",
)}
ADD = {PREFIX + name for name in (
    "AndroidMvtLabelMetrics.class", "AndroidMvtLabelMetrics$cache$1.class",
    "AndroidMvtLabelMetrics$Extent.class", "AndroidMvtLabelMetrics$Key.class",
    "MvtLabelCollisionMath.class",
)}
KOTLIN_MODULE = "META-INF/earth.worldwind_worldwind.kotlin_module"
# Additions are explicit declaration+descriptor pairs. All existing members and class headers
# must remain identical; an unexpected synthetic/helper/member still fails the gate.
ABI_ADDITIONS = {
    PREFIX + "MvtCurvedLineLabel.class": {
        "public final void copyLayoutStatistics(long[]);\ndescriptor: ([J)V",
        "public final int prepareCollision$earth_worldwind_worldwind(earth.worldwind.render.RenderContext, earth.worldwind.layer.mvt.AndroidMvtLabelMetrics, java.lang.Object);\ndescriptor: (Learth/worldwind/render/RenderContext;Learth/worldwind/layer/mvt/AndroidMvtLabelMetrics;Ljava/lang/Object;)I",
        "public final void copyRunBounds$earth_worldwind_worldwind(int, float[]);\ndescriptor: (I[F)V",
        "public final void acceptCollisionRun$earth_worldwind_worldwind(int);\ndescriptor: (I)V",
    },
    PREFIX + "MvtLabelCollider.class": {
        "public final void copyLineLayoutStatistics(long[]);\ndescriptor: ([J)V",
    },
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def json_write(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def checked(data: bytes, digest: str, name: str) -> bytes:
    require(sha256(data) == digest, f"SHA-256 mismatch for {name}; refusing an unreviewed SDK input")
    return data


def isolated_output(path: Path) -> Path:
    result = path.resolve()
    require((PROJECT_ROOT / ".openai").resolve() in result.parents,
            f"Generated output must be below this checkout's .openai directory: {result}")
    return result


def sdk_default() -> str | None:
    configured = os.environ.get("ANDROID_SDK_ROOT") or os.environ.get("ANDROID_HOME")
    if configured:
        return configured
    properties = PROJECT_ROOT / "mobile-native/local.properties"
    if properties.is_file():
        for line in properties.read_text(encoding="utf-8-sig").splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() == "sdk.dir":
                return value.strip().replace("\\:", ":").replace("\\\\", "\\")
    return None


def jdk_default() -> str | None:
    configured = os.environ.get("JAVA_HOME")
    if configured:
        return configured
    javac = shutil.which("javac")
    return str(Path(javac).resolve().parent.parent) if javac else None


def cached_jar(cache: Path, group: str, artifact: str, version: str) -> Path:
    matches = sorted((cache / group / artifact / version).glob(f"*/{artifact}-{version}.jar"))
    require(len(matches) == 1, f"Need exactly one cached {group}:{artifact}:{version}, found {len(matches)}")
    return matches[0].resolve()


def upstream(name: str, cache: Path, target: Path, override: Path | None) -> tuple[bytes, str]:
    expected = INPUTS[name]
    if override:
        data, origin = override.read_bytes(), str(override.resolve())
    else:
        names = [name, "worldwind.aar"] if name.endswith(".aar") else [name]
        folder = cache / "earth.worldwind/worldwind-android/2.1.1"
        matches = sorted({p for filename in names for p in folder.glob(f"*/{filename}")})
        if matches:
            valid = [p for p in matches if sha256(p.read_bytes()) == expected]
            require(bool(valid), f"Cached {name} does not match the locked release; cache left untouched")
            data, origin = valid[0].read_bytes(), str(valid[0].resolve())
        else:
            origin = BASE_URL + name
            with urllib.request.urlopen(origin, timeout=45) as response:
                data = response.read()
    checked(data, expected, origin)
    (target / name).write_bytes(data)
    return data, origin


def run(command: list[str], log: Path) -> str:
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            encoding="utf-8", errors="replace", check=False)
    log.write_text(result.stdout, encoding="utf-8")
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}); see {log}\n{result.stdout[-5000:]}")
    return result.stdout


def fingerprint(files: list[Path]) -> tuple[str, list[dict[str, str]]]:
    records = [{"path": p.relative_to(PATCH_ROOT).as_posix(), "sha256": sha256(p.read_bytes())}
               for p in sorted(files)]
    payload = "".join(f"{r['path']}\0{r['sha256']}\n" for r in records).encode("utf-8")
    return sha256(payload), records


def zip_contents(data: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), "Duplicate binary ZIP entries require separate review")
        return {name: archive.read(name) for name in names}


def replace_zip(data: bytes, replacements: dict[str, bytes]) -> bytes:
    """Retain all original entries/metadata; deterministic timestamps for newly added classes."""
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as original, zipfile.ZipFile(output, "w") as patched:
        patched.comment = original.comment
        remaining = dict(replacements)
        for info in original.infolist():
            content = remaining.pop(info.filename, None)
            if content is None:
                content = original.read(info)
            patched.writestr(copy.copy(info), content, compress_type=info.compress_type, compresslevel=9)
        for name, content in sorted(remaining.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            patched.writestr(info, content, compresslevel=9)
    return output.getvalue()


def zip_audit(before: bytes, after: bytes, allowed_replace: set[str], expected_add: set[str]) -> dict:
    old, new = zip_contents(before), zip_contents(after)
    changed = {name for name in old.keys() & new.keys() if old[name] != new[name]}
    added, removed = new.keys() - old.keys(), old.keys() - new.keys()
    require(not removed and added == expected_add and changed <= allowed_replace,
            f"Unexpected ZIP delta: changed={changed}, added={added}, removed={removed}")
    return {"changed": sorted(changed), "added": sorted(added), "removed": sorted(removed),
            "unchanged_entry_count": len(old) - len(changed)}


def hashes(data: bytes) -> dict:
    return {"size": len(data), **{name: hashlib.new(name, data).hexdigest()
            for name in ("sha512", "sha256", "sha1", "md5")}}


def abi_members(value: str) -> tuple[str, set[str]]:
    lines = [line.strip() for line in value.splitlines()
             if line.strip() and not line.startswith("Compiled from")]
    require(bool(lines) and lines[0].endswith("{") and lines[-1] == "}", "Unrecognized javap class envelope")
    entries = set()
    index = 1
    while index < len(lines) - 1:
        require(index + 1 < len(lines) - 1 and lines[index + 1].startswith("descriptor: "),
                f"Unrecognized javap declaration: {lines[index]}")
        entry = lines[index] + "\n" + lines[index + 1]
        require(entry not in entries, "Duplicate javap ABI entry")
        entries.add(entry)
        index += 2
    return lines[0], entries


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jdk", default=jdk_default(), help="JDK root; defaults JAVA_HOME or PATH javac")
    parser.add_argument("--android-sdk", default=sdk_default(), help="Android SDK root (API 35 required)")
    gradle_user = Path(os.environ.get("GRADLE_USER_HOME", str(Path.home() / ".gradle")))
    parser.add_argument("--gradle-cache", type=Path, default=gradle_user / "caches/modules-2/files-2.1")
    parser.add_argument("--upstream-aar", type=Path, help="Optional original, checksum-locked AAR")
    parser.add_argument("--sources-archive", type=Path, help="Optional original, checksum-locked sources JAR")
    parser.add_argument("--output-repository", type=Path, default=PROJECT_ROOT / ".openai/worldwind-label-maven")
    parser.add_argument("--work-root", type=Path, help="Defaults to the output repository's .build directory")
    parser.add_argument("--verify-reproducible", action="store_true", help="Compile/package twice and compare bytes")
    args = parser.parse_args()
    require(bool(args.jdk) and bool(args.android_sdk), "Set --jdk/JAVA_HOME and --android-sdk/ANDROID_SDK_ROOT")
    executable_suffix = ".exe" if os.name == "nt" else ""
    java = Path(args.jdk) / "bin" / ("java" + executable_suffix)
    javap = Path(args.jdk) / "bin" / ("javap" + executable_suffix)
    android = Path(args.android_sdk) / "platforms/android-35/android.jar"
    for path in (java, javap, android):
        require(path.is_file(), f"Missing required input: {path}")
    repository = isolated_output(args.output_repository)
    work_root = isolated_output(args.work_root or repository / ".build")
    run_id = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    work = work_root / run_id
    upstream_dir = work / "upstream"
    upstream_dir.mkdir(parents=True)
    original, origins = {}, {}
    for name in INPUTS:
        override = args.upstream_aar if name.endswith(".aar") else (
            args.sources_archive if name.endswith("-sources.jar") else None)
        original[name], origins[name] = upstream(name, args.gradle_cache, upstream_dir, override)
    aar_name = "worldwind-android-2.1.1.aar"
    original_aar = original[aar_name]
    original_jar = checked(zip_contents(original_aar)["classes.jar"], ORIGINAL_JAR_SHA256, "classes.jar")
    require(not any(n.upper().endswith((".RSA", ".DSA", ".SF")) for n in zip_contents(original_jar)),
            "Signed SDK JAR requires separate handling")
    jar_path = upstream_dir / "classes.jar"
    jar_path.write_bytes(original_jar)
    stdlib = cached_jar(args.gradle_cache, "org.jetbrains.kotlin", "kotlin-stdlib", "2.4.10")
    annotations = cached_jar(args.gradle_cache, "org.jetbrains", "annotations", "26.1.0")
    compiler_jars = [cached_jar(args.gradle_cache, group, name, version) for group, name, version in (
        ("org.jetbrains.kotlin", "kotlin-compiler-embeddable", "2.4.10"),
        ("org.jetbrains.kotlin", "kotlin-build-tools-api", "2.4.10"),
        ("org.jetbrains.kotlin", "kotlin-script-runtime", "2.4.10"),
        ("org.jetbrains.kotlin", "kotlin-reflect", "1.6.10"),
        ("org.jetbrains.kotlin", "kotlin-daemon-embeddable", "2.4.10"),
        ("org.jetbrains.kotlinx", "kotlinx-coroutines-core-jvm", "1.8.0"),
    )] + [stdlib, annotations]
    compiler = [str(java), "-cp", os.pathsep.join(map(str, compiler_jars)),
                "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler"]
    sources = sorted((PATCH_ROOT / "src").rglob("*.kt"))
    require(len(sources) == 4, "Only the four reviewed SDK source files may enter this overlay")
    source_fingerprint, source_records = fingerprint(sources)
    build_fingerprint, build_records = fingerprint(sources + sorted((PATCH_ROOT / "tests").glob("*.kt"))
                                                   + [Path(__file__).resolve(), PATCH_ROOT / "LICENSE", PATCH_ROOT / "NOTICE"])
    compile_flags = ["-no-stdlib", "-no-reflect", "-jvm-target", "17", "-module-name", "earth.worldwind_worldwind",
                     f"-Xfriend-paths={jar_path}", "-classpath",
                     os.pathsep.join(map(str, (jar_path, android, stdlib, annotations)))]

    def compile_patch(label: str) -> tuple[Path, dict[str, bytes]]:
        output = work / label
        output.mkdir()
        run(compiler + compile_flags + ["-d", str(output)] + list(map(str, sources)), work / (label + ".log"))
        classes = {p.relative_to(output).as_posix(): p.read_bytes() for p in output.rglob("*.class")}
        require(set(classes) == REPLACE | ADD, f"Unexpected compiler class set: {set(classes) ^ (REPLACE | ADD)}")
        require(all(struct.unpack(">H", data[6:8])[0] == 61 for data in classes.values()), "Classfile target must remain 17")
        return output, classes

    classes_dir, class_bytes = compile_patch("classes")
    math_dir = work / "math-classes"
    math_dir.mkdir()
    math_classpath = os.pathsep.join(map(str, (stdlib, jar_path)))
    run(compiler + ["-no-stdlib", "-no-reflect", "-jvm-target", "17", "-classpath", math_classpath,
                    "-d", str(math_dir), str(PATCH_ROOT / "src/earth/worldwind/layer/mvt/MvtLabelCollisionMath.kt"),
                    str(PATCH_ROOT / "tests/LabelCollisionMathCheck.kt")], work / "math-compile.log")
    math_result = run([str(java), "-cp", os.pathsep.join(map(str, (math_dir, stdlib, jar_path))),
                       "earth.worldwind.layer.mvt.LabelCollisionMathCheckKt"], work / "math-tests.log")
    abi = []
    for name in sorted(REPLACE):
        class_name = name[:-6].replace("/", ".")
        signatures = []
        for label, cp in (("original", jar_path), ("patched", classes_dir)):
            value = run([str(javap), "-s", "-classpath", str(cp), class_name],
                        work / (name.split("/")[-1] + "." + label + ".abi.txt"))
            signatures.append(abi_members(value))
        old_header, old_members = signatures[0]
        new_header, new_members = signatures[1]
        additions = ABI_ADDITIONS.get(name, set())
        require(old_header == new_header and old_members <= new_members and new_members - old_members == additions,
                f"Unapproved JVM ABI delta in {class_name}: removed={old_members - new_members}, "
                f"added={new_members - old_members}, expected_added={additions}")
        abi.append({"class": class_name, "original_non_private_signatures_preserved": True,
                    "non_private_signatures_identical": old_members == new_members,
                    "added_signatures": sorted(additions)})
    patched_jar = replace_zip(original_jar, class_bytes)
    jar_audit = zip_audit(original_jar, patched_jar, REPLACE, ADD)
    require(zip_contents(original_jar)[KOTLIN_MODULE] == zip_contents(patched_jar)[KOTLIN_MODULE],
            "Original complete Kotlin module metadata must remain byte-identical")
    patched_aar = replace_zip(original_aar, {"classes.jar": patched_jar})
    aar_audit = zip_audit(original_aar, patched_aar, {"classes.jar"}, set())
    if args.verify_reproducible:
        _, second_classes = compile_patch("repro-classes")
        require(class_bytes == second_classes, "Fresh compiler pass did not reproduce all 12 class bytes")
        second_aar = replace_zip(original_aar, {"classes.jar": replace_zip(original_jar, second_classes)})
        require(patched_aar == second_aar, "Second AAR packaging pass was not byte-reproducible")
    require(fingerprint(sources)[0] == source_fingerprint, "Source files changed while compiling")
    module_name = "worldwind-android-2.1.1.module"
    module = json.loads(original[module_name])
    expected_module = copy.deepcopy(module)
    changed_records = 0
    for variant in module["variants"]:
        for file in variant.get("files", []):
            if file["url"] == aar_name:
                file.update(hashes(patched_aar))
                changed_records += 1
    require(changed_records == 2, "Expected original Android API and runtime AAR records")
    scrubbed = copy.deepcopy(module)
    for variant in scrubbed["variants"]:
        for file in variant.get("files", []):
            if file["url"] == aar_name:
                file.update(hashes(original_aar))
    require(scrubbed == expected_module, "Dependency/variant metadata changed beyond AAR size/checksums")
    stage = work / "maven" / COORDINATE
    stage.mkdir(parents=True)
    outputs = {**original, aar_name: patched_aar,
               module_name: (json.dumps(module, indent=2) + "\n").encode("utf-8")}
    for name, data in outputs.items():
        (stage / name).write_bytes(data)
        for algorithm in ("sha512", "sha256", "sha1", "md5"):
            (stage / (name + "." + algorithm)).write_text(hashlib.new(algorithm, data).hexdigest() + "\n", encoding="ascii")
    shutil.copyfile(PATCH_ROOT / "LICENSE", stage / "LICENSE")
    shutil.copyfile(PATCH_ROOT / "NOTICE", stage / "NOTICE")
    manifest = {
        "status": "LOCAL_AAR_BUILT_NOT_APK_OR_VISUALLY_VERIFIED",
        "coordinate": "earth.worldwind:worldwind-android:2.1.1",
        "original_sha256": {**INPUTS, "classes.jar": ORIGINAL_JAR_SHA256},
        "input_origins": origins,
        "patched_aar": hashes(patched_aar), "patched_classes_jar": hashes(patched_jar),
        "patched_module": hashes(outputs[module_name]),
        "source_fingerprint_sha256": source_fingerprint, "source_files": source_records,
        "build_fingerprint_sha256": build_fingerprint, "build_files": build_records,
        "abi": abi, "jar_entry_audit": jar_audit, "aar_entry_audit": aar_audit,
        "replacement_classes": sorted(REPLACE), "added_classes": sorted(ADD),
        "original_kotlin_module_preserved": True,
        "pom_byte_identical": outputs["worldwind-android-2.1.1.pom"] == original["worldwind-android-2.1.1.pom"],
        "module_dependencies_variants_preserved": True,
        "reproducible_second_compile_and_package": bool(args.verify_reproducible),
        "math_checks": math_result.strip(),
        "compiler": {"kotlin": "2.4.10", "java": str(java), "flags": compile_flags,
                     "jars": [{"path": str(p), "sha256": sha256(p.read_bytes())} for p in compiler_jars]},
        "python": sys.version, "work_directory": str(work),
        "license": "Apache-2.0; original sources classifier retained unchanged; local patch source listed above",
        "line_layout_statistics": {"method": "MvtCurvedLineLabel.copyLayoutStatistics(long[11])",
                                   "aggregate_method": "MvtLabelCollider.copyLineLayoutStatistics(long[11])",
                                   "slots": ["candidate_repeats", "prepared_repeats", "accepted_repeats",
                                             "source_vertex_projections", "glyph_projections", "projection_rejected_repeats",
                                             "direction_rejected_repeats", "offscreen_repeats", "layout_nanoseconds",
                                             "contiguous_chunks", "metric_queries"]},
        "limitations": ["No Gradle or device invocation", "Android Paint runtime, visuals and CPU/memory unverified",
                        "2 physical pixel projection-residual gate can reject names on nonlinear terrain",
                        "Per-repeat conservative AABB can overreject curved names; road geometry is untouched",
                        "No general text shaping, depth-test, cross-layer or tile-assembly streetSeen changes",
                        "Visible-repeat iterator uses the original formula with Double arc length; small Float phase differences are possible",
                        "Per-repeat collision evaluates more candidate layouts than the original midpoint proxy; profile the counters"],
    }
    json_write(stage / "build-manifest.json", manifest)
    json_write(work / "build-manifest.json", manifest)
    destination = repository / COORDINATE
    destination.mkdir(parents=True, exist_ok=True)
    # Publish metadata last so a reader never observes new hashes before the matching artifact.
    staged_files = sorted(stage.iterdir(), key=lambda p: (p.name.endswith((".module", "build-manifest.json")), p.name))
    for path in staged_files:
        temporary = destination / (path.name + ".tmp-" + run_id)
        shutil.copyfile(path, temporary)
        os.replace(temporary, destination / path.name)
    print(json.dumps({"repository_version_directory": str(destination),
                      "patched_aar_sha256": sha256(patched_aar), "source_fingerprint_sha256": source_fingerprint,
                      "math": "PASS", "abi": "7 original class ABIs preserved; exactly 5 additive methods",
                      "class_delta": "7 replace + 5 add",
                      "reproducible": bool(args.verify_reproducible)}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"worldwind-labels build failed: {error}", file=sys.stderr)
        sys.exit(1)
