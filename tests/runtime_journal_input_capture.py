"""Caller mutation after a low-level IDB call cannot change accepted evidence."""
from browser_harness import BrowserSession, ROOT

with BrowserSession(ROOT/'netunim-orders/site', 'journal-input-capture', instrument=False) as browser:
    result = browser.evaluate(r"""(async()=>{
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const {sealStorageJsonRecord:seal}=await import('./assets/js/shared/storage-json-codec.js');
      const check=(ok,label)=>{if(!ok)throw Error(label)},note={id:'N',text:'accepted'};let serial=0;
      const cases=['setBase','beginFlight','acknowledge','rejectFlight','setControl','adoptCloudHead','resetCloudHead','resetState','clearControl','commitCloudRecovery'];
      for(const domain of ['orders','kupa','shared-checks'])for(const method of cases){
        const owner='A:'+domain,collection=domain==='shared-checks'?'checks':'notes',state={[collection]:[note]},empty={[collection]:[]};
        const checkpoint=(seq=0,epoch='E',value=state)=>seal({version:2,owner,epoch,seq,state:value});
        const base=(ackSeq=0,revision=2,epoch='E')=>seal({version:2,owner,epoch,revision,ackSeq,state});
        const control=()=>seal({version:2,owner,epoch:'E',retry:{attempts:1}});
        const flight=()=>seal({version:2,owner,epoch:'E',operationId:'F',baseRevision:1,startSeq:1,endSeq:1,snapshot:state});
        const db=createStorageJournalDb({name:'capture-'+(++serial)});await db.install(owner,checkpoint(0,'E',empty),'W');
        if(method!=='resetState')await db.setBase(owner,'E','W',base(0,1));
        if(['beginFlight','acknowledge','rejectFlight'].includes(method))await db.append(owner,'E','W',seal({version:2,owner,epoch:'E',seq:1,generation:1,operationId:'OP',at:'T',changes:[{type:'put',collection,id:'N',mode:'insert',index:0,record:note}]}));
        if(['acknowledge','rejectFlight'].includes(method))await db.beginFlight(owner,'E','W',flight());
        if(method==='clearControl')await db.setControl(owner,'E','W',control());
        const before=await db.load(owner),expected={seq:before.metadata.seq,checkpointChecksum:before.checkpoints.checksum,baseChecksum:before.bases?.checksum,controlChecksum:before.controls?.checksum??null};
        const seq=before.metadata.seq,cp=checkpoint(seq),nextBase=base(method==='acknowledge'?1:0),nextControl=control(),nextFlight=flight();
        let writing;
        if(method==='setBase')writing=db.setBase(owner,'E','W',nextBase);
        if(method==='beginFlight')writing=db.beginFlight(owner,'E','W',nextFlight);
        if(method==='acknowledge')writing=db.acknowledge(owner,'E','W','F',nextBase,{checkpoint:cp,control:nextControl});
        if(method==='rejectFlight')writing=db.rejectFlight(owner,'E','W','F',nextBase,{checkpoint:cp,expectedSeq:1,control:nextControl});
        if(method==='setControl')writing=db.setControl(owner,'E','W',nextControl);
        if(method==='adoptCloudHead')writing=db.adoptCloudHead(owner,'E','W',cp,nextBase,{expectedHead:expected});
        if(method==='clearControl')writing=db.clearControl(owner,'E','W',{expectedHead:expected});
        if(method==='commitCloudRecovery'){
          Object.assign(expected,{owner,epoch:'E',baseRevision:1,ackSeq:0});
          writing=db.commitCloudRecovery(owner,'E','W',cp,{expectedHead:expected});
        }
        if(method==='resetState'){
          delete expected.baseChecksum;
          Object.assign(expected,{epoch:'E'});Object.assign(cp,checkpoint(0,'NEW'));
          writing=db.resetState(owner,'E','W',cp,{expectedLocalHead:expected});
        }
        if(method==='resetCloudHead'){
          Object.assign(expected,{epoch:'E',revision:1});Object.assign(cp,checkpoint(0,'NEW'));Object.assign(nextBase,base(0,2,'NEW'));
          writing=db.resetCloudHead(owner,'E','W',cp,nextBase,{expectedCleanHead:expected});
        }
        // Re-sign valid changed records, so missing capture would consume a
        // different valid command rather than merely notice a broken checksum.
        for(const record of [cp,nextBase,nextFlight,nextControl]){
          if(record.data.state)record.data.state[collection][0].text='late mutation';
          if(record.data.snapshot)record.data.snapshot[collection][0].text='late mutation';
          if(record.data.retry)record.data.retry.attempts=99;
          Object.assign(record,seal(record.data));
        }
        expected.checkpointChecksum='changed';expected.seq=99;expected.baseRevision=99;
        await writing;
        const stored=await db.load(owner);
        for(const slot of ['checkpoints','bases','flights']){
          const value=stored[slot]?.data,rows=(value?.state||value?.snapshot)?.[collection];
          if(rows?.length)check(rows[0].text==='accepted',domain+' '+method+' '+slot);
        }
        if(stored.controls)check(stored.controls.data.retry.attempts===1,method+' control');
        if(['acknowledge','rejectFlight'].includes(method))check(stored.flights===null,method+' flight retained');
        if(method==='clearControl')check(stored.controls===null,'control not cleared');
      }
      const transitions=createStorageJournalDb({name:'capture-transitions'});
      for(const [method,key,input,read] of [
        ['beginBoundary','owner',{version:2,owner:'owner',id:'B',phase:'prepared'},()=>transitions.readBoundary('owner')],
        ['beginBootstrapGroup','scope',{version:2,scope:'scope',id:'BOOT',phase:'prepared',planHash:'HASH'},()=>transitions.readBootstrapGroup('scope')],
        ['beginLocalBirth','birth',{scope:'birth',id:'BIRTH',phase:'prepared'},()=>transitions.readLocalBirth('birth')],
      ]){
        input.evidence={text:'accepted'};const writing=transitions[method](key,input);
        input.evidence.text='late mutation';await writing;
        check((await read()).evidence.text==='accepted',method+' payload');
      }
      const patch={evidence:{text:'accepted'}},writing=transitions.advanceBootstrapGroup('scope','BOOT','prepared','applying',patch);
      patch.evidence.text='late mutation';await writing;
      check((await transitions.readBootstrapGroup('scope')).evidence.text==='accepted','bootstrap patch');
      return {scenarios:serial,transitions:4};
    })()""", timeout=40)
    assert result == {'scenarios': 30, 'transitions': 4}, result
    assert not browser.drain_serious_errors()
    print('PASS 30 native IDB input/precondition mutations plus four transition payload captures')
