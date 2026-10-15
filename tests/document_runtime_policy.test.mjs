import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {declaration,tokens} from './bank_policy_ast_fixture.mjs';
const root=new URL('../netunim-orders/document-bridge/',import.meta.url),baseline=JSON.parse(readFileSync(new URL('./fixtures/document-runtime-policies.json',import.meta.url),'utf8'));
const runtime=new Set(['ensureRoot','appendLog','readJsonFile','writeJsonFile','ensureToken','loadConfig','saveConfig','init','existsFile','normalizedRuntimePath','privateNodeRuntimeInfoSync']);
const windowsProcesses=new Set(['bridgeListenerPid','processAlive','forceStopProcessTree','waitForProcessExit']);
const replacements=new Set(['loopbackRequest','checkRunning','bridgeListenerPid','processAlive','forceStopProcessTree','waitForProcessExit','stopExisting']);
const tasks=new Set(['taskResultLabel','pdfMaintenanceTaskDiagnostics','taskActionDiagnosticLabel','printPdfMaintenanceTaskDiagnostics']);
for(const [name,expected] of Object.entries(baseline.functions))test('Document runtime preserves '+name,()=>{
 const file=windowsProcesses.has(name)?'windows-process-control.mjs':replacements.has(name)?'bridge-replacement-command.mjs':runtime.has(name)?'bridge-runtime-files.mjs':tasks.has(name)?'pdf-maintenance-task-diagnostics.mjs':name==='rebuildPdfFormIndexBacklog'?'pdf-inventory-reconciliation.mjs':'bridge-installation-diagnostics.mjs';
 const source=readFileSync(new URL(file,root),'utf8'),node=declaration(source,name);let actual=tokens(source.slice(node.start,node.end));
 if(name==='rebuildPdfFormIndexBacklog')actual=actual.replaceAll('clock.now()','Date.now()').replace('index.publish({pending:changed.length,pdfCount:full?rows.length:index.view().pdfCount});','pdfFormIndexPending=changed.length;pdfFormIndexInventoryCount=full?rows.length:pdfFormIndexInventoryCount;');
 assert.equal(createHash('sha256').update(tokens(expected.source)).digest('hex'),expected.digest);assert.equal(actual,tokens(expected.source));
});
test('the listener composes runtime diagnostics and inventory instead of owning their policies',()=>{
 const source=readFileSync(new URL('server.mjs',root),'utf8');for(const name of [...runtime,...tasks,...replacements,'printDoctor','writeInstallSummary'])assert.equal(source.includes('function '+name+'('),false);
 assert.ok(Buffer.byteLength(source.replaceAll('\r\n','\n'))<45000,'listener responsibility must remain below its new boundary budget');
 for(const file of ['pdf-inventory-reconciliation.mjs']){
  const owner=readFileSync(new URL(file,root),'utf8');for(const forbidden of ['node:fs','node:child_process','process.','setTimeout','createServer','createPdfInventory('])assert.equal(owner.includes(forbidden),false);
 }
});

test('each extracted Document runtime factory keeps a focused capability surface',()=>{
 for(const [file,name] of [['windows-process-control.mjs','createWindowsProcessControl'],['bridge-runtime-files.mjs','createBridgeRuntimeFiles'],['pdf-maintenance-task-diagnostics.mjs','createPdfMaintenanceTaskDiagnostics'],['bridge-installation-diagnostics.mjs','createBridgeInstallationDiagnostics'],['pdf-inventory-reconciliation.mjs','createPdfInventoryReconciliation'],['bridge-replacement-command.mjs','createBridgeReplacementCommand']]){
  const node=declaration(readFileSync(new URL(file,root),'utf8'),name),parameter=node.params[0].type==='AssignmentPattern'?node.params[0].left:node.params[0];assert.equal(parameter.type,'ObjectPattern');assert.ok(parameter.properties.length<=5,file+': use focused runtime capabilities');
 }
});
