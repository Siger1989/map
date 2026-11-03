#!/usr/bin/env python3
"""Capture an explicitly requested Android map diagnostic trace; no user content is edited."""

import argparse
import hashlib
import json
import math
import re
import socket
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_PACKAGE = "com.guanyun.weather.shantu.preview"
REFERENCE_CONFIG = '''buffers { size_kb: 32768 fill_policy: RING_BUFFER }
duration_ms: 16000
data_sources { config { name: "linux.ftrace" ftrace_config {
 ftrace_events: "sched/sched_switch"
 ftrace_events: "sched/sched_waking"
 ftrace_events: "power/cpu_frequency"
 atrace_categories: "gfx"
 atrace_categories: "view"
 atrace_categories: "dalvik"
 atrace_apps: "@@PACKAGE@@"
} } }
data_sources { config { name: "linux.process_stats" process_stats_config { scan_all_processes_on_start: true } } }
data_sources { config { name: "android.surfaceflinger.frametimeline" } }
'''
QA_HOST = "127.0.0.1"
QA_DEVICE_PORT = 23458
QUIET_SECONDS = 1.0
INTER_SWIPE_SECONDS = 0.2
SHORT_TRACE_BUFFER_KIB = 32768
LONG_TRACE_BUFFER_KIB = 131072
MAX_SWIPE_SPAN_OVERHEAD_MS = 15000
MAX_SWIPE_DURATION_SHORTFALL_MS = 20
TRACE_SWIPE_SPAN_NAME = "ShantuQa/swipe"


class CaptureError(RuntimeError):
    pass


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", action="store_true", help="opt in to QA input and Perfetto capture")
    parser.add_argument("--serial", help="explicit adb serial; required with --capture")
    parser.add_argument("--output", type=Path, help="unique new output directory; required with --capture")
    parser.add_argument("--package", default=DEFAULT_PACKAGE)
    parser.add_argument("--expected-version-name", help="required with --capture")
    parser.add_argument("--expected-version-code", type=int, help="required with --capture")
    parser.add_argument("--expected-map-count", type=int, choices=(1, 2), help="required with --capture")
    parser.add_argument("--repeats", type=int, choices=(4, 8, 32, 64), default=4)
    parser.add_argument("--duration-ms", type=int, default=350, help="each swipe duration in ms (50..2000); stable default 350ms; explicitly use 750ms for a ~30s 32-swipe window")
    parser.add_argument("--trace-seconds", type=int, default=16, help="Perfetto duration (15..90 seconds)")
    parser.add_argument("--perfetto-config", type=Path, help="optional existing pbtxt; otherwise use the embedded reference config")
    parser.add_argument("--adb", default="adb", help="adb executable or path")
    parser.add_argument("--qa-host-port", type=int, default=QA_DEVICE_PORT)
    parser.add_argument("--observed-manifest", type=Path, help="JSON with observed width/height and gesture coordinates")
    for name in ("x", "y", "x2", "y2"):
        parser.add_argument(f"--{name}", type=float)
    return parser


def coordinates_from_args(args):
    explicit = [args.x, args.y, args.x2, args.y2]
    if args.observed_manifest and any(value is not None for value in explicit):
        raise CaptureError("choose explicit gesture coordinates or --observed-manifest")
    if args.observed_manifest:
        try:
            manifest = json.loads(args.observed_manifest.read_text(encoding="utf-8"))
            gesture = manifest["gesture"]
            coords = {key: float(gesture[key]) for key in ("x", "y", "x2", "y2")}
            width, height = int(manifest["width"]), int(manifest["height"])
        except (OSError, ValueError, TypeError, KeyError) as error:
            raise CaptureError("observed manifest must contain width, height, and gesture x/y/x2/y2") from error
        source = "observed-manifest"
    elif all(value is not None for value in explicit):
        coords = dict(zip(("x", "y", "x2", "y2"), explicit))
        width = height = None
        source = "explicit"
    else:
        raise CaptureError("capture requires all --x/--y/--x2/--y2 values or --observed-manifest")
    if any(not math.isfinite(value) or value < 0 for value in coords.values()):
        raise CaptureError("gesture coordinates must be finite and non-negative")
    if width is not None and (width <= 0 or height <= 0 or
                              any(coords[key] >= (width if key in ("x", "x2") else height)
                                  for key in coords)):
        raise CaptureError("observed gesture coordinates exceed manifest dimensions")
    return coords, source, (width, height) if width is not None else None


