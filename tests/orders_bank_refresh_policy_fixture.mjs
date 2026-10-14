import {readFileSync} from 'node:fs';
import {declaration,tokens} from './bank_policy_ast_fixture.mjs';
const readOwner=()=>readFileSync(new URL('../netunim-orders/site/assets/js/domains/finance/bank-refresh.js',import.meta.url),'utf8');

// Recompose the actual controller's presentation/admission with the actual
// owner's provider/lease body. Only reviewed port substitutions and the added
// owner-lifetime fence are reversed; the immutable baseline is never rewritten.
export function restoreOrdersBankRefresh(controller,{owner=readOwner()}={}){
  const fn=declaration(controller,'refreshBank'),step=fn.body.body.find(n=>n.type==='TryStatement');
  const invocation=step?.block.body[0]?.argument?.argument;
  if(invocation?.callee?.object?.object?.name!=='bankRefresh')return controller;
  const options=invocation.arguments[0];
  const callback=name=>{
    const node=options.properties.find(p=>p.key.name===name)?.value;
    if(!node)throw Error('Bank presentation callback missing: '+name);
    return node.body.type==='BlockStatement'?tokens(controller.slice(node.body.start+1,node.body.end-1)):tokens(controller.slice(node.body.start,node.body.end))+';';
  };
  const run=declaration(owner,'runRefresh'),operation=run.body.body.find(n=>n.type==='TryStatement');
  let prefix=tokens(owner.slice(run.body.start+1,operation.start))
    .replace(/let lease=([^;]+);let leaseSession=([^;]+);let assertOwner;let assertConnection;/,'let lease=$1,leaseSession=$2,assertOwner,assertConnection;')
    .replace('active();','')
    .replace('assertOwner?.();assertConnection?.();leaseSession?.assertCurrent()','assertOwner();assertConnection();leaseSession?.assertCurrent()');
  let pipeline=tokens(owner.slice(operation.start,operation.handler.end));
  const published=callback('onPublished'),first=published.indexOf(';')+1;
  pipeline=pipeline
    .replace('onStarted();',callback('onStarted'))
    .replace('onDenied();',callback('onDenied'))
    .replace('device.recordScan(result.scan,assertConnection);onPublished(result);',published.slice(0,first)+'bankConnections.commands.recordScan(publication.scan,assertConnection);'+published.slice(first))
    .replace('onFailed(error,assertConnection,schedulerEpoch);',callback('onFailed'))
    .replace('active();assertOwner?.();assertConnection?.()','assertOwner?.();assertConnection?.()')
    .replace('assertCurrent:()=>{assertOwner?.();assertConnection?.()}','assertCurrent:()=>{assertOwner();assertConnection()}')
    .replace('const candidate=await device.fetchBalance','const result=await device.fetchBalance')
    .replace('const result=await publication.publish(candidate,','const publication=await publication.publish(result,')
    .replaceAll('financeBank(financeRow)?.archiveInitialized','financeRow?.state?.bank?.archiveInitialized')
    .replaceAll('financeBank(financeRow)?.archiveVersion','financeRow?.state?.bank?.archiveVersion');
  let closing=tokens(owner.slice(operation.finalizer.start+1,operation.finalizer.end-1))
    .replace('leases.reportFailure(error)',"console.error('orders bank sync lease release',error)");
  let combined=prefix+pipeline+'finally{'+closing+tokens(controller.slice(step.finalizer.start+1,step.finalizer.end-1))+'}';
  for(const [from,to] of [
    ['authority.capture()','operationScope.capture()'],['device.capture()','bankConnections.queries.capture()'],
    ['device.readStatus()','bankConnections.queries.readStatus()'],['device.supported(status)','bankConnections.queries.supported(status)'],
    ['device.fetchBalance(','bridge.fetchBalance('],['cloud.refresh(','refreshKupaReadout('],['cloud.readFinance(','readFinanceSyncDocument('],
    ['cloud.lastSyncAt()','bankLastSyncAt(checksSession.kupaCloudReadState)'],['automation.due(','bankRefreshDue('],
    ['automation.allowed()','financeAutomation.allowed(\'bank\')'],['automation.currentEpoch()','financeAutomation.currentEpoch()'],
    ['leases.commands.acquire(','syncLeases.commands.acquire('],['leases.createToken()','uid(\'FINLEASE\')'],
    ['publication.prepare(','bankSnapshots.commands.prepare('],['publication.publish(','bankSnapshots.commands.publish('],
  ])combined=combined.replaceAll(from,to);
  // Earlier immutable lease fixtures recognize the actual multiline cleanup
  // and denied-lease boundary. Preserve those source seams for their reviewed
  // heartbeat substitution instead of hiding them in a compact single line.
  combined=combined.replace('return false}if(auto){','return false}\nif(auto){')
    .replace('try{await leaseSession?.close();','try{\n        await leaseSession?.close();');
  const reconstructed=controller.slice(fn.start,step.start)+combined+'}';
  return controller.slice(0,fn.start)+reconstructed+controller.slice(fn.end);
}
