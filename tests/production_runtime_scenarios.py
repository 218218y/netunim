"""Native production release and third-party probes; only synthetic data."""
import base64
import io
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time
import zipfile
from functools import partial
from urllib.parse import urlparse
from browser_harness import BrowserSession, ROOT, _QuietHandler
from pwa_upgrade import wait_for_worker_control, wait_for_waiting_upgrade

sys.path.insert(0, str(ROOT/'tools'))
from build_release import release_id, shell_paths


def module_path(app, name):
    metadata = json.loads((ROOT/'.work/production'/app/'metafile.json').read_text(encoding='utf-8'))
    outputs = [output for output, row in metadata['outputs'].items() if row.get('entryPoint') == 'assets/js/' + name]
    assert len(outputs) == 1, (name, outputs)
    return './assets/build/' + Path(outputs[0]).name


def docx_bytes():
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as archive:
        archive.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        archive.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        archive.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>needle production fixture</w:t></w:r></w:p></w:body></w:document>')
    return base64.b64encode(out.getvalue()).decode()


def documents(browser, app):
    paths = {kind: module_path(app, 'domains/documents/' + kind + '-search-viewer.js') for kind in ('pdf', 'docx', 'spreadsheet')}
    pdf = base64.b64encode((ROOT/'tests/fixtures/pdf-corpus/ordinary-text.pdf').read_bytes()).decode()
    result = browser.evaluate("""(async()=>{
      const paths=PATHS,bytes=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
      const pdf=await import(paths.pdf),{pdfjsLib}=await pdf.preloadPdfSearchRuntime();
      const task=pdfjsLib.getDocument({data:bytes(PDF),isEvalSupported:false,standardFontDataUrl:new URL('./assets/vendor/pdfjs/standard_fonts/',location.href).href});
      const documentPdf=await task.promise,page=await documentPdf.getPage(1),content=await page.getTextContent();
      const pdfText=content.items.map(row=>row.str||'').join(' ');await task.destroy();
      const host=document.createElement('div');document.body.append(host);
      const word=await import(paths.docx);
      const wordView=await word.createDocxSearchViewer({host,blob:new Blob([bytes(DOCX)]),query:'needle'});
      const wordMatches=wordView.matchState().total;await wordView.destroy();
      const sheet=await import(paths.spreadsheet);
      const sheetView=await sheet.createSpreadsheetSearchViewer({host,blob:new Blob(['Title,Value\\nneedle,42']),query:'needle'});
      const sheetMatches=sheetView.matchState().total;await sheetView.destroy();host.remove();
      return {pdf:pdfText.includes('NETUNIM PDF CORPUS ORDINARY'),wordMatches,sheetMatches};
    })()""".replace('PATHS', json.dumps(paths)).replace('PDF', json.dumps(pdf), 1).replace('DOCX', json.dumps(docx_bytes())), timeout=45)
    assert result == {'pdf': True, 'wordMatches': 1, 'sheetMatches': 1}, result
    assert not browser.drain_serious_errors()
    return result


def publish_future(site, app, old_chunk):
    old_name = Path(old_chunk).name
    future_name = 'future-' + old_name
    original = (site/old_chunk[2:]).read_bytes()
    (site/'assets/build'/future_name).write_bytes(original + b'\nexport const futureRelease=true;\n')
    (site/old_chunk[2:]).unlink()
    for file in (site/'assets/build').glob('*.js'):
        content = file.read_text(encoding='utf-8')
        file.write_bytes(content.replace(old_name, future_name).encode('utf-8'))
    worker = site/'service-worker.js'
    source = worker.read_text(encoding='utf-8')
    source = re.sub(r'const SHELL=\[[\s\S]*?\];', 'const SHELL='+json.dumps(shell_paths(site))+';', source)
    worker.write_bytes(source.encode('utf-8'))
    release = release_id(site, app)
    worker.write_bytes(re.sub(r"const CACHE='[^']+';", f"const CACHE='{release}';", source).encode('utf-8'))
    headers = site/'_headers'
    headers.write_bytes(re.sub(r'^  X-Netunim-Release: [^\n]+', '  X-Netunim-Release: '+release, headers.read_text(encoding='utf-8'), flags=re.M).encode('utf-8'))
    return release