def swipe_gap_seconds(repeats, duration_ms):
    return INTER_SWIPE_SECONDS


def estimated_input_seconds(repeats, duration_ms):
    return repeats * (duration_ms / 1000 + swipe_gap_seconds(repeats, duration_ms))


def buffer_kib_for_trace(trace_seconds):
    return LONG_TRACE_BUFFER_KIB if trace_seconds > 30 else SHORT_TRACE_BUFFER_KIB


def build_swipe_request(coords, duration, index):
    reverse = index % 2 == 1
    return {
        "action": "swipe",
        "x": coords["x2"] if reverse else coords["x"],
        "y": coords["y2"] if reverse else coords["y"],
        "x2": coords["x"] if reverse else coords["x2"],
        "y2": coords["y"] if reverse else coords["y2"],
        "duration": duration,
    }


def make_plan(args, coordinate_source=None):
    return {
        "mode": "CAPTURE_REQUESTED" if args.capture else "DRY_RUN",
        "package": args.package,
        "serial": args.serial,
        "expected": {
            "versionName": args.expected_version_name,
            "versionCode": args.expected_version_code,
            "mapCount": args.expected_map_count,
        },
        "repeats": args.repeats,
        "swipeDurationMs": args.duration_ms,
        "estimatedHostInputWindowSeconds": round(estimated_input_seconds(args.repeats, args.duration_ms), 3),
        "quietBeforeSeconds": QUIET_SECONDS,
        "quietAfterSeconds": QUIET_SECONDS,
        "traceSeconds": args.trace_seconds,
        "bufferKiB": buffer_kib_for_trace(args.trace_seconds),
        "perfettoConfig": str(args.perfetto_config) if args.perfetto_config else "embedded reference config",
        "requiredTraceSeconds": math.ceil(estimated_input_seconds(args.repeats, args.duration_ms) + 2 * QUIET_SECONDS),
        "windowFitsTrace": estimated_input_seconds(args.repeats, args.duration_ms) + 2 * QUIET_SECONDS <= args.trace_seconds,
        "output": str(args.output) if args.output else None,
        "gestureSource": coordinate_source,
        "video": False,
        "stackSampling": False,
        "cacheClearing": False,
        "installOrLaunch": False,
        "explicitCameraPresetOrLayerChanges": False,
        "cameraMovedByGesture": True,
    }


def validate_capture_args(parser, args):
    if not 50 <= args.duration_ms <= 2000:
        parser.error("--duration-ms must be 50..2000 ms")
    if not 15 <= args.trace_seconds <= 90:
        parser.error("--trace-seconds must be 15..90")
    if not 1 <= args.qa_host_port <= 65535:
        parser.error("--qa-host-port must be 1..65535")
    if args.capture:
        required = {
            "--serial": args.serial,
            "--output": args.output,
            "--expected-version-name": args.expected_version_name,
            "--expected-version-code": args.expected_version_code,
            "--expected-map-count": args.expected_map_count,
        }
        missing = [name for name, value in required.items() if value is None or value == ""]
        if missing:
            parser.error("--capture requires " + ", ".join(missing))
        if args.expected_version_code < 0:
            parser.error("--expected-version-code must be non-negative")
        if not args.output.is_absolute() or not args.output.name:
            parser.error("--output must be an absolute path to a new directory")
    return args


