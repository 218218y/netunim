import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {declaration,tokens} from './bank_policy_ast_fixture.mjs';
import {createBridgeRuntimeFiles} from '../netunim-orders/document-bridge/bridge-runtime-files.mjs';
import {DEFAULT_ALLOWED_ORIGINS} from '../netunim-orders/document-bridge/lib.mjs';
const root=new URL('../netunim-orders/document-bridge/',import.meta.url),baseline=JSON.parse(readFileSync(new URL('./fixtures/document-runtime-policies.json',import.meta.url),'utf8'));
const securityPolicies={"saveConfig": "0fc1e36b92f0f768eb427fb865fd992516ef9fe04799d9ad15dff628994be432", "printDoctor": "bb0159eabd319e077dc6174519c6b6dc5bb3226aed712398f66b79a4bf5fb631", "writeInstallSummary": "ab91197a93a18a882407a5c03fdfcc5fc2f18d6d416cf452977ccc9af1102e27",
 "loopbackRequest":"83298355bc220e6762cdbbd3f9dcf6e5f72f3b0821ed044786c01a5d85c9282e",
 "checkRunning":"f0795adbf57ad7c8e75586f9ab7594b245c75b02d68cbdc25f30610b05201450"};
const expectedLoadConfig=`async function loadConfig(){
  const raw=await readJsonFile(CONFIG_PATH,{});
  return {
    roots:Array.isArray(raw.roots)?raw.roots:[],
    allowDriveRoots:raw.allowDriveRoots===true,
    everythingInstance:String(raw.everythingInstance||'').trim(),
    everythingExecutable:String(raw.everythingExecutable||'').trim(),
    allowedOrigins:configuredDocumentOrigins(raw.allowedOrigins),
    searchTimeoutMs:Math.max(3000,Math.min(30000,Number(raw.searchTimeoutMs)||15000)),
  };
}`;
const runtime=new Set(['ensureRoot','appendLog','readJsonFile','writeJsonFile','ensureToken','loadConfig','saveConfig','init','existsFile','normalizedRuntimePath','privateNodeRuntimeInfoSync']);
const windowsProcesses=new Set(['bridgeListenerPid','processAlive','forceStopProcessTree','waitForProcessExit']);
const replacements=new Set(['loopbackRequest','checkRunning','bridgeListenerPid','processAlive','forceStopProcessTree','waitForProcessExit','stopExisting']);
const tasks=new Set(['taskResultLabel','pdfMaintenanceTaskDiagnostics','taskActionDiagnosticLabel','printPdfMaintenanceTaskDiagnostics']);
for(const [name,expected] of Object.entries(baseline.functions).filter(([name])=>name!=='appendLog'))test('Document runtime preserves '+name,()=>{
 const file=windowsProcesses.has(name)?'windows-process-control.mjs':replacements.has(name)?'bridge-replacement-command.mjs':runtime.has(name)?'bridge-runtime-files.mjs':tasks.has(name)?'pdf-maintenance-task-diagnostics.mjs':name==='rebuildPdfFormIndexBacklog'?'pdf-inventory-reconciliation.mjs':'bridge-installation-diagnostics.mjs';
 const source=readFileSync(new URL(file,root),'utf8'),node=declaration(source,name);let actual=tokens(source.slice(node.start,node.end));
 if(name==='init')actual=actual.replace('await auditLog.prune();','');
 if(name==='rebuildPdfFormIndexBacklog')actual=actual.replaceAll('clock.now()','Date.now()').replace('index.publish({pending:changed.length,pdfCount:full?rows.length:index.view().pdfCount});','pdfFormIndexPending=changed.length;pdfFormIndexInventoryCount=full?rows.length:pdfFormIndexInventoryCount;');
 assert.equal(createHash('sha256').update(tokens(expected.source)).digest('hex'),expected.digest);
 if(name==='loadConfig')assert.equal(actual,tokens(expectedLoadConfig));
 else if(securityPolicies[name])assert.equal(createHash('sha256').update(actual).digest('hex'),securityPolicies[name],'reviewed security change with runtime behavior tests');
 else assert.equal(actual,tokens(expected.source));
});

