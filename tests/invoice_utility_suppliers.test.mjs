import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recognizeInvoice} from '../netunim-orders/site/assets/js/core/invoice-recognition.js';
import {INVOICE_SUPPLIER_PROFILES} from '../netunim-orders/site/assets/js/core/invoice-supplier-profiles.js';
import {invoicePdfLines} from '../netunim-orders/site/assets/js/core/invoice-pdf-layout.js';
import {invoiceFieldReview} from '../netunim-orders/site/assets/js/core/invoice-field-review.js';

const tax='123456782',buyer='987654324';
const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('supplier-tax:'+tax))),n=>n.toString(16).padStart(2,'0')).join('');
function page(rows,number=1){
 const items=rows.map(([text,x,y,width],index)=>({text,x,y,width:width??text.length*5,height:10,index,page:number,dir:/[א-ת]/.test(text)?'rtl':'ltr'}));
 return {page:number,width:600,height:840,items,lines:invoicePdfLines(items)};
}
const profile=id=>({...INVOICE_SUPPLIER_PROFILES.find(row=>row.id===id),issuerTaxHash:hash,aliases:['ספק בדיקה']});
const recognize=(id,pages)=>recognizeInvoice({hasText:true,pages},{profiles:[profile(id)]});
const utility=(number='009876543')=>page([
 ['מסמך זה אינו מהווה חשבונית מס. מסמך זה',20,24],['ספק בדיקה',20,121],[tax,140,132],
 ['לכבוד',460,140],[buyer,450,160],['תאריך עריכת החשבון',430,106],['16/08/2027',265,105],
 ['יוגש לחברת האשראי לא לפני',400,124],['02/09/2027',265,123],['07/07/2027 - 06/08/2027',265,152],
 ['חשבונית מס העתק',140,280],['חשבונית מספר '+number,100,292],['מחזור חיוב 3',25,292],
 ['210.13',310,228],['סה״כ החשבונית לפני מע״מ',400,228],
 ['37.82',310,246],['210.13',400,246,40],['18.00%',450,246,40],['מע״מ על',495,246,60],
 ['₪ 247.95',280,284],['סה״כ לתשלום כולל מע״מ',350,284],
]);
const bisan=(title='חשבונית מס',number='10/27/00042')=>page([
 ['ספק בדיקה',15,38],[title+' '+number,215,97],['מספר עוסק מורשה',475,104],[tax,500,114],
 ['09/06/2027',16,104],['לקוח',420,138],[buyer,450,185],['NIS',30,245],
 ['2,011.50',25,430],['סה״כ',85,430],['סה״כ פריטים 8',480,432],
 ['321.84',25,448],['16%',85,448],['מע״מ',115,448],['סה״כ כמות 12',480,447],
 ['2,333.34',25,462],['סה״כ לתשלום',85,462],['תעודת משלוח 10/27/00999',300,300],
 ['Bisan Systems 01/11/2030 09:20:00 UTC',200,820],
]);

test('utility account summary excludes payment dates, billing cycles, VAT bases and trailing annex totals',async()=>{
 const annex=page([['210.13',310,228],['סה״כ החשבונית לפני מע״מ',400,228],['999.99',310,246],['מע״מ על',495,246],
  ['₪ 1,210.12',280,284],['סה״כ לתשלום כולל מע״מ',350,284]],2);
 const result=await recognize('bezeq',[utility(),annex]);
 assert.equal(result.profile,'bezeq');assert.equal(result.fields.supplier.value,tax);
 assert.equal(result.fields.invoiceNumber.value,'009876543');assert.equal(result.fields.date.value,'2027-08-16');
 assert.equal(result.fields.net.value,21013);assert.equal(result.fields.vat.value,3782);assert.equal(result.fields.gross.value,24795);
 assert.equal(result.summaryPage,1);assert.equal(result.fields.currency.value,'ILS');assert.equal(result.documents.blocked,false);
 assert.equal(result.fields.documentType.value,305);assert.equal(result.fields.documentType.status,'review');
 assert.equal(result.fields.documentType.reason,'payment_conditional_invoice');assert.equal(result.outcome,'partial_recognition');
 assert.ok(result.fields.vat.sources.some(source=>source.text==='37.82'));
 const review=invoiceFieldReview(result,{}, {supplierId:'supplier',documentType:305,number:'009876543',date:'2027-08-16',net:'210.13',vat:'37.82',gross:'247.95'},tax);
 assert.match(review.documentType.detail,/מותנה בתשלום/);
 const mixed=await recognize('bezeq',[utility(),{...utility('009876544'),page:2}]);assert.equal(mixed.documents.blocked,true);
});

test('Bisan tax invoices and plural credit titles retain source numbers, positive totals and the actual header date',async()=>{
 for(const [title,type]of [['חשבונית מס',305],['חשבונות זיכוי',330]]){
  const result=await recognize('herbawi',[bisan(title)]);
  assert.equal(result.profile,'herbawi');assert.equal(result.fields.documentType.value,type);assert.equal(result.outcome,'recognized');
  assert.equal(result.fields.invoiceNumber.rawNumber,'10/27/00042');assert.equal(result.fields.invoiceNumber.value,'102700042');
  assert.equal(result.fields.invoiceNumber.suggestedNumber,'102700042');assert.equal(result.fields.invoiceNumber.effectiveNumber,null);
  assert.equal(result.fields.date.value,'2027-06-09');assert.equal(result.fields.net.value,201150);
  assert.equal(result.fields.vat.value,32184);assert.equal(result.fields.gross.value,233334);assert.equal(result.fields.currency.value,'ILS');
  assert.ok(result.fields.date.sources.every(source=>source.bounds.y<200));assert.equal(result.fields.allocationNumber.value,null);
 }
 const unusual=await recognize('herbawi',[bisan('חשבונית מס','10/27/42')]);
 assert.equal(unusual.fields.invoiceNumber.value,'10/27/42');assert.equal(unusual.fields.invoiceNumber.status,'review');
});

test('new supplier templates require issuer evidence and never add OCR or normalize unrelated numbers',async()=>{
 const unknown=utility();unknown.items=unknown.items.filter(item=>item.text!==tax);unknown.lines=invoicePdfLines(unknown.items);
 assert.equal((await recognize('bezeq',[unknown])).profile,null);
 const source=bisan();source.items.find(item=>item.text===tax).y=700;source.lines=invoicePdfLines(source.items);
 assert.equal((await recognize('herbawi',[source])).profile,null);
 const other={...profile('herbawi'),numberFormat:undefined};
 const ordinary=await recognizeInvoice({hasText:true,pages:[bisan()]},{profiles:[other]});assert.equal(ordinary.fields.invoiceNumber.value,'10/27/00042');
 const scan=await recognizeInvoice({hasText:false,pages:[page([])]});assert.equal(scan.outcome,'no_usable_text');
 assert.ok(Object.values(scan.fields).every(field=>field.value===null));
});
