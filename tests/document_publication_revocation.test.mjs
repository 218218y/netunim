import test from 'node:test';
import assert from 'node:assert/strict';
import {createEverythingSearchCoordinator} from '../netunim-orders/document-bridge/everything-search-coordinator.mjs';

for(const mode of ['everything','content','recent'])test(`production ${mode} rechecks live authorization immediately before minting IDs`,async()=>{
  let admissions=0,published=0;
  const owner=createEverythingSearchCoordinator({
    configuration:{load:async()=>({searchTimeoutMs:1000})},
    session:{probe:async()=>({esPath:'inert',instance:'synthetic'}),invalidate:()=>{}},
    process:{run:async()=>({stdout:JSON.stringify([{name:'file.txt',path:'C:\\business',size:1}])})},
    pdf:{prepare:async()=>({partial:false}),search:()=>[]},
    publication:{prune:()=>{},admit:async rows=>++admissions===1?rows:[],publish:()=>{published++;return {id:'must-not-publish'}}},
    audit:{write:async()=>{}},
  });
  const result=mode==='recent'?await owner.recentDocuments(1):await owner.searchDocuments('file',1,mode,{},'',0,{},'word');
  assert.equal(admissions,2,'candidate and final-page checks must both be connected');
  assert.deepEqual(result.results,[]);assert.equal(result.partial,true);
  assert.equal(published,0,'a candidate revoked after enumeration receives no opaque ID');
  await owner.runtime.dispose();
});

test('revocation of the entire root after the native read fails without publishing any ID',async()=>{
  let admissions=0,published=0;
  const owner=createEverythingSearchCoordinator({configuration:{load:async()=>({searchTimeoutMs:1000})},
    session:{probe:async()=>({esPath:'inert'}),invalidate:()=>{}},process:{run:async()=>({stdout:'[{"name":"file.txt","path":"C:\\\\business"}]'})},
    pdf:{prepare:async()=>({partial:false}),search:()=>[]},
    publication:{prune:()=>{},admit:async rows=>{if(++admissions>1)throw Object.assign(Error('revoked'),{code:'DOCUMENT_ROOTS_NOT_CONFIGURED'});return rows},publish:()=>{published++}},audit:{write:async()=>{}}});
  await assert.rejects(owner.searchDocuments('file',1),{code:'DOCUMENT_ROOTS_NOT_CONFIGURED'});
  assert.equal(published,0);await owner.runtime.dispose();
});

test('a revocation with lookahead stops pagination and a fresh search rebuilds visible offsets',async()=>{
  const indexed=['hidden.txt','remaining.txt'];
  let hidden=false,admissions=0;
  const owner=createEverythingSearchCoordinator({
    configuration:{load:async()=>({searchTimeoutMs:1000})},
    session:{probe:async()=>({esPath:'inert',instance:'synthetic'}),invalidate:()=>{}},
    process:{run:async(_file,args)=>{
      const offset=Number(args[args.indexOf('-offset')+1])||0;
      const limit=Number(args[args.indexOf('-max-results')+1]);
      const rows=indexed.slice(offset,offset+limit).map(name=>({name,path:'C:\\business'}));
      return {stdout:JSON.stringify(rows)};
    }},
    pdf:{prepare:async()=>({partial:false}),search:()=>[]},
    publication:{
      prune:()=>{},
      admit:async rows=>{
        if(++admissions===2)hidden=true;
        return rows.filter(row=>!hidden||row.name!=='hidden.txt');
      },
      publish:row=>({id:row.name}),
    },
    audit:{write:async()=>{}},
  });
  const interrupted=await owner.searchDocuments('txt',1);
  assert.deepEqual(interrupted.results,[]);
  assert.equal(interrupted.partial,true);
  assert.equal(interrupted.hasMore,false);
  const refreshed=await owner.searchDocuments('txt',1);
  assert.deepEqual(refreshed.results,[{id:'remaining.txt'}]);
  assert.equal(refreshed.partial,false);
  assert.equal(refreshed.hasMore,false);
  await owner.runtime.dispose();
});
