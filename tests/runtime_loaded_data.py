"""Loaded native IDB recovery and UI measurements in isolated, instrumented shells.

Diagnostic probes expose public APIs only; timings cannot be compared with the
uninstrumented startup suite or substitute for physical weak-machine evidence.
No live provider, account, production row, or deployment is accessed.
"""
import json
import os
import sys
import time
from browser_harness import BrowserSession, ROOT

sys.path.insert(0, str(ROOT / 'tools'))
from startup_evidence import capture_environment, distribution

COUNTS = [int(value) for value in os.environ.get('NETUNIM_LOADED_COUNTS', '1000,10000').split(',')]
assert COUNTS and all(1 <= count <= 10000 for count in COUNTS)
REPETITIONS = int(os.environ.get('NETUNIM_LOADED_REPETITIONS', '3'))
assert 2 <= REPETITIONS <= 10, 'loaded measurements require 2..10 independent recoveries per size'
CPU_RATE = int(os.environ.get('NETUNIM_LOADED_CPU_RATE', '4'))
assert CPU_RATE in (1, 4), 'use native CPU or the existing 4x diagnostic profile'
REPORT = {'environment': capture_environment(), 'cpuThrottleRate': CPU_RATE,
          'instrumented': True, 'physicalWeakMachine': False, 'requestedCounts': COUNTS,
          'repetitions': REPETITIONS, 'complete': False, 'samples': {}, 'summaries': {},
          'measurementKinds': {'open': 'synchronous compute and DOM, excludes next paint',
                               'search': 'application search interaction elapsed',
                               'edit': 'command through local durable commit, excludes cloud ACK',
                               'memory': 'post-GC JS heap, not total process memory',
                               'cloudACK': 'NOT RUN: local-only loaded fixture'}}
OUTPUT = ROOT / '.work/loaded-performance/latest.json'


def record_progress():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(REPORT, indent=2)+'\n', encoding='utf8')

SEED = r"""(async()=>{
  const count=COUNT,app='APP',day=new Date().toISOString().slice(0,10);
  const candidate=app==='kupa'
    ?{version:4,checks:[],credits:[],expenses:[],cards:[],cash:Array.from({length:count},(_,i)=>({
      id:'C'+i,date:day,description:'Loaded cash '+i,amount:i%200}))}
    :{suppliers:[{id:'S',name:'Loaded supplier',active:true}],transactions:Array.from({length:count},(_,i)=>({
      id:'T'+i,supplierId:'S',sequence:i+1,action:'Loaded transaction '+i,debit:i%200,credit:0})),
      customerDebts:Array.from({length:count},(_,i)=>({id:'D'+i,customerName:'Loaded customer '+i,amount:i%200+1}))};
  state=normalizeState(candidate);
  const head=await mainStorageV2.cloudState(),bytes=new TextEncoder().encode(JSON.stringify(state)).length;
  const start=performance.now();
  await mainStorageV2.replaceLocalAuthoritativeState(state,{boundaryId:'loaded-measurement',expectedSeq:head.seq});
  return {rows:count,jsonBytes:bytes,checkpointMs:performance.now()-start};
})()"""

MEASURE = r"""(async()=>{
  const app='APP',count=COUNT;
  const {startupSnapshot}=await import('./assets/js/shared/startup-timing.js');
  const {kupaAccountCashflowData}=await import('./assets/js/shared/kupa-cashflow.js');
  const timeline=startupSnapshot(),results={recovery:timeline.durations};
  const recovered=app==='kupa'?state.cash.length:state.transactions.length;
  if(recovered!==count)throw Error('loaded checkpoint was not recovered: '+recovered);
  const time=work=>{const start=performance.now(),value=work();return {ms:performance.now()-start,value}};
  if(app==='kupa'){
    results.open=time(()=>{setPage('cash');return document.querySelectorAll('[data-bulk-collection="cash"][data-bulk-id]').length});
    const reference=new Date().toISOString().slice(0,10),stamp=reference+'T10:00:00Z';
    const transactions=Array.from({length:count},(_,i)=>({id:'B'+i,
      date:new Date(Date.parse(reference)-Math.floor(i/4)*86400000).toISOString().slice(0,10),
      description:'Loaded bank '+i,amount:i%2?100:-100}));
    state.bank={currentBalance:100000,asOfDate:reference,source:'hapoalim',bankSyncAt:stamp,
      feed:{accountNumber:'123',syncedAt:stamp,balance:100000,transactions},
      homeFeed:{accountNumber:'456',syncedAt:stamp,balance:50000,transactions}};
    results.bankRows=transactions.length*2;
    results.bankHistoryYears=Math.round(count/4/365*100)/100;
    results.bankOpen=time(()=>{setPage('bank');return document.querySelectorAll('.bank-transactions-region tbody tr').length});
    results.forecast=time(()=>{
      const value=kupaAccountCashflowData(state,'עסקי',reference);return value.expectedChange;
    });
    results.search=time(()=>{setBankSearch('Loaded bank '+(count-1));return document.querySelectorAll('[data-bank-search-id]').length});
  }else{
    currentSupplierId='S';supplierYearView='all';filterMode='all';searchText='';
    results.open=time(()=>{switchView('supplier');return document.querySelectorAll('tr[data-tx-id]').length});
    const input=document.querySelector('.supplier-search');input.value='Loaded transaction '+(count-1);
    const start=performance.now();input.dispatchEvent(new Event('input',{bubbles:true}));
    // Observe scheduled input completion at 10k rows/4x CPU. Timer polling keeps
    // extra layout frames out of each sample. Existing unthrottled timing gates
    // retain their own ceilings; this window bounds baseline collection.
    while(searchText!==input.value&&performance.now()-start<30000){
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    if(searchText!==input.value)throw Error('loaded delegated search did not settle');
    results.search={ms:performance.now()-start,value:[...document.querySelectorAll('tr[data-tx-id]')].filter(row=>!row.hidden).length};
    results.customersOpen=time(()=>{switchView('customers');return document.querySelectorAll('[data-customer-bulk-id]').length});
  }
  const start=performance.now();await uiGlobalSearch.open();await uiGlobalSearch.renderResults('Loaded');
  results.globalSearch={ms:performance.now()-start};uiGlobalSearch.close();
  const original=app==='kupa'?state.cash[0].description:state.transactions[0].action;
  if(!original.startsWith('Loaded'))throw Error('measurement unexpectedly changed source');
  const editStart=performance.now();
  if(app==='kupa'){
    openCashModal('C0');document.getElementById('mDesc').value='Loaded edited cash';
    document.getElementById('mAmount').value='1';saveCash('C0');
  }else{
    openTransactionModal('T0');document.getElementById('fNote').value='Loaded edited note';await saveTransaction('T0');
  }
  await mainStorageV2.commitPromise;
  const durable=await mainStorageV2.recover();
  const edited=app==='kupa'?durable.state.cash[0].description==='Loaded edited cash'
    :durable.state.transactions[0].note==='Loaded edited note';
  if(!edited)throw Error('loaded editor did not durably commit');
  results.edit={ms:performance.now()-editStart,durable:edited};
  return results;
})()"""


