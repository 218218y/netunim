import {test} from 'node:test';
import assert from 'node:assert/strict';
import {invoicePdfQuad} from '../netunim-orders/site/assets/js/core/invoice-pdf-layout.js';
import {invoiceHighlightTargets,invoiceHighlightRects} from '../netunim-orders/site/assets/js/core/invoice-highlights.js';
import {expenseAmountSanity} from '../netunim-orders/site/assets/js/core/morning-expense-amounts.js';

test('VAT plausibility uses exact cents, tolerates ten agorot, and never changes printed amounts',()=>{
  const regular={net:'1000.00',vat:'180.00',gross:'1180.00'};
  assert.equal(expenseAmountSanity(regular).status,'plausible');
  assert.equal(expenseAmountSanity({net:'1000',vat:'160',gross:'1160'},16).status,'plausible');
  assert.equal(expenseAmountSanity({net:'1000',vat:'180.10',gross:'1180.10'}).status,'plausible');
  const atypical={net:'1000',vat:'150',gross:'1150'};
  assert.equal(expenseAmountSanity(atypical).status,'different_rate');assert.equal(atypical.vat,'150');
  assert.equal(expenseAmountSanity({net:'1000',vat:'180',gross:'1000'}).status,'inconsistent');
  assert.equal(expenseAmountSanity({net:'',vat:'',gross:''}).status,'incomplete');
  assert.equal(expenseAmountSanity(regular,16).expectedVatCents,16000);
});
test('source glyph corners project to the same page for normal, rotated and cropped views',()=>{
  const quad=invoicePdfQuad({transform:[10,0,0,10,40,700],width:60,height:10,ascent:.8,descent:-.2});
  assert.deepEqual(quad,[40,698,100,698,100,708,40,708]);
  const targets=[{key:'invoiceNumber',label:'number',sources:[{page:2,quad}]}];
  const views=[{width:600,height:800,convertToViewportPoint:(x,y)=>[x,800-y]},
    {width:800,height:600,convertToViewportPoint:(x,y)=>[y,x]},
    {width:400,height:700,convertToViewportPoint:(x,y)=>[x-20,750-y]}];
  for(const view of views){const [rect]=invoiceHighlightRects(targets,2,view);
    assert.ok(rect.width>0&&rect.height>0&&rect.left>=0&&rect.top>=0);assert.equal(rect.key,'invoiceNumber');}
  assert.equal(invoiceHighlightRects(targets,1,views[0]).length,0);
  assert.equal(invoicePdfQuad({transform:null}),null);
});
test('highlight navigation follows form fields and computed net points at its two actual sources',()=>{
  const src=page=>({page,quad:[10,10,20,10,20,20,10,20]});
  const field=(value,page=1)=>({value,sources:[src(page),{page,quad:null}]});
  const fields={gross:field(11800,6),vat:field(1800,6),net:{...field(10000,6),method:'gross_minus_explicit_vat'},
    supplier:field('issuer'),invoiceNumber:field('000123'),date:field('2026-10-20')};
  const targets=invoiceHighlightTargets(fields);
  assert.deepEqual(targets.map(row=>row.key),['supplier','invoiceNumber','date','net','vat','gross']);
  assert.equal(targets[3].sources.length,2);assert.equal(targets[3].computed,true);
  assert.equal(invoiceHighlightTargets({invoiceNumber:{value:'0001',sources:[]}}).length,0);
});
