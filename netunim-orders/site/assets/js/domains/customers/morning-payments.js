import {esc} from '../../core/values.js';

const PAYMENT_TYPES=Object.freeze({1:'מזומן',2:'צ׳ק',3:'כרטיס אשראי',4:'העברה בנקאית'});
const CARD_TYPES=Object.freeze({1:'ישראכרט',2:'Visa',3:'Mastercard',4:'American Express',5:'Diners'});

function todayLocal(){const d=new Date(),shift=d.getTimezoneOffset()*60_000;return new Date(d.getTime()-shift).toISOString().slice(0,10)}
function cleanText(value,max=250){return String(value??'').trim().slice(0,max)}

export function createMorningPayments({dateEditorMarkup,toast,currentField,getSource,getSelectedType}){
function paymentRowMarkup(index,payment={},source=getSource()){
  const type=Number(payment.type)||4,date=cleanText(payment.date,10)||todayLocal(),price=Number(payment.price),priceValue=Number.isFinite(price)&&price>0?price.toFixed(2):'',bankLocked=source?.kind==='bank'&&index===0&&payment.locked!==false;
  return `<div class="morning-payment-row ${bankLocked?'bank-source':''}" data-payment-row="${index}" data-bank-source="${bankLocked?'true':'false'}">
    <div class="morning-payment-row-head"><div class="morning-payment-row-title"><b>${bankLocked?'התקבול מתנועת הבנק':`תקבול ${index+1}`}</b>${bankLocked?'<span class="morning-payment-source-badge">מקור מאומת</span>':''}</div>${bankLocked?'':`<button type="button" class="icon-btn morning-payment-remove" data-action="morning-payment-remove" data-click-arg0="${index}" title="הסר תקבול" aria-label="הסר תקבול">×</button>`}</div>
    <div class="form-grid">
      <div class="field"><label>אמצעי תשלום</label><select data-payment-field="type" data-change="morning-payment-type" data-change-arg0="${index}" ${bankLocked?'disabled':''}>${Object.entries(PAYMENT_TYPES).map(([value,label])=>`<option value="${value}" ${Number(value)===type?'selected':''}>${esc(label)}</option>`).join('')}</select></div>
      <div class="field"><label>סכום תקבול</label><input class="number-input" data-payment-field="price" data-input="morning-payment-amount" type="number" min="0" step="1" value="${esc(priceValue)}" ${bankLocked?'readonly':''} placeholder="0.00"></div>
      <div class="field"><label>תאריך תשלום</label>${dateEditorMarkup(`morningPaymentDate${index}`,date,{label:'תאריך תשלום'})}</div>
      <div class="field full morning-transfer-fields" data-payment-kind="4"><label>אסמכתא / מספר העברה <small>(רשות)</small></label><input data-payment-field="transactionId" maxlength="80" value="${esc(payment.transactionId||'')}" ${bankLocked?'readonly':''} placeholder="למשל מספר אסמכתא מהבנק"></div>
      <div class="field morning-card-fields" data-payment-kind="3" hidden><label>סוג כרטיס</label><select data-payment-field="cardType">${Object.entries(CARD_TYPES).map(([value,label])=>`<option value="${value}" ${Number(payment.cardType||1)===Number(value)?'selected':''}>${esc(label)}</option>`).join('')}</select></div>
      <div class="field morning-card-fields" data-payment-kind="3" hidden><label>4 ספרות אחרונות</label><input data-payment-field="cardNum" inputmode="numeric" maxlength="4" value="${esc(payment.cardNum||'')}" placeholder="1234"></div>
      <div class="field morning-check-fields" data-payment-kind="2" hidden><label>בנק</label><input data-payment-field="bankName" maxlength="80" value="${esc(payment.bankName||'')}"></div>
      <div class="field morning-check-fields" data-payment-kind="2" hidden><label>סניף</label><input data-payment-field="bankBranch" maxlength="30" value="${esc(payment.bankBranch||'')}"></div>
      <div class="field morning-check-fields" data-payment-kind="2" hidden><label>חשבון</label><input data-payment-field="bankAccount" maxlength="40" value="${esc(payment.bankAccount||'')}"></div>
      <div class="field morning-check-fields" data-payment-kind="2" hidden><label>מספר צ׳ק</label><input data-payment-field="chequeNum" maxlength="40" value="${esc(payment.chequeNum||'')}"></div>
    </div>
  </div>`;
}
function initialPayments(data,source){if(Array.isArray(data?.payment)&&data.payment.length)return data.payment.slice(0,12).map(row=>({...row}));if(data?.payment&&typeof data.payment==='object')return [{...data.payment}];const amount=Number(data?.amount);return [{type:4,date:data?.date||todayLocal(),price:Number.isFinite(amount)&&amount>0?amount:'',currency:'ILS'}]}
function paymentFields(data,source){return `<div id="morningPaymentFields" class="morning-payment-panel">
  <div class="morning-section-title"><span>תקבולים</span><small>סכום המסמך מחושב מסך התקבולים</small></div>
  <div id="morningPaymentRows" class="morning-payment-rows">${initialPayments(data,source).map((payment,index)=>paymentRowMarkup(index,payment,source)).join('')}</div>
  <button type="button" class="btn small morning-payment-add" data-action="morning-payment-add">+ הוסף תקבול</button>
</div>`}
function syncPaymentType(index=null){
  const rows=[...document.querySelectorAll('[data-payment-row]')];for(const row of rows){if(index!==null&&Number(row.dataset.paymentRow)!==Number(index))continue;const type=Number(row.querySelector('[data-payment-field="type"]')?.value||4);row.querySelectorAll('[data-payment-kind]').forEach(el=>{el.hidden=Number(el.dataset.paymentKind)!==type})}
}
function readPaymentRows({strict=true}={}){
  const rows=[...document.querySelectorAll('[data-payment-row]')];if(strict&&!rows.length)throw new Error('יש להוסיף לפחות תקבול אחד');
  return rows.map((row,index)=>{const type=Number(row.querySelector('[data-payment-field="type"]')?.value||0),date=String(currentField(`morningPaymentDate${index}`)?.value||''),price=Number(row.querySelector('[data-payment-field="price"]')?.value||0),payment={type,date,price,currency:'ILS',locked:row.dataset.bankSource==='true'};
    if(!strict)return {...payment,transactionId:cleanText(row.querySelector('[data-payment-field="transactionId"]')?.value,80),cardType:Number(row.querySelector('[data-payment-field="cardType"]')?.value||1),cardNum:String(row.querySelector('[data-payment-field="cardNum"]')?.value||''),bankName:cleanText(row.querySelector('[data-payment-field="bankName"]')?.value,80),bankBranch:cleanText(row.querySelector('[data-payment-field="bankBranch"]')?.value,30),bankAccount:cleanText(row.querySelector('[data-payment-field="bankAccount"]')?.value,40),chequeNum:cleanText(row.querySelector('[data-payment-field="chequeNum"]')?.value,40)};
    if(!Object.prototype.hasOwnProperty.call(PAYMENT_TYPES,type))throw new Error(`יש לבחור אמצעי תשלום תקין בתקבול ${index+1}`);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error(`יש לבחור תאריך בתקבול ${index+1}`);if(!Number.isFinite(price)||price<=0)throw new Error(`יש להזין סכום חיובי בתקבול ${index+1}`);
    if(type===4){const ref=cleanText(row.querySelector('[data-payment-field="transactionId"]')?.value,80);if(ref)payment.transactionId=ref}
    if(type===3){const cardType=Number(row.querySelector('[data-payment-field="cardType"]')?.value||0),cardNum=String(row.querySelector('[data-payment-field="cardNum"]')?.value||'').replace(/\D/g,'');if(!CARD_TYPES[cardType])throw new Error(`יש לבחור סוג כרטיס בתקבול ${index+1}`);if(!/^\d{4}$/.test(cardNum))throw new Error(`יש להזין 4 ספרות אחרונות בתקבול ${index+1}`);Object.assign(payment,{dealType:1,cardType,cardNum})}
    if(type===2){const bankName=cleanText(row.querySelector('[data-payment-field="bankName"]')?.value,80),bankBranch=cleanText(row.querySelector('[data-payment-field="bankBranch"]')?.value,30),bankAccount=cleanText(row.querySelector('[data-payment-field="bankAccount"]')?.value,40),chequeNum=cleanText(row.querySelector('[data-payment-field="chequeNum"]')?.value,40);if(!bankName||!bankBranch||!bankAccount||!chequeNum)throw new Error(`בצ׳ק בתקבול ${index+1} יש למלא בנק, סניף, חשבון ומספר צ׳ק`);Object.assign(payment,{bankName,bankBranch,bankAccount,chequeNum})}
    delete payment.locked;return payment;
  });
}
function renderPaymentRows(payments){const host=currentField('morningPaymentRows');if(!host)return;host.innerHTML=payments.map((payment,index)=>paymentRowMarkup(index,payment,getSource())).join('');syncPaymentType();syncPaymentTotal()}
function addMorningPayment(){const payments=readPaymentRows({strict:false});if(payments.length>=12)return toast('ניתן להוסיף עד 12 תקבולים למסמך');payments.push({type:4,date:todayLocal(),price:'',currency:'ILS'});renderPaymentRows(payments)}
function removeMorningPayment(index){const payments=readPaymentRows({strict:false}),i=Number(index),source=getSource();if(!Number.isInteger(i)||i<0||i>=payments.length)return;if(source?.kind==='bank'&&i===0)return toast('התקבול שמקורו בתנועת הבנק אינו ניתן להסרה');if(payments.length<=1)return toast('יש להשאיר לפחות תקבול אחד');payments.splice(i,1);renderPaymentRows(payments)}
function syncPaymentTotal(){if(![320,400].includes(Number(getSelectedType())))return;const total=readPaymentRows({strict:false}).reduce((sum,row)=>sum+(Number.isFinite(Number(row.price))&&Number(row.price)>0?Math.round(Number(row.price)*100):0),0)/100,field=currentField('morningAmount');if(field)field.value=total>0?total.toFixed(2):''}
return {paymentFields,readPaymentRows,addMorningPayment,removeMorningPayment,syncPaymentType,syncPaymentTotal};
}
