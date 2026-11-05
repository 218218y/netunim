import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreditCardBoundaryRowMarkup,creditCycleRowsMarkup,creditUpcomingSectionsMarkup} from '../shared/credit-detail-sections.js';

const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const formatDate=value=>value.split('-').reverse().join('.');

test('nearest sections preserve every row once while separating foreign, uncertain and regular cycles',()=>{
  const rows=[{id:'regular',date:'2026-09-10'},{id:'uncertain',detailCycleUncertain:true},{id:'foreign',foreignCurrency:true}];
  const before=JSON.stringify(rows),rendered=[];
  const markup=creditUpcomingSectionsMarkup(rows,{colspan:9,escapeHtml,formatDate,rowMarkup:row=>{rendered.push(row.id);return `<tr data-row="${row.id}"></tr>`}});
  assert.deepEqual(rendered,['foreign','uncertain','regular']);
  assert.equal(JSON.stringify(rows),before,'presentation must not change the issuer records');
  assert.ok(markup.indexOf('data-row="foreign"')<markup.indexOf('data-row="uncertain"'));
  assert.ok(markup.indexOf('data-row="uncertain"')<markup.indexOf('data-row="regular"'));
  assert.match(markup,/colspan="9"/);
  assert.match(markup,/10\.09\.2026/);
});

test('credit detail rows mark only transitions between account identities, including across section headings',()=>{
  const rows=[
    {id:'foreign-a1',card:'Same visible label',creditAccountKey:'account-a',foreignCurrency:true},
    {id:'foreign-a2',card:'Same visible label',creditAccountKey:'account-a',foreignCurrency:true},
    {id:'uncertain-b',card:'Same visible label',profileId:'profile-b',accountNumber:'123',detailCycleUncertain:true},
    {id:'regular-a',card:'Same visible label',creditAccountKey:'account-a'},
  ];
  const markup=creditUpcomingSectionsMarkup(rows,{
    colspan:8,
    escapeHtml,
    formatDate,
    rowMarkup:createCreditCardBoundaryRowMarkup((row,{cardBoundary})=>`<tr${cardBoundary?' class="credit-card-boundary"':''} data-row="${row.id}"></tr>`),
  });
  assert.deepEqual([...markup.matchAll(/<tr class="credit-card-boundary" data-row="([^"]+)"/g)].map(match=>match[1]),['uncertain-b','regular-a']);
  assert.equal((markup.match(/credit-card-boundary/g)||[]).length,2,'repeated rows for one account stay together, and both card changes get one boundary');
});

test('cycle headings keep card ordering and distinguish actual months without changing nominal-day grouping',()=>{
  const rows=[{id:'a',date:'2026-10-10'},{id:'b',date:'2026-10-11'},{id:'c',date:'2026-11-10'},{id:'d',date:'2026-10-10'}];
  const rendered=[];
  const markup=creditCycleRowsMarkup(rows,{colspan:7,escapeHtml,formatDate,rowMarkup:row=>{rendered.push(row.id);return `<tr data-row="${row.id}"></tr>`}});
  assert.deepEqual(rendered,['a','b','c','d'],'grouping must not reorder cards');
  assert.equal((markup.match(/credit-detail-cycle-divider/g)||[]).length,3,'Saturday/Sunday dates share a nominal cycle, but a different month and returning cycle need headings');
  assert.match(markup,/10\.11\.2026/);
});

test('dynamic cycle headings are escaped and an empty result has no phantom sections',()=>{
  const presentation={colspan:8,escapeHtml,formatDate:()=>'<script>bad</script>',rowMarkup:()=>'<tr class="row"></tr>'};
  const markup=creditCycleRowsMarkup([{date:'2026-10-10'}],presentation);
  assert.ok(!markup.includes('<script>'));
  assert.match(markup,/&lt;script&gt;bad&lt;\/script&gt;/);
  assert.equal(creditUpcomingSectionsMarkup([],presentation),'');
});
