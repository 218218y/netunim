"""Uninstrumented cold, cached and offline startup milestones and CPU evidence.

Timing limits are generous regression ceilings, not cross-machine speed claims.
The ESM graph test separately enforces deterministic bytes/module budgets.
"""
from browser_harness import BrowserSession, ROOT
import json


BUDGETS = json.loads((ROOT/'tests/fixtures/startup-budgets.json').read_text(encoding='utf-8'))
REPORT = {}


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
      return {...timeline,resources:{modules:resources.length,decodedBytes:resources.reduce((sum,row)=>sum+row.decodedBodySize,0),
        lastResponseMs:Math.max(0,...resources.map(row=>row.responseEnd)),
        transferBytes:resources.reduce((sum,row)=>sum+row.transferSize,0)},
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


for app in ['kupa', 'orders']:
    with BrowserSession(ROOT/f'netunim-{app}/site', app+'-startup', instrument=False,
                        service_worker=True, auto_navigate=False) as browser:
        browser.call('Performance.enable')
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
        REPORT[app] = samples
        print('PASS', app, 'native cold/cached/offline startup and secondary authority;', json.dumps(samples), flush=True)

output = ROOT/'.work/startup-performance/latest.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(REPORT, indent=2), encoding='utf-8')
