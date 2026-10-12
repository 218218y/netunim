import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsBankController} from '../netunim-kupa/site/assets/js/domains/bank/controller.js';
import {createFinanceBrowserEffects} from '../shared/finance-browser-effects.js';

test('Kupa Bank diagnostic click failure releases the allocated URL and appended anchor', async t => {
  const urls = new Set(), anchors = new Set();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const anchor = {remove:() => anchors.delete(anchor), click() { throw Error('injected native click failure'); }};
  Object.defineProperty(globalThis, 'document', {configurable:true, value:{
    createElement:() => anchor, body:{appendChild:node => anchors.add(node)},
  }});
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  t.mock.method(URL, 'createObjectURL', () => { urls.add('blob:fixture'); return 'blob:fixture'; });
  t.mock.method(URL, 'revokeObjectURL', url => urls.delete(url));
  t.mock.method(globalThis, 'setTimeout', () => 1);
  const errors = [];
  const api = createDomainsBankController({
    model:{state:{bank:{},checks:[]}}, session:{}, checksSession:{}, saveState:async () => true, toast:message => errors.push(message), render:() => {},
    autoScope:() => null, operationScope:{capture:() => () => {}, captureRead:() => () => {}},
    effects:createFinanceBrowserEffects(),
    bridge:{getBridgeToken:() => 'synthetic', bankDiagnostics:async () => ({available:true,filename:'diagnostic.json',data:{version:1}})},
  });
  assert.equal(await api.exportBankChequeDiagnostics(), false);
  assert.deepEqual(errors, ['injected native click failure']);
  assert.equal(urls.size, 0, 'failed native click must release the temporary URL');
  assert.equal(anchors.size, 0, 'failed native click must remove the appended anchor');
});
