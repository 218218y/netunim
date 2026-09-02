import {clone} from '../core/values.js';
import {normalizeSharedChecks} from '../domains/checks/model.js';
import {wholeMoney} from '../core/money.js';
import {inactiveCreditExpired} from '../domains/credit/model.js';
import {normalizeBankFeed} from '../domains/bank/feed.js';
import {CREDIT_SYNC_VERSION,normalizeCreditSync} from '../domains/credit/sync-feed.js';
import {assertPortablePayload} from './validation.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStateNormalization({model}){
function prepareKupaCloudState(source=model.state){const x=normalizeState(clone(source));delete x.checks;delete x.creditSync;const bank=x.bank&&typeof x.bank==='object'?x.bank:{};x.bank={currentBalance:bank.source==='manual'?bank.currentBalance:null,updatedAt:bank.source==='manual'?bank.updatedAt:null,asOfDate:bank.source==='manual'?bank.asOfDate:null,adjustments:(bank.adjustments||[]).filter(a=>a?.type!=='check_deposit'),source:bank.source==='manual'?'manual':null,sourceAccount:null,snapshotToken:bank.snapshotToken??null,snapshotSeq:bank.snapshotSeq??null};return x}

function applyKupaCloudState(cloudState,checks=model.state.checks){const x=normalizeState({...clone(cloudState||{}),checks:normalizeSharedChecks(checks)});x.bank.adjustments=(x.bank.adjustments||[]).filter(a=>a?.type!=='check_deposit');return x}

function normalizeState(d){
  const n=clone(d||{});
  n.version=Math.max(Number(n.version||1),4);
  n.bank=(n.bank&&typeof n.bank==='object')?n.bank:{currentBalance:null,updatedAt:null,asOfDate:null,adjustments:[]};
  if(n.bank.currentBalance===''||n.bank.currentBalance===undefined)n.bank.currentBalance=null;
  if(n.bank.currentBalance!==null)n.bank.currentBalance=wholeMoney(n.bank.currentBalance);
  n.bank.updatedAt=n.bank.updatedAt||null;
  n.bank.source=n.bank.source?String(n.bank.source):null;
  n.bank.sourceAccount=n.bank.sourceAccount?String(n.bank.sourceAccount):null;
  n.bank.feed=normalizeBankFeed(n.bank.feed);
  n.bank.homeFeed=normalizeBankFeed(n.bank.homeFeed);
  n.bank.bankSyncAt=n.bank.feed?.syncedAt||n.bank.bankSyncAt||(n.bank.source==='hapoalim'?n.bank.updatedAt:null);
  n.bank.asOfDate=n.bank.asOfDate||(n.bank.updatedAt?String(n.bank.updatedAt).slice(0,10):null);
  n.bank.snapshotToken=n.bank.snapshotToken?String(n.bank.snapshotToken):null;
  {const seq=Number(n.bank.snapshotSeq);n.bank.snapshotSeq=Number.isSafeInteger(seq)&&seq>=0?seq:null}
  n.bank.adjustments=Array.isArray(n.bank.adjustments)?n.bank.adjustments.map(x=>({...x,amount:wholeMoney(x.amount)})):[];
  n.checks=normalizeSharedChecks(n.checks);
  n.cash=(Array.isArray(n.cash)?n.cash:[]).map(x=>({...x,amount:wholeMoney(x.amount)}));
  n.rights=(Array.isArray(n.rights)?n.rights:[]).map(x=>({...x,amount:wholeMoney(x.amount)}));
  {
    const raw=String(n.rightsLastCalculatedDate||'').trim();
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if(match){const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),d=new Date(Date.UTC(year,month-1,day));n.rightsLastCalculatedDate=d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day?raw:null}else n.rightsLastCalculatedDate=null;
  }
  n.notes=(Array.isArray(n.notes)?n.notes:[]).filter(x=>x&&x.id).map(x=>({...x,id:String(x.id),content:String(x.content||''),createdAt:String(x.createdAt||''),updatedAt:String(x.updatedAt||x.createdAt||'')}));
  n.expenses=(Array.isArray(n.expenses)?n.expenses:[]).map(x=>({...x,account:x.account==='ביתי'?'ביתי':'עסקי',amount:wholeMoney(x.amount),recurring:x.recurring===undefined?true:!!x.recurring}));
  const creditSyncSourceVersion=Math.trunc(Number(n.creditSync?.version)||1);
  n.creditSync=normalizeCreditSync(n.creditSync);
  const before=(n.credits||[]).length;
  // v3 is the one-time cutover requested for Kupa: discard the historical manual credit dataset once.
  // Future manual additions are preserved because the synchronized state is then persisted as v3.
  n.credits=creditSyncSourceVersion<CREDIT_SYNC_VERSION?[]:(n.credits||[]).map(x=>({...x,totalAmount:wholeMoney(x.totalAmount),ownerLabel:String(x.ownerLabel||'')})).filter(cr=>!inactiveCreditExpired(cr));
  model.lastNormalizeRemovedCredits=Math.max(0,before-n.credits.length);
  return n;
}

function stateFromPayload(p){assertPortablePayload(p);const {_meta,...raw}=p;return {state:normalizeState(raw),meta:_meta||{}}}

return { prepareKupaCloudState, applyKupaCloudState, normalizeState, stateFromPayload };
}
