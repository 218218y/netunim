import {creditSourceTransfer,creditPlacementOverlap,creditAmountEnrichment,creditHistoryKey as financialKey} from './credit-transaction-identity.js';
// @ts-check
/** Normalized retained records, after the current-response evidence boundary.
 * @typedef {Record<string,unknown> & {installments?:{number?:unknown,total?:unknown}|null}} Transaction
 * @typedef {{month:string,tier:string,fetchStatus:string,status:string,fetchedAt:string|null,transactions:Transaction[],lastErrorCode:string,lastErrorAt:string|null}} Month
 */
export const CREDIT_HISTORICAL_MONTH_REGRESSION='CREDIT_HISTORICAL_MONTH_REGRESSION';

/** @type {Intl.DateTimeFormat|undefined} */
let billingDayFormat;
/** Use the same business calendar as the SQL guard, including month/year
 * boundaries that arrive in Israel before UTC midnight. @param {string} at */
function billingObservationDay(at){
  billingDayFormat??=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'});
  const date=new Date(at),parts=billingDayFormat.formatToParts(Number.isFinite(date.getTime())?date:new Date());
  /** @param {string} type */
  const part=type=>parts.find(item=>item.type===type)?.value||'';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Calendar history is protected conservatively: the protocol has no issuer
 * statement-closed flag. Protect every retained completed row, including future
 * billing dates. A scheduled debit does not make posted evidence disposable. Never infer removal authority from success,
 * recovery mode or an empty array. Late additions/refunds remain supported.
 * @param {Month|undefined} prior @param {Month} next @param {string|null} [reference]
 * @returns {Month} */
export function mergeCreditMonthSnapshot(prior,next,reference=null){
  if(next.fetchStatus!=='success')return prior&&(prior.fetchedAt||prior.transactions.length)
    ?{...prior,status:'stale',fetchStatus:next.fetchStatus,lastErrorCode:next.lastErrorCode,lastErrorAt:next.lastErrorAt}
    :{...next,status:'missing'};
  if(prior?.transactions.length){
    const at=[reference,prior.fetchedAt,next.fetchedAt].filter(Boolean).sort().at(-1)||new Date().toISOString();
    const day=billingObservationDay(at);
    const protectedRows=prior.month<day.slice(0,7)?prior.transactions:prior.transactions.filter(tx=>
      tx.status==='completed'&&!(tx.type==='statement_adjustment'&&
        /^\d{4}-\d{2}-\d{2}/.test(String(tx.processedDate||''))&&String(tx.processedDate).slice(0,10)>day));
    if(protectedRows.length){
      const consumed=new Set(),remaining=[];
      for(const old of protectedRows){
        const index=next.transactions.findIndex((tx,index)=>!consumed.has(index)&&financialKey(old)===financialKey(tx));
        if(index>=0)consumed.add(index);else remaining.push(old);
      }
      for(const old of remaining){
        const matches=next.transactions.map((tx,index)=>({tx,index})).filter(({tx,index})=>!consumed.has(index)&&creditAmountEnrichment(old,tx));
        const match=matches.length===1?matches[0]:null;
        if(!match||remaining.filter(row=>creditAmountEnrichment(row,match.tx)).length!==1)
          return {...prior,status:'stale',fetchStatus:'schema_error',lastErrorCode:CREDIT_HISTORICAL_MONTH_REGRESSION,lastErrorAt:at};
        consumed.add(match.index);
      }
    }
  }
  return {...next,status:'fresh'};
}


export {creditSourceTransfer as sameUnassignedEvidence};

/** Unassigned absence never proves deletion. Consume matching observations once
 * so duplicate issuer IDs and anonymous multiplicity cannot erase a source row.
 * On uncertainty reject the account's transaction replacement as a unit, rather
 * than unioning two competing billing placements and double counting them.
 * @param {Transaction[]} previous @param {Transaction[]} incoming
 * @param {Month[]} months @param {string|null} reference */
export function reconcileUnassignedCredit(previous,incoming,months,reference){
  const candidates=[...incoming.map(tx=>({tx,month:''})),
    ...months.flatMap(month=>month.transactions.map(tx=>({tx,month:month.month})))];
  if(incoming.some(source=>months.some(month=>month.transactions.some(tx=>creditPlacementOverlap(source,tx)))))
    return {blocked:true,transactions:previous,transfers:[]};
  const consumed=new Set(),transfers=[],remaining=[];
  // Reserve unchanged financial evidence first, including repeated issuer IDs.
  // A retained occurrence cannot also authorize another source's transfer.
  for(const old of previous){
    const index=candidates.findIndex((row,index)=>!row.month&&!consumed.has(index)&&financialKey(old)===financialKey(row.tx));
    if(index>=0)consumed.add(index);else remaining.push(old);
  }
  for(const old of remaining){
    const matches=candidates.map((row,index)=>({row,index})).filter(({row,index})=>
      !consumed.has(index)&&(!row.month&&financialKey(old)===financialKey(row.tx)||creditSourceTransfer(old,row.tx)));
    if(matches.length!==1||remaining.filter(source=>creditSourceTransfer(source,matches[0]?.row.tx||{})).length!==1)return {blocked:true,transactions:previous,transfers:[]};
    const match=matches[0];
    if(!match)return {blocked:true,transactions:previous,transfers:[]};
    const {row,index}=match;consumed.add(index);
    if(row.month)transfers.push({transaction:old,month:row.month,at:reference});
  }
  return {blocked:false,transactions:incoming,transfers};
}
