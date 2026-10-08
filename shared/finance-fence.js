// A scrape captures one epoch. Renewal can never adopt an epoch obtained after expiry.
export function startFinanceLeaseHeartbeat(lease,claim,{ttlSeconds=1200,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  let stopped=false,timer=null,failure=null;
  const tick=async()=>{if(stopped)return;try{lease.assertCurrent?.();const next=await claim(lease.leaseName,lease.leaseToken,{ttlSeconds,...(lease.assertCurrent?{assertCurrent:lease.assertCurrent}:{})});lease.assertCurrent?.();if(!next?.acquired||String(next.fenceEpoch)!==String(lease.fenceEpoch))throw Object.assign(new Error('stale_finance_sync_fence'),{code:'stale_finance_sync_fence'})}catch(error){failure=error;stopped=true}finally{if(!stopped)timer=setTimer(tick,ttlSeconds*1000/3)}};
  timer=setTimer(tick,ttlSeconds*1000/3);
  return {assertCurrent(){if(failure)throw failure},stop(){stopped=true;if(timer!==null)clearTimer(timer)}};
}
export function financeFencePayload(lease){return {p_lease_name:lease?.leaseName??null,p_lease_token:lease?.leaseToken??null,p_fence_epoch:lease?.fenceEpoch??null}}

// An operation owns authorization and publication, independently of the
// scheduler's enabled/online state. Stopping a timer does not revoke a commit.
export function createFinanceOperationScope({readAccess}){
  if(typeof readAccess!=='function')throw new Error('finance_operation_access_required');
  const failure=()=>Object.assign(new Error('ההתחברות או בעלות האחסון השתנתה במהלך הסנכרון. הנתונים הקודמים נשמרו; יש להתחבר ולרענן שוב.'),{code:'FINANCE_OPERATION_SCOPE_CHANGED'});
  function observe(){
    const value=readAccess();
    if(!value?.writable||!value.storageOwner||!value.connectionMode)throw failure();
    const accountOwner=value.account?.owner??null,accountEpoch=value.account?.epoch??null;
    if((value.connectionMode==='supabase'||value.storageOwner!=='local')&&(!accountOwner||accountOwner!==value.storageOwner))throw failure();
    return {connectionMode:value.connectionMode,storageOwner:value.storageOwner,accountOwner,accountEpoch};
  }
  function capture(){
    const observed=observe();
    return ()=>{const live=observe();if(Object.keys(observed).some(key=>live[key]!==observed[key]))throw failure()};
  }
  return {capture};
}

// Manual changes share the issuer lease but do not start an issuer login. Queue
// local edits and allow an in-flight cross-app publication time to release it.
// Read/rebase the mutation only AFTER acquiring the lease; never reuse a draft
// of the entire finance document captured while waiting.
export function createFinanceManualQueue({claim,release,createToken,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),maxWaitMs=30000,retryMs=1000,onReleaseError=error=>console.error('manual finance lease release',error)}){
  let tail=Promise.resolve();
  return (work,{assertCurrent}={})=>{
    const run=async()=>{
      const token=createToken();let lease,waited=0;
      const scopeOptions=assertCurrent?[{assertCurrent}]:[];
      for(;;){
        assertCurrent?.();lease=await claim('credit',token,...scopeOptions);
        if(lease?.acquired)break;
        assertCurrent?.();
        if(waited>=maxWaitMs)throw Object.assign(new Error('סנכרון אשראי אחר עדיין פעיל. השינוי לא נשמר; ניתן לנסות שוב לאחר סיום הסנכרון.'),{code:'finance_sync_lease_busy'});
        const delay=Math.min(retryMs,maxWaitMs-waited);await wait(delay);waited+=delay;
      }
      // Scope loss deliberately leaves the former account's lease to expire.
      try{assertCurrent?.();return await work(assertCurrent?{...lease,assertCurrent}:lease)}finally{try{assertCurrent?.();await release('credit',token,...scopeOptions)}catch(error){if(error.code!=='FINANCE_OPERATION_SCOPE_CHANGED')onReleaseError(error)}}
    };
    const result=tail.then(run,run);tail=result.catch(()=>{});return result;
  };
}
