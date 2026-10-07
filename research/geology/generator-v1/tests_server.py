from __future__ import annotations

import http.client
import json
import sys
import tempfile
import threading
import types
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

import server
from server import Handler, ThreadingHTTPServer, _safe_filename


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.templates = cls.root / "templates"
        cls.templates.mkdir()
        cls.generated = cls.root / "generated"
        cls.uploads = cls.root / "uploads"
        cls.web = cls.root / "web"
        cls.web.mkdir()
        for name in server.TEMPLATE_FILES.values():
            (cls.templates / name).write_bytes(b"template")
        (cls.web / "index.html").write_text("ui", encoding="utf-8")
        (cls.web / "vector-viewer.html").write_text("viewer", encoding="utf-8")
        cls.root_patches = [
            patch.object(server, "TEMPLATE_ROOT", cls.templates),
            patch.object(server, "GENERATED_ROOT", cls.generated),
            patch.object(server, "UPLOAD_ROOT", cls.uploads),
            patch.object(server, "WEB_ROOT", cls.web),
        ]
        for item in cls.root_patches:
            item.start()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=3)
        for item in reversed(cls.root_patches):
            item.stop()
        cls.temp.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        payload = response.read()
        result = response.status, response.getheaders(), payload
        connection.close()
        return result

    def upload(self, drawing_type="section", *, filename="input.xlsx", file_bytes=b"xlsx", extras=None):
        boundary = "----Geology" + uuid.uuid4().hex
        fields = {"drawing_type": drawing_type, **(extras or {})}
        chunks = []
        for key, value in fields.items():
            chunks.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n".encode())
        chunks.append((f"--{boundary}\r\nContent-Disposition: form-data; name=\"workbook\"; filename=\"{filename}\"\r\n"
                       "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n").encode())
        chunks.extend([file_bytes, f"\r\n--{boundary}--\r\n".encode()])
        body = b"".join(chunks)
        return self.request("POST", "/api/generate", body, {
            "Content-Type": f"multipart/form-data; boundary={boundary}", "Content-Length": str(len(body))})

    @staticmethod
    def write_result(output_dir: Path, kind: str, source: Path):
        output_dir.mkdir(parents=True)
        normalized = {"drawing_type": kind, "summary": {"layers": 3} if kind == "drill" else {"records": 4},
                      "issues": [], "source": {"filename": source.name, "sha256": "abc"}}
        (output_dir / "normalized.json").write_text(json.dumps(normalized), encoding="utf-8")
        (output_dir / "manifest.json").write_text("{}", encoding="utf-8")
        (output_dir / "drawing.svg").write_text("<svg/>", encoding="utf-8")
        (output_dir / "complete-hd.png").write_bytes(b"png")

    def test_fixed_templates_status_and_download_filename(self):
        self.assertEqual(server.HOST, "127.0.0.1")
        self.assertEqual(server.DEFAULT_PORT, 9188)
        status, _, body = self.request("GET", "/api/status")
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertEqual(payload["modes"], ["section", "drill"])
        self.assertTrue(payload["templates"]["drill_example"])
        status, headers, body = self.request("GET", "/template?type=drill&example=1")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"template")
        content_disposition = dict(headers)["Content-Disposition"]
        self.assertIn("filename*=UTF-8''", content_disposition)
        for bad in ("/template?type=../../secret", "/template?type=drill&example=2"):
            self.assertEqual(self.request("GET", bad)[0], 400)

    def test_upload_runs_correct_pipeline_and_each_job_is_unique(self):
        calls = []

        def section(path, output, axis):
            calls.append(("section", axis))
            self.write_result(output, "section", path)

        fake_drill = types.ModuleType("drill_pipeline")

        def drill(path, output):
            calls.append(("drill", None))
            self.write_result(output, "drill", path)

        fake_drill.run_drill_pipeline = drill
        with patch.object(server, "run_pipeline", side_effect=section), patch.dict(sys.modules, {"drill_pipeline": fake_drill}):
            s1, _, b1 = self.upload("section", extras={"axis": "12.5"})
            s2, _, b2 = self.upload("drill", filename="hole.xlsx")
            s3, _, b3 = self.upload("section", extras={"axis": "12.5"})
        first, second, third = (json.loads(row) for row in (b1, b2, b3))
        self.assertEqual((s1, s2, s3), (200, 200, 200))
        self.assertEqual(calls, [("section", 12.5), ("drill", None), ("section", 12.5)])
        self.assertEqual(second["drawing_type"], "drill")
        self.assertIn("complete-hd.png", second["files"])
        self.assertNotEqual(first["job"], third["job"])
        self.assertEqual(first["files"]["drawing.svg"]["url"].split("/")[2], first["job"])

    def test_invalid_type_axis_and_drill_extension_are_rejected_before_pipeline(self):
        for kind, filename, extras, code in [
            ("bogus", "input.xlsx", {}, "INVALID_DRAWING_TYPE"),
            ("drill", "input.xlsx", {"axis": "22"}, "AXIS_NOT_APPLICABLE"),
            ("drill", "input.xls", {}, "UNSUPPORTED_FORMAT"),
        ]:
            status, _, body = self.upload(kind, filename=filename, extras=extras)
            self.assertEqual(status, 400)
            self.assertEqual(json.loads(body)["error"]["code"], code)

    def test_pipeline_cell_validation_is_returned_without_losing_location(self):
        issue = {"severity": "error", "code": "BAD_UNIT", "message": "单位不支持",
                 "cells": ["项目!B6"]}
        with patch.object(server, "run_pipeline", side_effect=server.GeometryInputError([issue])):
            status, _, body = self.upload("section")
        payload = json.loads(body)
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["issues"], [issue])

    def test_failure_leaves_previous_result_visible_only_for_its_mode(self):
        def section(path, output, axis):
            self.write_result(output, "section", path)

        fake_drill = types.ModuleType("drill_pipeline")
        def fail(path, output):
            raise RuntimeError("sensitive internal details")
        fake_drill.run_drill_pipeline = fail
        with patch.object(server, "run_pipeline", side_effect=section), patch.dict(sys.modules, {"drill_pipeline": fake_drill}):
            self.assertEqual(self.upload("section")[0], 200)
            failed, _, body = self.upload("drill", filename="hole.xlsx")
        self.assertEqual(failed, 500)
        self.assertNotIn(b"sensitive internal details", body)
        status, _, body = self.request("GET", "/api/status")
        results = json.loads(body)["last_results"]
        self.assertEqual(status, 200)
        self.assertIn("section", results)
        self.assertNotIn("drill", results)
        self.assertTrue(results["section"]["previous"])

    def test_generated_path_is_confined_and_allowlisted(self):
        status, _, _ = self.request("GET", "/generated/../server.py")
        self.assertEqual(status, 404)
        self.assertEqual(self.request("GET", "/generated/nope/server.py")[0], 404)

    def test_filename_is_basename_and_sanitized(self):
        self.assertEqual(_safe_filename(r"..\..\恶意 名称.xlsx"), "恶意_名称.xlsx")

    def test_upload_limit_checked_before_read(self):
        status, _, body = self.request("POST", "/api/generate", b"", {
            "Content-Type": "multipart/form-data; boundary=x", "Content-Length": str(20 * 1024 * 1024 + 1)})
        self.assertEqual(status, 413)
        self.assertEqual(json.loads(body)["error"]["code"], "UPLOAD_TOO_LARGE")


if __name__ == "__main__":
    unittest.main(verbosity=2)
