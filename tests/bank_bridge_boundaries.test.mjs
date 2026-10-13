import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {createBankBridgeRoutes} from '../netunim-kupa/bank-bridge/http-routes.mjs';
import {createBankBridgeHttpHandler} from '../netunim-kupa/bank-bridge/http-handler.mjs';
import { createHapoalimProvider } from '../netunim-kupa/bank-bridge/hapoalim-provider.mjs';
import { createHapoalimSessionAdapter } from '../netunim-kupa/bank-bridge/hapoalim-session.mjs';
import {createCreditProvider} from '../netunim-kupa/bank-bridge/credit-provider.mjs';
import {createCreditProfileSession} from '../netunim-kupa/bank-bridge/credit-session.mjs';
import { createHapoalimAccountReader } from '../netunim-kupa/bank-bridge/hapoalim-accounts.mjs';
import { createHapoalimEnrichment } from '../netunim-kupa/bank-bridge/hapoalim-enrichment.mjs';
import { createHapoalimJsonReader } from '../netunim-kupa/bank-bridge/hapoalim-json.mjs';
import {createInstalledBrowserLocator} from '../netunim-kupa/bank-bridge/browser-locator.mjs';
import {createChequeImages} from '../netunim-kupa/bank-bridge/cheque-images.mjs';
import {createBridgeArtifacts} from '../netunim-kupa/bank-bridge/bridge-artifacts.mjs';
import {createJsonArtifactOwner} from '../netunim-kupa/bank-bridge/json-artifact-owner.mjs';

