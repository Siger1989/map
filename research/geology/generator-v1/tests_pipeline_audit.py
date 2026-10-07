"""Ensure threaded result downloads do not enter a generation's read audit."""
from __future__ import annotations
import sys, tempfile, threading, unittest
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
import pipeline

class BusinessReadAuditThreadTests(unittest.TestCase):
    def test_owner_rejects_source_image_but_download_thread_does_not_trip_audit(self):
        with tempfile.TemporaryDirectory(prefix='audit-thread-') as td:
            root=Path(td); current=root/'generated'/'current'; current.mkdir(parents=True)
            older=root/'generated'/'older'; older.mkdir(); old_png=older/'previous.png'; old_png.write_bytes(b'png')
            source_image=root/'raw.png'; source_image.write_bytes(b'raw')
            input_xlsx=root/'input.xlsx'; input_xlsx.write_bytes(b'input')
            audit=pipeline.BusinessReadAudit(current,input_xlsx)
            if not pipeline._AUDIT_INSTALLED:
                sys.addaudithook(pipeline._audit_dispatch)
                pipeline._AUDIT_INSTALLED=True
            pipeline._AUDIT_LOCAL.current=audit
            worker_errors=[]
            def download_old_result():
                try: old_png.read_bytes()
                except Exception as exc: worker_errors.append(exc)
            try:
                with self.assertRaises(PermissionError): source_image.read_bytes()
                worker=threading.Thread(target=download_old_result)
                worker.start(); worker.join(timeout=5)
                self.assertFalse(worker.is_alive())
                self.assertEqual(worker_errors,[])
                input_xlsx.read_bytes()
                self.assertIn(input_xlsx.resolve(),audit.paths)
                self.assertNotIn(old_png.resolve(),audit.paths)
                self.assertNotIn(source_image.resolve(),audit.paths)
            finally:
                try: del pipeline._AUDIT_LOCAL.current
                except AttributeError: pass

    def test_rasterizer_decodes_chromium_logs_as_utf8_with_replacement(self):
        with tempfile.TemporaryDirectory(prefix='audit-raster-log-') as td:
            root=Path(td); svg=root/'drawing.svg'; png=root/'drawing.png'; log=root/'logs'/'raster.log'
            svg.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',encoding='utf-8')
            completed=SimpleNamespace(returncode=1,stdout='stdout-�',stderr='stderr-�')
            with patch.object(pipeline.subprocess,'run',return_value=completed) as run:
                with self.assertRaises(RuntimeError):
                    pipeline._rasterize(svg,png,root/'browser.exe',log)
            self.assertEqual(run.call_args.kwargs.get('encoding'),'utf-8')
            self.assertEqual(run.call_args.kwargs.get('errors'),'replace')
            output=log.read_text(encoding='utf-8')
            self.assertIn('stdout-�',output)
            self.assertIn('stderr-�',output)

if __name__=='__main__': unittest.main()
