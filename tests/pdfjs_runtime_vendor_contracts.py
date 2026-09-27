from __future__ import annotations

from pathlib import Path
import base64
import hashlib
import importlib.util
import io
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("netunim_pdfjs_runtime", ROOT / "tools/pdfjs-runtime.py")
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load tools/pdfjs-runtime.py")
RUNTIME = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNTIME)


def archive_bytes() -> bytes:
    payloads = {
        "package/build/pdf.mjs": b"export const version='6.3.289';\n",
        "package/build/pdf.worker.min.mjs": b"// worker\n",
        "package/web/pdf_viewer.mjs": b"export class PDFViewer {}\n",
        "package/web/pdf_viewer.css": b".pdfViewer{position:relative}\n",
        "package/LICENSE": b"Apache License\n",
        "package/web/images/example.svg": b"<svg/>\n",
        "package/cmaps/example.bcmap": b"cmap",
        "package/iccs/example.icc": b"icc",
        "package/standard_fonts/example.pfb": b"font",
        "package/wasm/example.wasm": b"wasm",
        "package/image_decoders/pdf.image_decoders.min.mjs": b"export{}\n",
        # Maps and unrelated package content must never enter the public runtime.
        "package/build/pdf.mjs.map": b"map",
        "package/README.md": b"readme",
    }
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz") as archive:
        for name, content in payloads.items():
            info = tarfile.TarInfo(name)
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))
    return stream.getvalue()


class PdfJsRuntimeVendorContracts(unittest.TestCase):
    def test_pinned_source_and_integrity_are_exact(self):
        self.assertEqual(RUNTIME.VERSION, "6.3.289")
        self.assertEqual(
            RUNTIME.TARBALL_URL,
            "https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.3.289.tgz",
        )
        self.assertEqual(
            RUNTIME.TARBALL_INTEGRITY,
            "sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==",
        )

    def test_install_extracts_only_runtime_assets_and_check_detects_drift(self):
        data = archive_bytes()
        integrity = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode("ascii")
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / "pdfjs"
            RUNTIME.build_runtime(data, destination, expected_integrity=integrity)
            self.assertEqual(RUNTIME.check_runtime(destination), [])
            self.assertTrue((destination / "build/pdf.mjs").is_file())
            self.assertTrue((destination / "web/images/example.svg").is_file())
            self.assertFalse((destination / "build/pdf.mjs.map").exists())
            self.assertFalse((destination / "README.md").exists())
            (destination / "build/pdf.mjs").write_text("tampered\n", encoding="utf-8")
            self.assertTrue(any("digest mismatch" in item for item in RUNTIME.check_runtime(destination)))

    def test_integrity_mismatch_is_rejected_before_destination_changes(self):
        data = archive_bytes()
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / "pdfjs"
            destination.mkdir()
            sentinel = destination / "sentinel.txt"
            sentinel.write_text("keep", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "integrity mismatch"):
                RUNTIME.build_runtime(data, destination)
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main(verbosity=2)
