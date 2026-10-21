"""Native incident IDB receipts can stall without holding other monitor domains."""
import json
from browser_harness import BrowserSession, ROOT

FLOW=r"""(async()=>{
  const {createSyncIncidentStore}=await import('./assets/js/shared/sync-incident-store.js');
  const {createSyncIncidentMonitor}=await import('./assets/js/shared/sync-incident-monitor.js');
  const native=createSyncIncidentStore(),owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',site=SITE;
  let scope={owner,epoch:1},sequence=0,timer=0,held=0,release,entered;
  const entry=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve}),jobs=new Map(),calls=[],rows=[];
  const check=(value,label)=>{if(!value)throw Error(label)},clean=()=>({known:true,pending:false,verified:true,epoch:'E',evidence:'journal',isCurrent:()=>true});
  const local=site+'_main',key=owner+':'+site+':'+local;
  const store={update:async(k,change)=>{const result=await native.update(k,change);if(k===key&&result.episodes.length&&held===0){held++;entered();await gate}return result}};
  const registry={list:async()=>rows.slice(),report:async(value,s)=>{calls.push({value,owner:s.owner});return {resolved_at:null}},resolve:async()=>({resolved_at:'confirmed'})};
  let view;const monitor=createSyncIncidentMonitor({site,clientId:'native-storage-fault',accountScope:()=>scope,primary:()=>true,
    domains:[{domain:local,read:async()=>({...clean(),pending:true,conflict:true,blocked:true})},{domain:'shared_checks',read:async()=>({...clean(),pending:true,conflict:true,blocked:true})}],
    store,registry,id:()=>`33333333-3333-4333-8333-${String(++sequence).padStart(12,'0')}`,publish:value=>{view=value},
    timers:{setTimeout:run=>{jobs.set(++timer,run);return timer},clearTimeout:id=>jobs.delete(id)}});
  const settle=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setTimeout(resolve,0))};
  const expire=()=>{for(const [id,run] of [...jobs]){jobs.delete(id);run()}};
  try{
    const first=monitor.start();await entry;await settle();expire();await first;
    check(view.localError,'stalled native receipt was not visible');check(calls.some(row=>row.value.domain==='shared_checks'),'another domain was held');
    const again=monitor.tick();await settle();expire();await again;check(held===1,'native update was duplicated after timeout');
    scope={owner:other,epoch:2};await monitor.accountChanged();check(calls.some(row=>row.owner===other),'replacement account was held by an old receipt');
    release();await settle();check(!calls.some(row=>row.value.domain===local&&row.owner===owner),'late original-account receipt published after switch');
    const recovered=await native.update(key,value=>value);check(recovered.episodes.length===1,'native committed incident was discarded');
    scope={owner,epoch:3};await monitor.accountChanged();check(calls.some(row=>row.value.incident_id===recovered.episodes[0].id&&row.owner===owner),'returning account did not reconcile its retained incident');
    return {singlePendingWrite:true,otherDomainProgress:true,accountFence:true,committedEpisodeRetained:true};
  }finally{release();monitor.stop()}
})()"""

for site in ('orders','kupa'):
    with BrowserSession(ROOT/f'netunim-{site}/site',site+'-incident-storage-liveness') as browser:
        result=browser.evaluate(FLOW.replace('SITE',json.dumps(site)),timeout=30)
        assert all(result.values()),result
        assert not browser.drain_serious_errors()
        print('PASS native incident liveness',site,result,flush=True)
