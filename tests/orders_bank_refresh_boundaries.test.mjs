import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {analyze} from 'eslint-scope';
import {declaration,tokens} from './bank_policy_ast_fixture.mjs';
import {restoreOrdersBankRefresh} from './orders_bank_refresh_policy_fixture.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const folder='netunim-orders/site/assets/js/domains/finance/';
const baseline=JSON.parse(read('tests/fixtures/orders-bank-refresh-policy.json'));
const clean=(key,value)=>['start','end','raw','loc','range'].includes(key)?undefined:value;
const ast=source=>JSON.parse(JSON.stringify(declaration(source,'refreshBank'),clean));

test('Orders Bank admission, provider, lease, backfill, presentation and cleanup retain the immutable previous AST',()=>{
  assert.equal(baseline.baseline,'cc99ff2456dd900202eb85fced0df514acdc7945');
  assert.deepEqual(ast(restoreOrdersBankRefresh(read(folder+'controller.js'))),ast(baseline.refresh));
});
test('Bank characterization rejects changed freshness, interactive/history scope, publication and unawaited cleanup',()=>{
  const controller=read(folder+'controller.js'),owner=tokens(read(folder+'bank-refresh.js'));
  for(const [from,to] of [
    ['if(auto&&!automation.due(cloud.lastSyncAt()))return true;','if(auto)return true;'],
    ['historyDays=!auto&&!archiveReady?365:30','historyDays=365'],
    ['{interactive,historyDays}','{interactive:false,historyDays}'],
    ['financeRow,historyDays,lease,archiveReady,archiveVersion','financeRow,historyDays,lease,archiveReady:false,archiveVersion'],
    ['await leaseSession?.close()','leaseSession?.close()'],
  ]){
    const changed=owner.replace(from,to);assert.notEqual(changed,owner,from);
    assert.notDeepEqual(ast(restoreOrdersBankRefresh(controller,{owner:changed})),ast(baseline.refresh),from);
  }
});
test('Bank operation has six role APIs, unknown provider evidence and no UI/storage/network globals',()=>{
  const source=read(folder+'bank-refresh.js'),tree=parse(source,{ecmaVersion:'latest',sourceType:'module',ranges:true});
  assert.equal(declaration(source,'createOrdersBankRefresh').params[0].properties.length,6);
  assert.deepEqual(tree.body.filter(n=>n.type==='ImportDeclaration').map(n=>n.source.value),['../../shared/runtime-task-owner.js']);
  for(const ref of analyze(tree,{ecmaVersion:2022,sourceType:'module'}).globalScope.through)
    assert.ok(!['document','window','navigator','localStorage','fetch','console','setTimeout','setInterval','process'].includes(ref.identifier.name),ref.identifier.name);
  const body=read(folder+'controller.js'),refresh=declaration(body,'refreshBank');
  const command=body.slice(refresh.start,refresh.end);
  for(const retired of ['leaseSession','syncLeases','fetchBalance','bankSnapshots','readFinanceSyncDocument'])assert.ok(!command.includes(retired),retired);
  assert.ok(body.includes('bankRefresh.runtime.dispose()'));assert.ok(body.includes('bankRefresh.runtime.drain()'));
});
