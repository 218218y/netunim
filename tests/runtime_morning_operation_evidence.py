"""Decoded production Morning recovery: bad evidence retains exact state; valid replay resumes."""
from browser_harness import BrowserSession, ROOT
from runtime_morning_cloud import LOCAL_CLOUD

FLOW = r"""(async()=>{
  await appReady;syncDocument.stopPolling();finance.runtime.stop();calendarRuntime.dispose();
"""+LOCAL_CLOUD+r"""
  const {createDomainsCustomersDocuments}=await import('./assets/js/domains/customers/documents.js');
  const {createMorningRequest}=await import('./assets/js/integrations/morning.js');
  const {createMorningDebtRecoveryContext,saveMorningDebtRecoveryContext,loadMorningDebtRecoveryContext,clearMorningDebtRecoveryContext}=await import('./assets/js/domains/customers/morning-debt-recovery.js');
  const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
  const raw=async()=>JSON.stringify({main:await db.load('local:orders'),checks:await db.load('local:shared-checks')}),before=await raw();
  const done=[],check=(ok,label)=>{if(!ok)throw Error(label);done.push(label)};
  const OP='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
  const valid={operation_id:OP,state:'created',document_id:'historical-document',document_type:305,amount:'42.00',verified_at:'2026-10-14T00:00:00Z'};
  for(const kind of ['foreign-failed','foreign-reserved','invalid-date','boolean-amount','foreign-abandonment','foreign-bank-document','malformed-rejection']){
    const context=createMorningDebtRecoveryContext({operationId:OP,type:305,amount:kind==='boolean-amount'?1:42,sourceKind:'standalone'});
    saveMorningDebtRecoveryContext(context);const retained=JSON.stringify(context),calls=[];let bad=true;
    cloudAuth.supaFetch=async(_path,options)=>{
      options.assertRequestScope();const input=JSON.parse(options.body);calls.push(input.action);
      if(!bad)return new Response(JSON.stringify({ok:true,operation:{...valid,amount:context.amount}}));
      if(kind==='malformed-rejection')return new Response(JSON.stringify({ok:false,code:'bad_fixture',uncertain:'false'}),{status:400});
      if(kind==='foreign-abandonment')return new Response(JSON.stringify(input.action==='status'?{ok:true,operation:{operation_id:OP,state:'reserved'}}:{ok:true,abandoned:true,operation:{operation_id:OTHER,state:'failed'}}));
      const operation=kind==='foreign-failed'?{operation_id:OTHER,state:'failed'}:kind==='foreign-reserved'?{operation_id:OTHER,state:'reserved'}:kind==='invalid-date'?{...valid,verified_at:'not-a-date'}:kind==='boolean-amount'?{...valid,amount:true}:valid;
      return new Response(JSON.stringify({ok:true,operation,...(kind==='foreign-bank-document'?{bank_link:{pending:false,operationId:OP,documentId:'foreign-document'}}:{})}));
    };
    const request=createMorningRequest({operationScope:fixtureMorningScope,supaFetch:(...args)=>cloudAuth.supaFetch(...args)});
    const documents=createDomainsCustomersDocuments({operationScope:fixtureMorningScope,request,model,modal(){},toast(){},documentsBrowser:{},dateEditorMarkup:()=>''});
    try{
      const stopped=await documents.recoverPendingMorningOperation();
      check(stopped.ok===false&&stopped.error?.code==='morning_operation_response_invalid',kind+': bad response grants no completion');
      check(JSON.stringify(loadMorningDebtRecoveryContext())===retained,kind+': exact durable operation retained');
      check(await raw()===before,kind+': Main and Shared journals unchanged');
      check(calls.join(',')===(kind==='foreign-abandonment'?'status,abandon_reservation':'status'),kind+': no create or extra mutation request');
      bad=false;const resumed=await documents.recoverPendingMorningOperation();
      check(resumed.ok&&resumed.state==='created'&&loadMorningDebtRecoveryContext()===null,kind+': original operation resumes after canonical verification');
      check(await raw()===before,kind+': standalone replay invents no journal effect');
    }finally{documents.dispose();await documents.runtime.drain();clearMorningDebtRecoveryContext(OP)}
  }
  return done;
})()"""

with BrowserSession(ROOT/'netunim-orders/site','morning-operation-evidence') as browser:
    result=browser.evaluate(FLOW,timeout=40)
    assert not browser.drain_serious_errors()
    print(f'PASS Morning operation evidence: {len(result)} native retained-recovery/journal/resumption assertions')
