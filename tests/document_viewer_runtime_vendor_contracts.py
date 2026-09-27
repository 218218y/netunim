from pathlib import Path
import base64,hashlib,importlib.util,io,sys,tarfile,tempfile

ROOT=Path(__file__).resolve().parents[1]
TOOL=ROOT/'tools/document-viewers-runtime.py'
spec=importlib.util.spec_from_file_location('document_viewers_runtime',TOOL);module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)

names={pkg.name:pkg for pkg in module.PACKAGES}
assert names['docx-preview'].version=='0.4.0'
assert names['jszip'].version=='3.10.1'
assert names['xlsx'].version=='0.20.3'
assert all(pkg.integrity.startswith('sha512-') for pkg in module.PACKAGES)
assert names['docx-preview'].destination.endswith('docx-preview.min.js')
assert names['xlsx'].destination.endswith('xlsx.full.min.js')
package=(ROOT/'package.json').read_text(encoding='utf-8')
assert 'document-viewers:install' in package and 'document-viewers:check' in package
ui=(ROOT/'netunim-orders/site/assets/js/ui/global-search.js').read_text(encoding='utf-8')
assert 'createDocxSearchViewer' in ui and 'createSpreadsheetSearchViewer' in ui and 'createTextSearchViewer' in ui
for path in ('docx-search-viewer.js','spreadsheet-preview-worker.js'):
    source=(ROOT/'netunim-orders/site/assets/js/domains/documents'/path).read_text(encoding='utf-8')
    assert 'http://' not in source and 'https://' not in source
bridge=(ROOT/'netunim-orders/document-bridge/lib.mjs').read_text(encoding='utf-8')
assert 'structuredPreviewKind' in bridge
sw=(ROOT/'netunim-orders/site/service-worker.js').read_text(encoding='utf-8')
assert "LAZY_RUNTIME_PREFIXES=['./assets/vendor/']" in sw
navigator=(ROOT/'netunim-orders/site/assets/js/domains/documents/document-search-navigator.js').read_text(encoding='utf-8')
assert 'CSS.highlights' in navigator and 'new Highlight' in navigator
worker=(ROOT/'netunim-orders/site/assets/js/domains/documents/spreadsheet-preview-worker.js').read_text(encoding='utf-8')
assert "dense:true" in worker and 'MAX_MATCHES=5000' in worker and 'importScripts' in worker
assert 'workbook.SheetNames.map' in worker and 'workbook.Sheets[name]' in worker and 'matches.push({sheet:index' in worker
assert 'globalThis.XLSX.read' in worker and 'globalThis.XLSX.utils.decode_range' in worker

docx=(ROOT/'netunim-orders/site/assets/js/domains/documents/docx-search-viewer.js').read_text(encoding='utf-8')
assert 'renderAsync(' not in docx and 'parseAsync(' in docx and 'renderDocument(' in docx
assert "new Blob([css],{type:'text/css'})" in docx and "link.rel='stylesheet'" in docx and 'URL.revokeObjectURL' in docx
pdf=(ROOT/'netunim-orders/site/assets/js/domains/documents/pdf-search-viewer.js').read_text(encoding='utf-8')
assert 'blob?.arrayBuffer' in pdf and 'options.data=new Uint8Array' in pdf
headers=(ROOT/'netunim-orders/site/_headers').read_text(encoding='utf-8')
assert "style-src-elem 'self' blob:" in headers and "style-src-elem 'self' 'unsafe-inline'" not in headers
connect=headers.split('connect-src ',1)[1].split(';',1)[0]
assert 'blob:' not in connect
assert 'createPdfSearchViewer({host:previewBody,blob,query' in ui

def archive(files):
    output=io.BytesIO()
    with tarfile.open(fileobj=output,mode='w:gz') as tar:
        for name,data in files.items():
            raw=data if isinstance(data,bytes) else data.encode();info=tarfile.TarInfo('package/'+name);info.size=len(raw);tar.addfile(info,io.BytesIO(raw))
    return output.getvalue()

def integrity(data):return 'sha512-'+base64.b64encode(hashlib.sha512(data).digest()).decode()

original=module.PACKAGES
try:
    blobs={
        'docx-preview':archive({'dist/docx-preview.min.js':'DOCX','LICENSE':'A'}),
        'jszip':archive({'dist/jszip.min.js':'ZIP','LICENSE.markdown':'B'}),
        'xlsx':archive({'dist/xlsx.full.min.js':'XLSX','LICENSE':'C'}),
    }
    module.PACKAGES=tuple(module.RuntimePackage(pkg.name,pkg.version,pkg.url,integrity(blobs[pkg.name]),pkg.destination,pkg.candidates,pkg.license_candidates) for pkg in original)
    with tempfile.TemporaryDirectory() as tmp:
        destination=Path(tmp)/'runtime';module.build_runtime(blobs,destination);assert module.check_runtime(destination)==[]
        target=destination/'xlsx/xlsx.full.min.js';target.write_text('tampered',encoding='utf-8');assert any('digest mismatch' in item for item in module.check_runtime(destination))
finally:module.PACKAGES=original

print('PASS local Word/Excel viewer runtimes are pinned, atomically vendored, integrity-checked and same-origin only')
