import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {createBankBridgeRoutes} from '../netunim-kupa/bank-bridge/http-routes.mjs';

const manifest=JSON.parse(readFileSync(new URL('../docs/evidence/bank-command-authority.json',import.meta.url),'utf8'));
const source=readFileSync(new URL('../netunim-kupa/bank-bridge/http-routes.mjs',import.meta.url),'utf8');

test('every registered Bank private route has an explicit reviewed effect and owner',()=>{
  const routes=[];
  let helperRegistration;
  let helperCount=0;
  function visit(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='VariableDeclarator'&&node.id.name==='json'){
      helperCount++;
      helperRegistration=node.init?.body;
      assert.equal(node.init?.type,'ArrowFunctionExpression');
      assert.equal(node.init.params[0]?.name,'key');
      assert.equal(helperRegistration?.callee?.object?.name,'routes');
      assert.equal(helperRegistration?.callee?.property?.name,'set');
      assert.equal(helperRegistration?.arguments?.[0]?.name,'key');
    }
    if(node.type==='CallExpression'&&(node.callee.name==='json'
      ||node.callee.object?.name==='routes'&&node.callee.property?.name==='set')){
      if(node!==helperRegistration){
        const key=node.arguments[0];
        assert.equal(typeof key?.value,'string','new computed route registration needs an explicit authority review');
        routes.push(key.value);
      }
    }
    for(const item of Object.values(node))for(const value of Array.isArray(item)?item:[item])if(value?.type)visit(value);
  }
  visit(parse(source,{ecmaVersion:'latest',sourceType:'module'}));
  assert.equal(helperCount,1);
  const reviewed=manifest.entries.filter(row=>!row.route.includes(':key'));
  assert.equal(new Set(manifest.entries.map(row=>row.route)).size,manifest.entries.length);
  assert.deepEqual(routes.sort(),reviewed.map(row=>row.route).sort());
  assert.equal(manifest.decision,'retain-single-pairing-authority');
  for(const row of manifest.entries){
    assert.ok(['read','write','provider','destructive','administrative'].includes(row.effect),row.route);
    assert.ok(row.risk.length>15&&row.capability.includes('.'),row.route);
  }
});

test('the reviewed routes and credit aliases still enter exactly their existing owner',async()=>{
  const calls=[];
  const tracked=name=>(...args)=>{calls.push({name,args});return name==='connections.importConnectionSettings'
    ?{bank:{},profiles:[],cleanupWarnings:[]}:name==='diagnostics.credit'?[]:null};
  const group=(name,methods)=>Object.fromEntries(methods.map(method=>[method,tracked(name+'.'+method)]));
  const routes=createBankBridgeRoutes({version:75,contractVersion:2,
    service:group('service',['bankStatus','creditStatus']),
    connections:group('connections',['saveCreditProfile','deleteCreditProfile','resetCreditProfiles','saveCredentials',
      'selectAccount','deleteCredentials','importConnectionSettings']),
    finance:group('finance',['balance','syncCredit']),diagnostics:group('diagnostics',['credit','creditData','bank']),
    cheques:group('cheques',['read']),shutdown:group('shutdown',['afterResponse']),
  });
  for(const row of manifest.entries){
    const [method,template]=row.route.split(' '),path=template.replace(':key','a'.repeat(64));
    for(const target of [path,...(path.startsWith('/credit/')?['/v2'+path]:[])]){
      calls.length=0;
      const route=routes.resolve(method,target);assert.ok(route,row.route);
      await route.run(route.readBody?{synthetic:true}:{});route.afterResponse?.();
      assert.deepEqual(calls.map(call=>call.name),[row.capability],row.route);
    }
  }
});
