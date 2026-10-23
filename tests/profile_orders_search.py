"""Operator performance probe using the existing isolated loaded-data fixture.

Unprofiled latency samples and separately traced attribution samples on the same
runner. These instrumented component timings are not a physical-machine SLA.
"""
import argparse
import ast
import collections
import json
import os
from pathlib import Path
import platform
import sys
import time

from acceptance_safety import write_evidence
from browser_harness import BrowserSession, ROOT

sys.path.insert(0, str(ROOT/'tools'))
from startup_evidence import capture_environment, distribution


def seed_expression(count):
    # Read the existing fixture without importing its top-level long benchmark.
    tree = ast.parse((ROOT/'tests/runtime_loaded_data.py').read_text(encoding='utf-8-sig'))
    seed = ast.literal_eval(next(n.value for n in tree.body if isinstance(n, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == 'SEED' for t in n.targets)))
    return seed.replace('COUNT', str(count)).replace('APP', 'orders')


SEARCH = r"""(async()=>{
  const input=document.querySelector('.supplier-search'),query='Loaded transaction '+(COUNT-1);
  input.value=query;performance.mark('netunim-search-start');
  const start=performance.now();input.dispatchEvent(new Event('input',{bubbles:true}));
  while(searchText!==query&&performance.now()-start<60000)await new Promise(r=>setTimeout(r,25));
  if(searchText!==query)throw Error('search did not settle');
  const modelMs=performance.now()-start;
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const frameMs=performance.now()-start;performance.mark('netunim-search-end');
  return {modelMs,twoFramesMs:frameMs,visible:[...document.querySelectorAll('tr[data-tx-id]')].filter(r=>!r.hidden).length};
})()"""


def summarize_trace(events):
    start = next(e for e in events if e['name'] == 'netunim-search-start')
    end = next(e for e in events if e['name'] == 'netunim-search-end')
    totals = collections.Counter()
    names = {'Layout', 'UpdateLayoutTree', 'PrePaint', 'Paint', 'FunctionCall', 'EventDispatch', 'TimerFire', 'RunMicrotasks'}
    for event in events:
        if (event.get('ph') == 'X' and event['name'] in names
                and (event['pid'], event['tid']) == (start['pid'], start['tid'])):
            overlap = max(0, min(event['ts']+event.get('dur', 0), end['ts'])-max(event['ts'], start['ts']))
            totals[event['name']] += overlap/1000
    return dict(totals)


def measure(browser, count, directory, *, trace=False, label=''):
    browser.evaluate(seed_expression(count), timeout=60)
    browser._navigate(timeout=45)
    browser.evaluate("import('./assets/js/main.js').then(m=>m.appReady).then(()=>true)", timeout=60)
    assert browser.evaluate("(()=>{currentSupplierId='S';supplierYearView='all';filterMode='all';searchText='';switchView('supplier');return document.querySelectorAll('tr[data-tx-id]').length})()", timeout=90) == count
    # Finish the preceding full render before delimiting attribution.
    browser.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))', timeout=60)
    bookmark = len(browser.events)
    if trace:
        browser.call('Tracing.start', {'categories': 'devtools.timeline,blink.user_timing,v8', 'transferMode': 'ReportEvents'}, timeout=30)
        browser.call('Profiler.enable', timeout=30)
        browser.call('Profiler.start', timeout=30)
    result = browser.evaluate(SEARCH.replace('COUNT', str(count)), timeout=120)
    assert result['visible'] == 1, result
    if trace:
        profile = browser.call('Profiler.stop', timeout=30)['result']['profile']
        browser.call('Tracing.end', timeout=30)
        deadline = time.monotonic()+30
        while not any(e.get('method') == 'Tracing.tracingComplete' for e in browser.events[bookmark:]):
            if time.monotonic() >= deadline:
                raise RuntimeError('the scoped performance trace did not finish')
            browser.call('Runtime.evaluate', {'expression': 'true'}, timeout=10)
        events = [row for e in browser.events[bookmark:] if e.get('method') == 'Tracing.dataCollected' for row in e['params']['value']]
        (directory/(label+'.trace.json')).write_text(json.dumps({'traceEvents': events}), encoding='utf8')
        (directory/(label+'.cpuprofile')).write_text(json.dumps(profile), encoding='utf8')
        result['inclusiveTimelineMs'] = summarize_trace(events)
        nodes = {node['id']: node for node in profile['nodes']}
        self_time = collections.Counter()
        for node, delta in zip(profile.get('samples', []), profile.get('timeDeltas', [])):
            self_time[node] += delta/1000
        result['hotSelfSamplesMs'] = [{'ms': ms, 'function': nodes[node]['callFrame']['functionName'],
            'url': nodes[node]['callFrame']['url'], 'line': nodes[node]['callFrame']['lineNumber']+1}
            for node, ms in self_time.most_common(15)]
        result['profilerOverhead'] = True
    serious = browser.drain_serious_errors()
    assert not serious, serious
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--counts', type=int, nargs='+', default=[1000, 10000])
    parser.add_argument('--rates', type=int, nargs='+', default=[1, 4])
    parser.add_argument('--repetitions', type=int, default=3)
    parser.add_argument('--report-dir', type=Path, default=ROOT/'.work/search-profile')
    args = parser.parse_args()
    if (not 1 <= args.repetitions <= 10 or any(n not in (1000, 10000) for n in args.counts)
            or any(n not in (1, 4) for n in args.rates)):
        parser.error('use 1k/10k rows, CPU rates 1/4 and 1..10 repetitions')
    args.report_dir.mkdir(parents=True, exist_ok=True)
    results = []
    report = {'environment': capture_environment(), 'instrumented': True, 'physicalTargetMachine': False,
              'inclusiveTraceDurationsMayOverlap': True, 'samples': results, 'complete': False}
    def save():
        (args.report_dir/'summary.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf8')
    save()
    with BrowserSession(ROOT/'netunim-orders/site', 'orders-search-profile') as browser:
        report['browser'] = browser.call('Browser.getVersion')['result']
        report['system'] = {'logicalCPUs': os.cpu_count(), 'processor': platform.processor()}
        if Path('/proc/cpuinfo').exists():
            report['system']['processor'] = next((line.split(':', 1)[1].strip()
                for line in Path('/proc/cpuinfo').read_text().splitlines() if line.startswith('model name')), platform.processor())
        for count in args.counts:
            for rate in args.rates:
                assert 'error' not in browser.call('Emulation.setCPUThrottlingRate', {'rate': rate}), 'CPU throttle was not acknowledged'
                row = {'rows': count, 'cpuThrottleRate': rate, 'unprofiled': []}
                results.append(row)
                for repetition in range(args.repetitions):
                    sample = measure(browser, count, args.report_dir)
                    row['unprofiled'].append(sample)
                    save()
                    print('MEASURE', count, 'CPU', rate, 'sample', repetition+1, json.dumps(sample), flush=True)
                # Three samples support a median/range, not a useful tail SLA.
                row['latencyDistributionMs'] = {key: {field: value for field, value in
                    distribution([s[key] for s in row['unprofiled']]).items() if field != 'p95'}
                    for key in ('modelMs', 'twoFramesMs')}
                row['profiled'] = measure(browser, count, args.report_dir, trace=True, label=f'{count}-cpu{rate}')
                save()
    report['complete'] = True
    save()
    write_evidence('orders-search-profile', [{'scenario': 'same-runner scoped Orders search profiling', 'status': 'PASS', **report}])


if __name__ == '__main__':
    main()