def prepare_config(config_text, package, trace_seconds, session_name, buffer_kib=None):
    buffer_kib = buffer_kib_for_trace(trace_seconds) if buffer_kib is None else buffer_kib
    text = config_text.replace("@@PACKAGE@@", package)
    buffer_sizes = list(re.finditer(r"\bsize_kb\s*:\s*\d+", text))
    if len(buffer_sizes) != 1:
        raise CaptureError("Perfetto config must contain exactly one buffer size_kb")
    match = buffer_sizes[0]
    text = text[:match.start()] + f"size_kb: {buffer_kib}" + text[match.end():]
    sources = re.findall(r'\bname\s*:\s*"([^"]+)"', text)
    if sorted(sources) != sorted(("linux.ftrace", "linux.process_stats", "android.surfaceflinger.frametimeline")):
        raise CaptureError("Perfetto config must keep the approved reference data sources")
    events = re.findall(r'(?m)^\s*ftrace_events\s*:\s*"([^"]+)"', text)
    if sorted(events) != sorted(("sched/sched_switch", "sched/sched_waking", "power/cpu_frequency")):
        raise CaptureError("Perfetto config must keep the approved ftrace events")
    categories = re.findall(r'(?m)^\s*atrace_categories\s*:\s*"([^"]+)"', text)
    if sorted(categories) != sorted(("gfx", "view", "dalvik")):
        raise CaptureError("Perfetto config must keep the approved atrace categories")
    app_names = re.findall(r'(?m)^\s*atrace_apps\s*:\s*"([^"]+)"', text)
    if app_names != [package]:
        raise CaptureError("Perfetto config does not target the requested package")
    duration_lines = list(re.finditer(r"(?m)^(\s*)duration_ms\s*:\s*\d+\s*$", text))
    if len(duration_lines) != 1:
        raise CaptureError("Perfetto config must contain exactly one duration_ms")
    match = duration_lines[0]
    replacement = f"{match.group(1)}duration_ms: {trace_seconds * 1000}"
    text = text[:match.start()] + replacement + text[match.end():]
    name_lines = list(re.finditer(r'(?m)^\s*unique_session_name\s*:\s*"[^"]*"\s*$', text))
    name_line = f'unique_session_name: "{session_name}"'
    if name_lines:
        match = name_lines[0]
        text = text[:match.start()] + name_line + text[match.end():]
    else:
        text = text.rstrip() + "\n" + name_line + "\n"
    return text


def validate_swipe_reply(reply, requested_duration_ms, previous_end_ns=None):
    """Validate QA device-clock metadata without aligning it to host or trace clocks."""
    accepted = reply.get("acceptedSwipeDurationMs")
    started = reply.get("commandStartedElapsedRealtimeNanos")
    ended = reply.get("commandEndedElapsedRealtimeNanos")
    if any(type(value) is not int or value < 0 for value in (accepted, started, ended)):
        raise CaptureError("QA swipe reply is missing valid device timing fields")
    if accepted != requested_duration_ms:
        raise CaptureError("QA swipe accepted duration differs from the requested duration")
    span_ns = ended - started
    if ended <= started or (previous_end_ns is not None and started <= previous_end_ns):
        raise CaptureError("QA swipe device timestamps are not strictly increasing")
    # The QA injector sleeps in integer duration/steps chunks, which can end up
    # up to about 15ms shorter than the requested duration before event overhead.
    minimum_ns = max(1, requested_duration_ms - MAX_SWIPE_DURATION_SHORTFALL_MS) * 1_000_000
    maximum_ns = (requested_duration_ms + MAX_SWIPE_SPAN_OVERHEAD_MS) * 1_000_000
    if not minimum_ns <= span_ns <= maximum_ns:
        raise CaptureError("QA swipe device span is outside the expected duration bounds")
    return {
        "acceptedSwipeDurationMs": accepted,
        "commandStartedElapsedRealtimeNanos": started,
        "commandEndedElapsedRealtimeNanos": ended,
    }


