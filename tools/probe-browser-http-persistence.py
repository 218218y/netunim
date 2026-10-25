"""Compare native socket reuse in two disposable cold browser fixtures."""
import json
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
import browser_harness as harness
from pwa_upgrade import wait_for_worker_control

results=[]
original=harness._netlog_failures
def observe(path):
    raw=json.loads(path.read_text(encoding='utf-8'))
    names={value:key for key,value in raw['constants']['logEventTypes'].items()}
    counts={'TCP_CONNECT':0,'reused':0}
    for event in raw['events']:
        name=names.get(event['type'],'')
        if event.get('phase')==1 and name=='TCP_CONNECT':counts['TCP_CONNECT']+=1
        if 'REUSED_AN_EXISTING_SOCKET' in name:counts['reused']+=1
    results.append({'protocol':harness._QuietHandler.protocol_version,**counts})
    return original(path)

harness._netlog_failures=observe
for protocol in ['HTTP/1.0','HTTP/1.1']:
    harness._QuietHandler.protocol_version=protocol
    with harness.BrowserSession(ROOT/'netunim-orders/site','http-persistence-'+protocol[-1],instrument=False,service_worker=True) as browser:
        browser.evaluate("import('./assets/js/main.js').then(m=>m.appReady).then(()=>true)")
        wait_for_worker_control(browser)
output=ROOT/'.work/http-persistence-evidence.json'
output.parent.mkdir(parents=True,exist_ok=True)
output.write_text(json.dumps(results,indent=2)+'\n',encoding='utf-8')
print(json.dumps(results),flush=True)
assert len(results)==2 and results[1]['TCP_CONNECT']<results[0]['TCP_CONNECT']/5,results
