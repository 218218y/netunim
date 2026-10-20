import {checkAddMonthsISO,checkDateObj,checkLocalISO} from '../../core/dates.js';
import {nextSeriesCheckNumber} from '../../shared/check-series.js';

function advanceChequeMonth(value,months){
  const date=String(value||''),parsed=/^\d{4}-\d{2}-\d{2}$/.test(date)?checkDateObj(date):null;
  return parsed&&!Number.isNaN(parsed.getTime())&&checkLocalISO(parsed)===date?checkAddMonthsISO(date,months):'';
}

function followingChequeNumber(value){
  const number=String(value||'').trim();
  // The shared sequence helper uses Number. Do not silently round long cheque numbers.
  const numeric=Number(number);
  return /^\d+$/.test(number)&&Number.isSafeInteger(numeric)&&numeric<Number.MAX_SAFE_INTEGER
    ?nextSeriesCheckNumber(number,1):'';
}

/** Suggest an editable receipt from the last cheque; never copy bank-source ownership/locks. */
export function nextMorningPaymentDraft(payments,defaultPayment){
  const cheques=(Array.isArray(payments)?payments:[]).filter(payment=>Number(payment?.type)===2);
  if(!cheques.length)return {...defaultPayment};
  const previous=cheques.at(-1),first=cheques[0];
  // Keep the original day across short months (31 Jan -> 28 Feb -> 31 Mar).
  // If someone edited the schedule, continue from the most recently edited cheque.
  const followsFirst=cheques.every((payment,index)=>payment.date===advanceChequeMonth(first.date,index));
  const date=(followsFirst?advanceChequeMonth(first.date,cheques.length):advanceChequeMonth(previous.date,1))||defaultPayment.date;
  const amount=Number(previous.price);
  return {
    type:2,date,price:Number.isFinite(amount)&&amount>0?amount:'',currency:'ILS',
    bankName:String(previous.bankName||''),bankCode:String(previous.bankCode||''),
    bankBranch:String(previous.bankBranch||''),bankAccount:String(previous.bankAccount||''),
    chequeNum:followingChequeNumber(previous.chequeNum)
  };
}
