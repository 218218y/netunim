"""Actual emitted assets: isolated cold/cache/offline startup and byte budgets.

Source modules are never imported to obtain readiness in a production test.
The existing source runtime suites still cover the full business semantics.
"""
import json
import os
import platform
import statistics
import subprocess
import sys
import time
from functools import partial
from browser_harness import BrowserSession, ROOT, _QuietHandler
from pwa_upgrade import wait_for_worker_control
from production_runtime_scenarios import documents, compatibility, failed_install, reset_entry, pending_activation, pages_navigation
from production_vendor_scenarios import vendor_upgrade
from production_legacy_migration import prebundle_upgrade
from pages_preview_browser import offline_probe


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
    report = {'note': 'Same isolated machine; synthetic empty local store, no live account. Timings are observations, not real-user promises.',
              'environment': {'platform': platform.platform(), 'cpuCount': os.cpu_count()}, 'repetitions': 3}
    for app in ('orders', 'kupa'):
        report[app] = {}
        for kind, site in [('source', ROOT/f'netunim-{app}/site'), ('production', ROOT/'dist'/app)]:
            profiles = []
            for cpu_rate in (1, 4):
                observations = []
                for repetition in range(report['repetitions']):
                    label = f'{app}-{kind}-cpu{cpu_rate}-{repetition}'
                    with BrowserSession(site, label, instrument=False, service_worker=True, auto_navigate=False) as browser:
                        connection = {'enabled': True}
                        class StartupNetwork(_QuietHandler):
                            def do_GET(self):
                                if not connection['enabled']:
                                    self.close_connection = True
                                    return
                                super().do_GET()
                        browser.httpd.RequestHandlerClass = partial(StartupNetwork, directory=str(browser.tmp/'site'))
                        browser.call('Performance.enable')
                        browser.call('Emulation.setCPUThrottlingRate', {'rate': cpu_rate})
                        report['environment']['browser'] = browser.call('Browser.getVersion')['result']['product']
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
                        connection['enabled'] = False
                        browser._navigate()
                        samples['offline'] = sample(browser)
                        assert browser.evaluate("localStorage.getItem('build-sentinel')") == 'preserved'
                        assert not browser.drain_serious_errors()
                        observations.append(samples)
                        if repetition == 0 and cpu_rate == 1:
                            report[app][kind] = samples
                            if kind == 'production':
                                online = {**offline, 'offline': False, 'connectionType': 'wifi'}
                                browser.call('Network.emulateNetworkConditions', online)
                                browser.call('Network.overrideNetworkState', online)
                                connection['enabled'] = True
                                report[app]['documents'] = documents(browser, app)
                                browser.evaluate("localStorage.setItem('preview-sentinel','preserved')")
                                browser.events.clear()
                                report[app]['workerOfflineTransport'] = offline_probe(browser)
                summary = {}
                for mode in ('cold', 'cached', 'offline'):
                    summary[mode] = {}
                    for mark in ('first-view-render', 'boot-complete', 'command-ready'):
                        values = [row[mode]['marks'][mark] for row in observations if mark in row[mode]['marks']]
                        summary[mode][mark] = {'medianMs': statistics.median(values), 'maxMs': max(values)} if values else None
                profiles.append({'cpuThrottleRate': cpu_rate, 'observations': observations, 'summary': summary})
            report[app][kind+'Profiles'] = profiles
        source, built = report[app]['source']['cold'], report[app]['production']['cold']
        assert built['requests'] <= source['requests']*.2, (app, source['requests'], built['requests'])
        assert built['decodedBytes'] < source['decodedBytes'], (app, source['decodedBytes'], built['decodedBytes'])
        for before, after in zip(report[app]['sourceProfiles'], report[app]['productionProfiles']):
            for cold in [row['cold'] for row in after['observations']]:
                assert cold['requests'] <= min(row['cold']['requests'] for row in before['observations'])*.2
                assert cold['decodedBytes'] < min(row['cold']['decodedBytes'] for row in before['observations'])
        print('PASS', app, 'actual production cold/cached/offline startup:', source['requests'], '->', built['requests'], 'JS requests', flush=True)
        print('STARTUP COMPARISON', app, json.dumps({kind: [{'cpu': row['cpuThrottleRate'], 'summary': row['summary']} for row in report[app][kind+'Profiles']] for kind in ('source', 'production')}), flush=True)
        report[app]['compatibility'] = compatibility(app, ready)
        report[app]['failedInstall'] = failed_install(app, ready)
        report[app]['resetEntry'] = reset_entry(app, ready)
        report[app]['pendingActivation'] = pending_activation(app, ready)
        report[app]['pagesNavigation'] = pages_navigation(app, ready)
        report[app]['vendorUpgrade'] = vendor_upgrade(app, ready)
        report[app]['prebundleMigration'] = prebundle_upgrade(app, ready)
    output = ROOT/'.work/production/comparison.json'
    output.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    run()
