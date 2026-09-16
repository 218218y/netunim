// A scrape captures one epoch. Renewal can never adopt an epoch obtained after expiry.
export function startFinanceLeaseHeartbeat(lease,claim,{ttlSeconds=1200,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  let stopped=false,timer=null,failure=null;
  const tick=async()=>{try{const next=await claim(lease.leaseName,lease.leaseToken,{ttlSeconds});if(!next?.acquired||String(next.fenceEpoch)!==String(lease.fenceEpoch))throw Object.assign(new Error('stale_finance_sync_fence'),{code:'stale_finance_sync_fence'})}catch(error){failure=error;stopped=true}finally{if(!stopped)timer=setTimer(tick,ttlSeconds*1000/3)}};
  timer=setTimer(tick,ttlSeconds*1000/3);
  return {assertCurrent(){if(failure)throw failure},stop(){stopped=true;if(timer!==null)clearTimer(timer)}};
}
export function financeFencePayload(lease){return {p_lease_name:lease?.leaseName??null,p_lease_token:lease?.leaseToken??null,p_fence_epoch:lease?.fenceEpoch??null}}

// Manual changes share the issuer lease but do not start an issuer login. Queue
// local edits and allow an in-flight cross-app publication time to release it.
// Read/rebase the mutation only AFTER acquiring the lease; never reuse a draft
// of the entire finance document captured while waiting.
export function createFinanceManualQueue({claim,release,createToken,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),maxWaitMs=30000,retryMs=1000,onReleaseError=error=>console.error('manual finance lease release',error)}){
  let tail=Promise.resolve();
  return work=>{
    const run=async()=>{
      const token=createToken();let lease,waited=0;
      for(;;){
        lease=await claim('credit',token);
        if(lease?.acquired)break;
        if(waited>=maxWaitMs)throw Object.assign(new Error('סנכרון אשראי אחר עדיין פעיל. השינוי לא נשמר; ניתן לנסות שוב לאחר סיום הסנכרון.'),{code:'finance_sync_lease_busy'});
        const delay=Math.min(retryMs,maxWaitMs-waited);await wait(delay);waited+=delay;
      }
      try{return await work(lease)}finally{try{await release('credit',token)}catch(error){onReleaseError(error)}}
    };
    const result=tail.then(run,run);tail=result.catch(()=>{});return result;
  };
}
