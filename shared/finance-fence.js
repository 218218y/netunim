// A scrape captures one epoch. Renewal can never adopt an epoch obtained after expiry.
export function startFinanceLeaseHeartbeat(lease,claim,{ttlSeconds=1200,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  let stopped=false,timer=null,failure=null;
  const tick=async()=>{try{const next=await claim(lease.leaseName,lease.leaseToken,{ttlSeconds});if(!next?.acquired||String(next.fenceEpoch)!==String(lease.fenceEpoch))throw Object.assign(new Error('stale_finance_sync_fence'),{code:'stale_finance_sync_fence'})}catch(error){failure=error;stopped=true}finally{if(!stopped)timer=setTimer(tick,ttlSeconds*1000/3)}};
  timer=setTimer(tick,ttlSeconds*1000/3);
  return {assertCurrent(){if(failure)throw failure},stop(){stopped=true;if(timer!==null)clearTimer(timer)}};
}
export function financeFencePayload(lease){return {p_lease_name:lease?.leaseName??null,p_lease_token:lease?.leaseToken??null,p_fence_epoch:lease?.fenceEpoch??null}}
