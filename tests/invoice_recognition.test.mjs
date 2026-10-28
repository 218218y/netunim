import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recognizeInvoice,invoiceMoneyCents,invoiceDate,allocationPolicy} from '../netunim-orders/site/assets/js/core/invoice-recognition.js';
import {invoicePdfLines} from '../netunim-orders/site/assets/js/core/invoice-pdf-layout.js';
const tax='123456782',buyer='987654324';
const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('supplier-tax:'+tax))),n=>n.toString(16).padStart(2,'0')).join('');
const profile={id:'synthetic',title:'ספק בדיקה',aliases:['ספק בדיקה'],issuerTaxHash:hash,layout:'hash'};
function page(rows,number=1){const items=rows.map(([text,x,y,width],index)=>({text,x,y,width:width??text.length*5,height:10,index,page:number,dir:/[א-ת]/.test(text)?'rtl':'ltr',fontName:'synthetic'}));return {page:number,width:600,height:800,items,lines:invoicePdfLines(items)};}
const header=(number='000123',title='חשבונית מס')=>[['ספק בדיקה',400,30],[tax,450,50],[title,350,100],[number,250,100],['תאריך',150,135],['27/10/2026',50,135],[buyer,450,170],['תאריך פרעון',350,200],['31/12/2026',250,200]];
const totals=(net='1,000.00',vat='150.00',gross='1,150.00')=>[[net,50,600],['סה״כ לפני מע״מ',150,600],[vat,50,620],['מע״מ',150,620],['18.00',230,620,25],['%',269,620,8],[gross,50,640],['סה״כ לתשלום',150,640],['₪',20,640]];
const recognize=(pages,overrides={})=>recognizeInvoice({version:1,source:'local_pdf',hasText:true,pages},{profiles:[{...profile,...overrides}]});

