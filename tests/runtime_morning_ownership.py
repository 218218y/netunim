"""Isolated Morning authority races with real Main journals; no live issuance."""
import json
from browser_harness import BrowserSession, ROOT

with BrowserSession(ROOT/'netunim-orders/site','morning-operation-ownership') as browser:
    result=browser.evaluate(r"""(async()=>{
      const {createDomainsCustomersDocuments:buildMorning}=await import('./assets/js/domains/customers/documents.js');
      const {createMorningRequest}=await import('./assets/js/integrations/morning.js');
      const createDomainsCustomersDocuments=ports=>buildMorning({...ports,request:createMorningRequest({supaFetch:ports.supaFetch,operationScope:ports.operationScope})});
      const {createMorningDebtRecoveryContext,saveMorningDebtRecoveryContext,loadMorningDebtRecoveryContext,clearMorningDebtRecoveryContext,morningFinancialSnapshot}=await import('./assets/js/domains/customers/morning-debt-recovery.js');
      const {applyVerifiedMorningDocumentToDebt}=await import('./assets/js/domains/customers/morning-debt.js');
      const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const {STORAGE_SCHEMAS}=await import('./assets/js/shared/storage-v2-schema.js');
      const {INITIAL_STATE}=await import('./assets/js/state/constants.js');
      const {createStateNormalization}=await import('./assets/js/state/normalization.js');
      const {assertOrderEntityInvariants}=await import('./assets/js/state/validation.js');
      const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}},report=[],db=createStorageJournalDb();let serial=0;
      for(const boundary of ['headers','body','refresh','application'])for(const transition of ['account','relogin','leadership']){
        const id=++serial,operationId='11111111-1111-4111-8111-'+String(id).padStart(12,'0'),stamp='2026-10-09T00:00:00Z';
        let account='A',epoch=1,primary=true,applied=0,injection=true;const commits=[],models={},journals={},before={};
        for(const key of ['A','B']){
          const model={state:structuredClone(INITIAL_STATE)},normalization=createStateNormalization({model});model.state=normalization.normalizeState(model.state);delete model.state.checks;
          model.state.customerDebts=[{id:'same-debt',customerName:'Ownership fixture',amount:100,paid:false,invoiceIssued:false,closedAt:null}];model.state.notes=[{id:'note-'+key,content:'original '+key}];models[key]=model;
          const journal=createStorageJournal({owner:'morning-'+id+'-'+key+':orders',schema:STORAGE_SCHEMAS.orders,db,validate:state=>assertOrderEntityInvariants(state,{required:true})});journals[key]=journal;
          await journal.initializeCloudHead(7,model.state,{appMetadata:{storageRole:'primary',mainProjectionVersion:2}});before[key]=JSON.stringify(await db.load('morning-'+id+'-'+key+':orders'));
        }
        const context=createMorningDebtRecoveryContext({operationId,debtId:'same-debt',type:320,amount:30,applyPayment:true,applyInvoice:true,createdAt:stamp,financialSnapshot:morningFinancialSnapshot(models.A.state.customerDebts[0])});saveMorningDebtRecoveryContext(context);
        const entered=deferred(),gate=deferred(),change=()=>{if(!injection)return;if(transition==='account')account='B';else if(transition==='relogin')epoch++;else primary=false};
        const capture=()=>{const observed={account,epoch};return ()=>{if(!primary||account!==observed.account||epoch!==observed.epoch)throw Object.assign(Error('scope changed'),{code:'MORNING_OPERATION_SCOPE_CHANGED'})}};
        const documents=createDomainsCustomersDocuments({operationScope:{capture,captureRead:capture},model:{get state(){return models[account].state}},modal(){},toast(){},confirmDialog:async()=>true,markModalDraftSaved(){},dateEditorMarkup:()=>'',documentsBrowser:{invalidateCache(){},viewDocument:async()=>false},rejectSecondaryIssuance:()=>false,rejectSecondaryMutation:()=>false,
          refreshForMorningRecovery:async()=>{if(boundary==='refresh'){entered.resolve();await gate.promise}return true},
          applyVerifiedDebtDocument:args=>{applied++;const model=models[account],debt=model.state.customerDebts[0],effect=applyVerifiedMorningDocumentToDebt(debt,args);const receipt=journals[account].append([{type:'put',collection:'customerDebts',mode:'replace',id:debt.id,record:debt}]);commits.push(receipt.committed);if(boundary==='application'){entered.resolve();queueMicrotask(change)}return {...effect,persisted:receipt.emergencyDurable}},
          supaFetch:async()=>{if(boundary==='headers'){entered.resolve();await gate.promise}return {ok:true,json:async()=>{if(boundary==='body'){entered.resolve();await gate.promise}return {ok:true,operation:{operation_id:operationId,state:'created',document_type:320,amount:30,document_id:'document-A',verified_at:stamp}}}}},
        });
        const work=documents.recoverPendingMorningOperation();await entered.promise;if(boundary!=='application')change();gate.resolve();const completion=await work;await Promise.all(commits);
        const a=await journals.A.recover(),b=await journals.B.recover(),retained=JSON.stringify(loadMorningDebtRecoveryContext())===JSON.stringify(context);
        const unchangedB=JSON.stringify(await db.load('morning-'+id+'-B:orders'))===before.B,unchangedA=boundary==='application'?a.state.customerDebts[0].debtProgress?.length===2:JSON.stringify(await db.load('morning-'+id+'-A:orders'))===before.A;
        const notes=a.state.notes[0].id==='note-A'&&b.state.notes[0].id==='note-B';
        const originalApplied=applied;injection=false;account='A';epoch++;primary=true;
        const resumed=await documents.recoverPendingMorningOperation();await Promise.all(commits);const final=await journals.A.recover();
        const restored=resumed.ok===true&&resumed.state==='created'&&!loadMorningDebtRecoveryContext()&&final.state.customerDebts[0].debtProgress?.length===2&&final.state.customerDebts[0].debtProgress.every(row=>row.id.startsWith('MORNING:'+operationId+':'))&&JSON.stringify(await db.load('morning-'+id+'-B:orders'))===before.B;
        report.push({boundary,transition,applied:originalApplied,stopped:completion.ok===false,retained,unchangedA,unchangedB,notes,restored});clearMorningDebtRecoveryContext(operationId);
        documents.dispose?.();
      }
      return report;
    })()""",timeout=45)
    print('Morning authority real IDB: '+json.dumps(result,ensure_ascii=False),flush=True)
    failures=[row for row in result if not (row['applied']==(1 if row['boundary']=='application' else 0) and row['stopped'] and row['retained'] and row['unchangedA'] and row['unchangedB'] and row['notes'] and row['restored'])]
    assert not failures, 'Morning authority failures: '+json.dumps(failures,ensure_ascii=False)
    assert not browser.drain_serious_errors()
    browser._navigate()
    restarted=browser.evaluate(r"""(async()=>{
      await appReady;const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js'),{createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),{STORAGE_SCHEMAS}=await import('./assets/js/shared/storage-v2-schema.js');const db=createStorageJournalDb(),report=[];
      for(let id=1;id<=12;id++){
        const a=await createStorageJournal({owner:'morning-'+id+'-A:orders',schema:STORAGE_SCHEMAS.orders,db}).recover(),b=await createStorageJournal({owner:'morning-'+id+'-B:orders',schema:STORAGE_SCHEMAS.orders,db}).recover(),operationId='11111111-1111-4111-8111-'+String(id).padStart(12,'0');
        report.push(a.state.notes[0].id==='note-A'&&b.state.notes[0].id==='note-B'&&a.state.customerDebts[0].debtProgress.length===2&&a.state.customerDebts[0].debtProgress.every(row=>row.id.startsWith('MORNING:'+operationId+':'))&&!b.state.customerDebts[0].debtProgress?.length);
      }return report;
    })()""",timeout=45)
    assert len(restarted)==12 and all(restarted),restarted
    assert not browser.drain_serious_errors()
