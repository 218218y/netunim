import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';

export function bankChequeDetails(row){
  const details=row?.checkDetails&&typeof row.checkDetails==='object'?row.checkDetails:null;if(!details)return '';
  const kind=['deposit','returned','returned_credit'].includes(details.kind)?details.kind:(row?.cheque?'deposit':'');if(!kind)return '';
  const items=(Array.isArray(details.checkItems)?details.checkItems:[]).filter(item=>item&&Number(item.amount)>0&&(item.checkNumber||(item.bankNumber&&item.branchNumber&&item.accountNumber))),numbers=[...new Set((Array.isArray(details.checkNumbers)?details.checkNumbers:[]).filter(Boolean))],facts=[];
  if(kind==='deposit'){if(items.length>1)facts.push(`<span><b>שיקים בהפקדה:</b> ${esc(items.length)}</span>`);else if(Number(details.checkCount)>1)facts.push(`<span><b>שיקים בהפקדה:</b> ${esc(Math.trunc(Number(details.checkCount)))}</span>`)}
  const rowNumbers=new Set(items.map(item=>String(item.checkNumber||'').trim()).filter(Boolean)),unassignedNumbers=numbers.filter(number=>!rowNumbers.has(String(number)));
  if(!items.length&&numbers.length)facts.push(`<span><b>${numbers.length===1?'מספר שיק':'מספרי שיקים'}:</b> ${numbers.map(esc).join(', ')}</span>`);else if(unassignedNumbers.length)facts.push(`<span><b>מספרי שיקים שלא שויכו לשורה:</b> ${unassignedNumbers.map(esc).join(', ')}</span>`);
  if(row.bankReference&&row.bankReference!=='0')facts.push(`<span><b>${kind==='deposit'?'אסמכתת הפקדה':'אסמכתא'}:</b> ${esc(row.bankReference)}</span>`);
  const table=items.length?`<div class="bank-cheque-items-wrap"><table class="bank-cheque-items"><thead><tr><th>בנק</th><th>סניף</th><th>חשבון</th><th>מס׳ שיק</th><th>סכום</th></tr></thead><tbody>${items.map(item=>`<tr><td>${esc(item.bankNumber||'—')}</td><td>${esc(item.branchNumber||'—')}</td><td>${esc(item.accountNumber||'—')}</td><td>${esc(item.checkNumber||'—')}</td><td>${money(item.amount)}</td></tr>`).join('')}</tbody></table></div>`:'';
  return facts.length||table||details.warning?`<div class="bank-cheque-info" data-cheque-kind="${esc(kind)}">${facts.length?`<div class="bank-cheque-facts">${facts.join('')}</div>`:''}${table}${details.warning?`<div class="bank-feed-warning">${esc(details.warning)}</div>`:''}</div>`:'';
}
