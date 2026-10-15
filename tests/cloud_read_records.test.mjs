import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readCloudMetaRows,readCloudDocumentRows,readFinanceDocumentRows,readCloudBackupRows,readCloudBackupPointRows} from '../shared/cloud-read-records.js';
import {createCloudTransport as orders} from '../netunim-orders/site/assets/js/cloud/transport.js';
import {createCloudTransport as kupa} from '../netunim-kupa/site/assets/js/cloud/transport.js';
const at='2026-10-15T10:00:00.000Z';
const document=()=>({document_name:'main',revision:1,updated_at:at,state:{bank:{currentBalance:125,snapshotSeq:0,snapshotToken:null},creditSync:{profiles:[]}}});
const backup=()=>({id:1,revision:1,saved_at:at,state:{notes:[]}});

test('missing documents are explicit empty arrays; malformed or ambiguous successes fail closed',()=>{
  assert.equal(readCloudDocumentRows([],'main'),null);
  for(const value of [null,{},false,[document(),document()],[null]])assert.throws(()=>readCloudDocumentRows(value,'main'));
  for(const patch of [{revision:'1'},{revision:true},{revision:0},{revision:Number.MAX_SAFE_INTEGER+1},{document_name:'other'},{updated_at:null},{updated_at:'yesterday'},{state:[]},{state:false}])assert.throws(()=>readCloudDocumentRows([{...document(),...patch}],'main'));
  const {state,...meta}=document();assert.equal(readCloudMetaRows([meta],'main').revision,1);
});

test('Finance rejects plausible coercible money, snapshot authority and malformed sections',()=>{
  for(const state of [{bank:[]},{creditSync:[]},{bank:{currentBalance:'125'}},{bank:{currentBalance:true}},{bank:{snapshotSeq:'0'}},{bank:{snapshotSeq:-1}},{bank:{snapshotToken:[]}}, {bank:{feed:[]}},{creditSync:{profiles:[false]}}])assert.throws(()=>readFinanceDocumentRows([{...document(),state}],'main'));
  assert.deepEqual(readFinanceDocumentRows([{...document(),state:{bank:null}}],'main').state,{bank:null});
  const input=[document()],accepted=readFinanceDocumentRows(input,'main');input[0].state.bank.currentBalance=900;
  assert.equal(accepted.state.bank.currentBalance,125);
});

test('backup catalog and selected point validate every identity, revision, timestamp and state',()=>{
  for(const value of [null,{},[null],[{...backup(),id:'1'}],[{...backup(),revision:false}],[{...backup(),saved_at:at.slice(0,10)}],[backup(),backup()]])assert.throws(()=>readCloudBackupRows(value));
  assert.equal(readCloudBackupPointRows([],1),null);
  assert.throws(()=>readCloudBackupPointRows([backup()],2));
  assert.throws(()=>readCloudBackupPointRows([{...backup(),state:[]}],1));
  assert.throws(()=>readCloudBackupPointRows([backup()],null,'2026-10-14T00:00:00Z'));
  const input=[backup()],accepted=readCloudBackupPointRows(input,1);input[0].state.notes.push({id:'late'});
  assert.deepEqual(accepted.state.notes,[]);
});

for(const [app,create] of [['orders',request=>orders({supaFetch:request})],['kupa',request=>kupa({session:{cloudDocumentName:'main'},supaRest:request})]]){
  test(app+' transport rejects malformed Finance and backup success responses before consumers',async()=>{
    let value=[document()];const api=create(async()=>new Response(JSON.stringify(value)));
    assert.equal((await api.readFinanceSyncDocument()).revision,1);
    value=[{...document(),revision:'1'}];await assert.rejects(api.readFinanceSyncDocument(),/cloud_read_evidence_invalid/);
    value={};await assert.rejects(api[app==='orders'?'listOrdersCloudBackups':'listKupaCloudBackups'](),/cloud_read_evidence_invalid/);
  });
  test(app+' Finance decoder remains behind the account/operation fence after body parsing',async()=>{
    let release,entered,current=true;
    const gate=new Promise(resolve=>{release=resolve}),parsing=new Promise(resolve=>{entered=resolve});
    const api=create(async()=>({ok:true,json:async()=>{entered();await gate;return [document()]}}));
    const pending=api.readFinanceSyncDocument({assertCurrent:()=>{if(!current)throw Error('old account')}});
    await parsing;current=false;release();await assert.rejects(pending,/old account/);
  });
}

test('implementation mutation removing revision validation admits coerced revision authority',async()=>{
  let source=fs.readFileSync('shared/cloud-read-records.js','utf8');
  source=source.replace("'./storage-json-codec.js'",JSON.stringify(new URL('../shared/storage-json-codec.js',import.meta.url).href));
  const check='positiveInteger(value.revision)';assert.ok(source.includes(check));source=source.replace(check,'true');
  const {readCloudMetaRows:unsafe}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const value=[{...document(),revision:'1'}];assert.throws(()=>readCloudMetaRows(value,'main'));
  assert.equal(unsafe(value,'main').revision,'1');
});
