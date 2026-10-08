from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]
ORDERS=ROOT/'netunim-orders/site'
KUPA=ROOT/'netunim-kupa/site'
CANONICAL=ROOT/'shared/document-search'


def assert_pdf_viewer_css_isolation(site:Path, app:str):
    css=(site/'assets/app.css').read_text(encoding='utf-8')
    reserved=('page','pdfViewer','textLayer','annotationLayer','canvasWrapper')
    for selector in re.findall(r'([^{}]+)\{',css):
        if selector.lstrip().startswith('@'):
            continue
        for branch in selector.split(','):
            branch=branch.strip()
            for name in reserved:
                assert not re.match(rf'^\.{re.escape(name)}(?:$|[\s:#.\[>+~])',branch), f'{app}: host CSS leaks into PDF.js via {branch}'

def search_dialog(html:str)->str:
    start=html.index('<div class="global-search-backdrop" id="globalSearchBackdrop"')
    closing='</div>\n  </section>\n</div>'
    end=html.index(closing,start)+len(closing)
    return html[start:end].strip()

orders_html=(ORDERS/'index.html').read_text(encoding='utf-8')
kupa_html=(KUPA/'index.html').read_text(encoding='utf-8')
assert search_dialog(orders_html)==search_dialog(kupa_html), 'Orders/Kupa advanced-search markup drifted'
for html in (orders_html,kupa_html):
    assert './assets/js/shared/global-document-search.css' in html
    for token in ('globalSearchFilterAll','globalSearchFilterSite','globalSearchFilterFiles','globalSearchFilterContent','globalSearchContentOptionsButton','globalSearchContentOptionsMenu','globalSearchContentWordLabel','globalSearchFolderScope','globalSearchDocumentPreview','globalSearchDocumentSplitter'):
        assert token in html, token

shared_shell=(ROOT/'shared/global-document-search.js').read_bytes()
shared_composition=(ROOT/'shared/document-search-composition.js').read_bytes()
shared_css=(ROOT/'shared/global-document-search.css').read_bytes()
shared_css_text=shared_css.decode('utf-8')
assert '.document-pdfjs-container .pdfViewer .page{box-sizing:content-box;margin:0 auto 10px;padding:0}' in shared_css_text
assert '.global-search-head{box-sizing:border-box;width:100%;' in shared_css_text
assert '.global-search-input-wrap{display:flex;align-items:center;gap:9px;min-width:260px;max-width:none;flex:1 1 0;' in shared_css_text
for app,site in (('orders',ORDERS),('kupa',KUPA)):
    assert_pdf_viewer_css_isolation(site,app)
    assert (site/'assets/js/shared/global-document-search.js').read_bytes()==shared_shell, f'{app}: shared search shell drift'
    assert (site/'assets/js/shared/document-search-composition.js').read_bytes()==shared_composition, f'{app}: shared document composition drift'
    assert (site/'assets/js/shared/global-document-search.css').read_bytes()==shared_css, f'{app}: shared search CSS drift'
    main=(site/'assets/js/main.js').read_text(encoding='utf-8')
    assert 'composeDocumentSearch({supaFetch:' in main
    assert 'documentBridge:domainsDocumentBridge' in main
    headers=(site/'_headers').read_text(encoding='utf-8')
    for value in ('https://www.googleapis.com','http://127.0.0.1:8766',"worker-src 'self' blob:",'frame-src blob:'):
        assert value in headers, f'{app}: missing CSP capability {value}'
    worker=(site/'service-worker.js').read_text(encoding='utf-8')
    assert "LAZY_RUNTIME_PREFIXES=['./assets/vendor/']" in worker
    for vendor in ('pdfjs','document-viewers'):
        assert (site/f'assets/vendor/{vendor}/_runtime-manifest.txt').is_file(), f'{app}: missing {vendor}'

composition=shared_composition.decode('utf-8')
assert all(name in composition for name in ('createDocumentBridgeIntegration','createDocumentGoogleDriveIntegration','createDomainsDocumentSearch'))

for source in CANONICAL.rglob('*.js'):
    relative=source.relative_to(CANONICAL)
    expected=source.read_bytes()
    for app,site in (('orders',ORDERS),('kupa',KUPA)):
        target=site/'assets/js'/relative
        assert target.read_bytes()==expected, f'{app}: document-search drift: {relative}'

orders_adapter=(ORDERS/'assets/js/ui/global-search.js').read_text(encoding='utf-8')
kupa_adapter=(KUPA/'assets/js/ui/global-search.js').read_text(encoding='utf-8')
assert 'createGlobalDocumentSearch' in orders_adapter and 'searchGlobalEntries' in orders_adapter
assert 'createGlobalDocumentSearch' in kupa_adapter and 'searchKupaGlobalEntries' in kupa_adapter
assert 'netunim_orders_document_preview_width_v1' in orders_adapter
assert 'netunim_kupa_document_preview_width_v1' in kupa_adapter

print('PASS Orders/Kupa share one document-search shell, one document module tree and identical advanced-search markup')
