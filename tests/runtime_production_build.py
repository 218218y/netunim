"""Actual emitted assets: isolated cold/cache/offline startup and byte budgets.

Source modules are never imported to obtain readiness in a production test.
The existing source runtime suites still cover the full business semantics.
"""
import json
import subprocess
import sys
import time
from browser_harness import BrowserSession, ROOT
from pwa_upgrade import wait_for_worker_control


def ready(browser):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        marks = browser.evaluate("Object.fromEntries(performance.getEntriesByType('mark').filter(row=>row.name.startsWith('netunim-startup:')).map(row=>[row.name.slice(16),row.startTime]))")
        if 'boot-complete' in marks:
            return marks
        time.sleep(.1)
    raise AssertionError({'startup': marks, 'errors': browser.drain_serious_errors()})


def sample(browser):
    marks = ready(browser)
    resources = browser.evaluate("performance.getEntriesByType('resource').filter(row=>new URL(row.name).pathname.endsWith('.js')&&!row.name.includes('/vendor/')).map(row=>({path:new URL(row.name).pathname,bytes:row.decodedBodySize,transfer:row.transferSize}))")
    metrics = browser.call('Performance.getMetrics')['result']['metrics']
    return {'marks': marks, 'requests': len(resources), 'decodedBytes': sum(row['bytes'] for row in resources),
            'transferBytes': sum(row['transfer'] for row in resources), 'resources': resources,
            'cpu': {row['name']: row['value'] for row in metrics if row['name'] in ('ScriptDuration', 'TaskDuration', 'JSHeapUsedSize')}}


def run():
    subprocess.run(['node', 'tools/production-build.mjs'], cwd=ROOT, check=True)
    report = {'note': 'Same isolated machine; synthetic empty local store, no live account. Timings are observations, not real-user promises.'}
    for app in ('orders', 'kupa'):
        report[app] = {}
        for kind, site in [('source', ROOT/f'netunim-{app}/site'), ('production', ROOT/'dist'/app)]:
            with BrowserSession(site, app+'-'+kind+'-build', instrument=False, service_worker=True, auto_navigate=False) as browser:
                browser.call('Performance.enable')
                browser.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'performance.setResourceTimingBufferSize(4000)'})
                browser._navigate()
                samples = {'cold': sample(browser)}
                wait_for_worker_control(browser)
                browser.evaluate("localStorage.setItem('build-sentinel','preserved')")
                browser._navigate()
                samples['cached'] = sample(browser)
                browser.call('Network.enable')
                offline = {'offline': True, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1, 'connectionType': 'none'}
                browser.call('Network.emulateNetworkConditions', offline)
                browser.call('Network.overrideNetworkState', offline)
                browser._navigate()
                samples['offline'] = sample(browser)
                assert browser.evaluate("localStorage.getItem('build-sentinel')") == 'preserved'
                assert not browser.drain_serious_errors()
                report[app][kind] = samples
        source, built = report[app]['source']['cold'], report[app]['production']['cold']
        assert built['requests'] <= source['requests']*.2, (app, source['requests'], built['requests'])
        assert built['decodedBytes'] < source['decodedBytes'], (app, source['decodedBytes'], built['decodedBytes'])
        print('PASS', app, 'actual production cold/cached/offline startup:', source['requests'], '->', built['requests'], 'JS requests', flush=True)
    output = ROOT/'.work/production/comparison.json'
    output.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    run()
