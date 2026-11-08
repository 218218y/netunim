import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {createDomainsCreditView} from '../netunim-kupa/site/assets/js/domains/credit/view.js';
import {todayISO,addMonthsISO} from '../netunim-kupa/site/assets/js/core/dates.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const css=readFileSync(resolve(root,'netunim-kupa/site/assets/app.css'),'utf8');

// Exercise the production HTML generator, not a duplicate hand-written table.
function detailTable({bulk=false}={}){
  const transactionDate=todayISO(),chargeDate=addMonthsISO(transactionDate,1);
  const transaction=(id,status)=>({
    id,status,processedDate:chargeDate,transactionDate,transactionTime:'14:35',
    chargedAmount:-10,chargedCurrency:'ILS',description:id
  });
  const state={
    version:4,expenses:[],checks:[],cash:[],cards:[],bank:{},
    credits:[{
      id:'manual-1',active:true,firstChargeDate:chargeDate,totalAmount:100,
      installments:1,card:'כרטיס ידני',account:'עסקי',description:'רכישה ידנית',transactionDate
    }],
    creditSync:{
      version:4,
      profiles:[{profileId:'test',provider:'max',accounts:[{
        accountNumber:'1234',txns:[transaction('synced', 'completed'),transaction('pending','pending')]
      }]}],
      cardMappings:{'test:1234':{included:true,cardName:'כרטיס מסונכרן'}}
    }
  };
  const ui={
    creditDetailMode:'all',creditAccountFilter:'all',creditProviderFilter:'all',creditCardFilter:'all',
    creditView:'rolling12',bulkCollection:bulk?'credits':'',bulkSelected:new Set()
  };
  let html='';
  const host={parentElement:null,set outerHTML(value){html=value;}};
  const previousDocument=globalThis.document;
  try{
    globalThis.document={getElementById:id=>id==='credit-transaction-sections'?host:null};
    const view=createDomainsCreditView({
      model:{state},ui,runFinance:callback=>callback(),syncBulkUi:()=>{},
      bulkHeader:collection=>bulk&&collection==='credits'?'<th class="bulk-check-col">בחירה</th>':'',
      bulkCell:collection=>bulk&&collection==='credits'?'<td class="bulk-check-col"></td>':'',
      dateEditorMarkup:()=>'<input>'
    });
    view.renderCreditDetails();
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
  assert.ok(html,'credit details did not render');
  return html;
}

function rows(html){
  const header=html.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/)?.[1];
  const body=html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
  assert.ok(header&&body,'missing header/body');
  return {
    headings:[...header.matchAll(/<th\b[^>]*>/g)],
    bodyRows:[...body.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)].map(([,attrs,content])=>({
      attrs,content,cells:[...content.matchAll(/<td\b[^>]*>/g)]
    }))
  };
}

test('credit detail: no unused actions column; all data cells and section spans match the header in either bulk mode',()=>{
  for(const bulk of [false,true]){
    const html=detailTable({bulk}),{headings,bodyRows}=rows(html);
    assert.equal(headings.length,bulk?8:7);
    assert.match(headings.at(-1)[0],/credit-detail-col-status/);
    assert.doesNotMatch(html,/credit-detail-(?:col-)?actions/);
    const dataRows=bodyRows.filter(row=>!row.attrs.includes('credit-detail-cycle-divider'));
    assert.equal(dataRows.length,3,'both synchronized cases and the editable manual record must appear');
    for(const row of dataRows){
      assert.equal(row.cells.length,headings.length,`misaligned cells: ${row.attrs}`);
      assert.match(row.cells.at(-1)[0],/credit-detail-status/,`status must be last: ${row.attrs}`);
    }
    const dividers=bodyRows.filter(row=>row.attrs.includes('credit-detail-cycle-divider'));
    assert.ok(dividers.length);
    for(const row of dividers)assert.match(row.content,new RegExp(`colspan="${headings.length}"`));
    const manual=dataRows.find(row=>row.attrs.includes('data-bulk-id="manual-1"'));
    assert.ok(manual,'manual row not rendered');
    assert.match(manual.content,/<td class="credit-detail-status">[\s\S]*?<button class="iconbtn credit-detail-edit" data-action="open-credit-modal-2" data-click-arg0="manual-1">עריכה<\/button><\/td>/);
    assert.equal((html.match(/data-action="open-credit-modal-2"/g)||[]).length,1);
    assert.equal(dataRows.filter(row=>row.attrs.includes('credit-synced-detail-row')).length,2);
    const synchronized=dataRows.filter(row=>row.attrs.includes('credit-synced-detail-row'));
    for(const row of synchronized){
      assert.match(row.content,/<td class="credit-detail-transaction-date"><span class="credit-transaction-date-value">[^<]+<\/span><small class="credit-transaction-time" dir="ltr">14:35<\/small><\/td>/);
    }
    assert.doesNotMatch(manual.content,/credit-transaction-time/, 'manual transaction without a time must show only a date');
  }
});

test('credit detail: compact date/time is rendered on separate lines, including in the mobile sizing rules',()=>{
  assert.match(css,/\.credit-transaction-date-value,\.credit-transaction-time\{display:block;direction:ltr;text-align:right;unicode-bidi:isolate\}/);
  assert.match(css,/\.credit-transaction-time\{margin-top:3px;color:var\(--muted\);font-size:10px\}/);
  assert.match(css,/\.credit-detail-col-transaction-date,\.credit-detail-transaction-date\{width:108px\}/);
  assert.match(css,/@media\(max-width:800px\)[\s\S]*?\.credit-detail-col-transaction-date,\.credit-detail-transaction-date\{width:100px\}/);
  assert.match(css,/\.credit-detail-edit\{display:block;margin:5px auto 0;/);
  assert.doesNotMatch(css,/\.credit-detail-(?:col-)?actions/);
});
