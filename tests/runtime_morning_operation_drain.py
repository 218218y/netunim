"""Production Morning commands: disposal joins held issuance and preserves recovery/journals."""
from browser_harness import BrowserSession, ROOT
from runtime_morning_cloud import LOCAL_CLOUD

FLOW = r"""(async()=>{
  await appReady;syncDocument.stopPolling();finance.runtime.stop();calendarRuntime.dispose();
"""+LOCAL_CLOUD+r"""
  const done=[],check=(ok,label)=>{if(!ok)throw Error(label);done.push(label)};
  const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
  const held=gate(),entered=gate(),calls=[],documentId='11111111-1111-4111-8111-111111111111';
  const {loadMorningDebtRecoveryContext}=await import('./assets/js/domains/customers/morning-debt-recovery.js');
  const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
  const raw=async()=>JSON.stringify({main:await db.load('local:orders'),checks:await db.load('local:shared-checks')}),before=await raw();
  cloudAuth.supaFetch=async(_path,options)=>{
    options.assertRequestScope();const request=JSON.parse(options.body);calls.push(request);
    if(request.action==='status')return new Response(JSON.stringify({ok:true,configured:true,available:true,environment:'sandbox'}));
    if(request.action==='reserve')return new Response(JSON.stringify({ok:true,reserved:true,operation:{operation_id:request.operation_id,state:'reserved'}}));
    if(request.action==='create'){
      const response=new Response(JSON.stringify({ok:true,verified:true,document:{id:documentId,type:305,amount:42,number:'4001'}})),read=response.json.bind(response);
      response.json=async()=>{entered.resolve();await held.promise;return read()};return response;
    }
    throw Error('unexpected command after disposal: '+request.action);
  };
  const wait=async predicate=>{const until=performance.now()+5000;while(!predicate()){if(performance.now()>until)throw Error('Morning did not settle');await new Promise(done=>requestAnimationFrame(done))}};
  try{
    domainsCustomers.morningActions['open-morning-standalone']();await wait(()=>document.querySelector('[data-action="morning-create"]')?.disabled===false);
    document.querySelector('input[name="morningDocumentType"][value="305"]').checked=true;
    domainsCustomers.morningActions['morning-document-type']();
    document.getElementById('morningClientName').value='Exact customer';document.getElementById('morningAmount').value='42';document.getElementById('morningDescription').value='Exact document';
    document.querySelector('[data-action="morning-create"]').click();await wait(()=>document.getElementById('confirmBackdrop').classList.contains('open'));
    document.getElementById('confirmAccept').click();await entered.promise;
    const retained=JSON.stringify(loadMorningDebtRecoveryContext()),context=loadMorningDebtRecoveryContext();
    check(!!context&&context.operationId===calls.find(row=>row.action==='create').operation_id,'accepted issuance persisted exact operation before provider create');
    check(domainsCustomers.runtime.isPending(),'whole confirmation/reservation/create command belongs to runtime');
    check(domainsCustomers.dispose()&&!domainsCustomers.dispose(),'Customers disposal is final and idempotent');
    let drained=false;const draining=domainsCustomers.runtime.drain().then(()=>{drained=true});for(let n=0;n<8;n++)await Promise.resolve();
    check(!drained&&domainsCustomers.runtime.isPending(),'drain waits for held official response body after disposal');
    held.resolve();await draining;
    check(!domainsCustomers.runtime.isPending(),'accepted command settles its runtime after delayed body completion');
    check(JSON.stringify(loadMorningDebtRecoveryContext())===retained,'late official response cannot clear durable recovery');
    check(await raw()===before,'closed issuance preserves exact Main and Shared journals');
    check(calls.filter(row=>row.action==='create').length===1&&calls.filter(row=>row.action==='reserve').length===1,'disposal never retries create or reservation');
    check(!document.getElementById('modal').textContent.includes('Exact customer'),'disposal clears private issuance display');
    const count=calls.length;domainsCustomers.morningActions['morning-create']({});domainsCustomers.morningActions['morning-reconcile']({});await domainsCustomers.runtime.drain();
    check(calls.length===count,'closed public commands cannot send a new provider operation');
  }finally{held.resolve();domainsCustomers.dispose()}
  return done;
})()"""

with BrowserSession(ROOT/'netunim-orders/site','morning-operation-drain') as browser:
    result=browser.evaluate(FLOW,timeout=40)
    assert not browser.drain_serious_errors()
    print(f'PASS Morning operation drain: {len(result)} native issuance/lifecycle and retained-recovery assertions')
