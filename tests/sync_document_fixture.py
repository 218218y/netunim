"""Named Main stand-ins for native IDB tests; no production test API."""
from pathlib import Path

PORTS = (Path(__file__).parent / 'sync_document_fixture_ports.mjs').read_text(encoding='utf-8').replace('export function ', 'function ')
IMPORT = "{createSyncDocument}=await import('./assets/js/sync/document.js')"
ADAPTER = """
const createSyncDocument=p=>createDocumentRuntime(__PORTS__);
"""


def evaluate_sync(browser, script, *, baseline=False, **kwargs):
    if IMPORT in script and not baseline:
        if browser.site.parent.name == 'netunim-kupa':
            adapter = "const {createMainDocumentWrite}=await import('./assets/js/cloud/main-document-write.js');const _mainSyncValidation=await import('./assets/js/state/validation.js'),_mainSyncMeasurement=await import('./assets/js/shared/runtime-performance.js');" + ADAPTER.replace('__PORTS__', 'kupaDocumentPorts(p,createMainDocumentWrite({documentName:()=>p.session.cloudDocumentName,request:p.supaRest,validate:_mainSyncValidation.assertValidCloudState,beginMeasure:_mainSyncMeasurement.beginMeasure}).rpcSaveCloudV2)')
        else:
            adapter = ADAPTER.replace('__PORTS__', 'ordersDocumentPorts(p)')
        script = script.replace(IMPORT, "{createSyncDocument:createDocumentRuntime}=await import('./assets/js/sync/document.js')")
        # App is declared inside each existing fixture; the adapter must share
        # that lexical scope, including fixtures that instantiate a fresh owner.
        position = script.index("{createSyncDocument:createDocumentRuntime}=await import('./assets/js/sync/document.js')")
        end = script.index(';', position) + 1
        script = script[:end] + PORTS + adapter + script[end:]
    return browser.evaluate(script, **kwargs)