test('supplier identification crosses issuer tax evidence with the profile and never chooses the recurring buyer',async()=>{
 const result=await recognize([page([...header(),...totals()])]);
 assert.equal(result.fields.supplier.value,tax);assert.equal(result.fields.supplier.canonicalVerified,false);assert.equal(result.fields.supplier.status,'review');
 const unknown=await recognize([page([...header().filter(row=>row[0]!==tax),...totals()])]);
 assert.equal(unknown.profile,null);assert.equal(unknown.fields.supplier.value,null);
 const buyerOnly=await recognize([page([['ספק אחר',400,30],['לכבוד',450,150],['ספק בדיקה',350,160],[tax,450,170],...totals()])]);
 assert.equal(buyerOnly.profile,null,'a known supplier appearing only as the buyer cannot establish issuer identity');
});
test('invoice identifiers retain zeroes and remain distinct from orders, long internal codes and allocations',async()=>{
 const result=await recognize([page([...header(),['IN100009999-INTERNAL',250,115],['מספר הקצאה',400,250],['111222333',300,250],['20261027123456789',180,250],...totals()])]);
 assert.equal(result.fields.invoiceNumber.rawNumber,'000123');assert.equal(result.fields.invoiceNumber.effectiveNumber,null);
 assert.equal(result.fields.allocationNumber.value,'111222333');assert.equal(result.fields.date.value,'2026-10-27');
 assert.equal(result.fields.allocationNumber.officiallyValidated,false);
});
test('only a verified supplier-specific prefix may be removed and zeroes are never trimmed',async()=>{
 const result=await recognize([page([...header('s000123'),...totals()])],{verifiedNumberPrefixes:['s']});
 assert.equal(result.fields.invoiceNumber.rawNumber,'s000123');assert.equal(result.fields.invoiceNumber.suggestedNumber,'000123');assert.equal(result.fields.invoiceNumber.normalizationVerified,true);
 const other=await recognize([page([...header('AB000123'),...totals()])]);
 assert.equal(other.fields.invoiceNumber.value,'AB000123');assert.equal(other.fields.invoiceNumber.status,'review');
 for(const number of ['SIX000123','SI000123-OTHER']){
  const changedTemplate=await recognize([page([...header(number),...totals()])],{verifiedNumberPrefixes:['SI']});
  assert.equal(changedTemplate.fields.invoiceNumber.suggestedNumber,number);
  assert.equal(changedTemplate.fields.invoiceNumber.status,'review');assert.notEqual(changedTemplate.fields.invoiceNumber.normalizationVerified,true);
 }
});
test('explicit monetary fields override line sums; detached VAT rate percentages never become VAT amounts',async()=>{
 const result=await recognize([page([...header(),['9,999.00',50,550],['סיכום שורות',150,550],...totals()])]);
 assert.equal(result.fields.net.value,100000);assert.equal(result.fields.vat.value,15000);assert.equal(result.fields.gross.value,115000);
 assert.equal(result.fields.net.status,'verified');assert.ok(result.fields.vat.sources.some(source=>source.text==='150.00'));
});
test('a receipt total below the invoice summary does not replace its explicit pre-VAT amount',async()=>{
 const summary=totals().map(row=>row[0]==='סה״כ לפני מע״מ'?['סה״כ',...row.slice(1)]:row);
 const result=await recognize([page([...header('000123','חשבונית מס / קבלה'),...summary,['1,150.00',50,720],['סה״כ',150,720]])],{layout:'morning'});
 assert.equal(result.fields.net.value,100000);assert.equal(result.fields.net.status,'verified');
 assert.equal(result.fields.net.method,'label_geometry');assert.equal(result.fields.net.sources[0].bounds.y,600);
});
test('user-confirmed Cocktail and Comfort prefixes keep raw evidence and preserve leading zeroes',async()=>{
 const {INVOICE_SUPPLIER_PROFILES}=await import('../netunim-orders/site/assets/js/core/invoice-supplier-profiles.js');
 for(const [supplier,prefix]of [['cocktail','CR'],['cocktail','SI'],['yesharim','SI']]){
  const actual=INVOICE_SUPPLIER_PROFILES.find(row=>row.id===supplier);
  const candidate={...actual,issuerTaxHash:hash,aliases:['ספק בדיקה'],layout:'hash'};
  const result=await recognizeInvoice({hasText:true,pages:[page([...header(prefix+'000123'),...totals()])]},{profiles:[candidate]});
  assert.equal(result.fields.invoiceNumber.rawNumber,prefix+'000123');assert.equal(result.fields.invoiceNumber.value,'000123');
  assert.equal(result.fields.invoiceNumber.suggestedNumber,'000123');assert.equal(result.fields.invoiceNumber.effectiveNumber,null);
  const other=await recognize([page([...header(prefix+'000123'),...totals()])]);
  assert.equal(other.fields.invoiceNumber.value,prefix+'000123','a supplier-specific prefix must not become a global removal rule');
 }
});
test('credit notes use type 330 with positive amounts and keep the original financial sign convention',async()=>{
 const result=await recognize([page([...header('000124','חשבונית מס זיכוי'),...totals()])]);
 assert.equal(result.fields.documentType.value,330);assert.equal(result.fields.gross.value,115000);assert.equal(result.allocationPolicy.status,'separate_treatment');
});
test('summary lookup crosses pages and ignores a trailing annex without mixing page totals',async()=>{
 const last=await recognize([page(header()),page(totals(),2),page([['נספח תנאים',200,50]],3)]);
 assert.equal(last.summaryPage,2);assert.equal(last.fields.gross.value,115000);assert.equal(last.fields.gross.sources[0].page,2);
 const mixed=await recognize([page([...header('000123'),...totals()]),page([...header('000124'),...totals()],2)]);
 assert.equal(mixed.fields.invoiceNumber.value,null);assert.equal(mixed.fields.gross.status,'review');
});
test('derived net is explicitly marked and inconsistent explicit totals require review',async()=>{
 const computed=await recognize([page([...header(),...totals()])],{derivedNet:true});
 assert.equal(computed.fields.net.value,100000);assert.equal(computed.fields.net.status,'review');assert.equal(computed.fields.net.method,'gross_minus_explicit_vat');
 const wrong=await recognize([page([...header(),...totals('999.00')])]);
 assert.ok(wrong.warnings.includes('amounts_inconsistent'));assert.ok(['net','vat','gross'].every(key=>wrong.fields[key].status==='review'));
});
test('SAP abbreviated after-discount net stays explicit even when the source totals disagree',async()=>{
 const rows=totals('999.78','180.00','1,180.00').map(row=>row[0]==='סה״כ לפני מע״מ'?['סה״כ אחרי הנחה',...row.slice(1)]:row[0]==='סה״כ לתשלום'?['סכום לתשלום',...row.slice(1)]:row);
 const head=header().map(row=>row[0]===tax?[tax,50,row[2]]:row);
 const result=await recognize([page([...head,...rows])],{layout:'sap'});
 assert.equal(result.fields.net.value,99978);assert.equal(result.fields.net.method,'label_geometry');
 assert.ok(result.warnings.includes('amounts_inconsistent'));assert.equal(result.fields.net.status,'review');
 assert.ok(result.fields.net.sources.some(row=>row.text==='סה״כ אחרי הנחה'));
});
test('ambiguous allocation candidates are never resolved by taking the last nine digits of an arbitrary string',async()=>{
 const result=await recognize([page([...header(),['מספר הקצאה',400,250],['111222333',300,250],['444555666',200,250],...totals()])]);
 assert.equal(result.fields.allocationNumber.value,null);assert.equal(result.fields.allocationNumber.status,'review');
 const packed=await recognize([page([...header(),['מספר הקצאה',400,250],['20261027123456789111222333',250,250],...totals()])]);
 assert.equal(packed.fields.allocationNumber.value,null);
});
test('allocation checks use dated net thresholds and preserve the separate business applicability conditions',()=>{
 const input={date:'2026-05-31',documentType:305,netCents:1000000,vatCents:180000};
 assert.equal(allocationPolicy(input).status,'below_threshold_or_no_vat');assert.equal(allocationPolicy({...input,netCents:1000001}).status,'check_business_conditions');
 assert.equal(allocationPolicy({...input,date:'2026-06-01',netCents:500000}).status,'below_threshold_or_no_vat');
 assert.equal(allocationPolicy({...input,date:'2026-06-01',netCents:500001}).status,'check_business_conditions');
 assert.equal(allocationPolicy({...input,netCents:9999999,vatCents:0}).status,'below_threshold_or_no_vat');
 assert.equal(allocationPolicy({...input,pcnClassification:'P'}).status,'separate_treatment');
 assert.equal(invoiceMoneyCents('₪5,000.01'),500001);assert.equal(invoiceMoneyCents('1.001'),null);assert.equal(invoiceMoneyCents('18.00%'),null);
 assert.equal(invoiceDate('31/02/26'),null);assert.equal(invoiceDate('01/06/26'),'2026-06-01');
});

