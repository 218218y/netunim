import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {createBankBridgeRoutes} from '../netunim-kupa/bank-bridge/http-routes.mjs';
import {createBankBridgeHttpHandler} from '../netunim-kupa/bank-bridge/http-handler.mjs';
import {createHapoalimProvider} from '../netunim-kupa/bank-bridge/hapoalim-provider.mjs';
import {createHapoalimSessionAdapter} from '../netunim-kupa/bank-bridge/hapoalim-session.mjs';
import {createCreditProvider} from '../netunim-kupa/bank-bridge/credit-provider.mjs';
import {createCreditProfileSession} from '../netunim-kupa/bank-bridge/credit-session.mjs';

test('Bank HTTP/capability boundaries have explicit dependency and collaborator budgets',()=>{
  const contracts=[
    ['hapoalim-provider',['./provider-errors.mjs'],'createHapoalimProvider',7],
    ['credit-session',[],'createCreditProfileSession',4],
    ['credit-provider',['node:crypto','./lib.mjs','./credit-adapters.mjs','./credit-diagnostics.mjs'],'createCreditProvider',3],
    ['shutdown-owner',[],'createBridgeShutdownOwner',3],
    ['replacement-command',[],'createBridgeReplacementCommand',4],
    ['http-handler',['node:crypto','./wire-errors.mjs'],'createBankBridgeHttpHandler',4],
    ['http-routes',[],'createBankBridgeRoutes',8],
    ['finance-commands',['./lib.mjs','./credit-adapters.mjs','./credit-data-diagnostics.mjs'],'createFinanceCommands',3],
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
  for(const name of ['scrapeHapoalimSnapshot','scrapeAllCreditProfiles','scrapeCreditProfile','enableHapoalimSessionAwareLogin','waitForHapoalimSessionReady'])assert.ok(!new RegExp(`function ${name}\\(`).test(root));
  for(const [name,fields] of [['hapoalim-provider',['read']],['credit-session',['scrape']],['credit-provider',['scrape']],['hapoalim-session',['decorate','ready','reuse','safeUrl']]]){
    const source=readFileSync(new URL(`../netunim-kupa/bank-bridge/${name}.mjs`,import.meta.url),'utf8'),ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
    const factory=ast.body.find(node=>node.type==='ExportNamedDeclaration'&&node.declaration?.type==='FunctionDeclaration')?.declaration;
    const returned=factory.body.body.find(node=>node.type==='ReturnStatement').argument.arguments[0];
    assert.deepEqual(returned.properties.map(property=>property.key.name),fields,name+' public API');
    assert.ok(!source.includes("from 'node:fs"));
  }
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
