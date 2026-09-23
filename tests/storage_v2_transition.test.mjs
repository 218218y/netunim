import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageV2Transition} from '../shared/storage-v2-transition.js';

function coordinator(){let group=null;return {
  get ready(){return true},get hasGroup(){return !!group},get group(){return group},
  async load(){return group},async prepare(){return group??={id:'g',planHash:'h',phase:'complete'}},async advance(){throw new Error('unused')}
}}
function cutoverDb(){const rows=new Map();return {
  async readCutoverPreparation(scope){return rows.has(scope)?structuredClone(rows.get(scope)):null},
  async beginCutoverPreparation(scope,record){const current=rows.get(scope);if(current)return structuredClone(current);rows.set(scope,structuredClone(record));return structuredClone(record)},
  async advanceCutoverPreparation(scope,id,from,to,patch){const current=rows.get(scope);if(!current||current.id!==id||current.phase!==from)throw new Error('cutover changed');const next={...current,...structuredClone(patch),phase:to};rows.set(scope,next);return structuredClone(next)},
}}

test('transition does not begin cutover during hydrate or resume without a durable preparation',async()=>{
  const bootstrap=coordinator(),calls=[];
  // Inject the durable cutover store explicitly so this Node contract proves
  // hydrate/resume behavior without depending on a browser IndexedDB global.
  const db=cutoverDb();
  const transition=createStorageV2Transition({app:'orders',owner:()=> 'A',primary:()=>true,bootstrapCoordinator:bootstrap,cutoverDb:db,
    initializeMain:async()=>calls.push('main-init'),initializeShared:async()=>calls.push('shared-init'),syncMain:async()=>calls.push('main-sync'),syncShared:async()=>calls.push('shared-sync'),verifyBootstrap:async()=>({clean:true}),discoverBootstrap:async()=>({}),drainLegacy:async()=>calls.push('drain'),verifyLegacyClean:async()=>true,verifyHeads:async()=>({clean:true}),markCutover:async()=>calls.push('mark'),verifyCutover:async()=>true});
  await transition.hydrate();assert.equal(transition.preparing,false);assert.deepEqual(calls,[]);assert.equal(await transition.resume(),null);
});
