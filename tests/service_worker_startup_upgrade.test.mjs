import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MessageChannel} from 'node:worker_threads';
import vm from 'node:vm';
import {mayStartApp} from '../shared/app-release-startup.js';

for(const app of ['kupa','orders']){
  function scenario({otherTab=false,waiting=true,updateFails=false,installing=false}={}){
    const source=readFileSync(new URL(`../netunim-${app}/site/service-worker.js`,import.meta.url),'utf8');
    const handlers={},listeners=new Map();
    let reloaded=0,skipped=0,updateCalls=0,registered=0;
    const earlier={id:'controller-before'};
    const container={controller:earlier,
      addEventListener(name,fn){listeners.set(name,fn)},
      removeEventListener(name,fn){if(listeners.get(name)===fn)listeners.delete(name)},
    };
    const windows=[{id:'current'}];
    if(otherTab)windows.push({id:'another-open-window'});
    const self={
      location:{origin:'https://app.test',href:'https://app.test/service-worker.js'},
      clients:{matchAll:async options=>{
        assert.equal(options.type,'window');assert.equal(options.includeUncontrolled,true);
        return windows;
      }},
      skipWaiting:async()=>{
        skipped++;
        if(windows.length===1){container.controller={id:'controller-next'};listeners.get('controllerchange')?.();}
      },
      addEventListener(name,handler){handlers[name]=handler},
    };
    vm.runInNewContext(source,{self,URL,Promise,Error,console});
    const next={state:installing?'installing':'installed',postMessage(data,ports){
      const tasks=[];
      handlers.message({data,source:{id:'current'},ports,waitUntil:p=>tasks.push(p)});
      void Promise.all(tasks);
    },addEventListener(name,fn){this.onChange=fn},removeEventListener(){this.onChange=null}};
    const registration={waiting:waiting&&!installing?next:null,installing:installing?next:null,
      update:async()=>{
        updateCalls++;
        if(updateFails)throw Error('offline');
        if(installing){next.state='installed';registration.installing=null;registration.waiting=next;next.onChange?.();}
      }};
    container.register=async(url,options)=>{
      assert.equal(url,'./service-worker.js');assert.equal(options.updateViaCache,'none');registered++;
      return registration;
    };
    const location={reload(){reloaded++}};
    async function run(){return mayStartApp({serviceWorker:container,location,makeChannel:()=>new MessageChannel()})}
    return {run,values:()=>({reloaded,skipped,updateCalls,registered,controller:container.controller.id})};
  }

  test(`${app}: a verified waiting release replaces one idle startup before application imports`,async()=>{
    const state=scenario();
    assert.equal(await state.run(),false);
    assert.deepEqual(state.values(),{reloaded:1,skipped:1,updateCalls:1,registered:1,controller:'controller-next'});
  });

  test(`${app}: other open tab blocks takeover; current release starts without reload`,async()=>{
    const state=scenario({otherTab:true});
    assert.equal(await state.run(),true);
    assert.deepEqual(state.values(),{reloaded:0,skipped:0,updateCalls:1,registered:1,controller:'controller-before'});
  });

  test(`${app}: an installation completing during the update check is eligible`,async()=>{
    const state=scenario({installing:true});
    assert.equal(await state.run(),false);
    assert.equal(state.values().reloaded,1);
  });

  test(`${app}: offline update check continues with the existing release`,async()=>{
    const state=scenario({waiting:false,updateFails:true});
    assert.equal(await state.run(),true);
    assert.equal(state.values().skipped,0);
  });
}

test('no service-worker capability does not prevent normal startup',async()=>{
  assert.equal(await mayStartApp({serviceWorker:undefined,location:{reload(){throw Error('unexpected')}}}),true);
});