def expression(source, app, count):
    return source.replace('COUNT', str(count)).replace('APP', app)


for app in ['kupa', 'orders']:
    with BrowserSession(ROOT / f'netunim-{app}/site', app+'-loaded-data') as browser:
        browser.call('Performance.enable')
        browser.call('Emulation.setCPUThrottlingRate', {'rate': CPU_RATE})
        samples = []
        REPORT['samples'][app] = samples
        record_progress()
        for count, repetition in [(count, repetition) for count in COUNTS for repetition in range(1, REPETITIONS+1)]:
            seed = browser.evaluate(expression(SEED, app, count), timeout=45)
            browser._navigate()
            browser.evaluate("import('./assets/js/main.js').then(m=>m.appReady).then(()=>true)", timeout=45)
            measured = browser.evaluate(expression(MEASURE, app, count), timeout=180)
            assert measured['open']['value'] == count, measured
            assert 0 < measured['search']['value'] <= count, measured
            if count >= 10:
                assert measured['search']['value'] < count, measured
            if app == 'orders':
                assert 0 < measured['customersOpen']['value'] <= 150, measured
            gc_start=time.monotonic()
            browser.call('HeapProfiler.collectGarbage', timeout=30)
            measured['memoryCollection']={'ms':(time.monotonic()-gc_start)*1000}
            metrics = browser.call('Performance.getMetrics')['result']['metrics']
            measured['memory'] = {row['name']: row['value'] for row in metrics
                                  if row['name'] in ['JSHeapUsedSize', 'JSHeapTotalSize']}
            assert measured['memory']['JSHeapUsedSize'] > 0
            with browser.second_tab():
                secondary = browser.evaluate("import('./assets/js/shared/startup-timing.js').then(m=>m.startupSnapshot())")
                assert secondary['durations']['commandReady'] is None, secondary
                measured['secondaryReadOnly'] = True
                assert not browser.drain_serious_errors()
            assert not browser.drain_serious_errors()
            samples.append({'fixture': seed, 'repetition': repetition, 'results': measured})
            record_progress()
            print('PASS', app, count, 'loaded rows; repetition', repetition, 'CPU x'+str(CPU_RATE)+'; actual IDB reload/search; fenced second tab;',
                  json.dumps(samples[-1]), flush=True)
        summaries = REPORT['summaries'][app] = {}
        for count in COUNTS:
            observations = [row['results'] for row in samples if row['fixture']['rows'] == count]
            series = {}
            series['localCheckpoint.ms'] = [row['fixture']['checkpointMs'] for row in samples if row['fixture']['rows'] == count]
            for row in observations:
                for key, value in row.items():
                    if isinstance(value, dict) and isinstance(value.get('ms'), (int, float)):
                        series.setdefault(key+'.ms', []).append(value['ms'])
                for key, value in row['recovery'].items():
                    series.setdefault('recovery.'+key, []).append(value)
                for key, value in row['memory'].items():
                    series.setdefault('memory.'+key+'.bytes', []).append(value)
            summaries[str(count)] = {key: {field: value for field, value in distribution(values).items() if field != 'p95'}
                                    for key, values in series.items()}
            print('MEASURED', app, count, json.dumps(summaries[str(count)]), flush=True)
REPORT['complete'] = True
record_progress()
