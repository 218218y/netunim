import {createKupaBankRefresh} from '../../netunim-kupa/site/assets/js/domains/bank/refresh.js';
import {createKupaBankSnapshotPolicy} from '../../netunim-kupa/site/assets/js/domains/bank/snapshot-policy.js';
/** @type {import('../../netunim-kupa/site/assets/js/domains/bank/snapshot-policy.js').PolicyPorts} */
const policyPorts={feeds:{normalize:value=>value,recurringHistory:()=>[],roundMoney:Math.round},source:{readBank:()=>({}),observedSequence:()=>7},identity:{now:()=> '2026-10-15T00:00:00Z',today:()=> '2026-10-15',createToken:()=> 'BANK'}};
const policy=createKupaBankSnapshotPolicy(policyPorts);
/** @type {import('../../netunim-kupa/site/assets/js/domains/bank/refresh.js').RefreshPorts} */
const ports={
 authority:{capture:()=>()=>{}},cloud:{mode:()=> 'supabase',refresh:async()=>({verified:true,state:{}}),currentState:()=>({}),lastSyncAt:()=>null,checksHaveLocalWork:()=>false},
 device:{capture:()=>()=>{},readStatus:async()=>({bridgeVersion:74}),supported:()=>true,fetchBalance:async()=>null},
 leases:{commands:{acquire:(leaseName,leaseToken)=>({ready:Promise.resolve({acquired:true,leaseName,leaseToken,fenceEpoch:1,leasedUntil:'2026-10-15T00:00:00Z',assertCurrent:()=>{}}),assertCurrent:()=>{},close:async()=>{}})},runtime:{isPending:()=>false,drain:async()=>{},dispose:()=>true},createToken:()=> 'LEASE',reportFailure:()=>{}},
 publication:{prepare:async()=>{},reconcile:async()=>{throw Error('fixture')},publishCloud:async()=>({remoteCommitted:true,readoutVerified:true}),publishLocal:async()=>true,readoutWarning:'warning'},
 policy,automation:{due:()=>true,markAttempt:()=>{}},
};
/** @type {import('../../netunim-kupa/site/assets/js/domains/bank/refresh.js').RefreshRequest} */
const request={allowed:()=>true,onStarted:()=>{},onDenied:()=>{},onCloudSaved:()=>{},onPublished:()=>{},onFailed:()=>{}};
const owner=createKupaBankRefresh(ports);
/** @type {Promise<boolean>} */ export const result=owner.commands.refresh(request);
/** @type {Promise<void>} */ export const drain=owner.runtime.drain();
// @ts-expect-error Synchronous account authority cannot come from an async UI effect.
createKupaBankRefresh({...ports,authority:{capture:()=>async()=>{}}});
// @ts-expect-error Passive status cannot certify financial publication.
createKupaBankRefresh({...ports,publication:{...ports.publication,publishCloud:async()=>({configured:true})}});
// @ts-expect-error Presentation cannot replace synchronous observation with deferred authority.
owner.commands.refresh({...request,onPublished:async()=>{}});
// @ts-expect-error A local-only grant cannot supply a cloud snapshot lease.
ports.publication.publishCloud({snapshotToken:'B',snapshotSeq:7},null,{acquired:true,localOnly:true,assertCurrent:()=>{}});
// @ts-expect-error A textual Shared watermark cannot enter candidate construction.
createKupaBankSnapshotPolicy({...policyPorts,source:{...policyPorts.source,observedSequence:()=> '7'}});
// @ts-expect-error A candidate date cannot be an asynchronous read.
createKupaBankSnapshotPolicy({...policyPorts,identity:{...policyPorts.identity,today:async()=> '2026-10-15'}});
ports.device.fetchBalance({interactive:false,historyDays:30}).then(value=>{
 // @ts-expect-error Provider evidence must pass the balance decoder before candidate authority.
 return value.accounts.business.balance;
});