test('shared summary rules cover each deployed layout with synthetic identities and fresh invoice values',async()=>{
 const {INVOICE_SUPPLIER_PROFILES}=await import('../netunim-orders/site/assets/js/core/invoice-supplier-profiles.js');
 for(const actual of INVOICE_SUPPLIER_PROFILES){
  const synthetic={...actual,issuerTaxHash:hash,aliases:['ספק בדיקה']};
  let head=header(actual.id==='roya'?'s000123':actual.id==='gaber'?'SI000123':'000123',actual.id==='gaber'?'חשבונית מס מרכזת':'חשבונית מס');
  if(actual.layout==='sap'||actual.issuerRegion==='left-column')head=head.map(row=>row[0]===tax?[row[0],50,row[2]]:row);
  if(actual.id==='gaber'){head=head.filter(row=>row[0]!==tax).map(row=>row[0]==='SI000123'?[row[0],60,145]:row);head.push(['ע.מ. '+tax,270,750]);}
  const netLabel=['tbi','morning'].includes(actual.layout)?'סה״כ':actual.layout==='priority'?'מחיר אחרי הנחה':actual.layout==='sap'?'סך הכול אחרי הנחה':'סה״כ לפני מע״מ';
  const grossLabel=actual.layout==='bina'?'לתשלום בש״ח':actual.layout==='priority'?'סה״כ כולל מע״מ':actual.layout==='sap'?'סכום לתשלום':actual.layout==='priority-print'?'סה״כ כללי':'סה״כ לתשלום';
  const rows=totals().map(row=>row[0]==='סה״כ לפני מע״מ'?[netLabel,...row.slice(1)]:row[0]==='סה״כ לתשלום'?[grossLabel,...row.slice(1)]:row);
  const result=await recognizeInvoice({version:1,hasText:true,pages:[page([...head,...rows])]},{profiles:[synthetic]});
  assert.equal(result.profile,actual.id,actual.id);assert.equal(result.fields.invoiceNumber.value,'000123',actual.id);
  assert.equal(result.fields.net.value,100000,actual.id);assert.equal(result.fields.vat.value,15000,actual.id);assert.equal(result.fields.gross.value,115000,actual.id);
 }
});

