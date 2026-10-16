"""Uninstrumented cold, cached and offline startup milestones and CPU evidence.

Timing limits are generous regression ceilings, not cross-machine speed claims.
The ESM graph test separately enforces deterministic bytes/module budgets.
"""
from browser_harness import BrowserSession, ROOT
import json
import os
import sys

sys.path.insert(0, str(ROOT/'tools'))
from startup_evidence import summarize_startup, capture_environment


BUDGETS = json.loads((ROOT/'tests/fixtures/startup-budgets.json').read_text(encoding='utf-8'))
REPORT = {'environment': capture_environment()}
REPETITIONS = int(os.environ.get("NETUNIM_STARTUP_REPETITIONS", "5"))
CPU_RATE = int(os.environ.get("NETUNIM_STARTUP_CPU_RATE", "4"))
assert 1 <= REPETITIONS <= 10
assert 2 <= CPU_RATE <= 8


def measure(browser, app):
    browser.evaluate("import('./assets/js/main.js').then(m=>m.appReady).then(()=>true)")
    result = browser.evaluate("""(async()=>{
      const {startupSnapshot}=await import('./assets/js/shared/startup-timing.js');
      const timeline=startupSnapshot(),end=timeline.marks['composition-start'];
      const resources=performance.getEntriesByType('resource').filter(entry=>{
        const url=new URL(entry.name);
        return url.origin===location.origin&&url.pathname.endsWith('.js')&&!url.pathname.includes('/vendor/')&&entry.startTime<=end;
      });
      const navigation=performance.getEntriesByType('navigation')[0];
      const firstResponse=Math.min(...resources.map(row=>row.responseEnd));
      const requests=resources.map(row=>({path:new URL(row.name).pathname,startMs:row.startTime,responseMs:row.responseEnd,transferBytes:row.transferSize}));
      return {...timeline,resources:{modules:resources.length,decodedBytes:resources.reduce((sum,row)=>sum+row.decodedBodySize,0),
        lastResponseMs:Math.max(0,...resources.map(row=>row.responseEnd)),
        transferBytes:resources.reduce((sum,row)=>sum+row.transferSize,0),
        firstResponseMs:firstResponse,requestsStartedAfterFirstResponse:resources.filter(row=>row.startTime>firstResponse).length,requests},
        domContentLoadedMs:navigation.domContentLoadedEventEnd,offline:!navigator.onLine};
    })()""")
    metrics = browser.call('Performance.getMetrics')['result']['metrics']
    result['cpu'] = {item['name']: item['value'] for item in metrics if item['name'] in ['ScriptDuration', 'TaskDuration', 'JSHeapUsedSize']}
    marks = result['marks']
    ordered = ['evaluation-start', 'composition-start', 'composition-end', 'boot-start', 'primary-tab-ready',
               'storage-owner-ready', 'recovery-start', 'local-recovered', 'boot-complete']
    assert all(name in marks for name in ordered), (app, result)
    assert all(marks[a] <= marks[b] for a, b in zip(ordered, ordered[1:])), (app, result)
    for name, ceiling in BUDGETS['milliseconds'].items():
        value = result['durations'][name]
        assert value is not None or app == 'kupa' and name in ['firstView', 'commandReady'], (app, name, result)
        if value is not None:
            assert 0 <= value < ceiling, (app, name, result)
    assert result['resources']['modules'] > 100, result
    assert result['resources']['modules'] <= BUDGETS['graph'][app]['modules'] + 1, result
    assert not browser.drain_serious_errors()
    return result


def sample_profile(app, cpu_rate):
    observations = []
    for repetition in range(REPETITIONS):
        with BrowserSession(ROOT/f'netunim-{app}/site', app+'-startup-cpu'+str(cpu_rate), instrument=False,
                            service_worker=True, auto_navigate=False) as browser:
            browser.call('Performance.enable')
            browser.call('Emulation.setCPUThrottlingRate', {'rate': cpu_rate})
            # Browser diagnostic setup only: avoid silently truncating the default
            # Resource Timing buffer on a 300+ module cold load. No app code patches.
            browser.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'performance.setResourceTimingBufferSize(3000)'})
            browser._navigate()
            samples = {'cold': measure(browser, app)}
            installed = browser.evaluate("""(async()=>{
              await navigator.serviceWorker.ready;
              if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
              return !!navigator.serviceWorker.controller;
            })()""", timeout=30)
            assert installed
            browser._navigate()
            samples['cached'] = measure(browser, app)
            browser.call('Network.enable')
            offline = {'offline': True, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1, 'connectionType': 'none'}
            browser.call('Network.emulateNetworkConditions', offline)
            browser.call('Network.overrideNetworkState', offline)
            browser._navigate()
            samples['offline'] = measure(browser, app)
            assert samples['offline']['offline']
            assert samples['offline']['marks']['local-recovered'] <= samples['offline']['marks']['boot-complete']
            with browser.second_tab():
                timeline = browser.evaluate("import('./assets/js/shared/startup-timing.js').then(m=>m.startupSnapshot())")
                assert timeline['durations']['commandReady'] is None, timeline
            observations.append(samples)


    summary = summarize_startup(observations, BUDGETS['milliseconds'])
    print('PASS', app, 'CPU rate', cpu_rate, REPETITIONS, 'isolated cold/cached/offline startup samples;', json.dumps(summary), flush=True)
    return {'cpuThrottleRate': cpu_rate, 'repetitions': REPETITIONS, 'samples': observations, 'summary': summary}


for app in ['kupa', 'orders']:
    REPORT[app] = sample_profile(app, 1)
    REPORT[app]['cpuThrottled'] = sample_profile(app, CPU_RATE)

output = ROOT/'.work/startup-performance/latest.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(REPORT, indent=2), encoding='utf-8')
