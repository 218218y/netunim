import {createBankLocalSnapshot} from '../../netunim-kupa/site/assets/js/domains/bank/local-snapshot.js';

const snapshot={snapshotToken:'bank-stable-id',currentBalance:123};
const local=createBankLocalSnapshot({model:{state:{bank:{snapshotToken:null,currentBalance:null}}},saveState:async(_message,options)=>{
  /** @type {'bank'} */ const field=options.operations[0]?.field??'bank';
  /** @type {string} */ const id=options.operations[0]?.value.snapshotToken??'';
  void field;void id;return true;
},recoverLocalState:async assertCurrent=>{assertCurrent();return true},render:()=>{}});
local.save(snapshot,'save bank',()=>{});local.retry();
/** @type {boolean|undefined} */ const retryAllowed=local.state()?.canRetry;
// @ts-expect-error a snapshot cannot replace a stable operation identity with a number
local.save({snapshotToken:123},'bad',()=>{});
// @ts-expect-error the authority guard must synchronously throw or return void
local.save(snapshot,'bad','owner');
// @ts-expect-error publication phases are not a generic saved/synced string
/** @type {'synced'|undefined} */ const synced=local.state()?.phase;
void retryAllowed;void synced;
// @ts-expect-error recovery readiness is a boolean, not a successful-looking string
createBankLocalSnapshot({model:{state:{bank:snapshot}},saveState:()=>true,recoverLocalState:async()=> 'ready',render:()=>{}});
