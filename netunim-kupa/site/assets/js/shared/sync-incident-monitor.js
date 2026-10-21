import {classifySyncIncident} from './sync-incident-model.js';

const sameAccount=(a,b)=>a?.owner===b?.owner&&a?.epoch===b?.epoch;
const summary=(sample,state)=>({severity:state.severity,reason_code:state.reason,evidence_kind:sample.evidence||'unknown',has_pending:!!sample.pending,last_error_code:String(sample.errorCode||'').replace(/[^a-zA-Z0-9_.:-]/g,'').slice(0,100)});
const payload=episode=>({incident_id:episode.id,client_instance_id:episode.client,device_label:episode.label,site:episode.site,domain:episode.domain,scope_epoch:episode.epoch,report_version:episode.version,...episode.summary});

export function createSyncIncidentMonitor({site,clientId,deviceLabel=()=>'',accountScope,primary,domains,store,registry,
  publish=()=>{},visible=()=>true,now=()=>Date.now(),random=Math.random,id=()=>crypto.randomUUID(),timers=globalThis,readTimeoutMs=15000}={}){
  let stopped=true,timer=null,running=null,runningScope=null,monitorEpoch=0,observed=null,nextRead=0,readFailures=0;
  const pendingReads=new Set(),readDeadline=Math.max(1,Math.min(60000,Number(readTimeoutMs)||15000));
  const domainWork=new Map();
  let view={status:'unavailable',incidents:[],localError:false};
  const emit=()=>{try{publish(structuredClone(view))}catch{/* Rendering cannot affect durability. */}};
  const cancelReads=()=>{for(const cancel of pendingReads)cancel()};
  function resetAccount(scope){
    if(sameAccount(scope,observed))return;
    monitorEpoch++;cancelReads();
    observed={...scope};nextRead=0;readFailures=0;
    view={status:scope.owner?'unavailable':'signed_out',incidents:[],localError:false};emit();
  }
  const current=scope=>!stopped&&scope.monitorEpoch===monitorEpoch&&sameAccount(accountScope(),scope);
  function boundedRead(read,scope){
    return new Promise((resolve,reject)=>{
      let settled=false,deadline=null;
      const finish=(error,value)=>{if(settled)return;settled=true;timers.clearTimeout(deadline);pendingReads.delete(cancel);if(error)reject(error);else resolve(value)};
      const cancel=()=>finish(new Error('sync_incident_read_cancelled'));
      pendingReads.add(cancel);deadline=timers.setTimeout(()=>finish(new Error('sync_incident_read_timeout')),readDeadline);
      Promise.resolve().then(()=>{if(!current(scope))throw new Error('sync_incident_read_cancelled');return read()}).then(value=>finish(null,value),error=>finish(error));
    });
  }
  async function sampleDomain(adapter,scope){try{const sample=await boundedRead(()=>adapter.read(),scope);return current(scope)?sample:{known:false}}catch{if(current(scope))view.localError=true;return {known:false}}}
  async function observeDomain(adapter,scope){
    const sample=await sampleDomain(adapter,scope);
    if(!current(scope)||!primary())return;
    const key=scope.owner+':'+site+':'+adapter.domain;
    const record=await store.update(key,value=>{
      if(!current(scope)||!primary())return value;
      if(sample.pending&&value.pendingSince===null)value.pendingSince=now();
      const state=classifySyncIncident(sample,{pendingSince:value.pendingSince,now:now()});
      const active=value.episodes.find(episode=>episode.phase==='open'&&episode.epoch===sample.epoch&&episode.client===clientId);
      if(state.reason){
        const details=summary(sample,state),label=String(deviceLabel()||'').trim().slice(0,80);
        if(active){if(JSON.stringify(active.summary)!==JSON.stringify(details)||active.label!==label){active.summary=details;active.label=label;active.version++;active.nextAttempt=0}}
        else value.episodes.push({id:id(),client:clientId,label,site,domain:adapter.domain,epoch:sample.epoch||'unavailable',version:1,phase:'open',sentVersion:0,failures:0,nextAttempt:0,summary:details});
      }else if(state.state==='clean_verified'&&sample.isCurrent?.()){
        value.pendingSince=null;
        if(active){active.phase='resolve';active.version++;active.nextAttempt=0}
      }
      return value;
    });
    if(!current(scope)||!primary())return;
    if(record.episodes.some(episode=>episode.failures>0&&episode.sentVersion!==episode.version))view.localError=true;
    for(const episode of record.episodes){
      if(!current(scope)||!primary())return;
      if(episode.client!==clientId||episode.sentVersion===episode.version||episode.nextAttempt>now())continue;
      let observationCurrent=()=>true,withRequestScope;
      if(episode.phase==='resolve'){
        const fresh=await sampleDomain(adapter,scope);
        if(!current(scope)||!primary()||fresh.epoch!==episode.epoch||classifySyncIncident(fresh).state!=='clean_verified'||!fresh.isCurrent?.()||fresh.confirmCurrent&&!await fresh.confirmCurrent())continue;
        observationCurrent=fresh.isCurrent;
        withRequestScope=fresh.withRequestScope;
      }
      try{
        const receipt=await registry[episode.phase==='resolve'?'resolve':'report'](payload(episode),scope,()=>current(scope)&&primary()&&observationCurrent(),withRequestScope);
        if(!current(scope)||!primary())return;
        await store.update(key,value=>{
          if(!current(scope)||!primary())return value;
          const live=value.episodes.find(item=>item.id===episode.id);
          if(!live||live.version!==episode.version)return value;
          if(receipt.resolved_at!==null)value.episodes=value.episodes.filter(item=>item!==live);
          else{live.sentVersion=episode.version;live.failures=0;live.nextAttempt=0}
          return value;
        });
        nextRead=0;
      }catch(error){
        if(!current(scope)||!primary())return;
        if(error?.message==='sync_incident_observation_changed')continue;
        await store.update(key,value=>{
          if(!current(scope)||!primary())return value;
          const live=value.episodes.find(item=>item.id===episode.id);
          if(live&&live.version===episode.version){live.failures=Math.min(16,live.failures+1);live.nextAttempt=now()+Math.min(300_000,5000*2**(live.failures-1))*(0.8+random()*0.4)}
          return value;
        });
        view.localError=true;
      }
    }
  }
  // A manually reviewed incident is terminal. Its originating installation must
  // rotate the episode on its next observation if the problem is still present.
  async function reconcileReviewed(adapter,scope,rows){
    const activeIds=new Set(rows.map(row=>row.incident_id));
    if(!current(scope)||!primary())return;
    await store.update(scope.owner+':'+site+':'+adapter.domain,value=>{
      if(!current(scope)||!primary())return value;
      value.episodes=value.episodes.filter(episode=>episode.phase!=='open'||episode.sentVersion!==episode.version||episode.client!==clientId||activeIds.has(episode.id));
      return value;
    });
  }
  async function readIncidents(scope){
    if(visible()&&now()>=nextRead){
      try{
        const rows=await boundedRead(()=>registry.list(scope),scope);
        if(!current(scope))return;
        view.status=rows.length?'incidents':'no_reported_incidents';view.incidents=rows;readFailures=0;nextRead=now()+45_000;
        if(current(scope))emit();
        return rows;
      }catch{
        if(!current(scope))return;
        view.status='unavailable';readFailures=Math.min(8,readFailures+1);nextRead=now()+Math.min(300_000,15_000*2**(readFailures-1))*(0.8+random()*0.4);
      }
    }
    if(current(scope))emit();
    return null;
  }
  // A timed-out observer keeps its original IDB/RPC operation and slot. Later
  // ticks can read warnings and serve other domains, but cannot duplicate that
  // domain's unknown write. Completion is reconciled by the next fresh list.
  async function serviceDomain(adapter,scope,rows){
    const key=scope.owner+':'+site+':'+adapter.domain;
    let work=domainWork.get(key);
    if(!work){
      if(domainWork.size>=Math.max(1,domains.length*2)){if(current(scope))view.localError=true;return}
      work=(async()=>{if(rows)await reconcileReviewed(adapter,scope,rows);if(current(scope))await observeDomain(adapter,scope)})();
      domainWork.set(key,work);
      void work.finally(()=>{if(domainWork.get(key)===work)domainWork.delete(key)}).catch(()=>{});
    }
    try{await boundedRead(()=>work,scope)}catch{if(current(scope))view.localError=true}
  }
  async function run(scope){
    resetAccount(scope);
    if(!scope.owner||stopped)return;
    view.localError=false;
    const rows=await readIncidents(scope);
    if(primary()&&current(scope))await Promise.all(domains.map(adapter=>serviceDomain(adapter,scope,rows)));
    if(!current(scope))return;
    // A successful write invalidates the list; ordinary ticks do not reread it.
    await readIncidents(scope);
  }
  function schedule(){if(!stopped&&timer===null)timer=timers.setTimeout(()=>{timer=null;void tick()},5000)}
  function tick(){
    if(stopped)return Promise.resolve();
    const identity=accountScope();resetAccount(identity);const scope={...identity,monitorEpoch};
    if(running&&sameAccount(scope,runningScope)&&runningScope.monitorEpoch===monitorEpoch)return running;
    const work=run(scope).catch(()=>{if(current(scope)){view.localError=true;emit()}}).finally(()=>{if(running===work){running=null;runningScope=null;schedule()}});
    runningScope=scope;running=work;return work;
  }
  function wake(){resetAccount(accountScope());nextRead=0;return tick()}
  async function review(row){
    const scope={...accountScope(),monitorEpoch};if(!current(scope)||row.owner_id!==scope.owner)throw new Error('sync_incident_account_changed');
    await registry.review(row,scope);if(current(scope))await wake();
  }
  return {start(){if(!stopped)return tick();stopped=false;return wake()},wake,tick,review,
    accountChanged(){resetAccount(accountScope());return wake()},
    stop(){stopped=true;monitorEpoch++;cancelReads();if(timer!==null)timers.clearTimeout(timer);timer=null;view={status:'signed_out',incidents:[],localError:false};emit()},
    get view(){return structuredClone(view)}};
}
