import {createOrdersBankRefresh} from '../../netunim-orders/site/assets/js/domains/finance/bank-refresh.js';
/** @type {import('../../netunim-orders/site/assets/js/domains/finance/bank-refresh.js').BankRefreshPorts} */
const ports={
  authority:{capture:()=>()=>{}},
  cloud:{refresh:async()=>true,lastSyncAt:()=>null,readFinance:async()=>null},
  device:{capture:()=>()=>{},readStatus:async()=>({configured:true}),supported:()=>true,fetchBalance:async()=>null,recordScan:()=>{}},
  leases:{commands:{acquire:(leaseName,leaseToken)=>({ready:Promise.resolve({acquired:true,leaseName,leaseToken,fenceEpoch:1,assertCurrent:()=>{}}),assertCurrent:()=>{},close:async()=>{}})},runtime:{isPending:()=>false,drain:async()=>{},dispose:()=>true},createToken:()=> 'T',reportFailure:()=>{}},
  publication:{prepare:async()=>{},publish:async()=>({published:true,homeFailed:false,scan:{lastScrapeAt:null,lastError:'',lastErrorAt:null,lastWarning:'',availableAccounts:[],accountRole:''}})},
  automation:{allowed:()=>true,currentEpoch:()=>1,due:()=>true},
};
/** @type {import('../../netunim-orders/site/assets/js/domains/finance/bank-refresh.js').RefreshRequest} */
const request={onStarted:()=>{},onDenied:()=>{},onPublished:()=>{},onFailed:()=>{}};
const owner=createOrdersBankRefresh(ports);
/** @type {Promise<boolean>} */ export const result=owner.commands.refresh(request);
/** @type {Promise<void>} */ export const draining=owner.runtime.drain();
// @ts-expect-error Captured account authority is synchronous.
createOrdersBankRefresh({...ports,authority:{capture:()=>async()=>{}}});
// @ts-expect-error Passive Bridge status cannot replace financial publication evidence.
createOrdersBankRefresh({...ports,publication:{...ports.publication,publish:async()=>({configured:true})}});
// @ts-expect-error A local-only lease cannot grant Orders cloud snapshot authority.
createOrdersBankRefresh({...ports,leases:{...ports.leases,commands:{acquire:()=>({ready:Promise.resolve({acquired:true,localOnly:true}),assertCurrent:()=>{},close:async()=>{}})}}});
// @ts-expect-error A textual scheduler epoch cannot join an operation lifetime.
createOrdersBankRefresh({...ports,automation:{...ports.automation,currentEpoch:()=> 'ready'}});
// @ts-expect-error Presentation cannot provide deferred approval or financial authority.
owner.commands.refresh({...request,onPublished:async()=>{}});
ports.device.fetchBalance({interactive:false,historyDays:30}).then(value=>{
  // @ts-expect-error Unknown provider evidence must go through the publication decoder.
  return value.accounts.business.balance;
});
