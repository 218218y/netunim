import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
import { declaration, tokens } from './bank_policy_ast_fixture.mjs';
import { restoreCreditRefresh } from './credit_refresh_policy_fixture.mjs';
import {createOrdersCreditRefresh} from '../netunim-orders/site/assets/js/domains/finance/credit-refresh.js';
import {createKupaCreditRefresh} from '../netunim-kupa/site/assets/js/domains/credit/refresh.js';
const read = (file) =>
  readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const baseline = JSON.parse(
  read('tests/fixtures/credit-refresh-preserved-policy.json'),
);
const clean = (key, value) =>
  ['start', 'end', 'raw', 'loc', 'range'].includes(key) ? undefined : value;
const ast = (source, name) =>
  JSON.parse(JSON.stringify(declaration(source, name), clean));
for (const site of ['orders', 'kupa']) {
  for(const [evidence,account] of [['missing status',{txns:[{id:'T'}]}],['unknown pending status',{pendingStatus:'garbage',pendingTransactions:[{id:'T',status:'pending'}]}],['unknown frame fetch status',{frameFetchStatus:'garbage',balance:999,cardFrame:9999}],['unknown frame status',{frameStatus:'garbage',balance:999}],['missing monthly rows',{months:[{month:'2026-10',fetchStatus:'success'}]}],['missing pending rows',{pendingStatus:'success'}],['boolean amount',{txns:[{id:'T',status:'completed',chargedAmount:true}]}]])test(site+' current publication rejects '+evidence+' before merge/write',async()=>{
    const create=site==='orders'?createOrdersCreditRefresh:createKupaCreditRefresh;
    const guard=()=>{},failures=[];let writes=0,merges=0,scans=0,releases=0;
    const status={bridgeVersion:73,contractVersion:2,profiles:[{profileId:'P'}]};
    const owner=create({authority:{capture:()=>guard},
      cloud:{refresh:async()=>({verified:true,state:{}}),readSync:()=>({profiles:[]})},
      device:{capture:()=>guard,readStatus:async()=>status,status:()=>status,error:()=>'',supported:()=>true,
        sync:async()=>{scans++;return {profiles:[{profileId:'P',accounts:[account]}]};},refreshStatus:async()=>status,reportFailure:guard},
      leases:{createToken:()=> 'T',reportFailure:guard,commands:{acquire:(leaseName,leaseToken)=>({
        ready:Promise.resolve({acquired:true,leaseName,leaseToken,fenceEpoch:1,assertCurrent:guard}),
        assertCurrent:guard,close:async()=>{releases++;}})},runtime:{isPending:()=>false,drain:async()=>{},dispose:()=>true}},
      policy:{normalizeMode:()=> 'forecast',resolveMode:()=> 'quick',selection:()=>[],lastSyncAt:()=>null,
        merge:()=>{merges++;return {}; }},
      publication:{commit:async()=>{writes++;return {saved:true};},publish:async()=>{writes++;}},
      automation:{allowed:()=>true,currentEpoch:()=>1,due:()=>true,mode:()=> 'smart',markAttempt:()=>true},
    });
    await owner.commands.refresh({allowed:()=>true,onDenied:guard,onDeferred:guard,onWarning:guard,onPublished:guard,
      onFailed:error=>{failures.push(error.code);},onDiagnosticsWarning:guard,onDiagnosticsFailed:guard,onFailureFinished:guard});
    await owner.runtime.drain();owner.runtime.dispose();
    assert.deepEqual(failures,['CREDIT_REFRESH_RESULT_INVALID']);
    assert.deepEqual({writes,merges,scans,releases},{writes:0,merges:0,scans:1,releases:1});
  });
  test(site+' Credit construction is inert and refuses missing real lease acquisition',()=>{
    const create=site==='orders'?createOrdersCreditRefresh:createKupaCreditRefresh;
    const unexpected=()=>assert.fail('construction performed accepted work');
    const ports={authority:{capture:unexpected},cloud:{refresh:unexpected,readSync:unexpected},
      device:{capture:unexpected,readStatus:unexpected,status:unexpected,error:unexpected,supported:unexpected,sync:unexpected,refreshStatus:unexpected,reportFailure:unexpected},
      leases:{createToken:unexpected,reportFailure:unexpected,commands:{acquire:unexpected},runtime:{isPending:()=>false,drain:async()=>{},dispose:()=>true}},
      policy:{normalizeMode:unexpected,resolveMode:unexpected,selection:unexpected,merge:unexpected,lastSyncAt:unexpected},
      publication:{commit:unexpected,publish:unexpected},automation:{allowed:unexpected,currentEpoch:unexpected,mode:unexpected,due:unexpected,markAttempt:unexpected}};
    const owner=create(ports);assert.equal(owner.runtime.isPending(),false);owner.runtime.dispose();
    assert.throws(()=>create({...ports,leases:{...ports.leases,commands:{}}}),/credit_refresh_lease_commands_acquire_required/);
  });
  const folder = `netunim-${site}/site/assets/js/domains/${site === 'orders' ? 'finance' : 'credit'}/`,
    name = site === 'orders' ? 'refreshCredit' : 'refreshCreditSync',
    ownerFile =
      folder + (site === 'orders' ? 'credit-refresh' : 'refresh') + '.js';
  test(
    site +
      ' Credit preserves immutable admission, modes, cooldown, merge, diagnostic, publication and awaited cleanup policy',
    () => {
      assert.equal(
        baseline.baseline,
        'fd94882b718ca05f0ff0c7348a2f5016ef016733',
      );
      assert.deepEqual(
        ast(restoreCreditRefresh(read(folder + 'controller.js'), site), name),
        ast(baseline.functions[folder + 'controller.js'][name], name),
      );
    },
  );
  test(
    site +
      ' Credit characterization rejects provider scope, publication and cleanup mutations',
    () => {
      const controller = read(folder + 'controller.js'),
        owner = tokens(read(ownerFile));
      for (const [from, to] of [
        [
          'interactive,syncMode:requestedMode',
          "interactive:false,syncMode:'forecast'",
        ],
        ['errors:issues', 'errors:[]'],
        ['await leaseSession?.close()', 'leaseSession?.close()'],
        ['if(!lease.acquired)', 'if(false)'],
      ]) {
        const changed = owner.replace(from, to);
        assert.notEqual(changed, owner, from);
        assert.notDeepEqual(
          ast(restoreCreditRefresh(controller, site, { owner: changed }), name),
          ast(baseline.functions[folder + 'controller.js'][name], name),
        );
      }
    },
  );
  test(
    site +
      ' Credit owner requires seven role APIs and no ambient provider/UI/storage authority',
    () => {
      const source = read(ownerFile),
        tree = parse(source, {
          ecmaVersion: 'latest',
          sourceType: 'module',
          ranges: true,
        });
      assert.equal(
        declaration(
          source,
          site === 'orders'
            ? 'createOrdersCreditRefresh'
            : 'createKupaCreditRefresh',
        ).params[0].properties.length,
        7,
      );
      for (const ref of analyze(tree, {
        ecmaVersion: 2022,
        sourceType: 'module',
      }).globalScope.through)
        assert.ok(
          ![
            'document',
            'window',
            'navigator',
            'localStorage',
            'fetch',
            'console',
            'setTimeout',
            'setInterval',
            'process',
          ].includes(ref.identifier.name),
          ref.identifier.name,
        );
      const controller = read(folder + 'controller.js'),
        fn = declaration(controller, name),
        command = controller.slice(fn.start, fn.end);
      for (const retired of [
        'leaseSession',
        'syncLeases',
        'syncCreditCards',
        'mergeCreditSyncResult',
        'refreshFinanceCloudSnapshot',
      ])
        assert.ok(!command.includes(retired), retired);
      for (const method of ['dispose', 'drain', 'isPending'])
        assert.ok(
          controller.includes('creditRefresh.runtime.' + method + '()'),
        );
    },
  );
}
