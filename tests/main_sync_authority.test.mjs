import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudWriteAuthority} from '../shared/cloud-write-authority.js';
import {createCloudWriteAuthority as kupa} from '../netunim-kupa/site/assets/js/shared/cloud-write-authority.js';
import {createCloudWriteAuthority as orders} from '../netunim-orders/site/assets/js/shared/cloud-write-authority.js';

for(const [label,create] of [['canonical',createCloudWriteAuthority],['kupa',kupa],['orders',orders]]){
  for(const change of ['owner','epoch','login','writable','primary','preparing'])test(`${label} queued Main control observes ${change} at transaction time`,async()=>{
    let live={owner:'storage:A',epoch:'E',accountOwner:'A',loginEpoch:1,writable:true},primary=true,preparing=false;
    const captured={...live},head={base:{owner:live.owner,epoch:live.epoch}},control={retry:{attempts:1}},failure=new Error('storage_cloud_scope_changed');
    let release,observed;
    const gate=new Promise(resolve=>{release=resolve});
    const owner=create({scope:{read:()=>live},leadership:{primary:()=>primary,preparing:()=>preparing},control:{write:async(value,options)=>{observed={value,options};await gate;assert.equal(options.isCurrent(),false);throw failure}}});
    assert.equal(owner.isCurrent(captured,head),true);
    const writing=owner.setControl(captured,control);
    assert.equal(observed.value,control);assert.equal(observed.options.expectedScope,captured);
    if(change==='primary')primary=false;
    else if(change==='preparing')preparing=true;
    else live={...live,...({owner:{owner:'storage:B',accountOwner:'B'},epoch:{epoch:'F'},login:{loginEpoch:2},writable:{writable:false}}[change])};
    release();assert.equal(await writing,false);assert.equal(owner.isCurrent(captured,head),false);
  });
  test(`${label} current Main storage failure remains an error rather than success`,async()=>{
    const live={owner:'A',epoch:'E',accountOwner:'A',loginEpoch:1,writable:true},failure=new DOMException('controlled abort','AbortError');
    const owner=create({scope:{read:()=>live},leadership:{primary:()=>true,preparing:()=>false},control:{write:async()=>{throw failure}}});
    await assert.rejects(owner.setControl({...live},{retry:{attempts:1}}),error=>error===failure);
  });
}
