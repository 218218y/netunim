import test from 'node:test';
import assert from 'node:assert/strict';
import {auditFeatureEntry,auditApplicationEntries} from '../tools/feature-entry-audit.mjs';
import {composeActionRegistry,markMutationActions} from '../shared/action-registry.js';
import {wrapMutationActions} from '../netunim-orders/site/assets/js/ui/actions.js';

test('every application action pack returns completion and uses injected business owners',()=>{
  const report=auditApplicationEntries();
  assert.ok(report.reduce((sum,row)=>sum+row.actions.length,0)>400);
  assert.deepEqual(report.flatMap(row=>row.failures),[]);
});

test('entry gate rejects real bypasses and discarded conditional command completion',()=>{
  const invalid=[
    ["export const actions={'save':()=>{commit()}}",'discarded-completion:save'],
    ["export const actions={'save':()=>{if(ready)return commit();else fallback()}}",'discarded-completion:save'],
    ["export const actions={'save':()=>{if(ready){commit()}}}",'discarded-completion:save'],
    ["export const actions={'save':()=>fetch('/write')}",'raw-effect:fetch'],
    ["export const actions={'save':()=>window['fetch']('/write')}",'raw-effect:window'],
    ["const store=localStorage;export const actions={'save':()=>store.setItem('business','x')}",'raw-effect:localStorage'],
    ["import {save} from '../../storage/browser.js';export const actions={'save':()=>save()}",'owner-bypass-import'],
    ["export const actions={'save':()=>import('../../shared/storage-journal.js')}",'owner-bypass-import'],
    ["export const actions={'save':()=>import(target)}",'owner-bypass-import'],
    ["export const actions={'save':()=>setInterval(work,1000)}",'raw-effect:setInterval'],
  ];
  for(const [source,rule] of invalid)assert.ok(auditFeatureEntry(source).failures.some(row=>row.rule===rule),source);
  assert.deepEqual(auditFeatureEntry("export const actions={'search':element=>element.value,'save':()=>{if(ready)return commit();else return false}}").failures,[]);
});

test('example feature composes through its owner and preserves completion and startup admission',()=>{
  const source=`export function createExampleActions({commands}){
    return {'example-save':element=>commands.save(element.value)};
  }`;
  assert.deepEqual(auditFeatureEntry(source).failures,[]);
  const factory=Function(source.replace('export ','')+';return createExampleActions')();
  const calls=[],completion=Promise.resolve('owned receipt'),commands={save:value=>{calls.push(value);return completion}};
  const actions=markMutationActions(factory({commands}),{orders:['example-save']});
  const registry=composeActionRegistry([{name:'example',actions}]);
  assert.equal(wrapMutationActions(registry,()=>false)['example-save']({value:'blocked'}),undefined);
  assert.deepEqual(calls,[]);
  assert.equal(wrapMutationActions(registry,()=>true)['example-save']({value:'accepted'}),completion);
  assert.deepEqual(calls,['accepted']);
});

