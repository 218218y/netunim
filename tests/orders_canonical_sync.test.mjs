import test from 'node:test';
import assert from 'node:assert/strict';
import {comparableBackupData} from '../netunim-orders/site/assets/js/state/serialization.js';
import {createStateNormalization} from '../netunim-orders/site/assets/js/state/normalization.js';
test('JSONB field ordering cannot create perpetual local work after cloud ACK',()=>{
  const {normalizeState}=createStateNormalization({}),local=normalizeState({notes:[{id:'N',content:'same'}]});
  const remote=JSON.parse(JSON.stringify(local,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value));
  assert.equal(comparableBackupData(local),comparableBackupData(remote));
  assert.equal(comparableBackupData(normalizeState(structuredClone(remote))),comparableBackupData(remote));
  remote.notes[0].content='changed';assert.notEqual(comparableBackupData(local),comparableBackupData(remote));
});
