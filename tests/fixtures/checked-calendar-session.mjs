import {createCalendarSessionRuntime} from '../../netunim-orders/site/assets/js/calendar/session-runtime.js';
import {createCalendarConnection} from '../../netunim-orders/site/assets/js/calendar/connection.js';

/** @type {Parameters<typeof createCalendarSessionRuntime>[0]} */
const ports={
  session:{accessToken:'',accountId:'A',expectedAccountId:'',autoConnect:false,accountVerified:false,syncing:false,lastError:'',queueObservationError:'',lastSyncAt:null},
  auth:{restore:async()=> 'token',beginConnect:async()=>false,disconnect:async()=>{},rejectToken(){},hasUsableToken:()=>true,authRequiredError:()=>Object.assign(Error('auth'),{code:'calendar_auth_required'}),configured:()=>true,ready:()=>true,prepare:async()=>true},
  storage:{connectionPreference:()=>({known:true,autoConnect:false,accountId:'A'}),saveConnectionPreference(){},getMeta:async()=> 'A',putMeta:async()=>{},clearRangeCache:async()=>{},listOperations:async()=>[],putRangeCache:async()=>{},readPendingSnapshot:async()=>({operations:[],isCurrent:()=>true,isSettled:()=>true}),confirmPendingSnapshot:async publish=>publish({operations:[],isCurrent:()=>true,isSettled:()=>true})},
  api:{listCalendars:async()=>[{id:'A',primary:true}],fetchEvents:async()=>[]},journal:{flushPending:async()=>{}},
  effects:/** @type {Parameters<typeof createCalendarSessionRuntime>[0]['effects']} */ ({}),
  authority:{checkpoint:()=>()=>{},capture:()=>({owner:'A',signal:new AbortController().signal,assertCurrent(){}})},
  display:{isOpen:()=>true,isPrimary:()=>true,open(){},prefetchRange:()=>({key:'range',startKey:'2026-10-01',endKey:'2026-11-01',timeMin:'2026-10-01T00:00:00Z',timeMax:'2026-11-01T00:00:00Z'}),cacheCovers:()=>false,containsPrefetch:()=>true,setCalendars(){},setPending(){},clearCache(){},publish(){},render(){},status(){}},
  feedback:{toast(){},requestCloudLogin(){}},
};
const runtime=createCalendarSessionRuntime(ports);
/** @type {boolean} */ const confirmed=await runtime.syncNow();void confirmed;
/** @type {Promise<void>} */ const drained=runtime.drain();void drained;
// @ts-expect-error Formatted text cannot prove synchronous queue confirmation.
createCalendarSessionRuntime({...ports,storage:{...ports.storage,confirmPendingSnapshot:async()=> 'confirmed'}});
// @ts-expect-error A queue-current predicate cannot be an asynchronous truthy object.
createCalendarSessionRuntime({...ports,storage:{...ports.storage,readPendingSnapshot:async()=>({operations:[],isCurrent:async()=>true,isSettled:()=>true})}});
// @ts-expect-error A confirmed remote Calendar identity is textual.
createCalendarSessionRuntime({...ports,api:{...ports.api,listCalendars:async()=>[{id:1}]}});
// @ts-expect-error A display authority must include its cancellation signal.
createCalendarSessionRuntime({...ports,authority:{...ports.authority,capture:()=>({owner:'A',assertCurrent(){}})}});
// @ts-expect-error A display status string cannot stand in for a sync result.
/** @type {string} */ const status=await runtime.syncNow();void status;
// @ts-expect-error Disposal cannot return a fabricated asynchronous status.
/** @type {Promise<boolean>} */ const closed=runtime.dispose();void closed;
// @ts-expect-error The narrow connection does not expose Google transport or mutable credentials.
/** @type {ReturnType<typeof createCalendarConnection>} */ const connection={...ports.auth};void connection;
// @ts-expect-error Credential scope assertions must remain synchronous before navigation.
ports.auth.beginConnect({assertCurrent:true});