test('actual configuration loader upgrades shipped Origins while preserving business roots and custom restrictions',async()=>{
 const previous=['https://bargig-furniture.com','https://bargig-orders.pages.dev','https://bargig-kupa.pages.dev'];
 const legacy=[...previous,'https://*.bargig-furniture.com','https://*.bargig-orders.pages.dev','https://*.bargig-kupa.pages.dev','http://localhost:*','http://127.0.0.1:*'];
 const ordersOnlyLegacy=legacy.filter(origin=>!origin.includes('bargig-kupa.pages.dev'));
 const roots=['C:\\Business\\Documents'];
 for(const allowedOrigins of [previous,legacy,ordersOnlyLegacy,['https://custom.example']]){
  let reads=0;
  const files={readFile:async file=>{assert.match(file,/config\.json$/);reads++;return JSON.stringify({allowedOrigins,roots,everythingInstance:' business ',searchTimeoutMs:1})}};
  const runtime=createBridgeRuntimeFiles({root:'isolated-config-fixture',files}),config=await runtime.loadConfig();
  assert.equal(reads,1);assert.deepEqual(config.roots,roots);assert.equal(config.everythingInstance,'business');assert.equal(config.searchTimeoutMs,3000);
  assert.deepEqual(config.allowedOrigins,allowedOrigins===previous||allowedOrigins===legacy||allowedOrigins===ordersOnlyLegacy?DEFAULT_ALLOWED_ORIGINS:allowedOrigins);
 }
});
test('the listener composes runtime diagnostics and inventory instead of owning their policies',()=>{
 const source=readFileSync(new URL('server.mjs',root),'utf8');for(const name of [...runtime,...tasks,...replacements,'printDoctor','writeInstallSummary','main','prepareShutdown','finishShutdown','documentBridgeStatus','loadPdfFormIndex','searchDocuments','deleteDocument','openDocument','previewMatches'])assert.equal(source.includes('function '+name+'('),false);
 assert.ok(Buffer.byteLength(source.replaceAll('\r\n','\n'))<18000,'listener responsibility must remain below its new boundary budget');
 for(const file of ['pdf-inventory-reconciliation.mjs']){
  const owner=readFileSync(new URL(file,root),'utf8');for(const forbidden of ['node:fs','node:child_process','process.','setTimeout','createServer','createPdfInventory('])assert.equal(owner.includes(forbidden),false);
 }
});

test('each extracted Document runtime factory keeps a focused capability surface',()=>{
 for(const [file,name] of [['windows-process-control.mjs','createWindowsProcessControl'],['bridge-runtime-files.mjs','createBridgeRuntimeFiles'],['pdf-maintenance-task-diagnostics.mjs','createPdfMaintenanceTaskDiagnostics'],['bridge-installation-diagnostics.mjs','createBridgeInstallationDiagnostics'],['pdf-inventory-reconciliation.mjs','createPdfInventoryReconciliation'],['bridge-replacement-command.mjs','createBridgeReplacementCommand']]){
  const node=declaration(readFileSync(new URL(file,root),'utf8'),name),parameter=node.params[0].type==='AssignmentPattern'?node.params[0].left:node.params[0];assert.equal(parameter.type,'ObjectPattern');assert.ok(parameter.properties.length<=5,file+': use focused runtime capabilities');
 }
});

test('runtime log policy delegates to the bounded privacy owner instead of the historical raw append',()=>{
 const source=readFileSync(new URL('bridge-runtime-files.mjs',root),'utf8');
 assert.match(source,/const appendLog=auditLog\.append/);
 assert.match(source,/async function init\(\)\{await auditLog\.prune\(\)/);
 const expected=baseline.functions.appendLog;
 assert.equal(createHash('sha256').update(tokens(expected.source)).digest('hex'),expected.digest);
});
