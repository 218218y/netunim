"""Actual compiled UI, real disposable Auth/PostgREST and two owned profiles.

No source imports, replacement HTML, module probes or fake authentication. This
helper is invoked only by the already-attested full Supabase CI fixture.
"""
import json
import time
from browser_harness import BrowserSession, ROOT
from pages_preview_browser import ready, offline_probe
from pwa_upgrade import wait_for_worker_control


def wait(browser, expression, label, timeout=45):
    deadline = time.monotonic()+timeout
    while time.monotonic() < deadline:
        if browser.evaluate(expression):
            return
        time.sleep(.1)
    raise AssertionError(label+'; '+json.dumps(browser.evaluate("({title:document.title,loginError:document.querySelector('#supaLoginError')?.textContent,toast:document.querySelector('#toast')?.textContent,cloud:document.querySelector('#cloudHeaderStatus')?.textContent})")))


def click(browser, selector):
    encoded = json.dumps(selector)
    wait(browser, "(()=>{const el=document.querySelector("+encoded+");return !!el&&!el.disabled&&el.getClientRects().length>0})()", 'Missing visible control: '+selector)
    browser.evaluate('document.querySelector('+encoded+').click();true', user_gesture=True)


def fields(browser, values):
    browser.evaluate("(()=>{for(const [id,value] of Object.entries("+json.dumps(values)+")){const input=document.getElementById(id);if(!input)throw Error('Missing field '+id);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))}return true})()")


def settings(browser, app):
    click(browser, '#settingsTopButton' if app == 'orders' else '[data-page="settings"]')


def login(browser, app, account):
    ready(browser)
    if app == 'orders':
        settings(browser, app)
        click(browser, '[data-action="open-cloud"]')
        wait(browser, "!!document.getElementById('cEmail')", 'Orders login modal')
        fields(browser, {'cEmail': account['email'], 'cPassword': account['password']})
        click(browser, '[data-action="finish-cloud-login"]')
    else:
        if browser.evaluate("!!document.querySelector('#openCloud')?.getClientRects().length"):
            click(browser, '#openCloud')
        else:
            settings(browser, app)
            click(browser, '[data-action="open-supabase-login-modal"]')
        wait(browser, "!!document.getElementById('supaEmail')", 'Kupa login modal')
        fields(browser, {'supaEmail': account['email'], 'supaPassword': account['password']})
        click(browser, '[data-modal-save]')
    wait(browser, "document.querySelector('#modalBackdrop')?.getAttribute('aria-hidden')==='true'", 'Authenticated cloud opening')
    wait_for_worker_control(browser)


def show_records(browser, app):
    if app == 'orders':
        settings(browser, app)
        wait(browser, "!!document.querySelector('#settingsSupplierEdit option[value=\"S\"]')", 'Compiled Orders cloud hydration')
    else:
        click(browser, '[data-page="cash"]')
        wait(browser, "!!document.querySelector('[data-bulk-id=\"R\"]')", 'Compiled Kupa cloud hydration')


def create_record(browser, app, label):
    if app == 'orders':
        settings(browser, app)
        click(browser, '[data-action="open-supplier-modal"]')
        fields(browser, {'sName': label, 'sNote': 'compiled production acceptance'})
        click(browser, '[data-action="save-supplier"]')
    else:
        click(browser, '[data-page="cash"]')
        click(browser, '[data-action="open-cash-modal"]')
        fields(browser, {'mDesc': label, 'mAmount': '17'})
        click(browser, '[data-modal-save]')


def run_compiled_ui(stack, account, templates):
    shared = {'version': 1, 'checks': [], 'bankEvents': []}
    code, _ = stack.request('/rest/v1/rpc/save_shared_checks_document_v6', {'p_document_name': 'main',
        'p_expected_revision': 0, 'p_state': shared, 'p_operation_id': 'compiled-shared-seed',
        'p_audit': {}, 'p_deleted_check_ids': []}, token=account['token'])
    assert code == 200
    results = []
    for app in ('orders', 'kupa'):
        table = 'order_management_documents' if app == 'orders' else 'kupa_documents'
        document = 'suppliers' if app == 'orders' else 'main'
        rpc = 'save_order_management_document_v6' if app == 'orders' else 'save_kupa_document_v6'
        code, _ = stack.request('/rest/v1/rpc/'+rpc, {'p_document_name': document, 'p_expected_revision': 0,
            'p_state': templates[app], 'p_operation_id': 'compiled-'+app+'-seed', 'p_delete_intents': {}, 'p_audit': {}}, token=account['token'])
        assert code == 200
        collection, field = ('suppliers', 'name') if app == 'orders' else ('cash', 'description')
        def cloud_rows():
            code, rows = stack.request('/rest/v1/'+table+'?document_name=eq.'+document+'&select=state,revision', token=account['token'])
            assert code == 200 and len(rows) == 1
            return rows[0]
        def wait_cloud(labels):
            deadline = time.monotonic()+45
            while time.monotonic() < deadline:
                value = cloud_rows()
                if labels <= {row.get(field) for row in value['state'][collection]}:
                    return value
                time.sleep(.1)
            raise AssertionError('Compiled UI write did not reach actual PostgREST: '+app)
        with BrowserSession(ROOT/'dist'/app, app+'-compiled-stack-A', instrument=False, native_incidents=True,
                            service_worker=True, supabase=stack) as a, \
             BrowserSession(ROOT/'dist'/app, app+'-compiled-stack-B', instrument=False, native_incidents=True,
                            service_worker=True, supabase=stack) as b:
            for browser in (a, b):
                browser.call('Emulation.setDeviceMetricsOverride', {'width': 1440, 'height': 1000, 'deviceScaleFactor': 1, 'mobile': False})
            login(a, app, account);login(b, app, account)
            show_records(a, app);show_records(b, app)
            first, second = 'Compiled '+app+' profile A', 'Compiled '+app+' profile B'
            create_record(a, app, first)
            wait_cloud({first})
            settings(b, app)
            click(b, '[data-action="open-cloud"]' if app == 'orders' else '[data-action="cloud-poll"]')
            show_records(b, app)
            wait(b, 'document.body.textContent.includes('+json.dumps(first)+')', 'Second compiled profile sees first write')
            create_record(b, app, second)
            complete = wait_cloud({first, second})
            # Native process restart, persisted Auth, V2 recovery and automatic
            # cloud read run from the emitted app rather than test-access.js.
            a.restart_process();ready(a);show_records(a, app)
            wait(a, 'document.body.textContent.includes('+json.dumps(second)+')', 'Compiled restart reloads second write')
            a.evaluate("localStorage.setItem('preview-sentinel','preserved')")
            a.events.clear()
            offline = offline_probe(a)
            assert cloud_rows() == complete
            code, rows = stack.request('/rest/v1/shared_checks_documents?document_name=eq.main&select=state,revision', token=account['token'])
            assert code == 200 and rows == [{'state': shared, 'revision': 1}]
            assert not a.drain_serious_errors() and not b.drain_serious_errors()
        results.append({'scenario': app+' compiled UI and real Supabase', 'status': 'PASS', 'realPasswordLogin': True,
            'twoIndependentCompiledProfiles': True, 'bothUiWritesInPostgREST': True, 'authAndV2SurviveProcessRestart': True,
            'sharedHeadUnchanged': True, 'offline': offline})
    return results