def run_process(command, timeout=20):
    try:
        return subprocess.run(command, check=False, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise CaptureError(f"command unavailable or timed out: {Path(command[0]).name}") from error


def adb_command(args, serial, *parts, timeout=20):
    result = run_process([args.adb, "-s", serial, *map(str, parts)], timeout=timeout)
    if result.returncode != 0:
        raise CaptureError(f"adb command failed: {parts[0] if parts else 'unknown'}")
    return result.stdout.strip()


def ensure_output_is_new(path):
    if path.exists():
        raise CaptureError("output directory already exists; refusing to overwrite")
    try:
        path.mkdir(parents=True, exist_ok=False)
    except OSError as error:
        raise CaptureError("cannot create unique output directory") from error


def check_device(args):
    serial = args.serial
    if adb_command(args, serial, "get-state") != "device":
        raise CaptureError("adb target is not in device state")
    size_lines = adb_command(args, serial, "shell", "wm", "size").splitlines()
    density_lines = adb_command(args, serial, "shell", "wm", "density").splitlines()
    physical_size = next((line.strip().split(":", 1)[1].strip() for line in size_lines if line.startswith("Physical size:")), None)
    override_size = next((line.strip().split(":", 1)[1].strip() for line in size_lines if line.startswith("Override size:")), None)
    physical_density = next((line.strip().split(":", 1)[1].strip() for line in density_lines if line.startswith("Physical density:")), None)
    override_density = next((line.strip().split(":", 1)[1].strip() for line in density_lines if line.startswith("Override density:")), None)
    if not physical_size or not physical_density:
        raise CaptureError("device size/density could not be read")
    effective_size = override_size or physical_size
    match = re.fullmatch(r"(\d+)x(\d+)", effective_size)
    if not match:
        raise CaptureError("device size is not parseable")
    return {
        "physicalSize": physical_size,
        "overrideSize": override_size,
        "effectiveSize": effective_size,
        "width": int(match.group(1)),
        "height": int(match.group(2)),
        "physicalDensity": physical_density,
        "overrideDensity": override_density,
    }


def check_foreground(args):
    activities = adb_command(args, args.serial, "shell", "dumpsys", "activity", "activities")
    patterns = (
        r"\btopResumedActivity\s*[:=]\s*ActivityRecord\{[^\n]*?\s([^\s/]+)/([^\s}]+)",
        r"\bmResumedActivity\s*:\s*ActivityRecord\{[^\n]*?\s([^\s/]+)/([^\s}]+)",
    )
    component = None
    for pattern in patterns:
        match = re.search(pattern, activities)
        if match:
            component = match.group(1)
            break
    if component is None:
        windows = adb_command(args, args.serial, "shell", "dumpsys", "window", "windows")
        match = re.search(r"\bmCurrentFocus=.*?\s([^\s/]+)/([^\s}]+)", windows)
        component = match.group(1) if match else None
    if component != args.package:
        raise CaptureError("expected target package is not the foreground activity")
    return True


def installed_package_hashes(args):
    paths_output = adb_command(args, args.serial, "shell", "pm", "path", args.package)
    paths = [line.removeprefix("package:").strip() for line in paths_output.splitlines() if line.startswith("package:")]
    if not paths:
        raise CaptureError("pm path did not return installed package files")
    result = []
    for path in paths:
        line = adb_command(args, args.serial, "shell", "sha256sum", path)
        parts = line.split()
        if not parts or not re.fullmatch(r"[0-9a-fA-F]{64}", parts[0]):
            raise CaptureError("installed package SHA-256 could not be read")
        result.append({"path": path, "sha256": parts[0].lower()})
    return result


def capture_process_evidence(args, output, phase):
    pid_output = adb_command(args, args.serial, "shell", "pidof", args.package)
    pids = sorted({int(value) for value in pid_output.split() if value.isdigit()})
    if not pids:
        raise CaptureError(f"target package PID unavailable at {phase}")
    process_list = adb_command(args, args.serial, "shell", "ps", "-A", "-o", "USER,PID,PPID,NAME")
    service_list = adb_command(args, args.serial, "shell", "dumpsys", "activity", "services", "com.android.webview")
    target_service_list = adb_command(args, args.serial, "shell", "dumpsys", "activity", "services", args.package)
    process_file = f"process-{phase}.txt"
    service_file = f"webview-services-{phase}.txt"
    target_service_file = f"target-services-{phase}.txt"
    (output / process_file).write_text(process_list + "\n", encoding="utf-8")
    (output / service_file).write_text(service_list + "\n", encoding="utf-8")
    (output / target_service_file).write_text(target_service_list + "\n", encoding="utf-8")
    return {
        "capturedAtUtc": datetime.now(timezone.utc).isoformat(),
        "targetPids": pids,
        "processEvidenceFile": process_file,
        "webViewServiceEvidenceFile": service_file,
        "targetPackageServiceEvidenceFile": target_service_file,
    }


def qa_forward(args):
    output = adb_command(args, args.serial, "forward", "--list")
    local = f"tcp:{args.qa_host_port}"
    for line in output.splitlines():
        parts = line.split()
        if len(parts) >= 3 and parts[1] == local:
            if parts[0] == args.serial and parts[2] == f"tcp:{QA_DEVICE_PORT}":
                return False
            raise CaptureError("QA host port is already forwarded elsewhere")
    adb_command(args, args.serial, "forward", local, f"tcp:{QA_DEVICE_PORT}")
    return True


def qa_command(host_port, request):
    try:
        with socket.create_connection((QA_HOST, host_port), timeout=10) as connection:
            connection.settimeout(15)
            connection.sendall(json.dumps(request, separators=(",", ":")).encode("utf-8") + b"\n")
            with connection.makefile("rb") as stream:
                line = stream.readline(1024 * 1024)
        if not line:
            raise CaptureError("QA bridge returned an empty response")
        reply = json.loads(line.decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise CaptureError("QA loopback bridge request failed") from error
    if not isinstance(reply, dict) or reply.get("ok") is not True:
        code = reply.get("errorType", "command-failed") if isinstance(reply, dict) else "invalid-response"
        raise CaptureError(f"QA inspect/swipe failed: {code}")
    return reply


def inspect_summary(reply, package, expected_name, expected_code, expected_maps):
    version = reply.get("targetVersion")
    counters = reply.get("diagnostics", {}).get("counters", {})
    if not isinstance(version, dict) or version.get("package") != package:
        raise CaptureError("QA inspect package does not match the requested package")
    if version.get("versionName") != expected_name or version.get("versionCode") != expected_code:
        raise CaptureError("QA inspect version does not match the expected version")
    if counters.get("mapCount") != expected_maps:
        raise CaptureError("QA inspect mapCount does not match the expected mode")
    if not isinstance(reply.get("camera"), dict):
        raise CaptureError("QA inspect did not return camera state")
    digest = hashlib.sha256(json.dumps(reply, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()
    return {"package": package, "versionName": expected_name, "versionCode": expected_code,
            "mapCount": expected_maps, "inspectSha256": digest}


def save_inspect(output, phase, reply):
    """Persist raw QA state privately; reports contain only its path and digest."""
    name = f"{phase}-inspect.json"
    payload = (json.dumps(reply, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    (output / name).write_bytes(payload)
    return {"file": name, "sha256": hashlib.sha256(payload).hexdigest()}


def input_fits_trace(trace_call_begin, input_started, input_ended, quiet_after, trace_seconds):
    """Conservatively bound host input by the Perfetto invocation start, not its ack."""
    return (input_started >= trace_call_begin and
            input_ended + quiet_after <= trace_call_begin + trace_seconds)


def wait_for_trace_end(args, session_name, trace_call_ack, trace_seconds):
    # Do not poll perfetto during the quiet/gesture window; wait through the full
    # configured duration after the command ack, then query only this unique session.
    deadline = trace_call_ack + trace_seconds
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(remaining, 30.0))
    query = adb_command(args, args.serial, "shell", "perfetto", "--query", "--long")
    if session_name not in query:
        return
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        time.sleep(0.5)
        query = adb_command(args, args.serial, "shell", "perfetto", "--query", "--long")
        if session_name not in query:
            return
    raise CaptureError("Perfetto session did not finish before timeout")


def pull_trace(args, remote_trace, local_trace):
    size_output = adb_command(args, args.serial, "shell", "wc", "-c", remote_trace)
    match = re.match(r"\s*(\d+)", size_output)
    if not match or int(match.group(1)) <= 0:
        raise CaptureError("Perfetto output file is missing or empty")
    result = run_process([args.adb, "-s", args.serial, "pull", remote_trace, str(local_trace)], timeout=60)
    if result.returncode != 0 or not local_trace.is_file() or local_trace.stat().st_size <= 0:
        raise CaptureError("adb pull of completed Perfetto trace failed")
    return local_trace.stat().st_size


def write_report(output, report):
    (output / "capture.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def execute_capture(args, coords, coordinate_source, manifest_size):
    if args.output.exists():
        raise CaptureError("output directory already exists; refusing to overwrite")
    if args.duration_ms < 50 or args.duration_ms > 2000:
        raise CaptureError("swipe duration must be 50..2000 ms")
    estimated = estimated_input_seconds(args.repeats, args.duration_ms)
    if QUIET_SECONDS * 2 + estimated > args.trace_seconds:
        raise CaptureError("gesture window plus pre/post quiet exceeds Perfetto trace duration")
    if args.perfetto_config is not None and not args.perfetto_config.is_file():
        raise CaptureError("Perfetto config is unavailable")
    session_name = "codex-map-" + uuid.uuid4().hex[:16]
    if args.perfetto_config:
        try:
            config_text = args.perfetto_config.read_text(encoding="utf-8")
        except OSError as error:
            raise CaptureError("Perfetto config is unavailable") from error
    else:
        config_text = REFERENCE_CONFIG
    config_buffer_kib = buffer_kib_for_trace(args.trace_seconds)
    config = prepare_config(config_text, args.package, args.trace_seconds, session_name, config_buffer_kib)
    if manifest_size and manifest_size != (None, None):
        observed_width, observed_height = manifest_size
        device = check_device(args)
        if (observed_width, observed_height) != (device["width"], device["height"]):
            raise CaptureError("observed manifest dimensions do not match current device size")
    output = args.output
    ensure_output_is_new(output)
    report = {
        "status": "FAILED",
        "startedAtUtc": datetime.now(timezone.utc).isoformat(),
        "package": args.package,
        "serial": args.serial,
        "expected": {"versionName": args.expected_version_name, "versionCode": args.expected_version_code,
                     "mapCount": args.expected_map_count},
        "repeats": args.repeats,
        "swipeDurationMs": args.duration_ms,
        "traceSeconds": args.trace_seconds,
        "bufferKiB": config_buffer_kib,
        "hostTimingBasis": "host monotonic wall time around QA swipe requests; not device time or Perfetto timestamps",
        "deviceTimingBasis": "QA instrumentation SystemClock.elapsedRealtimeNanos; not host or Perfetto timestamp",
        "traceSwipeSpanName": TRACE_SWIPE_SPAN_NAME,
        "deviceSwipeSpans": [],
        "video": False,
        "stackSampling": False,
        "periodicQaSampling": False,
        "cacheClearing": False,
        "installOrLaunch": False,
        "explicitCameraPresetOrLayerChanges": False,
        "cameraMovedByGesture": True,
        "gestureSource": coordinate_source,
    }
    report["perfettoConfigSha256"] = hashlib.sha256(config.encode("utf-8")).hexdigest()
    (output / "trace-config.pbtxt").write_text(config, encoding="utf-8")
    created_forward = False
    trace_started = False
    trace_end_wait_attempted = False
    trace_end_confirmed = False
    trace_pull_attempted = False
    trace_call_begin = None
    trace_call_ack = None
    remote_config = f"/data/local/tmp/{session_name}.pbtxt"
    remote_trace = f"/data/misc/perfetto-traces/{session_name}.pftrace"
    local_trace = output / f"{session_name}.pftrace"
    try:
        device_before = check_device(args)
        foreground_before = check_foreground(args)
        hashes_before = installed_package_hashes(args)
        if manifest_size:
            width, height = manifest_size
            if width and (width, height) != (device_before["width"], device_before["height"]):
                raise CaptureError("observed manifest dimensions do not match current device size")
        elif any(coords[key] >= (device_before["width"] if key in ("x", "x2") else device_before["height"])
                 for key in coords):
            raise CaptureError("explicit gesture coordinates exceed current device size")
        report["deviceBefore"] = {key: value for key, value in device_before.items() if key not in ("width", "height")}
        report["foregroundBefore"] = foreground_before
        report["installedApkSha256Before"] = hashes_before
        report["processEvidenceBefore"] = capture_process_evidence(args, output, "before")

        created_forward = qa_forward(args)
        before = qa_command(args.qa_host_port, {"action": "inspect"})
        report["beforeInspect"] = save_inspect(output, "before", before)
        report["fixtureIdentity"] = inspect_summary(before, args.package, args.expected_version_name,
                                                    args.expected_version_code, args.expected_map_count)
        print("QA inspect: package, version, and mapCount verified", flush=True)

        push = run_process([args.adb, "-s", args.serial, "push", str(output / "trace-config.pbtxt"), remote_config], timeout=30)
        if push.returncode != 0:
            raise CaptureError("Perfetto config push failed")
        trace_call_begin = time.monotonic()
        start = run_process([args.adb, "-s", args.serial, "shell", "perfetto", "--txt", "-c", remote_config,
                             "-o", remote_trace, "--background-wait"], timeout=35)
        trace_call_ack = time.monotonic()
        if start.returncode != 0:
            raise CaptureError("Perfetto start failed")
        trace_started = True
        if session_name not in adb_command(args, args.serial, "shell", "perfetto", "--query", "--long"):
            raise CaptureError("Perfetto session did not start")
        print("Perfetto: trace session started", flush=True)

        time.sleep(QUIET_SECONDS)
        swipe_calls = []
        previous_device_end_ns = None
        input_started = time.monotonic()
        gap = swipe_gap_seconds(args.repeats, args.duration_ms)
        for index in range(args.repeats):
            call_started = time.monotonic()
            swipe_reply = qa_command(args.qa_host_port, build_swipe_request(coords, args.duration_ms, index))
            device_span = validate_swipe_reply(swipe_reply, args.duration_ms, previous_device_end_ns)
            device_span["index"] = index
            device_span["requestedSwipeDurationMs"] = args.duration_ms
            report["deviceSwipeSpans"].append(device_span)
            previous_device_end_ns = device_span["commandEndedElapsedRealtimeNanos"]
            swipe_calls.append(round(time.monotonic() - call_started, 4))
            print(f"QA swipe {index + 1}/{args.repeats}", flush=True)
            if index + 1 < args.repeats and gap:
                time.sleep(gap)
        input_window = time.monotonic() - input_started
        if trace_call_begin is None or trace_call_ack is None or input_started < trace_call_ack:
            report["status"] = "CAPTURE_INVALID"
            report["invalidReason"] = "host input did not begin after Perfetto start acknowledgement"
            raise CaptureError(report["invalidReason"])
        if not input_fits_trace(trace_call_begin, input_started, time.monotonic(), QUIET_SECONDS, args.trace_seconds):
            report["status"] = "CAPTURE_INVALID"
            report["invalidReason"] = "actual host input window plus trailing quiet exceeded conservative trace deadline"
            raise CaptureError("host input window exceeded the configured trace window")
        time.sleep(QUIET_SECONDS)
        report["hostInputWindowSeconds"] = round(input_window, 4)
        report["hostSwipeRequestSeconds"] = swipe_calls
        report["estimatedInputWindowSeconds"] = round(estimated, 4)

        trace_end_wait_attempted = True
        wait_for_trace_end(args, session_name, trace_call_ack, args.trace_seconds)
        trace_end_confirmed = True
        if trace_call_begin is None or time.monotonic() - trace_call_begin < args.trace_seconds - 1:
            raise CaptureError("Perfetto session ended before its configured duration")
        print("Perfetto: duration completed and session is absent from --query", flush=True)
        after = qa_command(args.qa_host_port, {"action": "inspect"})
        report["afterInspect"] = save_inspect(output, "after", after)
        report["afterInspectIdentity"] = inspect_summary(after, args.package, args.expected_version_name,
                                                         args.expected_version_code, args.expected_map_count)
        report["installedApkSha256After"] = installed_package_hashes(args)
        if report["installedApkSha256Before"] != report["installedApkSha256After"]:
            raise CaptureError("installed package files changed during capture")
        report["processEvidenceAfter"] = capture_process_evidence(args, output, "after")
        if report["processEvidenceBefore"]["targetPids"] != report["processEvidenceAfter"]["targetPids"]:
            report["status"] = "CAPTURE_INVALID"
            report["invalidReason"] = "target package PID changed during capture"
            raise CaptureError(report["invalidReason"])
        report["deviceAfter"] = {key: value for key, value in check_device(args).items() if key not in ("width", "height")}
        if report["deviceBefore"] != report["deviceAfter"]:
            raise CaptureError("device size or density changed during capture")
        check_foreground(args)

        trace_pull_attempted = True
        report["traceBytes"] = pull_trace(args, remote_trace, local_trace)
        report["traceFile"] = local_trace.name
        report["perfettoEndConfirmed"] = trace_end_confirmed
        report["status"] = "CAPTURE_COMPLETED_UNVALIDATED"
        report["completedAtUtc"] = datetime.now(timezone.utc).isoformat()
        write_report(output, report)
        print(json.dumps({"status": report["status"], "output": str(output),
                          "hostInputWindowSeconds": report["hostInputWindowSeconds"],
                          "traceBytes": report["traceBytes"]}, ensure_ascii=False))
        return report
    except Exception as error:
        if trace_started and not trace_end_confirmed and not trace_end_wait_attempted:
            trace_end_wait_attempted = True
            try:
                wait_for_trace_end(args, session_name, trace_call_ack, args.trace_seconds)
                trace_end_confirmed = True
            except CaptureError:
                trace_end_confirmed = False
        if trace_end_confirmed and not trace_pull_attempted:
            trace_pull_attempted = True
            try:
                report["traceBytes"] = pull_trace(args, remote_trace, local_trace)
                report["traceFile"] = local_trace.name
            except CaptureError:
                report["tracePullError"] = "completed trace could not be pulled"
        report["perfettoEndConfirmed"] = trace_end_confirmed
        report["error"] = str(error) if isinstance(error, CaptureError) else f"unexpected {type(error).__name__}"
        report["completedAtUtc"] = datetime.now(timezone.utc).isoformat()
        write_report(output, report)
        raise
    finally:
        if created_forward:
            try:
                adb_command(args, args.serial, "forward", "--remove", f"tcp:{args.qa_host_port}")
            except CaptureError:
                report["status"] = "FAILED"
                report["cleanupError"] = "could not remove runner-created adb forward"
                write_report(output, report)
                print("capture failed: could not remove runner-created adb forward", file=sys.stderr)
                raise CaptureError("could not remove runner-created adb forward")


def main(argv=None):
    parser = build_parser()
    args = validate_capture_args(parser, parser.parse_args(argv))
    try:
        coords = None
        coordinate_source = None
        manifest_size = None
        if args.capture:
            coords, coordinate_source, manifest_size = coordinates_from_args(args)
            if args.output.exists():
                raise CaptureError("output directory already exists; refusing to overwrite")
        plan = make_plan(args, coordinate_source)
        if not args.capture:
            print(json.dumps(plan, ensure_ascii=False, indent=2))
            return 0
        execute_capture(args, coords, coordinate_source, manifest_size)
        return 0
    except CaptureError as error:
        print(f"capture failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
