import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaxRemote} from '../shared/tax-calculator/remote.js';
import {root,check,describe} from './typecheck_contract_fixture.mjs';
import {readFileSync} from 'node:fs';
import path from 'node:path';
function fixture(){
  const f={epoch:1,writable:true,entered:0,row:{owner_id:'A',document_name:'profile',revision:2,state:{n:1},operation_id:'op',operation_replayed:false}};
  f.remote=createTaxRemote({capture:(edit=false)=>{const epoch=f.epoch;return ()=>{if(epoch!==f.epoch||edit&&!f.writable)throw Error('scope changed');};},decodeState:(_,raw)=>{if(!raw||typeof raw!=='object'||typeof raw.n!=='number')throw Error('invalid state');return structuredClone(raw);},equalState:(a,b)=>a.n===b.n,request:async(_,options)=>{f.entered++;options.assertRequestScope();if(f.hold)await f.hold;options.assertRequestScope();return {ok:true,status:200,text:async()=>{if(f.changeBody)f.epoch++;return JSON.stringify(f.row);}};}});
  f.flight={id:'op',expectedRevision:1,state:{n:1}};return f;
}
test('ACK rejects wrong owner, name, revision, operation, state and replay marker',async()=>{
  for(const patch of [{owner_id:'B'},{document_name:'year/2026'},{revision:'2'},{revision:3},{operation_id:'other'},{state:{n:2}},{operation_replayed:'yes'}]){
    const f=fixture();Object.assign(f.row,patch);await assert.rejects(f.remote.write('A','profile',f.flight));
  }
});
test('input flight is detached before HTTP await and write scope includes primary ownership',async()=>{
  const f=fixture();let release;f.hold=new Promise(resolve=>{release=resolve;});const task=f.remote.write('A','profile',f.flight);f.flight.state.n=99;release();assert.equal((await task).state.n,1);
  const g=fixture();g.hold=new Promise(resolve=>{release=resolve;});const blocked=g.remote.write('A','profile',g.flight);g.writable=false;release();await assert.rejects(blocked,/scope/);
});
test('account epoch is checked after reading the response body',async()=>{const f=fixture();f.changeBody=true;await assert.rejects(f.remote.write('A','profile',f.flight),/scope/);});
test('strict implementation checker rejects returning a display string as revision',()=>{
  const file=path.join(root,'shared/tax-calculator/remote.js'),original=readFileSync(file,'utf8'),changed=original.replace('return {revision:row.revision,state:decodeState(name,row.state)};',"return {revision:'saved',state:decodeState(name,row.state)};");assert.notEqual(changed,original);
  const diagnostics=check(new Map([[file,changed]]));assert.ok(diagnostics.some(d=>d.file&&path.resolve(d.file.fileName)===file&&d.code===2322),describe(diagnostics));
});
