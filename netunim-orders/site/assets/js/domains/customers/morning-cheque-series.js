import {checkAddMonthsISO,checkDateObj,checkLocalISO,checkTodayISO} from '../../core/dates.js';

function advanceChequeMonth(value,months){
  const date=String(value||''),parsed=/^\d{4}-\d{2}-\d{2}$/.test(date)?checkDateObj(date):null;
  return parsed&&!Number.isNaN(parsed.getTime())&&checkLocalISO(parsed)===date?checkAddMonthsISO(date,months):'';
}

function followingChequeNumber(value){
  const number=String(value||'').trim();
  if(!/^\d{1,40}$/.test(number))return '';
  const next=String(BigInt(number)+1n);
  return next.length<=40?next.padStart(number.length,'0'):'';
}

/** Suggest an editable receipt from the last cheque; never copy bank-source ownership/locks. */
export function nextMorningPaymentDraft(payments,defaultPayment){
  const cheques=(Array.isArray(payments)?payments:[]).filter(payment=>Number(payment?.type)===2);
  if(!cheques.length)return {...defaultPayment};
  const previous=cheques.at(-1);
  // A manual date starts a new monthly schedule. Keep its day through short months.
  let anchor=cheques[0],offset=1;
  for(const payment of cheques.slice(1)){
    if(payment.date===advanceChequeMonth(anchor.date,offset))offset++;
    else{anchor=payment;offset=1}
  }
  const date=advanceChequeMonth(anchor.date,offset)||defaultPayment.date;
  const amount=Number(previous.price);
  return {
    type:2,date,price:Number.isFinite(amount)&&amount>0?amount:'',currency:'ILS',
    bankName:String(previous.bankName||''),bankCode:String(previous.bankCode||''),
    bankBranch:String(previous.bankBranch||''),bankAccount:String(previous.bankAccount||''),
    chequeNum:followingChequeNumber(previous.chequeNum)
  };
}

/** Run after the lazy import, against the same live, editable form. */
export function appendMorningPayment(host,{field,read,render,toast,canEdit}){
  if(!host||field('morningPaymentRows')!==host||!canEdit())return false;
  const payments=read({strict:false});
  if(payments.length>=12){toast('ניתן להוסיף עד 12 תקבולים למסמך');return false}
  payments.push(nextMorningPaymentDraft(payments,{type:4,date:checkTodayISO(),price:'',currency:'ILS'}));
  render(payments);
  return true;
}
