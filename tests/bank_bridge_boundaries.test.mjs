import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {createBankBridgeRoutes} from '../netunim-kupa/bank-bridge/http-routes.mjs';
import {createBankBridgeHttpHandler} from '../netunim-kupa/bank-bridge/http-handler.mjs';

test('Bank HTTP/capability boundaries have explicit dependency and collaborator budgets',()=>{
  const contracts=[
    ['http-handler',['node:crypto','./wire-errors.mjs'],'createBankBridgeHttpHandler',3],
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

test('route and HTTP construction reject incomplete capabilities before a listener is created',()=>{
  assert.throws(()=>createBankBridgeRoutes({}),/bank_bridge_route_ports_required/);
  for(const ports of [{},{token:'token',routes:{resolve:()=>{}},health:null},{token:'',routes:{resolve:()=>{}},health:()=>({})}])assert.throws(()=>createBankBridgeHttpHandler(ports),/bank_bridge_http_ports_required/);
  const source=readFileSync(new URL('../netunim-kupa/bank-bridge/server.mjs',import.meta.url),'utf8');
  for(const helper of ['handler','readJson','sendJson','tokenEqual','corsHeaders'])assert.ok(!new RegExp(`function ${helper}\\(`).test(source),'composition must not retain a parallel HTTP implementation');
});