def compatibility(app, ready):
    path = module_path(app, 'domains/documents/text-search-viewer.js')
    with BrowserSession(ROOT/'dist'/app, app+'-production-update', instrument=False, service_worker=True) as browser:
        isolated_config = (browser.tmp/'site/supabase/config.js').read_bytes()
        ready(browser)
        wait_for_worker_control(browser)
        assert browser.evaluate('!performance.getEntriesByType("resource").some(row=>new URL(row.name).pathname===' + json.dumps(path[1:]) + ')')
        browser.evaluate("localStorage.setItem('production-update-sentinel','preserved')")
        browser.evaluate("""(async()=>{const db=await new Promise((resolve,reject)=>{const task=indexedDB.open('production-build-sentinel',1);task.onupgradeneeded=()=>task.result.createObjectStore('values');task.onsuccess=()=>resolve(task.result);task.onerror=()=>reject(task.error)});await new Promise((resolve,reject)=>{const tx=db.transaction('values','readwrite');tx.objectStore('values').put('preserved','fixture');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();return true})()""")
        network_paths = []
        class ObservedNetwork(_QuietHandler):
            def do_GET(self):
                network_paths.append(urlparse(self.path).path)
                super().do_GET()
        browser.httpd.RequestHandlerClass = partial(ObservedNetwork, directory=str(browser.tmp/'site'))
        future = publish_future(browser.tmp/'site', app, path)
        wait_for_waiting_upgrade(browser)
        result = browser.evaluate("""(async()=>{const module=await import(PATH),host=document.createElement('div');const viewer=await module.createTextSearchViewer({host,text:'old needle',query:'needle'});const matches=viewer.matchState().total;await viewer.destroy();return {matches,future:module.futureRelease===true,preference:localStorage.getItem('production-update-sentinel')}})()""".replace('PATH', json.dumps(path)))
        assert result == {'matches': 1, 'future': False, 'preference': 'preserved'}, result
        assert path[1:] not in network_paths, 'Hashed chunk cache hit revalidated against the new deployment'
        # Another scoped window must deny single-client activation.
        target = browser.call('Target.createTarget', {'url': browser.url})['result']['targetId']
        try:
            time.sleep(.5)
            allowed = browser.evaluate("""(async()=>{const registration=await navigator.serviceWorker.getRegistration();const channel=new MessageChannel();return await new Promise(resolve=>{channel.port1.onmessage=event=>{channel.port1.close();resolve(event.data.allowed)};registration.waiting.postMessage({type:'netunim-activate-single-client'},[channel.port2])})})()""")
            assert allowed is False, 'Update took over multiple active tabs'
        finally:
            browser.call('Target.closeTarget', {'targetId': target})
        # A graceful process restart makes the new release active; no storage reset.
        browser.restart_process()
        ready(browser)
        wait_for_worker_control(browser)
        assert browser.evaluate("navigator.serviceWorker.getRegistration().then(row=>row.active.scriptURL)")
        assert browser.evaluate("localStorage.getItem('production-update-sentinel')") == 'preserved'
        assert browser.evaluate("""(async()=>{const db=await new Promise(resolve=>{const task=indexedDB.open('production-build-sentinel',1);task.onsuccess=()=>resolve(task.result)});const value=await new Promise(resolve=>{db.transaction('values').objectStore('values').get('fixture').onsuccess=event=>resolve(event.target.result)});db.close();return value})()""") == 'preserved'
        current = browser.evaluate("caches.keys()")
        assert future in current, current
        # Restore the exact prior payload independently of the newer source or
        # dependencies, then exercise the same waiting/activation protocol.
        site = browser.tmp/'site'
        assert site.resolve().is_relative_to(browser.tmp.resolve()) and site.name == 'site'
        shutil.rmtree(site)
        shutil.copytree(ROOT/'dist'/app, site)
        (site/'supabase/config.js').write_bytes(isolated_config)
        # copy2 retains archive timestamps. Model a fresh deployment timestamp,
        # otherwise SimpleHTTPRequestHandler can incorrectly return 304 to a
        # worker update whose previous response had the future file's newer mtime.
        os.utime(site/'service-worker.js', None)
        wait_for_waiting_upgrade(browser)
        browser.restart_process()
        ready(browser)
        wait_for_worker_control(browser)
        assert browser.evaluate("localStorage.getItem('production-update-sentinel')") == 'preserved'
        original_release = json.loads((ROOT/'.work/production'/app/'manifest.json').read_text(encoding='utf-8'))['release']
        assert original_release in browser.evaluate('caches.keys()')
        assert not browser.drain_serious_errors()
        return {'oldUnusedChunkSurvivedDeletion': True, 'multitabActivationDenied': True, 'localStorageAndIndexedDBPreserved': True, 'exactPayloadRollback': True}


def failed_install(app, ready):
    """A missing lazy resource may not leave a partial controlling release."""
    path = module_path(app, 'domains/documents/text-search-viewer.js')[1:]
    with BrowserSession(ROOT/'dist'/app, app+'-production-incomplete', instrument=False, service_worker=True, auto_navigate=False) as browser:
        reject = {'active': True}
        class MismatchedLazyChunk(_QuietHandler):
            def send_header(self, name, value):
                if reject['active'] and name.lower() == 'x-netunim-release' and urlparse(self.path).path == path:
                    value = 'deliberately-wrong-release'
                super().send_header(name, value)
        browser.httpd.RequestHandlerClass = partial(MismatchedLazyChunk, directory=str(browser.tmp/'site'))
        browser._navigate()
        ready(browser)
        deadline = time.monotonic()+45
        state = None
        while time.monotonic() < deadline:
            state = browser.worker_state()
            if not state['registration'] and not state['controller']:
                break
            time.sleep(.1)
        else:
            raise AssertionError({'incompleteReleaseStillRegistered': state})
        assert not browser.evaluate('caches.keys()'), 'Failed install left partial cache behind'
        browser.save_worker_evidence('expected-incomplete-install')
        # Retain the expected rejection above as evidence; a second installation
        # must be judged on its own native worker events.
        browser.call('ServiceWorker.disable')
        browser.events = [event for event in browser.events if event.get('method') != 'ServiceWorker.workerErrorReported']
        # Toggle the actual handler too: keep-alive HTTP connections retain their
        # original handler instance even after RequestHandlerClass is replaced.
        reject['active'] = False
        browser._navigate()
        ready(browser)
        wait_for_worker_control(browser)
        return {'incompleteInstallRejected': True, 'partialCacheRemoved': True, 'subsequentInstallRecovered': True}


