import {esc} from '../../core/values.js';
import {formatMorningBank,morningBankCode,morningBankDatalistMarkup,morningBankName,resolveMorningBank} from './morning-banks.js';

const PAYMENT_TYPES=Object.freeze({1:'מזומן',2:'צ׳ק',3:'כרטיס אשראי',4:'העברה בנקאית'});
const CARD_TYPES=Object.freeze({1:'ישראכרט',2:'Visa',3:'Mastercard',4:'American Express',5:'Diners'});

function todayLocal(){const d=new Date(),shift=d.getTimezoneOffset()*60_000;return new Date(d.getTime()-shift).toISOString().slice(0,10)}
function cleanText(value,max=250){return String(value??'').trim().slice(0,max)}
function bankDisplayValue(payment={}){const code=cleanText(payment.bankCode,20),name=cleanText(payment.bankName,80),resolved=resolveMorningBank(code||name);return resolved?formatMorningBank(resolved):name}
function paymentKindVisible(element,type){return String(element.dataset.paymentKinds||element.dataset.paymentKind||'').split(',').map(value=>Number(value.trim())).includes(Number(type))}

export function createMorningPayments({dateEditorMarkup,toast,currentField,getSource,getSelectedType}){
function paymentRowMarkup(index,payment={},source=getSource()){
  const type=Number(payment.type)||4,date=cleanText(payment.date,10)||todayLocal(),price=Number(payment.price),priceValue=Number.isFinite(price)&&price>0?price.toFixed(2):'',bankSource=source?.kind==='bank'&&!!cleanText(payment.bankSourceKey,180),bankLocked=bankSource&&payment.locked!==false,bankDetailsLocked=bankLocked&&type===2,removable=!bankSource||payment.removable===true,bankValue=bankDisplayValue(payment);
  return `<div class="morning-payment-row ${bankSource?'bank-source':''}" data-payment-row="${index}" data-bank-source="${bankSource?'true':'false'}" data-bank-source-key="${esc(payment.bankSourceKey||'')}" data-bank-removable="${removable?'true':'false'}">
    <div class="morning-payment-row-head"><div class="morning-payment-row-title"><b>${bankSource?'תקבול מתנועת הבנק':`תקבול ${index+1}`}</b>${bankSource?'<span class="morning-payment-source-badge">מקור מאומת</span>':''}</div>${removable?`<button type="button" class="icon-btn morning-payment-remove" data-action="morning-payment-remove" data-click-arg0="${index}" title="הסר תקבול" aria-label="הסר תקבול">×</button>`:''}</div>
    <div class="form-grid">
      <div class="field"><label>אמצעי תשלום</label><select data-payment-field="type" data-change="morning-payment-type" data-change-arg0="${index}" ${bankLocked?'disabled':''}>${Object.entries(PAYMENT_TYPES).map(([value,label])=>`<option value="${value}" ${Number(value)===type?'selected':''}>${esc(label)}</option>`).join('')}</select></div>
      <div class="field"><label>סכום תקבול</label><input class="number-input" data-payment-field="price" data-input="morning-payment-amount" type="number" min="0" step="1" value="${esc(priceValue)}" ${bankLocked?'readonly':''} placeholder="0.00"></div>
      <div class="field"><label>תאריך תשלום</label>${dateEditorMarkup(`morningPaymentDate${index}`,date,{label:'תאריך תשלום'})}</div>
      <div class="field full morning-transfer-fields" data-payment-kinds="4"><label>אסמכתא מספר העברה <small>(רשות)</small></label><input data-payment-field="transactionId" maxlength="80" value="${esc(payment.transactionId||'')}" ${bankLocked?'readonly':''} placeholder="מספר האסמכתא מהבנק"></div>
      <div class="field morning-bank-fields" data-payment-kinds="2,4"><label>בנק <small>(שם או קוד)</small></label><input data-payment-field="bankName" data-change="morning-payment-bank" data-change-arg0="${index}" list="morningBankDirectory" autocomplete="off" maxlength="120" value="${esc(bankValue)}" ${bankDetailsLocked?'readonly':''} placeholder="למשל 12 או הפועלים"></div>
      <div class="field morning-bank-fields" data-payment-kinds="2,4"><label>סניף</label><input data-payment-field="bankBranch" inputmode="numeric" maxlength="30" value="${esc(payment.bankBranch||'')}" ${bankDetailsLocked?'readonly':''}></div>
      <div class="field morning-bank-fields" data-payment-kinds="2,4"><label>חשבון</label><input data-payment-field="bankAccount" inputmode="numeric" maxlength="40" value="${esc(payment.bankAccount||'')}" ${bankDetailsLocked?'readonly':''}></div>
      <div class="field morning-check-fields" data-payment-kinds="2"><label>מספר צ׳ק</label><input data-payment-field="chequeNum" inputmode="numeric" maxlength="40" value="${esc(payment.chequeNum||'')}" ${bankLocked?'readonly':''}></div>
      <div class="field morning-card-fields" data-payment-kinds="3"><label>סוג כרטיס</label><select data-payment-field="cardType">${Object.entries(CARD_TYPES).map(([value,label])=>`<option value="${value}" ${Number(payment.cardType||1)===Number(value)?'selected':''}>${esc(label)}</option>`).join('')}</select></div>
      <div class="field morning-card-fields" data-payment-kinds="3"><label>4 ספרות אחרונות</label><input data-payment-field="cardNum" inputmode="numeric" maxlength="4" value="${esc(payment.cardNum||'')}" placeholder="1234"></div>
    </div>
  </div>`;
}
function initialPayments(data){if(Array.isArray(data?.payment)&&data.payment.length)return data.payment.slice(0,12).map(row=>({...row}));if(data?.payment&&typeof data.payment==='object')return [{...data.payment}];const amount=Number(data?.amount);return [{type:4,date:data?.date||todayLocal(),price:Number.isFinite(amount)&&amount>0?amount:'',currency:'ILS'}]}
function paymentFields(data,source){return `<div id="morningPaymentFields" class="morning-payment-panel">
  <div class="morning-section-title"><span>תקבולים</span><small>סכום המסמך מחושב מסך התקבולים</small></div>
  ${morningBankDatalistMarkup()}
  <div id="morningPaymentRows" class="morning-payment-rows">${initialPayments(data,source).map((payment,index)=>paymentRowMarkup(index,payment,source)).join('')}</div>
  <button type="button" class="btn small morning-payment-add" data-action="morning-payment-add">+ הוסף תקבול</button>
</div>`}
function syncPaymentType(index=null){
  const rows=[...document.querySelectorAll('[data-payment-row]')];for(const row of rows){if(index!==null&&Number(row.dataset.paymentRow)!==Number(index))continue;const type=Number(row.querySelector('[data-payment-field="type"]')?.value||4);row.querySelectorAll('[data-payment-kind],[data-payment-kinds]').forEach(el=>{el.hidden=!paymentKindVisible(el,type)})}
}
function syncPaymentBank(index){
  const row=document.querySelector(`[data-payment-row="${Number(index)}"]`),input=row?.querySelector('[data-payment-field="bankName"]');if(!input)return;const bank=resolveMorningBank(input.value);if(bank)input.value=formatMorningBank(bank);
}
function rowBankData(row){
  const raw=cleanText(row.querySelector('[data-payment-field="bankName"]')?.value,120),resolved=resolveMorningBank(raw),bankName=resolved?.name||morningBankName(raw),bankCode=resolved?.code||morningBankCode(raw),bankBranch=cleanText(row.querySelector('[data-payment-field="bankBranch"]')?.value,30),bankAccount=cleanText(row.querySelector('[data-payment-field="bankAccount"]')?.value,40);
  return {bankName,bankCode,bankBranch,bankAccount};
}
function readPaymentRows({strict=true}={}){
  const rows=[...document.querySelectorAll('[data-payment-row]')];if(strict&&!rows.length)throw new Error('יש להוסיף לפחות תקבול אחד');
  return rows.map((row,index)=>{const type=Number(row.querySelector('[data-payment-field="type"]')?.value||0),date=String(currentField(`morningPaymentDate${index}`)?.value||''),price=Number(row.querySelector('[data-payment-field="price"]')?.value||0),bankSourceKey=cleanText(row.dataset.bankSourceKey,180),payment={type,date,price,currency:'ILS'};
    if(bankSourceKey)payment.bankSourceKey=bankSourceKey;
    if(!strict){Object.assign(payment,rowBankData(row),{transactionId:cleanText(row.querySelector('[data-payment-field="transactionId"]')?.value,80),cardType:Number(row.querySelector('[data-payment-field="cardType"]')?.value||1),cardNum:String(row.querySelector('[data-payment-field="cardNum"]')?.value||''),chequeNum:cleanText(row.querySelector('[data-payment-field="chequeNum"]')?.value,40),locked:row.dataset.bankSource==='true',removable:row.dataset.bankRemovable==='true',source:row.dataset.bankSource==='true'?'bank':''});return payment}
    if(!Object.prototype.hasOwnProperty.call(PAYMENT_TYPES,type))throw new Error(`יש לבחור אמצעי תשלום תקין בתקבול ${index+1}`);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error(`יש לבחור תאריך בתקבול ${index+1}`);if(!Number.isFinite(price)||price<=0)throw new Error(`יש להזין סכום חיובי בתקבול ${index+1}`);
    if(type===4){const ref=cleanText(row.querySelector('[data-payment-field="transactionId"]')?.value,80),bank=rowBankData(row);if(ref)payment.transactionId=ref;if(bank.bankName)payment.bankName=bank.bankName;if(bank.bankCode)payment.bankCode=bank.bankCode;if(bank.bankBranch)payment.bankBranch=bank.bankBranch;if(bank.bankAccount)payment.bankAccount=bank.bankAccount}
    if(type===3){const cardType=Number(row.querySelector('[data-payment-field="cardType"]')?.value||0),cardNum=String(row.querySelector('[data-payment-field="cardNum"]')?.value||'').replace(/\D/g,'');if(!CARD_TYPES[cardType])throw new Error(`יש לבחור סוג כרטיס בתקבול ${index+1}`);if(!/^\d{4}$/.test(cardNum))throw new Error(`יש להזין 4 ספרות אחרונות בתקבול ${index+1}`);Object.assign(payment,{dealType:1,cardType,cardNum})}
    if(type===2){const bank=rowBankData(row),chequeNum=cleanText(row.querySelector('[data-payment-field="chequeNum"]')?.value,40);if(!bank.bankName||!bank.bankBranch||!bank.bankAccount||!chequeNum)throw new Error(`בצ׳ק בתקבול ${index+1} יש למלא בנק, סניף, חשבון ומספר צ׳ק`);Object.assign(payment,bank,{chequeNum})}
    return payment;
  });
}
function renderPaymentRows(payments){const host=currentField('morningPaymentRows');if(!host)return;host.innerHTML=payments.map((payment,index)=>paymentRowMarkup(index,payment,getSource())).join('');syncPaymentType();syncPaymentTotal()}
function addMorningPayment(){const payments=readPaymentRows({strict:false});if(payments.length>=12)return toast('ניתן להוסיף עד 12 תקבולים למסמך');payments.push({type:4,date:todayLocal(),price:'',currency:'ILS'});renderPaymentRows(payments)}
function removeMorningPayment(index){
  const payments=readPaymentRows({strict:false}),i=Number(index);if(!Number.isInteger(i)||i<0||i>=payments.length)return;if(payments.length<=1)return toast('יש להשאיר לפחות תקבול אחד');const target=payments[i];if(target.bankSourceKey){const bankRows=payments.filter(row=>row.bankSourceKey);if(!target.removable)return toast('התקבול שמייצג את תנועת הבנק אינו ניתן להסרה');if(bankRows.length<=1)return toast('יש להשאיר לפחות תקבול אחד שמקורו בתנועת הבנק')}
  payments.splice(i,1);renderPaymentRows(payments);
}
function syncPaymentTotal(){if(![320,400].includes(Number(getSelectedType())))return;const total=readPaymentRows({strict:false}).reduce((sum,row)=>sum+(Number.isFinite(Number(row.price))&&Number(row.price)>0?Math.round(Number(row.price)*100):0),0)/100,field=currentField('morningAmount');if(field)field.value=total>0?total.toFixed(2):''}
return {paymentFields,readPaymentRows,addMorningPayment,removeMorningPayment,syncPaymentType,syncPaymentBank,syncPaymentTotal};
}