test('older overlapping summary labels are profile-scoped and retain the original source evidence',async()=>{
 const keys={net:['הסכ'],vat:['עממ'],gross:['הסכלתשלום','הסכהוחזר']};
 const rows=totals().map(row=>row[0]==='סה״כ לפני מע״מ'?['ה ס ״כ',...row.slice(1)]:row[0]==='מע״מ'?['ע 18% מ״מ',...row.slice(1)]:row[0]==='סה״כ לתשלום'?['ה ס ״כ לתשלום',...row.slice(1)]:row);
 const result=await recognize([page([...header(),...rows])],{summaryLabelKeys:keys});
 assert.equal(result.fields.net.value,100000);assert.equal(result.fields.vat.value,15000);assert.equal(result.fields.gross.value,115000);
 assert.ok(result.fields.vat.sources.some(row=>row.text==='ע 18% מ״מ'));
 const other=await recognize([page([...header(),...rows])]);
 assert.equal(other.fields.gross.value,null,'an unrelated supplier cannot use the legacy template keys');
});

test('side-by-side issuer columns require issuer identity on the left and exclude the buyer column',async()=>{
 const head=[['ספק בדיקה',50,150],[tax,90,185],['לכבוד',450,150],[buyer,450,185],['חשבונית מס / קבלה',250,90],['000789',180,90],['14/03/2026',480,92]];
 const result=await recognize([page([...head,...totals()])],{layout:'morning',issuerRegion:'left-column'});
 assert.equal(result.profile,'synthetic');assert.equal(result.fields.documentType.value,320);assert.equal(result.fields.invoiceNumber.value,'000789');assert.equal(result.fields.date.value,'2026-03-14');
 const wrong=await recognize([page(head.map(row=>row[0]===tax?[tax,450,185]:row))],{issuerRegion:'left-column'});
 assert.equal(wrong.profile,null);
});

test('multiple summary totals remain ambiguous instead of selecting a convenient number',async()=>{
 const result=await recognize([page([...header(),...totals(),['2,000.00',50,660],['סה״כ לתשלום',150,660]])]);
 assert.equal(result.fields.gross.value,null);
});

test('no text and scan captions are distinct from useful text with an unknown supplier and partial recognition',async()=>{
 for(const rows of [[],[['Scanned page cover - confidential',30,30]],[['Page 1 of 1',30,30]]]){
  const result=await recognize([page(rows)]);assert.equal(result.outcome,'no_usable_text');assert.equal(result.profile,null);
 }
 const unknown=await recognize([page([['Invoice 000123 unknown supplier',30,30]])]);assert.equal(unknown.outcome,'unknown_supplier');
 const partial=await recognize([page(header())]);assert.equal(partial.outcome,'partial_recognition');
 const full=await recognize([page([...header(),...totals()])]);assert.equal(full.outcome,'recognized');
});