test('Bank HTTP/capability boundaries have explicit dependency and collaborator budgets',()=>{
  const contracts=[
    ['json-artifact-owner',['./file-task-owner.mjs'],'createJsonArtifactOwner',1],
    ['hapoalim-accounts',["./bank-money-value.mjs","node:crypto","./hapoalim-policy.mjs","./hapoalim-transaction-model.mjs","./hapoalim-account-model.mjs","./hapoalim-date-codec.mjs","./hapoalim-wire.mjs","./provider-errors.mjs","./wire-errors.mjs"],'createHapoalimAccountReader',5],
    ['hapoalim-enrichment',["./hapoalim-additional-details-model.mjs","./hapoalim-cheque-model.mjs","./hapoalim-credit-settlement-model.mjs","./hapoalim-transaction-model.mjs","./hapoalim-wire.mjs"],'createHapoalimEnrichment',3],
    ['browser-locator',[],'createInstalledBrowserLocator',2],
    ['hapoalim-provider',['./provider-errors.mjs'],'createHapoalimProvider',7],
    ['credit-session',[],'createCreditProfileSession',4],
    ['credit-provider',['node:crypto','./credit-profile-model.mjs','./credit-failure-policy.mjs','./credit-adapter-wire.mjs','./credit-sync-scope.mjs','./credit-diagnostic-model.mjs'],'createCreditProvider',3],
    ['shutdown-owner',[],'createBridgeShutdownOwner',3],
    ['replacement-command',[],'createBridgeReplacementCommand',4],
    ['http-handler',['node:crypto','./wire-errors.mjs'],'createBankBridgeHttpHandler',4],
    ['http-routes',[],'createBankBridgeRoutes',8],
    ['finance-commands',["./hapoalim-policy.mjs","./credit-sync-scope.mjs","./credit-data-diagnostics.mjs"],'createFinanceCommands',3],
    ['connection-queries',['./connection-commands.mjs'],'createConnectionQueries',3],
    ['diagnostic-queries',['./credit-data-diagnostics.mjs','./bank-diagnostics.mjs'],'createDiagnosticQueries',2],
  ];
  for(const [name,allowed,factory,maximum] of contracts){
    const source=readFileSync(new URL(`../netunim-kupa/bank-bridge/${name}.mjs`,import.meta.url),'utf8'),ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
    const imports=ast.body.filter(node=>node.type==='ImportDeclaration').map(node=>node.source.value);
    assert.deepEqual(imports,allowed,name+' must not acquire private infrastructure through new imports');
    const declaration=ast.body.find(node=>node.type==='ExportNamedDeclaration'&&node.declaration?.id?.name===factory)?.declaration;
    assert.ok(declaration);assert.equal(declaration.params.length,1);assert.equal(declaration.params[0].type,'ObjectPattern');assert.ok(declaration.params[0].properties.length<=maximum,name+' collaborator budget');
    assert.ok(!/\b(?:fetch|setTimeout|setInterval|spawn|readFile|writeFile|createServer)\s*\(/.test(source),name+' must use the required capability instead of creating runtime effects');
  }
});

test('Bank composition cannot keep parallel provider/session implementations or widen their public APIs',()=>{
  const root=readFileSync(new URL('../netunim-kupa/bank-bridge/server.mjs',import.meta.url),'utf8');
  for(const name of ['scrapeHapoalimSnapshot','scrapeAllCreditProfiles','scrapeCreditProfile','enableHapoalimSessionAwareLogin','waitForHapoalimSessionReady','pageFetchJson','pageFetchJsonOnce','enrichHapoalimTransactions','fetchHapoalimAccountSnapshot','fetchSelectedHapoalimSnapshot','readCachedChequeImage','writeCachedChequeImage','fetchChequeImageIntoCache','browserCandidates','rememberBrowser','findInstalledBrowser'])assert.ok(!new RegExp(`function ${name}\\(`).test(root));
  for(const [name,fields] of [['hapoalim-accounts',['read','lookbackDays']],['hapoalim-enrichment',['enrich']],['hapoalim-json',['read']],['browser-locator',['find']],['file-task-owner',['run','drain']],['hapoalim-provider',['read']],['credit-session',['scrape']],['credit-provider',['scrape']],['hapoalim-session',['decorate','ready','reuse','safeUrl']]]){
    const source=readFileSync(new URL(`../netunim-kupa/bank-bridge/${name}.mjs`,import.meta.url),'utf8'),ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
    const factory=ast.body.find(node=>node.type==='ExportNamedDeclaration'&&node.declaration?.type==='FunctionDeclaration')?.declaration;
    const returned=factory.body.body.find(node=>node.type==='ReturnStatement').argument.arguments[0];
    assert.deepEqual(returned.properties.map(property=>property.key.name),fields,name+' public API');
    assert.ok(!source.includes("from 'node:fs"));
  }
});

test('reader and image construction reject missing ports and create no platform jobs',()=>{
  for(const [factory,error] of [[createHapoalimAccountReader,'bank_account_ports_required'],[createHapoalimEnrichment,'bank_enrichment_ports_required'],[createHapoalimJsonReader,'bank_json_ports_required'],[createInstalledBrowserLocator,'browser_locator_ports_required'],[createChequeImages,'cheque_image_ports_required']])assert.throws(()=>factory({}),new RegExp(error));
  const unexpected=()=>{throw new Error('construction must remain inert')};
  const images=createChequeImages({directory:'fixture-directory',clock:{date:unexpected,now:unexpected},reporter:unexpected,files:new Proxy({},{get:unexpected})});
  assert.deepEqual(Object.keys(images),['read','attach','inRetention','cleanup','clear','drain']);
  const source=readFileSync(new URL('../netunim-kupa/bank-bridge/cheque-images.mjs',import.meta.url),'utf8'),ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
  const factory=ast.body.find(node=>node.type==='ExportNamedDeclaration').declaration;assert.equal(factory.params[0].properties.length,4);
});

test('artifact constructors reject missing ports and expose only fixed document namespaces',()=>{
  assert.throws(()=>createBridgeArtifacts({}),/bridge_artifact_ports_required/);
  assert.throws(()=>createJsonArtifactOwner({}),/json_artifact_ports_required/);
  const unexpected=()=>{throw new Error('construction must remain inert')};
  const artifacts=createBridgeArtifacts({directory:'fixture-directory',files:new Proxy({},{get:unexpected}),stamp:unexpected});
  const owner=createJsonArtifactOwner({files:{read:unexpected,write:unexpected,clear:unexpected}});assert.deepEqual(Object.keys(owner),['read','write','update','clear','drain']);
  assert.deepEqual(Object.keys(artifacts),['bankMeta','creditMeta','bankDiagnostic','creditData','drain']);
  assert.deepEqual(Object.keys(artifacts.bankMeta),['read','write']);assert.deepEqual(Object.keys(artifacts.creditMeta),['read','write','clear']);
  for(const name of ['readMeta','writeMeta','readCreditMeta','writeCreditMeta','readBankDiagnostic','writeBankDiagnostic','deleteBankDiagnostic','readCreditDataDiagnostic','writeCreditDataDiagnostic','deleteCreditDataDiagnostic']){
    const root=readFileSync(new URL('../netunim-kupa/bank-bridge/server.mjs',import.meta.url),'utf8');assert.ok(!new RegExp(`function ${name}\\(`).test(root));
  }
  const model=readFileSync(new URL('../netunim-kupa/bank-bridge/credit-diagnostic-model.mjs',import.meta.url),'utf8');
  assert.ok(!/\b(?:readFile|writeFile|appendFile|setTimeout|spawn|fetch)\s*\(/.test(model));
  const ast=parse(model,{ecmaVersion:'latest',sourceType:'module'});assert.deepEqual(ast.body.filter(node=>node.type==='ImportDeclaration').map(node=>node.source.value),['node:crypto']);
});

test('route and HTTP construction reject incomplete capabilities before a listener is created',()=>{
  assert.throws(()=>createBankBridgeRoutes({}),/bank_bridge_route_ports_required/);
  for(const ports of [{},{token:'token',routes:{resolve:()=>{}},health:null},{token:'',routes:{resolve:()=>{}},health:()=>({})}])assert.throws(()=>createBankBridgeHttpHandler(ports),/bank_bridge_http_ports_required/);
  const source=readFileSync(new URL('../netunim-kupa/bank-bridge/server.mjs',import.meta.url),'utf8');
  for(const helper of ['handler','readJson','sendJson','tokenEqual','corsHeaders'])assert.ok(!new RegExp(`function ${helper}\\(`).test(source),'composition must not retain a parallel HTTP implementation');
});

test('provider and session construction reject absent effects before accepting a request',()=>{
  assert.throws(()=>createHapoalimProvider({}),/bank_provider_ports_required/);
  assert.throws(()=>createHapoalimSessionAdapter({}),/bank_session_ports_required/);
  assert.throws(()=>createCreditProvider({}),/credit_provider_ports_required/);
  assert.throws(()=>createCreditProfileSession({}),/credit_session_ports_required/);
});