def reset_entry(app, ready):
    """Exercise the compiled reset entry in peer mode without clearing data."""
    reset_module = module_path(app, 'shared/local-site-reset-page.js')
    with BrowserSession(ROOT/'dist'/app, app+'-production-reset-entry', instrument=False, service_worker=True) as browser:
        ready(browser)
        browser.evaluate("localStorage.setItem('reset-peer-sentinel','preserved')")
        main_url = browser.url
        browser.url = main_url.replace('index.html', 'reset-local.html?peer=1')
        browser._navigate()
        result = browser.evaluate("""(()=>({status:document.getElementById('resetStatus').textContent,
          preserved:localStorage.getItem('reset-peer-sentinel')==='preserved',
          hasBusinessMarks:performance.getEntriesByType('mark').some(row=>row.name.startsWith('netunim-startup:')),
          scripts:performance.getEntriesByType('resource').map(row=>new URL(row.name).pathname) }))()""")
        assert result['status'] == 'הטאב הושהה לצורך איפוס', result
        assert result['preserved'] and not result['hasBusinessMarks'], result
        assert reset_module[1:] in result['scripts'], result
        assert not browser.drain_serious_errors()
        browser.url = main_url
        browser._navigate()
        ready(browser)
        return {'compiledResetLoaded': True, 'peerModePreservesStorage': True, 'noBusinessBootInResetPage': True}


def pending_activation(app, ready):
    """A late native takeover cannot open a timed-out document's business graph."""
    path = module_path(app, 'domains/documents/text-search-viewer.js')
    with BrowserSession(ROOT/'dist'/app, app+'-production-pending-activation', instrument=False, service_worker=True) as browser:
        ready(browser)
        wait_for_worker_control(browser)
        browser.evaluate("localStorage.setItem('pending-activation-sentinel','preserved')")
        publish_future(browser.tmp/'site', app, path)
        wait_for_waiting_upgrade(browser)
        # Delay only the bootstrap's activation message. The install, worker,
        # permission check, takeover and compiled bootstrap remain native/real.
        browser.call('Page.addScriptToEvaluateOnNewDocument', {'source': """
          const send=ServiceWorker.prototype.postMessage;
          ServiceWorker.prototype.postMessage=function(data,ports){
            if(data?.type==='netunim-activate-single-client'){
              window.__beforeLateActivation=navigator.serviceWorker.controller;
              window.__releaseLateActivation=()=>{
                // The sender closes its timed-out ports. Deliver the held
                // request with a fresh reply endpoint; only the real worker
                // decides whether this scoped client may activate it.
                const late=new MessageChannel();
                late.port1.onmessage=()=>late.port1.close();
                send.call(this,data,[late.port2]);
              };
              return;
            }
            return send.call(this,data,ports);
          };
        """})
        browser._navigate()
        deadline = time.monotonic()+35
        while time.monotonic()<deadline:
            state = browser.evaluate("({blocked:document.querySelector('main[role=alert] h1')?.textContent||'',business:performance.getEntriesByType('mark').some(row=>row.name.startsWith('netunim-startup:')),held:typeof window.__releaseLateActivation==='function'})")
            if state['blocked']:
                break
            time.sleep(.1)
        else:
            raise AssertionError({'activationDidNotStopAtDeadline': state})
        assert state == {'blocked': 'עדכון המערכת טרם הושלם', 'business': False, 'held': True}, state
        browser.evaluate('window.__releaseLateActivation();true')
        deadline = time.monotonic()+15
        while time.monotonic()<deadline:
            if browser.evaluate('navigator.serviceWorker.controller!==window.__beforeLateActivation'):
                break
            time.sleep(.1)
        else:
            raise AssertionError('Late native activation fixture never replaced the controller')
        assert browser.evaluate("!performance.getEntriesByType('mark').some(row=>row.name.startsWith('netunim-startup:'))")
        browser._navigate()
        ready(browser)
        assert browser.evaluate("localStorage.getItem('pending-activation-sentinel')") == 'preserved'
        assert not browser.drain_serious_errors()
        return {'activationDeadlineBlocksBusinessImports': True, 'lateNativeTakeoverRemainsPaused': True, 'reloadRecoversWithoutDataReset': True}
