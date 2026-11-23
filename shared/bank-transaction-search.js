// Search only transaction facts, never serialized objects or archive bookkeeping.
// Amount queries are exact monetary comparisons; identifiers are separate fields.
import {prepareSearchValues,createPreparedSearchMatcher} from './search.js';
import {readBankMoney} from './bank-money-value.js';

function chequeItems(row){return Array.isArray(row?.checkDetails?.checkItems)?row.checkDetails.checkItems.filter(item=>item&&typeof item==='object'):[]}
function chequeNumbers(row){return Array.isArray(row?.checkDetails?.checkNumbers)?row.checkDetails.checkNumbers:[]}
function cardSuffixes(row){return Array.isArray(row?.creditSettlementDetails?.cardLast4s)?row.creditSettlementDetails.cardLast4s:[]}

function searchableFacts(row,dateLabel){
  const sender=row?.senderAccount||{},cheques=chequeItems(row),credit=row?.creditSettlementDetails||{};
  return [
    row?.date,row?.processedDate,dateLabel,row?.description,row?.memo,
    row?.partyName,row?.partyHeadline,row?.messageHeadline,row?.messageDetail,
    row?.amount,row?.balanceAfter,row?.bankReference,row?.status,row?.presenceState,
    sender.bankNumber,sender.branchNumber,sender.accountNumber,
    ...chequeNumbers(row),...cheques.flatMap(item=>[
      item.bankNumber,item.branchNumber,item.accountNumber,item.checkNumber,item.amount,
    ]),
    credit.providerLabel,credit.permissionReference,credit.issuerReference,...cardSuffixes(row),
    row?.checkDetails?.warning,credit.warning,
  ];
}

function parseAmountQuery(query){
  const text=String(query??'').trim().replace(/[\s\u00a0\u202f₪]/g,'');
  if(!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text))return null;
  const number=Number(text.replaceAll(',',''));
  return Number.isFinite(number)?Math.round(Math.abs(number)*100):null;
}

function exactAmount(value,cents){
  const amount=readBankMoney(value);
  return amount!==null&&Math.round(Math.abs(amount)*100)===cents;
}

function numberInVisibleText(value,digits){
  // A number inside the description is meaningful, but a suffix of a longer
  // account number, or pieces of two unrelated numbers, are not that number.
  const text=String(value??'');
  const numbers=text.match(/\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/g)||[];
  return numbers.some(number=>number.replaceAll(',','')===digits);
}

function exactIdentifier(value,digits){
  return value!==null&&value!==undefined&&String(value).trim().replace(/[\s-]/g,'')===digits;
}

function matchesNumeric(row,digits,cents){
  const cheques=chequeItems(row),sender=row?.senderAccount||{},credit=row?.creditSettlementDetails||{};
  if([row?.amount,row?.balanceAfter,...cheques.map(item=>item.amount)].some(amount=>exactAmount(amount,cents)))return true;
  if([
    row?.bankReference,sender.bankNumber,sender.branchNumber,sender.accountNumber,
    ...chequeNumbers(row),...cheques.flatMap(item=>[
      item.bankNumber,item.branchNumber,item.accountNumber,item.checkNumber,
    ]),credit.permissionReference,credit.issuerReference,...cardSuffixes(row),
  ].some(value=>exactIdentifier(value,digits)))return true;
  if([row?.description,row?.memo,row?.partyName,row?.partyHeadline,row?.messageHeadline,row?.messageDetail]
    .some(value=>numberInVisibleText(value,digits)))return true;
  // A year is also a supported date search, independent of monetary amounts.
  return /^\d{4}$/.test(digits)&&[row?.date,row?.processedDate].some(date=>String(date??'').startsWith(`${digits}-`));
}

export function createBankTransactionSearchMatcher(query){
  const amountCents=parseAmountQuery(query);
  const digits=amountCents===null?'':String(query).trim().replace(/[\s\u00a0\u202f₪,+-]/g,'');
  const matcher=amountCents===null?createPreparedSearchMatcher(query):null;
  return (row,dateLabel='')=>amountCents!==null
    ?matchesNumeric(row,digits,amountCents)
    :matcher(prepareSearchValues(searchableFacts(row,dateLabel),[row?.date,row?.processedDate]));
}

export function bankTransactionMatchesSearch(row,query,dateLabel=''){
  return createBankTransactionSearchMatcher(query)(row,dateLabel);
}
