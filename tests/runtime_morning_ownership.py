"""Isolated Morning authority races with real Main journals; no live issuance."""
import json
from browser_harness import BrowserSession, ROOT

with BrowserSession(ROOT/'netunim-orders/site','morning-operation-ownership') as browser:
    result=browser.evaluate(r"""(async()=>{
      const {createDomainsCustomersDocuments}=await import('./assets/js/domains/customers/documents.js');
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
        let account='A',epoch=1,primary=true,applied=0;const commits=[],models={},journals={},before={};
        for(const key of ['A','B']){
          const model={state:structuredClone(INITIAL_STATE)},normalization=createStateNormalization({model});model.state=normalization.normalizeState(model.state);delete model.state.checks;
          model.state.customerDebts=[{id:'same-debt',customerName:'Ownership fixture',amount:100,paid:false,invoiceIssued:false,closedAt:null}];model.state.notes=[{id:'note-'+key,content:'original '+key}];models[key]=model;
          const journal=createStorageJournal({owner:'morning-'+id+'-'+key+':orders',schema:STORAGE_SCHEMAS.orders,db,validate:state=>assertOrderEntityInvariants(state,{required:true})});journals[key]=journal;
          await journal.initializeCloudHead(7,model.state,{appMetadata:{storageRole:'primary',mainProjectionVersion:2}});before[key]=JSON.stringify(await db.load('morning-'+id+'-'+key+':orders'));
        }
        const context=createMorningDebtRecoveryContext({operationId,debtId:'same-debt',type:320,amount:30,applyPayment:true,applyInvoice:true,createdAt:stamp,financialSnapshot:morningFinancialSnapshot(models.A.state.customerDebts[0])});saveMorningDebtRecoveryContext(context);
        const entered=deferred(),gate=deferred(),change=()=>{if(transition==='account')account='B';else if(transition==='relogin')epoch++;else primary=false};
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
        report.push({boundary,transition,applied,stopped:completion.ok===false,retained,unchangedA,unchangedB,notes});clearMorningDebtRecoveryContext(operationId);
        documents.dispose?.();
      }
      return report;
    })()""",timeout=45)
    print('Morning authority real IDB: '+json.dumps(result,ensure_ascii=False),flush=True)
    failures=[row for row in result if not (row['applied']==(1 if row['boundary']=='application' else 0) and row['stopped'] and row['retained'] and row['unchangedA'] and row['unchangedB'] and row['notes'])]
    assert not failures, 'Morning authority failures: '+json.dumps(failures,ensure_ascii=False)
    assert not browser.drain_serious_errors()
print('PASS Morning operation authority: 12 real IDB races, retained recovery, independent account journals and original IDs')
