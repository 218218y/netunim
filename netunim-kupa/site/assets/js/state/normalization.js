import {clone} from '../core/values.js';
import {normalizeSharedChecks} from '../domains/checks/model.js';
import {wholeMoney} from '../core/money.js';
import {inactiveCreditExpired} from '../domains/credit/model.js';
import {assertPortablePayload} from './validation.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStateNormalization({model}){
function prepareKupaCloudState(source=model.state){const x=normalizeState(clone(source));delete x.checks;x.bank={...x.bank,adjustments:(x.bank.adjustments||[]).filter(a=>a?.type!=='check_deposit')};return x}

function applyKupaCloudState(cloudState,checks=model.state.checks){const x=normalizeState({...clone(cloudState||{}),checks:normalizeSharedChecks(checks)});x.bank.adjustments=(x.bank.adjustments||[]).filter(a=>a?.type!=='check_deposit');return x}

function normalizeState(d){
  const n=clone(d||{});
  n.version=Math.max(Number(n.version||1),4);
  n.bank=(n.bank&&typeof n.bank==='object')?n.bank:{currentBalance:null,updatedAt:null,asOfDate:null,adjustments:[]};
  if(n.bank.currentBalance===''||n.bank.currentBalance===undefined)n.bank.currentBalance=null;
  if(n.bank.currentBalance!==null)n.bank.currentBalance=wholeMoney(n.bank.currentBalance);
  n.bank.updatedAt=n.bank.updatedAt||null;
  n.bank.asOfDate=n.bank.asOfDate||(n.bank.updatedAt?String(n.bank.updatedAt).slice(0,10):null);
  n.bank.snapshotToken=n.bank.snapshotToken?String(n.bank.snapshotToken):null;
  {const seq=Number(n.bank.snapshotSeq);n.bank.snapshotSeq=Number.isSafeInteger(seq)&&seq>=0?seq:null}
  n.bank.adjustments=Array.isArray(n.bank.adjustments)?n.bank.adjustments.map(x=>({...x,amount:wholeMoney(x.amount)})):[];
  n.checks=normalizeSharedChecks(n.checks);
  n.cash=(n.cash||[]).map(x=>({...x,amount:wholeMoney(x.amount)}));
  n.expenses=(n.expenses||[]).map(x=>({...x,amount:wholeMoney(x.amount),recurring:x.recurring===undefined?true:!!x.recurring}));
  const before=(n.credits||[]).length;
  n.credits=(n.credits||[]).map(x=>({...x,totalAmount:wholeMoney(x.totalAmount)})).filter(cr=>!inactiveCreditExpired(cr));
  model.lastNormalizeRemovedCredits=Math.max(0,before-n.credits.length);
  return n;
}

function stateFromPayload(p){assertPortablePayload(p);const {_meta,...raw}=p;return {state:normalizeState(raw),meta:_meta||{}}}

return { prepareKupaCloudState, applyKupaCloudState, normalizeState, stateFromPayload };
}
