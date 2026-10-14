import {createOrdersCreditRefresh} from '../../netunim-orders/site/assets/js/domains/finance/credit-refresh.js';
import {createKupaCreditRefresh} from '../../netunim-kupa/site/assets/js/domains/credit/refresh.js';
import {readCreditRefreshResult} from '../../shared/credit-refresh-result.js';
/** @type {import('../../netunim-orders/site/assets/js/domains/finance/credit-refresh.js').RefreshPorts} */
const orders={
 authority:{capture:()=>()=>{}},cloud:{refresh:async()=>true,readSync:()=>null},
 device:{capture:()=>()=>{},readStatus:async()=>null,supported:()=>true,sync:async()=>null,refreshStatus:async()=>null,reportFailure:()=>{}},
 leases:{commands:{acquire:(leaseName,leaseToken)=>({ready:Promise.resolve({acquired:true,leaseName,leaseToken,fenceEpoch:1,leasedUntil:'2026-10-14T12:00:00Z',assertCurrent:()=>{}}),assertCurrent:()=>{},close:async()=>{}})},runtime:{isPending:()=>false,drain:async()=>{},dispose:()=>true},createToken:()=> 'T',reportFailure:()=>{}},
 policy:{normalizeMode:()=> 'forecast',resolveMode:()=> 'quick',selection:()=>[],merge:()=>({}),lastSyncAt:()=>null},
 publication:{commit:async()=>({saved:true,skipped:false})},automation:{allowed:()=>true,currentEpoch:()=>1,due:()=>true,mode:()=> 'smart'},
};
/** @type {import('../../netunim-orders/site/assets/js/domains/finance/credit-refresh.js').RefreshRequest} */
const ordersRequest={onDenied:()=>{},onDeferred:()=>{},onWarning:()=>{},onPublished:()=>{},onFailed:()=>{},onDiagnosticsWarning:()=>{},onDiagnosticsFailed:()=>{},onFailureFinished:()=>{}};
/** @type {import('../../netunim-kupa/site/assets/js/domains/credit/refresh.js').RefreshPorts} */
const kupa={...orders,cloud:{refresh:async()=>({verified:true,state:{}}),readSync:()=>null},
 device:{...orders.device,status:()=>null,error:()=>'',refreshStatus:async()=>null},
 publication:{publish:async()=>null},automation:{due:()=>true,mode:()=> 'smart',markAttempt:()=>true},
};
/** @type {import('../../netunim-kupa/site/assets/js/domains/credit/refresh.js').RefreshRequest} */
const kupaRequest={...ordersRequest,allowed:()=>true,onPublished:()=>{},onFailed:()=>{},onDiagnosticsFailed:()=>{}};
const ordersOwner=createOrdersCreditRefresh(orders),kupaOwner=createKupaCreditRefresh(kupa);
/** @type {Promise<boolean>} */ export const ordersResult=ordersOwner.commands.refresh(ordersRequest);
/** @type {Promise<boolean|undefined>} */ export const kupaResult=kupaOwner.commands.refresh(kupaRequest);
/** @type {Promise<void>} */ export const drain=kupaOwner.runtime.drain();
// @ts-expect-error A Bridge result is unknown until envelope decoding.
orders.device.sync({interactive:false,syncMode:'forecast',selection:[]}).then(value=>value.attemptedCount);
// @ts-expect-error The counter stays numeric after decoding.
const textualCount=/** @type {string} */ (readCreditRefreshResult({profiles:[]}).attemptedCount);
// @ts-expect-error Pairing/account authority cannot be deferred.
createOrdersCreditRefresh({...orders,authority:{capture:()=>async()=>{}}});
// @ts-expect-error Automatic admission cannot be supplied by an async UI callback.
kupaOwner.commands.refresh({...kupaRequest,allowed:async()=>true});
// @ts-expect-error Publication warning cannot be synthesized from a boolean ACK.
createOrdersCreditRefresh({...orders,publication:{commit:async()=>({publicationWarning:true})}});
// @ts-expect-error Manual observer cannot replace operation completion with deferred authority.
ordersOwner.commands.refresh({...ordersRequest,onPublished:async()=>{}});
// @ts-expect-error Existing last-known-good state starts as unknown at the owner boundary.
orders.cloud.readSync().syncedAt;
