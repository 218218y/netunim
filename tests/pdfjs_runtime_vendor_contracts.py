from __future__ import annotations

from pathlib import Path
import base64
import hashlib
import importlib.util
import io
import json
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("netunim_pdfjs_runtime", ROOT / "tools/pdfjs-runtime.py")
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load tools/pdfjs-runtime.py")
RUNTIME = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNTIME)


def archive_bytes(*, viewer_selected_getter: str = "get selected(){}", build: str = RUNTIME.BUILD) -> bytes:
    marker = f"/** pdfjsVersion = {RUNTIME.VERSION} pdfjsBuild = {build} */\n".encode()
    payloads = {
        "package/build/pdf.mjs": marker + b"export const version='6.4.299', build='d0991a0d5'; class PageViewport { convertToViewportPoint(x, y){} }\n",
        "package/build/pdf.worker.min.mjs": marker + b"// worker\n",
        "package/legacy/build/pdf.mjs": marker + b"export const version='6.4.299', build='d0991a0d5'; function getDocument(src = {}){} class GlobalWorkerOptions {} const BinaryDataFactory = src.BinaryDataFactory;\n",
        "package/legacy/build/pdf.worker.min.mjs": marker + b"// legacy worker\n",
        "package/web/pdf_viewer.mjs": marker + f"class PDFFindController {{ get pageMatches(){{}} get pageMatchesLength(){{}} {viewer_selected_getter} match(query, pageContent, pageIndex){{}} scrollMatchIntoView({{}}){{}} }} export class PDFViewer {{ getPageView(index){{}} }}\n".encode(),
        "package/web/pdf_viewer.css": b".pdfViewer{position:relative}\n",
        "package/LICENSE": b"Apache License\n",
        "package/web/images/example.svg": b"<svg/>\n",
        "package/cmaps/example.bcmap": b"cmap",
        "package/iccs/example.icc": b"icc",
        "package/standard_fonts/example.pfb": b"font",
        "package/wasm/example.wasm": b"wasm",
        "package/image_decoders/pdf.image_decoders.min.mjs": marker + b"export{}\n",
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


def integrity(data: bytes) -> str:
    return "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode("ascii")


class PdfJsRuntimeVendorContracts(unittest.TestCase):
    def test_pinned_release_identity_is_exact(self):
        self.assertEqual(RUNTIME.VERSION, "6.4.299")
        self.assertEqual(RUNTIME.BUILD, "d0991a0d5")
        self.assertEqual(
            RUNTIME.REGISTRY_METADATA_URL,
            "https://registry.npmjs.org/pdfjs-dist/6.4.299",
        )
        self.assertEqual(
            RUNTIME.TARBALL_URL,
            "https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.4.299.tgz",
        )

    def test_registry_metadata_must_match_exact_release_and_sha512_integrity(self):
        expected = integrity(b"archive")
        metadata = {
            "name": "pdfjs-dist",
            "version": "6.4.299",
            "dist": {"tarball": RUNTIME.TARBALL_URL, "integrity": expected},
        }
        self.assertEqual(RUNTIME.registry_integrity_from_metadata(metadata), expected)
        for changed in (
            {**metadata, "version": "6.4.300"},
            {**metadata, "dist": {**metadata["dist"], "tarball": RUNTIME.TARBALL_URL + ".wrong"}},
            {**metadata, "dist": {**metadata["dist"], "integrity": "sha256-deadbeef"}},
        ):
            with self.assertRaises(ValueError):
                RUNTIME.registry_integrity_from_metadata(changed)

    def test_install_extracts_only_runtime_assets_and_check_detects_drift(self):
        data = archive_bytes()
        expected_integrity = integrity(data)
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / "pdfjs"
            RUNTIME.build_runtime(data, destination, expected_integrity=expected_integrity)
            self.assertEqual(RUNTIME.check_runtime(destination, expected_integrity=expected_integrity), [])
            self.assertTrue((destination / "build/pdf.mjs").is_file())
            self.assertTrue((destination / "web/images/example.svg").is_file())
            self.assertTrue((destination / "legacy/build/pdf.mjs").is_file())
            self.assertFalse((destination / "build/pdf.mjs.map").exists())
            self.assertFalse((destination / "README.md").exists())
            metadata, _ = RUNTIME.parse_manifest(destination)
            self.assertEqual(metadata["version"], RUNTIME.VERSION)
            self.assertEqual(metadata["build"], RUNTIME.BUILD)
            self.assertEqual(metadata["integrity"], expected_integrity)
            (destination / "build/pdf.mjs").write_text("tampered\n", encoding="utf-8")
            self.assertTrue(any("digest mismatch" in item for item in RUNTIME.check_runtime(destination)))

    def test_preflight_rejects_api_or_build_drift_before_destination_changes(self):
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / "pdfjs"
            destination.mkdir()
            sentinel = destination / "sentinel.txt"
            sentinel.write_text("keep", encoding="utf-8")
            bad_api = archive_bytes(viewer_selected_getter="get selection(){}")
            with self.assertRaisesRegex(ValueError, "preflight.*selected"):
                RUNTIME.build_runtime(bad_api, destination, expected_integrity=integrity(bad_api))
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")
            bad_build = archive_bytes(build="wrongbuild")
            with self.assertRaisesRegex(ValueError, "preflight.*pdfjsBuild"):
                RUNTIME.build_runtime(bad_build, destination, expected_integrity=integrity(bad_build))
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")

    def test_check_rejects_runtime_api_surface_drift(self):
        data = archive_bytes()
        expected_integrity = integrity(data)
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / "pdfjs"
            RUNTIME.build_runtime(data, destination, expected_integrity=expected_integrity)
            viewer = destination / "web/pdf_viewer.mjs"
            source = viewer.read_text(encoding="utf-8").replace("get selected(){}", "get selection(){}")
            viewer.write_text(source, encoding="utf-8")
            errors = RUNTIME.check_runtime(destination)
            self.assertTrue(any("API contract mismatch" in item and "selected" in item for item in errors))
            RUNTIME.build_runtime(data, destination, expected_integrity=expected_integrity)
            legacy = destination / "legacy/build/pdf.mjs"
            legacy.write_text(legacy.read_text(encoding="utf-8").replace("function getDocument(src = {})", "function getDocumentChanged(src = {})", 1), encoding="utf-8")
            errors = RUNTIME.check_runtime(destination)
            self.assertTrue(any("legacy/build/pdf.mjs" in item and "API contract mismatch" in item for item in errors))

    def test_integrity_mismatch_is_rejected_before_destination_changes(self):
        data = archive_bytes()
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / "pdfjs"
            destination.mkdir()
            sentinel = destination / "sentinel.txt"
            sentinel.write_text("keep", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "integrity mismatch"):
                RUNTIME.build_runtime(data, destination, expected_integrity=integrity(b"different archive"))
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")

    def test_pdfjs_check_runs_the_immutable_regression_corpus(self):
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        check_command = package["scripts"]["pdfjs:check"]
        install_command = package["scripts"]["pdfjs:install"]
        self.assertIn("tools/pdfjs-runtime.py check", check_command)
        self.assertIn("tools/sync-assets.py --check", check_command)
        self.assertIn("node --test tests/pdfjs_corpus.test.mjs", check_command)
        self.assertIn("tools/pdfjs-runtime.py install", install_command)
        self.assertIn("tools/sync-assets.py", install_command)
        self.assertIn("node --test tests/pdfjs_corpus.test.mjs", install_command)
        manifest = json.loads((ROOT / "tests/fixtures/pdf-corpus/manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["baselinePdfjsVersion"], RUNTIME.VERSION)
        self.assertEqual(manifest["baselinePdfjsBuild"], RUNTIME.BUILD)
        self.assertEqual({case["kind"] for case in manifest["cases"]}, {"ordinary", "acroform", "large", "empty", "corrupt", "password"})

    def test_git_never_rewrites_vendored_runtime_or_corpus_bytes(self):
        attrs = (ROOT / ".gitattributes").read_text(encoding="utf-8")
        self.assertIn("netunim-orders/site/assets/vendor/pdfjs/** -text", attrs)
        self.assertIn("netunim-kupa/site/assets/vendor/pdfjs/** -text", attrs)
        self.assertIn("tests/fixtures/pdf-corpus/*.pdf -text", attrs)


if __name__ == "__main__":
    unittest.main(verbosity=2)
