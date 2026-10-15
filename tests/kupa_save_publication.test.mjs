import test from 'node:test';
import assert from 'node:assert/strict';
import {createSavePublication} from '../netunim-kupa/site/assets/js/storage/save-publication.js';

function gate(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
test('Kupa cloud publication waits for the accepted mirror and coalesces only unpublished generations',async()=>{
  const entered=gate(),release=gate(),events=[],session={connectionMode:'file',backendReady:true,localGeneration:1};
  const api=createSavePublication({model:{state:{id:'visible'}},session,access:{storageV2Primary:()=>true},
    projection:{normalizeState:structuredClone,prepareKupaCloudState:structuredClone},view:{setSaveStatus:()=>{}},
    mirror:{persistState:async()=>{events.push('file:start');entered.resolve();await release.promise;events.push('file:done');return true}},
    cloud:{persistSupabaseState:async(snapshot,_msg,generation)=>{events.push(['cloud',snapshot,generation]);return true}},
  });
  const file=api.saveFile({id:'file'},'file',1);await entered.promise;
  session.connectionMode='supabase';session.localGeneration=3;
  const first=api.requestCloudSave({id:'old'},'old',2),latest=api.requestCloudSave({id:'latest'},'latest',3);
  assert.equal(first,latest);assert.deepEqual(events,['file:start']);
  release.resolve();assert.deepEqual(await Promise.all([file,first,latest]),[true,true,true]);
  assert.deepEqual(events,['file:start','file:done',['cloud',{id:'latest'},3]]);
});
