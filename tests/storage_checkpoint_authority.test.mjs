import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sealStorageJsonRecord as seal} from '../shared/storage-json-codec.js';
import {captureStorageCheckpoint,readStorageJournalDeletionKeys as keys} from '../shared/storage-checkpoint.js';
import {storageRecoveryFailure} from '../shared/storage-v2-runtime.js';

const checkpoint=()=>({version:2,owner:'A',epoch:'E',seq:1,state:{notes:[{id:'N',text:'original'}]},appMetadata:null});
const entry=()=>({version:2,owner:'A',epoch:'E',seq:1,changes:[],extraHistoricalMetadata:{retained:true}});
test('checkpoint commands decode and detach before a caller can mutate their authority',()=>{
  const original=seal(checkpoint()),accepted=captureStorageCheckpoint(original);
  original.data.state.notes[0].text='changed';original.data.epoch='other';
  assert.equal(accepted.data.epoch,'E');assert.equal(accepted.data.state.notes[0].text,'original');assert.equal(accepted.data.appMetadata,null);
});
for(const patch of [{version:'2'},{state:[]},{state:null},{seq:'1'},{seq:-1},{seq:1.5},{epoch:[]},{owner:null},{appMetadata:[]}])test('checksum-valid malformed replacement fails before authority: '+JSON.stringify(patch),()=>{
  assert.throws(()=>captureStorageCheckpoint(seal({...checkpoint(),...patch})),/storage_invalid_checkpoint/);
});
test('retirement keys prove the exact physical tuple without claiming a business operation schema',()=>{
  const physical=[['A','E',1]],result=keys([seal(entry())],physical,'A');
  assert.deepEqual(result,physical);result[0][1]='other';assert.equal(physical[0][1],'E');
});
for(const physical of [[],[['B','E',1]],[['A','other',1]],[['A','E',2]],[['A','E','1']],[['A','E',1,'extra']],[null]])test('mismatched physical journal row cannot grant deletion: '+JSON.stringify(physical),()=>{
  assert.throws(()=>keys([seal(entry())],physical,'A'),/storage_journal_key_mismatch/);
});
test('corrupt, foreign and malformed row envelopes stay retained',()=>{
  for(const patch of [{owner:'B'},{epoch:[]},{seq:0},{seq:'1'},{version:1}])assert.throws(()=>keys([seal({...entry(),...patch})],[['A','E',1]],'A'));
  const corrupt=seal(entry());corrupt.data.seq=2;assert.throws(()=>keys([corrupt],[['A','E',2]],'A'),/checksum/);
  assert.equal(storageRecoveryFailure(new Error('storage_journal_key_mismatch')),'fatal');
});
test('all checkpoint-writing IDB consumers capture the checked command before starting the transaction',()=>{
  const source=fs.readFileSync('shared/storage-journal-idb.js','utf8').replaceAll('\r\n','\n');
  for(const name of ['install','initializeCloudHead','compact','replaceCheckpoint','replaceLocalCheckpoint','acknowledge','rejectFlight','commitCloudRecovery','adoptCloudHead','resetState','resetCloudHead']){
    const body=source.slice(source.indexOf(`async function ${name}(`));
    assert.ok(body.indexOf('captureStorageCheckpoint(checkpoint)')<body.indexOf('return change('),name);
  }
  assert.ok(!source.includes('record.data.epoch,record.data.seq'),'retirement must not manufacture physical keys from payload alone');
});
test('implementation mutation of the physical-key comparison reproduces retirement authority for a different row',async()=>{
  let source=fs.readFileSync('shared/storage-checkpoint.js','utf8').replaceAll('\r\n','\n');
  source=source.replace("'./storage-json-codec.js'",JSON.stringify(new URL('../shared/storage-json-codec.js',import.meta.url).href));
  const comparison='key[1]!==data.epoch||key[2]!==data.seq';assert.ok(source.includes(comparison));source=source.replace(comparison,'false');
  const {readStorageJournalDeletionKeys:unsafe}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  assert.deepEqual(unsafe([seal(entry())],[['A','different',99]],'A'),[['A','E',1]]);
  assert.throws(()=>keys([seal(entry())],[['A','different',99]],'A'));
});
