import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {declaration,tokens} from './bank_policy_ast_fixture.mjs';

const baseline=JSON.parse(readFileSync(new URL('./fixtures/kupa-persistence-policies.json',import.meta.url),'utf8'));
const read=file=>readFileSync(new URL('../netunim-kupa/site/assets/js/storage/'+file,import.meta.url),'utf8');
const body=(source,name)=>{const node=declaration(source,name);return source.slice(node.start,node.end)};

test('Kupa mutation and publication retain earlier decisions outside reviewed source admission',()=>{
  // File adoption deliberately gained detached source preparation and a paired
  // commit point. Its behavior is covered by kupa_source_transition and native
  // OPFS/IDB recovery, rather than freezing the old unsafe installation order.
  for(const [file,names] of [['local-commit.js',['mergeDeleteIntents','saveStateAccepted']],['save-publication.js',['requestCloudSave']]]){
    for(const name of names){
      let expected=body(baseline.policies[file],name),actual=body(read(file),name);
      // These two queue submissions moved behind the serialized publication
      // capability; all admission/normalization/durability decisions stay exact.
      expected=expected.replace("saveQueue=saveQueue.catch(e=>{console.error('previous save queue',e)}).then(()=>persistState(snapshot,msg,currentGeneration,deleteIntents));return saveQueue.then",'return publication.saveFile(snapshot,msg,currentGeneration).then');
      expected=expected.replace("saveQueue=saveQueue.catch(e=>{console.error('previous save queue',e)}).then(()=>persistState(snapshot,msg,generation,effectiveDeleteIntents));\n    return saveQueue.then",'return publication.saveFile(snapshot,msg,generation).then');
      actual=actual.replaceAll('publication.requestCloudSave(','requestCloudSave(');
      actual=actual.replace("if(session.localSourceSwitchPending){setSaveStatus('ממתין להשלמת חיבור מקור הנתונים','saving');return Promise.resolve(false)}",'');
      assert.equal(tokens(actual),tokens(expected),name);
    }
  }
});

test('Kupa routing plus file mirror preserve the entire historical persist policy',()=>{
  const mirror=declaration(read('local-file-mirror.js'),'persistState');
  const mirrorBody=read('local-file-mirror.js').slice(mirror.body.start+1,mirror.body.end-1);
  const actual=body(read('save-publication.js'),'persistState').replace('return mirror.persistState(snapshot,msg,generation);',mirrorBody);
  assert.equal(tokens(actual),tokens(body(baseline.policies['local-file-mirror.js'],'persistState')));
});