print('PASS Morning operation authority: 12 real IDB races, retained recovery, independent account journals and original IDs')

for transition in ('account','relogin','primary'):
    with BrowserSession(ROOT/'netunim-orders/site','morning-composed-'+transition) as browser:
        composed=browser.evaluate(r"""(async()=>{
          await appReady;syncDocument.stopPolling();domainsFinanceController.stopAutoSync?.();
          const transition=__TRANSITION__,owner='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
          const debt={id:'composed-morning-debt',customerName:'Ownership fixture',amount:100,paid:false,invoiceIssued:false,closedAt:null};state.customerDebts.push(debt);
          storagePersistence.scheduleSave('Morning composed fixture',{domains:['customerDebts'],operations:[{type:'put',collection:'customerDebts',mode:'insert',id:debt.id,record:debt,index:state.customerDebts.length-1}]});await mainStorageV2.commitPromise;
          const login=id=>cloudAuth.saveSession({user:{id},access_token:'fixture',expires_at:9999999999});login(owner);
          let main=null,shared=null;
          cloudTransport.readCloud=async()=>main;cloudTransport.readSharedChecksCloud=async()=>shared;
          cloudTransport.rpcSaveV2=async snapshot=>{main={revision:1,state:structuredClone(snapshot)};return {r:{ok:true},row:main}};
          cloudTransport.rpcSaveSharedChecksV2=async checks=>{shared={revision:1,state:{version:1,checks:structuredClone(checks),bankEvents:[]}};return {r:{ok:true},row:shared}};
          await storageV2Coordinator.startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'});session.storageProtocolBlocked=false;
          morningOperationScope.capture()();
          const {createMorningDebtRecoveryContext,saveMorningDebtRecoveryContext,loadMorningDebtRecoveryContext,morningFinancialSnapshot}=await import('./assets/js/domains/customers/morning-debt-recovery.js');
          const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
          const context=createMorningDebtRecoveryContext({operationId:'33333333-3333-4333-8333-333333333333',debtId:debt.id,type:320,amount:30,applyPayment:true,applyInvoice:true,createdAt:'2026-10-09T00:00:00Z',financialSnapshot:morningFinancialSnapshot(debt)});saveMorningDebtRecoveryContext(context);
          const before=JSON.stringify(await db.load(owner+':orders'));let release,entered;const bodyGate=new Promise(done=>{release=done}),bodyEntered=new Promise(done=>{entered=done});
          cloudAuth.supaFetch=async(_path,options)=>{options.assertRequestScope();return {ok:true,json:async()=>{entered();await bodyGate;return {ok:true,operation:{operation_id:context.operationId,state:'created',document_type:320,amount:30,document_id:'official-A',verified_at:'2026-10-09T00:00:00Z'}}}}};
          const work=domainsCustomers.recoverPendingMorningOperation();await bodyEntered;
          if(transition==='account')login('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb');else if(transition==='relogin')login(owner);else tab.primaryTab=false;
          release();const completion=await work;await mainStorageV2.commitPromise;
          return {stopped:completion.ok===false,retained:loadMorningDebtRecoveryContext()?.operationId===context.operationId,unchanged:JSON.stringify(await db.load(owner+':orders'))===before,noProjection:!state.customerDebts.find(row=>row.id===debt.id).debtProgress?.length};
        })()""".replace('__TRANSITION__',json.dumps(transition)),timeout=45)
        assert composed and all(composed.values()),composed
        assert not browser.drain_serious_errors()
        print('PASS composed Morning '+transition+': '+json.dumps(composed),flush=True)
